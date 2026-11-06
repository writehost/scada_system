# -*- coding: utf-8 -*-
"""Параметры запуска и режимы: live, image, video, calibration (+ проверка точности)."""
from __future__ import annotations

import argparse
import glob
import json
import logging
import sys
import time
from pathlib import Path

import cv2

from .app import (
    AccuracyCollector,
    ConsoleReporter,
    Pipeline,
    PipelineConfig,
    StopFlag,
    WINDOW,
    accuracy_table,
    dumps_pretty,
    run_stream,
    write_accuracy_csv,
)
from .calibration import CalibrationError, build_calibration, calibrate_chessboard, detect_board_size
from .capture import FrameSourceError, HikrobotSource, ImageSource, LatestFrameGrabber, VideoSource
from .detection import pupil_available
from .export import JsonlWriter, MeasurementHub, UdpSender
from .measurement import SourceInfo
from .overlay import draw
from .pose import PoseConfig
from .tracking import TrackerConfig

log = logging.getLogger("apriltag_tracking")

DEFAULT_IP = "169.254.19.203"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="main.py",
        description="Hikrobot MVS + AprilTag: распознавание, положение метки относительно камеры, измерения в JSON",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--mode", choices=["live", "image", "video", "calibration", "calib-capture"], help="по умолчанию: image при --image, video при --video, иначе live")
    src = p.add_argument_group("источник")
    src.add_argument("--ip", default=DEFAULT_IP, help="IP камеры (как в MVS)")
    src.add_argument("--image", help="изображение (Image Mode)")
    src.add_argument("--video", help="видеофайл (Video Mode)")
    src.add_argument("--realtime", action="store_true", help="Video Mode: воспроизводить с частотой файла")
    src.add_argument("--exposure-us", type=float, default=5000.0)
    src.add_argument("--frame-timeout-ms", type=int, default=1500)
    src.add_argument("--mvs-path", help="папка MvImport, если MVS установлен не в стандартное место")
    det = p.add_argument_group("распознавание")
    det.add_argument("--families", nargs="+", default=["tag16h5"])
    det.add_argument("--min-margin", type=float, default=15.0, help="минимальный decision_margin")
    det.add_argument("--max-hamming", type=int, default=0, help="максимум исправленных бит")
    det.add_argument("--backend", choices=["auto", "pupil", "opencv"], default="auto", help="auto = pupil-apriltags, если установлен")
    det.add_argument("--min-side-px", type=float, default=8.0, help="меньшие метки отбрасываются")
    pose = p.add_argument_group("положение и калибровка")
    pose.add_argument("--calibration", help="файл калибровки; если не указан, берётся calibration.json из текущей папки")
    pose.add_argument("--tag-size-mm", type=float, help="измеренная сторона чёрного квадрата метки (между углами детекции), мм")
    pose.add_argument("--fx", type=float, help="(совместимость) фокус, px")
    pose.add_argument("--fy", type=float)
    pose.add_argument("--cx", type=float)
    pose.add_argument("--cy", type=float)
    pose.add_argument("--no-pose", action="store_true", help="только распознавание")
    pose.add_argument("--max-reproj-px", type=float, default=2.0)
    pose.add_argument("--ambiguity-ratio", type=float, default=2.0, help="err2/err1 ниже — решения PnP неоднозначны")
    pose.add_argument("--max-tilt-deg", type=float, default=75.0)
    flt = p.add_argument_group("сопровождение и сглаживание")
    flt.add_argument("--alpha", type=float, default=0.5, help="коэффициент экспоненциального сглаживания (1 — без сглаживания)")
    flt.add_argument("--max-jump-m", type=float, default=0.10, help="порог скачка положения за кадр, м")
    flt.add_argument("--jump-confirm-frames", type=int, default=3)
    flt.add_argument("--lost-timeout-s", type=float, default=0.6)
    flt.add_argument("--stability-window", type=int, default=30)
    out = p.add_argument_group("выдача")
    out.add_argument("--save-jsonl", help="файл JSONL для событий и измерений")
    out.add_argument("--jsonl-events-only", action="store_true", help="в JSONL только detected/lost")
    out.add_argument("--udp", help="host:port — отправлять каждое измерение UDP-датаграммой JSON")
    out.add_argument("--print-json", action="store_true", help="печатать каждое измерение JSON в консоль")
    out.add_argument("--no-window", action="store_true")
    out.add_argument("--save-dir", default=".", help="куда сохранять снимки по клавише S и результаты")
    acc = p.add_argument_group("проверка точности расстояния (Live/Video)")
    acc.add_argument("--accuracy-cm", help="фактические расстояния, см, через запятую: 30,50,100")
    acc.add_argument("--accuracy-tag", default="tag16h5:3")
    acc.add_argument("--accuracy-samples", type=int, default=30)
    acc.add_argument("--accuracy-metric", choices=["distance", "z"], default="distance", help="z — если рулеткой мерили по оси объектива")
    acc.add_argument("--accuracy-csv", default="accuracy_report.csv")
    cal = p.add_argument_group("Calibration Mode")
    cal.add_argument("--chessboard", help="шаблон снимков доски: 'calib/*.png'")
    cal.add_argument("--board", default="auto", help="ВНУТРЕННИЕ углы доски, колонки x строки (доска 10×7 клеток → 9x6) или auto")
    cal.add_argument("--square-mm", type=float, help="сторона клетки доски, мм")
    cal.add_argument("--calibration-out", default="calibration.json")
    cal.add_argument("--calib-frames", type=int, default=20, help="calib-capture: сколько снимков доски снять")
    p.add_argument("--log-level", default="INFO")
    return p


