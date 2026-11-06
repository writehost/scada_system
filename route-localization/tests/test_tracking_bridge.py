"""Мост apriltag-tracking → позиция на плане: настоящий модуль apriltag-tracking на синтетических кадрах.

Синтетика проверяет согласованность систем координат и обработку потерь; точность на складе
проверяется только на объекте (рулеткой и по реальным меткам).
"""
import json
import math
import os
import sys

import numpy as np
import pytest

from route_localization.geometry import PlanFrame
from route_localization.pose import MarkerInfo
from route_localization.synthetic import default_calibration, render
from route_localization.tracker import TrackerConfig
from route_localization.tracking_bridge import (
    TrackingLocalizer,
    accuracy_report_ok,
    calibration_from_tracking_file,
    calibration_version,
    import_apriltag_tracking,
    measurements_to_detections,
)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRACKING = os.path.join(ROOT, "apriltag-tracking")
MPU = 0.8 / 12
FRAME = PlanFrame(MPU)
EXTR = {"look": "forward", "x": 0.3, "y": 0.05, "z": 1.1, "measured": True}


def wall_markers():
    # три метки на стене, смотрят навстречу погрузчику (курс 180° = на −x плана), высота 1.2 м
    return [MarkerInfo("tag16h5", i, 2000.0, 880.0 + i * 12.0, 1.2, 0.15, yaw_deg=180.0, mount="wall") for i in range(3)]


def write_cal(tmp_path, calibrated=True):
    c = default_calibration(extr=EXTR)
    data = {
        "image_width": c.width,
        "image_height": c.height,
        "camera_matrix": c.K.tolist(),
        "dist_coeffs": c.dist.tolist(),
        "rms_px": 0.16,
        "calibrated": calibrated,
        "camera_id": "MV-CU013-A0GM",
    }
    p = tmp_path / "calibration.json"
    p.write_text(json.dumps(data), encoding="utf-8")
    return str(p), c


@pytest.fixture(scope="module")
def at():
    return import_apriltag_tracking(TRACKING)


def make_pipeline(cal_path, markers):
    from apriltag_tracking.cli import build_parser, make_pipeline as mk

    class Src:
        image = None
        camera_id = "synthetic"

    args = build_parser().parse_args(["--calibration", cal_path, "--families", "tag16h5", "--no-window", "--image", "x.png"])
    pipe = mk(args, Src())
    pipe.estimator.cal.tag_sizes_m = {f"{m.family}:{m.tag_id}": m.size_m for m in markers}
    return pipe


def run_frames(at, tmp_path, poses, markers=None):
    from apriltag_tracking.capture import Frame

    markers = markers or wall_markers()
    cal_path, calib = write_cal(tmp_path)
    info = calibration_from_tracking_file(cal_path, EXTR)
    loc = TrackingLocalizer(FRAME, markers, info, tracker_cfg=TrackerConfig(meters_per_unit=MPU, lost_after_s=1.0, predict_max_s=0.5))
    pipe = make_pipeline(cal_path, markers)
    outs = []
    for i, (x, y, h, t) in enumerate(poses):
        img = render(FRAME, markers, calib, x, y, h, noise=1.0, seed=i) if x is not None else np.full((calib.height, calib.width), 170, np.uint8)
        fr = Frame(img, i + 1, t, 1_800_000_000.0 + t)
        r = pipe.process(fr)
        outs.append(loc.on_frame(fr.frame_id, fr.t, fr.t_wall, r.measurements, r.current))
    return loc, outs


def test_wall_tags_forward_camera_world_pose(at, tmp_path):
    x, y, h = 2000.0 - 2.5 / MPU, 892.0, 4.0
    loc, outs = run_frames(at, tmp_path, [(x, y, h, 0.25 * k) for k in range(4)])
    out, est = outs[-1]
    assert est is not None and sorted(est.tag_ids) == [0, 1, 2]
    assert out is not None and out.state == "ok"
    err = math.hypot(out.x - x, out.y - y) * MPU
    dh = abs((out.heading_deg - h + 180) % 360 - 180)
    assert err < 0.05, f"ошибка {err:.3f} м"
    assert dh < 1.5, f"ошибка курса {dh:.2f}°"
    assert out.measured_at == pytest.approx(1_800_000_000.0 + 0.75)  # время кадра, а не отправки
    assert loc.state.visible == ["tag16h5:0", "tag16h5:1", "tag16h5:2"]


