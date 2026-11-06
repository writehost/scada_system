# -*- coding: utf-8 -*-
"""Режимы запуска через main.py: Image (с расчётом положения), Video, Calibration, проверка точности."""
import csv
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

from apriltag_tracking.app import AccuracyRow, accuracy_table
from apriltag_tracking.cli import main
from apriltag_tracking.export import read_jsonl
from synthetic import H, K, W, calibration_dict, chessboard_views, facing_pose, render


def write_cal(path, **kw):
    path.write_text(json.dumps(calibration_dict(**kw)), encoding="utf-8")
    return str(path)


def test_image_mode_computes_pose(tmp_path):
    """Исправление ошибки исходного image_test(): pose_args не передавались, положение не считалось."""
    R, t = facing_pose(0.5, 10, -5, 15, (0.02, -0.01))
    img, _ = render([("tag16h5", 3, 0.1, R, t)])
    png = tmp_path / "frame.png"
    cv2.imwrite(str(png), img)
    out = tmp_path / "m.jsonl"
    rc = main(["--image", str(png), "--calibration", write_cal(tmp_path / "cal.json"), "--no-window", "--save-jsonl", str(out), "--save-dir", str(tmp_path)])
    assert rc == 0
    rows = read_jsonl(out)
    assert len(rows) == 1
    m = rows[0]
    assert m["tag_id"] == 3 and m["status"] == "POSE_VALID" and m["source"] == "image"
    assert abs(m["distance_m"] - np.linalg.norm(t)) < 0.003
    assert abs(m["position_camera_m"]["z"] - t[2]) < 0.003
    assert (tmp_path / "apriltag_result.png").exists()


def test_image_mode_compat_fx_fy(tmp_path, capsys):
    R, t = facing_pose(0.5, 10, -5, 15)
    img, _ = render([("tag16h5", 3, 0.1, R, t)])
    png = tmp_path / "frame.png"
    cv2.imwrite(str(png), img)
    out = tmp_path / "m.jsonl"
    rc = main(["--image", str(png), "--tag-size-mm", "100", "--fx", "997.28", "--fy", "997.28", "--no-window", "--save-jsonl", str(out), "--save-dir", str(tmp_path)])
    assert rc == 0
    m = read_jsonl(out)[0]
    # параметры только из командной строки — калибровка не подтверждена: положение есть, но не POSE_VALID
    assert m["status"] == "POSE_UNCERTAIN" and "uncalibrated" in m["status_codes"] and not m["calibration_valid"]
    assert abs(m["distance_m"] - np.linalg.norm(t)) < 0.003


def test_image_mode_without_calibration(tmp_path):
    img, _ = render([("tag16h5", 3, 0.1, *facing_pose(0.5, 10, 0, 0))])
    png = tmp_path / "f.png"
    cv2.imwrite(str(png), img)
    out = tmp_path / "m.jsonl"
    assert main(["--image", str(png), "--no-window", "--save-jsonl", str(out), "--save-dir", str(tmp_path)]) == 0
    m = read_jsonl(out)[0]
    assert m["status"] == "NO_CALIBRATION" and m["distance_m"] is None and m["center_px"]


def test_calibration_resolution_mismatch_disables_metres(tmp_path):
    img, _ = render([("tag16h5", 3, 0.1, *facing_pose(0.5, 10, 0, 0))])
    small = cv2.resize(img, (640, 512))
    png = tmp_path / "f.png"
    cv2.imwrite(str(png), small)
    out = tmp_path / "m.jsonl"
    main(["--image", str(png), "--calibration", write_cal(tmp_path / "cal.json"), "--no-window", "--save-jsonl", str(out), "--save-dir", str(tmp_path)])
    m = read_jsonl(out)[0]
    assert m["status"] == "NO_CALIBRATION" and m["distance_m"] is None


def _write_video(path, frames, fps=7.0):
    vw = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (W, H), True)
    if not vw.isOpened():
        pytest.skip("OpenCV без записи видео MJPG")
    for f in frames:
        vw.write(cv2.cvtColor(f, cv2.COLOR_GRAY2BGR))
    vw.release()