def mode_of(args) -> str:
    if args.mode:
        return args.mode
    if args.image:
        return "image"
    if args.video:
        return "video"
    return "live"


def make_source(args):
    m = mode_of(args)
    if m == "image":
        if not args.image:
            raise SystemExit("--image обязателен для режима image")
        return ImageSource(args.image)
    if m == "video":
        if not args.video:
            raise SystemExit("--video обязателен для режима video")
        return VideoSource(args.video, realtime=args.realtime)
    if args.mvs_path:
        import os

        os.environ["MVS_PYTHON_PATH"] = args.mvs_path
    return LatestFrameGrabber(HikrobotSource(args.ip, args.exposure_us, args.frame_timeout_ms))


def make_pipeline(args, source, hub: MeasurementHub | None = None) -> Pipeline:
    frame_size = None
    img = getattr(source, "image", None)
    if img is not None:
        frame_size = (img.shape[1], img.shape[0])
    calibration = None
    if not args.no_pose:
        calibration = build_calibration(args.calibration, args.tag_size_mm, args.fx, args.fy, args.cx, args.cy, frame_size)
    cfg = PipelineConfig(
        families=args.families,
        min_margin=args.min_margin,
        max_hamming=args.max_hamming,
        backend=args.backend,
        pose_enabled=not args.no_pose,
        min_side_px=args.min_side_px,
        pose=PoseConfig(max_reproj_px=args.max_reproj_px, ambiguity_ratio=args.ambiguity_ratio, max_tilt_deg=args.max_tilt_deg),
        tracker=TrackerConfig(
            alpha=args.alpha,
            max_jump_m=args.max_jump_m,
            jump_confirm_frames=args.jump_confirm_frames,
            lost_timeout_s=args.lost_timeout_s,
            stability_window=args.stability_window,
        ),
    )
    info = SourceInfo(getattr(source, "camera_id", "unknown"), getattr(source, "ip", None), mode_of(args), "")
    pipe = Pipeline(cfg, calibration, info, hub)
    if isinstance(source, LatestFrameGrabber):
        pipe.grabber = source
    return pipe