def test_tag_loss_marks_position_not_moved(at, tmp_path):
    x, y, h = 2000.0 - 2.0 / MPU, 890.0, 0.0
    poses = [(x, y, h, 0.25 * k) for k in range(3)] + [(None, None, None, 0.75 + 0.5 * k) for k in range(1, 5)]
    loc, outs = run_frames(at, tmp_path, poses)
    last_ok = [o for o, e in outs if o is not None and o.state == "ok"][-1]
    states = [o.state for o, _ in outs[3:] if o is not None]
    assert states and states[-1] == "lost"
    lost = [o for o, _ in outs[3:] if o is not None and o.state == "lost"][-1]
    assert math.hypot(lost.x - last_ok.x, lost.y - last_ok.y) * MPU < 0.01  # без одометрии точка не «едет»
    assert loc.state.used == []


def test_unregistered_tag_is_not_used(at, tmp_path):
    markers = wall_markers()
    x, y, h = 2000.0 - 2.0 / MPU, 892.0, 0.0
    cal_path, calib = write_cal(tmp_path)
    info = calibration_from_tracking_file(cal_path, EXTR)
    known = [m for m in markers if m.tag_id == 1]
    loc = TrackingLocalizer(FRAME, known, info)
    pipe = make_pipeline(cal_path, known)  # размеры известны только для ID 1 → у остальных NO_CALIBRATION
    from apriltag_tracking.capture import Frame

    img = render(FRAME, markers, calib, x, y, h, noise=1.0)
    r = pipe.process(Frame(img, 1, 0.0, 1.0))
    out, est = loc.on_frame(1, 0.0, 1.0, r.measurements, r.current)
    assert est is not None and est.tag_ids == [1]
    reasons = dict(loc.state.rejected)
    assert 0 in reasons and 2 in reasons


def test_calibration_requirements(tmp_path):
    cal_path, _ = write_cal(tmp_path, calibrated=False)
    with pytest.raises(RuntimeError, match="calibrated=false"):
        calibration_from_tracking_file(cal_path, EXTR)
    cal_path, _ = write_cal(tmp_path)
    with pytest.raises(RuntimeError, match="measured"):
        calibration_from_tracking_file(cal_path, {"look": "forward", "x": 0, "y": 0, "z": 0})
    info = calibration_from_tracking_file(cal_path, EXTR)
    assert info.version.startswith("cal-") and not info.accuracy_checked
    d = json.loads(open(cal_path, encoding="utf-8").read())
    d["camera_matrix"][0][0] += 1
    assert calibration_version(d) != info.version


def test_accuracy_report(tmp_path):
    p = tmp_path / "acc.csv"
    p.write_text("# camera;MV\nactual_cm;measured_cm;abs_error_cm\n30;30.2;0.2\n50;50.6;0.6\n100;;\n", encoding="utf-8-sig")
    ok, note = accuracy_report_ok(str(p))
    assert ok and "2" in note
    p.write_text("actual_cm;measured_cm\n30;31.5\n50;50.1\n", encoding="utf-8-sig")
    ok, note = accuracy_report_ok(str(p))
    assert not ok and "5.0%" in note


def test_lost_and_uncertain_measurements_filtered():
    ms = [
        {"frame_id": 5, "event": "update", "family": "tag16h5", "tag_id": 1, "status": "POSE_VALID", "corners_px": [[0, 0], [10, 0], [10, 10], [0, 10]]},
        {"frame_id": 5, "event": "update", "family": "tag16h5", "tag_id": 2, "status": "NO_CALIBRATION", "status_reasons": ["нет размера"], "corners_px": [[0, 0], [1, 0], [1, 1], [0, 1]]},
        {"frame_id": 4, "event": "update", "family": "tag16h5", "tag_id": 3, "status": "POSE_VALID", "corners_px": [[0, 0], [1, 0], [1, 1], [0, 1]]},
        {"frame_id": 5, "event": "lost", "family": "tag16h5", "tag_id": 4, "status": "LOST"},
        {"frame_id": 5, "event": "update", "family": "tag16h5", "tag_id": 5, "status": "POSE_UNCERTAIN", "corners_px": [[0, 0], [1, 0], [1, 1], [0, 1]]},
    ]
    dets, w, skipped = measurements_to_detections(ms, 5)
    assert [d.tag_id for d in dets] == [1, 5]
    assert w[("tag16h5", 5)] < w[("tag16h5", 1)]
    assert [t for t, _ in skipped] == [2]