def test_video_mode_events_loss_and_recovery(tmp_path):
    frames = []
    for i in range(10):
        frames.append(render([("tag16h5", 3, 0.1, *facing_pose(0.5 + 0.002 * i, 10, -5, 15))], seed=i)[0])
    frames += [np.zeros((H, W), np.uint8)] * 6  # кадры не получены (~0.9 с)
    for i in range(8):
        frames.append(render([("tag16h5", 3, 0.1, *facing_pose(0.6, 10, -5, 15))], seed=50 + i)[0])
    vid = tmp_path / "test.avi"
    _write_video(vid, frames)
    out = tmp_path / "m.jsonl"
    rc = main(["--video", str(vid), "--calibration", write_cal(tmp_path / "cal.json"), "--no-window", "--save-jsonl", str(out), "--lost-timeout-s", "0.5"])
    assert rc == 0
    rows = read_jsonl(out)
    events = [r["event"] for r in rows]
    assert events.count("detected") == 2 and events.count("lost") == 1
    assert events.index("lost") > 9
    valid = [r for r in rows if r["status"] == "POSE_VALID"]
    assert len(valid) >= 15
    last = rows[-1]
    assert abs(last["distance_m"] - np.linalg.norm([0, 0, 0.6])) < 0.01
    assert abs(last["smoothed"]["distance_m"] - 0.6) < 0.01


def test_accuracy_mode_on_video(tmp_path):
    frames = []
    for d in (0.30, 0.50, 1.00):
        for i in range(12):
            frames.append(render([("tag16h5", 3, 0.1, *facing_pose(d, 3, -2, 0))], seed=int(d * 100) + i)[0])
    vid = tmp_path / "acc.avi"
    _write_video(vid, frames)
    rc = main(["--video", str(vid), "--calibration", write_cal(tmp_path / "cal.json"), "--no-window", "--accuracy-cm", "30,50,100",
               "--accuracy-samples", "10", "--accuracy-metric", "z", "--save-dir", str(tmp_path), "--max-jump-m", "1.0"])
    assert rc == 0
    rows = list(csv.reader(open(tmp_path / "accuracy_report.csv", encoding="utf-8-sig"), delimiter=";"))
    data = [r for r in rows if r and not r[0].startswith("#")][1:]
    assert [float(r[0]) for r in data] == [30, 50, 100]
    for r in data:
        assert abs(float(r[3])) < 1.5, r  # относительная ошибка, % (синтетика, не реальная камера)


def test_accuracy_table_format():
    s = accuracy_table([AccuracyRow(30, 30.4, 30, 0.8, 0.3), AccuracyRow(100, None, 0, None, None)])
    assert "+0.40" in s and "+1.33" in s and "нет данных" in s


def test_calibration_mode_check_and_chessboard(tmp_path, capsys):
    img, _ = render([("tag16h5", 3, 0.1, *facing_pose(0.5, 15, -5, 0))])
    png = tmp_path / "f.png"
    cv2.imwrite(str(png), img)
    assert main(["--mode", "calibration", "--calibration", write_cal(tmp_path / "cal.json", calibrated=False), "--image", str(png)]) == 0
    out = capsys.readouterr().out
    assert "НЕ ПОДТВЕРЖДЕНА" in out and "решение 1" in out and "calibrated=false" in out
    views = chessboard_views()
    files = []
    for i, v in enumerate(views):
        f = tmp_path / f"cb_{i:02d}.png"
        cv2.imwrite(str(f), v)
        files.append(f)
    cal_out = tmp_path / "calibration.json"
    rc = main(["--mode", "calibration", "--chessboard", str(tmp_path / "cb_*.png"), "--board", "9x6", "--square-mm", "25",
               "--tag-size-mm", "100", "--calibration-out", str(cal_out), "--save-dir", str(tmp_path)])
    assert rc == 0
    data = json.loads(cal_out.read_text(encoding="utf-8"))
    assert data["calibrated"] is True and data["image_width"] == W
    Kc = np.array(data["camera_matrix"])
    assert abs(Kc[0, 0] - K[0, 0]) / K[0, 0] < 0.01 and abs(Kc[0, 2] - K[0, 2]) < 6