def make_hub(args) -> MeasurementHub:
    hub = MeasurementHub()
    if args.save_jsonl:
        hub.subscribe(JsonlWriter(args.save_jsonl, events_only=args.jsonl_events_only))
        print(f"Измерения пишутся в {args.save_jsonl}")
    if args.udp:
        host, port = args.udp.rsplit(":", 1)
        hub.subscribe(UdpSender(host, int(port)))
        print(f"Измерения отправляются UDP на {host}:{port}")
    return hub


def print_header(pipeline: Pipeline, args):
    print(f"Детектор: {pipeline.detector.backend_name}; семейства: {', '.join(args.families)}; "
          f"фильтр: hamming ≤ {args.max_hamming}, margin ≥ {args.min_margin}")
    if pipeline.detector.backend_name != "pupil-apriltags":
        print("ВНИМАНИЕ: pupil-apriltags не используется (нет пакета или --backend opencv): decision_margin недоступен.")
    cal = pipeline.estimator.cal
    if args.no_pose:
        print("Положение: выключено (--no-pose).")
    elif cal is None:
        print("Положение: НЕТ КАЛИБРОВКИ — выводятся ID и пиксельные координаты, метры не считаются (NO_CALIBRATION).")
    else:
        print(cal.summary())
        if cal.tag_size_m is None and not cal.tag_sizes_m:
            print("Размер метки не задан — метры не считаются. Укажите --tag-size-mm.")
        elif not cal.calibrated:
            print("Калибровка НЕ подтверждена: расстояния ориентировочные, статус не выше POSE_UNCERTAIN.")
    print("Положение считается через OpenCV solvePnPGeneric(SOLVEPNP_IPPE_SQUARE); pupil estimate_tag_pose не используется.")


# ---------------- режимы ----------------


def run_image(args) -> int:
    src = ImageSource(args.image)
    hub = make_hub(args)
    pipe = make_pipeline(args, src, hub)
    print_header(pipe, args)
    r = pipe.process(next(src.frames()))
    hub.close()
    if not r.measurements:
        print("Метки не найдены. Проверьте семейство, резкость, освещение и белое поле вокруг метки.")
    for m in r.measurements:
        print(dumps_pretty(m))
    out = Path(args.save_dir) / "apriltag_result.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas = draw(src.image, r.current, pipe.overlay_info(r), pipe.estimator.cal)
    cv2.imwrite(str(out), canvas)
    print(f"Сохранено {out}")
    if not args.no_window:
        cv2.imshow(WINDOW, canvas)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    return 0 if r.measurements else 2