def test_calibration_board_auto(tmp_path, capsys):
    for i, v in enumerate(chessboard_views(cols=7, rows=5, square_m=0.03, n=10, seed=3)):
        cv2.imwrite(str(tmp_path / f"apriltag_raw_{i:02d}.png"), v)
    cal_out = tmp_path / "calibration.json"
    rc = main(["--mode", "calibration", "--chessboard", str(tmp_path / "apriltag_raw_*.png"), "--square-mm", "30",
               "--tag-size-mm", "100", "--calibration-out", str(cal_out), "--save-dir", str(tmp_path)])
    assert rc == 0
    out = capsys.readouterr().out
    assert "7×5" in out and "OK" in out
    data = json.loads(cal_out.read_text(encoding="utf-8"))
    assert data["board_inner_corners"] == "7x5" and data["calibrated"] is True
    assert list((tmp_path / "calib_debug").glob("*_ok.jpg"))


def test_calibration_no_board_explains(tmp_path, capsys):
    img, _ = render([("tag16h5", 3, 0.1, *facing_pose(0.5, 0, 0, 0))])
    for i in range(3):
        cv2.imwrite(str(tmp_path / f"apriltag_raw_{i}.png"), img)
    rc = main(["--mode", "calibration", "--chessboard", str(tmp_path / "apriltag_raw_*.png"), "--square-mm", "30",
               "--tag-size-mm", "100", "--calibration-out", str(tmp_path / "c.json"), "--save-dir", str(tmp_path)])
    assert rc != 0
    out = capsys.readouterr()
    assert "не метка AprilTag" in (out.out + out.err)


def test_calib_capture_from_video(tmp_path, capsys):
    views = chessboard_views(n=12, seed=5)
    vid = tmp_path / "board.avi"
    vw = cv2.VideoWriter(str(vid), cv2.VideoWriter_fourcc(*"FFV1"), 10, (W, H), False)
    for v in views:
        for _ in range(3):  # доска неподвижна 3 кадра — снимок должен сохраниться
            vw.write(v)
    vw.release()
    cal_out = tmp_path / "calibration.json"
    rc = main(["--mode", "calib-capture", "--video", str(vid), "--no-window", "--board", "9x6", "--square-mm", "25",
               "--tag-size-mm", "100", "--calibration-out", str(cal_out), "--save-dir", str(tmp_path), "--calib-frames", "20"])
    out = capsys.readouterr().out
    assert "SAVED" in out
    assert rc == 0, out
    data = json.loads(cal_out.read_text(encoding="utf-8"))
    assert data["calibrated"] is True and data["frames_used"] >= 8


def test_calib_capture_overexposed_hint():
    from apriltag_tracking.calib_capture import CalibCapture

    v = chessboard_views(n=1)[0].copy()
    v[: H // 2] = 255
    cap = CalibCapture(9, 6, Path("unused"))
    _, status, saved = cap.process(v, save=False)
    assert saved is None and ("overexposed" in status or "NOT found" in status)


def test_calibration_json_autoloaded(tmp_path, monkeypatch, capsys):
    img, _ = render([("tag16h5", 3, 0.1, *facing_pose(0.5, 0, 0, 0))])
    png = tmp_path / "f.png"
    cv2.imwrite(str(png), img)
    write_cal(tmp_path / "calibration.json", calibrated=True)
    monkeypatch.chdir(tmp_path)
    assert main(["--image", str(png), "--tag-size-mm", "100", "--no-window"]) == 0
    out = capsys.readouterr().out
    assert "Найден calibration.json" in out
    assert "POSE_VALID" in out or "POSE_UNCERTAIN" in out