def run_stream_mode(args) -> int:
    src = make_source(args)
    hub = make_hub(args)
    stop = StopFlag()
    try:
        pipe = make_pipeline(args, src, hub)
        print_header(pipe, args)
        reporter = ConsoleReporter()
        acc_rows, acc_state = [], None
        targets = [float(x) for x in args.accuracy_cm.split(",")] if args.accuracy_cm else []
        if targets:
            if args.no_window and mode_of(args) == "live":
                raise SystemExit("проверка точности в Live Mode требует окна (SPACE — начать замер)")
            print(f"\nПРОВЕРКА ТОЧНОСТИ: метка {args.accuracy_tag}, {args.accuracy_samples} достоверных кадров на точку.")
            print(f"Поставьте метку на {targets[0]:g} см и нажмите SPACE в окне.")

        def on_result(r):
            nonlocal acc_state
            reporter(r)
            if acc_state is not None:
                if acc_state.feed(r.measurements):
                    actual = targets[len(acc_rows)]
                    acc_rows.append(acc_state.row(actual))
                    acc_state = None
                    print(f"  {actual:g} см: измерено {acc_rows[-1].measured_cm:.2f} см (σ {acc_rows[-1].std_mm:.2f} мм)")
                    if len(acc_rows) < len(targets):
                        print(f"Поставьте метку на {targets[len(acc_rows)]:g} см и нажмите SPACE.")

        def on_key(key, r):
            nonlocal acc_state
            if targets and key == ord(" ") and acc_state is None and len(acc_rows) < len(targets):
                acc_state = AccuracyCollector(args.accuracy_tag, args.accuracy_samples, args.accuracy_metric)
                print(f"Замер {targets[len(acc_rows)]:g} см...")
            return bool(targets) and len(acc_rows) >= len(targets)

        if targets and args.no_window:  # Video Mode без окна: точки идут подряд по сегментам видео
            def auto(r):
                nonlocal acc_state
                if acc_state is None and len(acc_rows) < len(targets):
                    acc_state = AccuracyCollector(args.accuracy_tag, args.accuracy_samples, args.accuracy_metric)
                on_result(r)

            run_stream(pipe, src.frames(), window=False, on_result=auto, stop=stop)
        else:
            run_stream(pipe, src.frames(), window=not args.no_window, on_result=on_result, save_dir=Path(args.save_dir),
                       on_key=on_key, accuracy=bool(targets), stop=stop)
        if targets:
            print("\n" + accuracy_table(acc_rows))
            cal = pipe.estimator.cal
            write_accuracy_csv(
                Path(args.save_dir) / args.accuracy_csv,
                acc_rows,
                {
                    "camera": pipe.source.camera_id,
                    "tag": args.accuracy_tag,
                    "metric": args.accuracy_metric,
                    "tag_size_mm": None if cal is None or cal.tag_size_m is None else cal.tag_size_m * 1000,
                    "calibration": "none" if cal is None else cal.source,
                    "calibrated": None if cal is None else cal.calibrated,
                    "time": time.strftime("%Y-%m-%d %H:%M:%S"),
                },
            )
            print(f"Отчёт: {Path(args.save_dir) / args.accuracy_csv}")
        grab = getattr(pipe, "grabber", None)
        if grab is not None:
            print(f"\nКамера: получено {grab.captured} кадров ({grab.capture_fps:.1f} FPS), обработано {grab.delivered}, "
                  f"пропущено из-за медленной обработки {grab.dropped}")
        print(f"Кадров обработано: {pipe.frames}, без изображения: {pipe.frames_missing}; измерений доставлено: {hub.delivered}, "
              f"отброшено очередью: {hub.dropped}")
        return 0
    finally:
        src.release()
        hub.close()
        try:
            cv2.destroyAllWindows()
        except cv2.error:
            pass


def run_calibration(args) -> int:
    if args.chessboard:
        if not args.square_mm:
            raise SystemExit("--square-mm обязателен для калибровки по доске")
        files = sorted(f for f in glob.glob(args.chessboard) if "apriltag_result_" not in Path(f).name)
        if not files:
            raise SystemExit(f"нет файлов по шаблону {args.chessboard}")
        print(f"Снимков: {len(files)}")
        if args.board.lower() == "auto":
            found = detect_board_size(files)
            if found is None:
                raise CalibrationError(
                    "шахматная доска не найдена ни на одном из первых снимков. Проверьте: доска целиком в кадре с белым полем "
                    "вокруг, резкая, без бликов; это именно шахматная доска (чёрные и белые клетки), а не метка AprilTag."
                )
            cols, rows = found
        else:
            cols, rows = (int(x) for x in args.board.lower().split("x"))
        debug = str(Path(args.save_dir) / "calib_debug")
        data, used = calibrate_chessboard(files, cols, rows, args.square_mm, debug_dir=debug)
        print(f"Снимки с отмеченными углами: {debug}")
        if args.tag_size_mm:
            data["tag_size_mm"] = args.tag_size_mm
        data["camera_id"] = "MV-CU013-A0GM"
        data["created"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        Path(args.calibration_out).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Калибровка по {len(used)} снимкам из {len(files)}: RMS {data['rms_px']} px → {args.calibration_out}")
        if data["rms_px"] > 0.8:
            print("ВНИМАНИЕ: RMS > 0.8 px — переснимите доску (резкость, доска во всех углах кадра, разные наклоны).")
        args.calibration = args.calibration_out
    if not args.calibration and args.fx is None:
        raise SystemExit("укажите --calibration calibration.json (или --chessboard для новой калибровки)")
    cal = build_calibration(args.calibration, args.tag_size_mm, args.fx, args.fy, args.cx, args.cy)
    print(cal.summary())
    problems = []
    if not cal.calibrated:
        problems.append("calibrated=false: параметры номинальные, расстояние приблизительное")
    if cal.tag_size_m is None and not cal.tag_sizes_m:
        problems.append("не задан размер метки")
    if cal.image_width and abs(cal.cx - cal.image_width / 2) > 0.15 * cal.image_width:
        problems.append("cx далеко от центра кадра — проверьте калибровку")
    if abs(cal.fx / cal.fy - 1) > 0.05:
        problems.append("fx и fy различаются больше чем на 5% — проверьте калибровку")
    if args.image:
        src = ImageSource(args.image)
        ok, why = cal.matches_frame(src.image.shape[1], src.image.shape[0])
        if not ok:
            problems.append(why)
        pipe = make_pipeline(args, src)
        r = pipe.process(next(src.frames()))
        print(f"\nКонтрольный снимок {args.image}: меток {len(r.measurements)}")
        for d in pipe.detector.detect(src.image)[0]:
            res = pipe.estimator.estimate(d)
            print(f"  {d.key}: углы (порядок IPPE: ВЛ, ВП, НП, НЛ) {[tuple(round(v, 1) for v in c) for c in d.corners_px]}")
            if res is None:
                continue
            for i, c in enumerate(res.candidates):
                print(f"    решение {i + 1}: dist={c.distance_m:.4f} м t={[round(float(v), 4) for v in c.tvec]} reproj={c.reproj_px:.3f} px "
                      f"{'OK' if c.valid else 'отброшено: ' + c.reason}")
            print(f"    итог: {res.status} {'; '.join(res.reasons)}")
    print("\nПроверки: " + ("замечаний нет" if not problems else "\n  - " + "\n  - ".join(problems)))
    return 0


def run_calib_capture_mode(args) -> int:
    from .calib_capture import run_calib_capture

    board = "9x6" if args.board.lower() == "auto" else args.board
    cols, rows = (int(x) for x in board.lower().split("x"))
    src = VideoSource(args.video, realtime=False) if args.video else LatestFrameGrabber(HikrobotSource(args.ip, args.exposure_us, args.frame_timeout_ms))
    try:
        saved = run_calib_capture(args, src, cols, rows)
    finally:
        src.release()
    print(f"Сохранено снимков доски: {len(saved)}")
    if len(saved) < 8:
        print("Для калибровки нужно не меньше 8 снимков — запустите съёмку ещё раз.")
        return 1
    if not args.square_mm:
        print(f"Теперь: py main.py --mode calibration --chessboard \"{saved[0].parent / 'calib_*.png'}\" "
              f"--board {cols}x{rows} --square-mm <клетка, мм> --tag-size-mm <метка, мм>")
        return 0
    args.chessboard = str(saved[0].parent / "calib_*.png")
    args.board = f"{cols}x{rows}"
    args.image = None
    return run_calibration(args)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level.upper(), logging.INFO), format="%(asctime)s %(levelname)s %(message)s")
    if args.backend == "pupil" and not pupil_available():
        print("ОШИБКА: pupil-apriltags не установлен: py -m pip install pupil-apriltags", file=sys.stderr)
        return 1
    try:
        m = mode_of(args)
        if m in ("live", "video", "image") and not args.calibration and args.fx is None and Path("calibration.json").is_file():
            args.calibration = "calibration.json"
            print("Найден calibration.json рядом с программой — используется он (другой файл: --calibration <путь>).")
        if m == "calibration":
            return run_calibration(args)
        if m == "calib-capture":
            return run_calib_capture_mode(args)
        if m == "image":
            return run_image(args)
        return run_stream_mode(args)
    except (CalibrationError, FrameSourceError) as e:
        print(f"ОШИБКА: {e}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Остановлено пользователем")
        return 0
