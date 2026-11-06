# -*- coding: utf-8 -*-
"""Конвейер «кадр → метки → положение → сопровождение → измерения» и режимы запуска."""
from __future__ import annotations

import csv
import json
import logging
import signal
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

import cv2
import numpy as np

from .calibration import Calibration
from .capture import Frame
from .detection import DetectorBank
from .export import MeasurementHub
from .measurement import SourceInfo, build_measurement, to_json
from .overlay import draw, show
from .pose import POSE_VALID, PoseConfig, PoseEstimator
from .tracking import Tracker, TrackerConfig

log = logging.getLogger("apriltag_tracking")
WINDOW = "Hikrobot - AprilTag tracking"


@dataclass
class PipelineConfig:
    families: list[str] = field(default_factory=lambda: ["tag16h5"])
    min_margin: float = 15.0
    max_hamming: int = 0
    backend: str = "auto"
    pose_enabled: bool = True
    min_side_px: float = 8.0
    pose: PoseConfig = field(default_factory=PoseConfig)
    tracker: TrackerConfig = field(default_factory=TrackerConfig)


@dataclass
class FrameResult:
    frame: Frame
    measurements: list[dict]  # события и измерения этого кадра (то, что уходит в JSONL)
    current: list[dict]  # текущее состояние всех известных меток (для окна)
    rejected: int
    proc_ms: float


class Pipeline:
    def __init__(self, cfg: PipelineConfig, calibration: Calibration | None, source: SourceInfo | None = None,
                 hub: MeasurementHub | None = None, detector: DetectorBank | None = None):
        self.cfg = cfg
        self.calibration = calibration
        self.detector = detector or DetectorBank(cfg.families, cfg.min_margin, cfg.max_hamming, cfg.backend, min_side_px=cfg.min_side_px)
        self.source = source or SourceInfo("unknown", None, "test", self.detector.backend_name)
        self.source.backend = self.detector.backend_name
        self.estimator = PoseEstimator(calibration, cfg.pose)
        self.tracker = Tracker(cfg.tracker)
        self.hub = hub
        self.current: dict[str, dict] = {}
        self.warning: str | None = None
        self._size_checked = False
        self._last_t: float | None = None
        self.capture_fps = 0.0
        self.proc_fps = 0.0
        self._last_proc_end: float | None = None
        self.frames = 0
        self.frames_missing = 0
        self.grabber = None  # LatestFrameGrabber в Live Mode: частота камеры и пропуски

    @property
    def calibration_state(self) -> str:
        if self.estimator.cal is None:
            return "none"
        if self.estimator.cal.tag_size_m is None and not self.estimator.cal.tag_sizes_m:
            return "no tag size"
        return "verified" if self.estimator.cal.calibrated else "nominal"

    def _check_size(self, img: np.ndarray):
        if self._size_checked or self.calibration is None:
            return
        self._size_checked = True
        ok, why = self.calibration.matches_frame(img.shape[1], img.shape[0])
        if not ok:
            self.warning = "calibration size mismatch - metres disabled"
            log.error("Положение отключено: %s", why)
            self.estimator = PoseEstimator(None, self.cfg.pose)

    def _fps(self, t: float):
        if self._last_t is not None and t > self._last_t:
            inst = 1.0 / (t - self._last_t)
            self.capture_fps = inst if self.capture_fps == 0 else 0.8 * self.capture_fps + 0.2 * inst
        self._last_t = t

    def process(self, frame: Frame) -> FrameResult:
        t0 = time.perf_counter()
        self.frames += 1
        if frame.image is None:
            self.frames_missing += 1
            updates = self.tracker.tick(frame.frame_id, frame.t)
            rejected = 0
        else:
            self._fps(frame.t)
            self._check_size(frame.image)
            dets, stats = self.detector.detect(frame.image)
            rejected = sum(stats.rejected.values())
            items = []
            for d in dets:
                pose = None
                if self.cfg.pose_enabled:
                    pose = self.estimator.estimate(d, self.tracker.prior_for(d.key, frame.t))
                items.append((d, pose))
            updates = self.tracker.update(frame.frame_id, frame.t, items)
        cal_valid = bool(self.estimator.cal is not None and self.estimator.cal.calibrated)
        cal_src = self.estimator.cal.source if self.estimator.cal is not None else "none"
        out = [
            build_measurement(u, frame.frame_id, frame.t_wall, self.source, cal_valid, cal_src, self.cfg.tracker.stability_window, self.cfg.pose_enabled)
            for u in updates
        ]
        for m in out:
            self.current[f"{m['family']}:{m['tag_id']}"] = m
        if self.hub is not None and out:
            self.hub.publish(out)
        end = time.perf_counter()
        if self._last_proc_end is not None:
            inst = 1.0 / max(end - self._last_proc_end, 1e-6)
            self.proc_fps = inst if self.proc_fps == 0 else 0.8 * self.proc_fps + 0.2 * inst
        self._last_proc_end = end
        return FrameResult(frame, out, list(self.current.values()), rejected, (end - t0) * 1000)

    def overlay_info(self, r: FrameResult, accuracy: bool = False) -> dict:
        g = self.grabber
        return {
            "capture_fps": g.capture_fps if g is not None else self.capture_fps,
            "dropped": g.dropped if g is not None else 0,
            "proc_fps": self.proc_fps,
            "proc_ms": r.proc_ms,
            "frame_id": r.frame.frame_id,
            "source": self.source.source,
            "backend": self.source.backend,
            "calibration": self.calibration_state,
            "warning": self.warning,
            "rejected": r.rejected,
            "accuracy": accuracy,
        }


class ConsoleReporter:
    """События — сразу; текущие измерения — не чаще раза в period_s (одна метка не печатается «новой» каждый кадр)."""

    def __init__(self, period_s: float = 1.0, print_json: bool = False):
        self.period_s = period_s
        self.print_json = print_json
        self._last = 0.0

    def __call__(self, r: FrameResult):
        for m in r.measurements:
            if m["event"] == "detected":
                print(f"[DETECTED] {m['family']} ID={m['tag_id']} center=({m['center_px'][0]:.1f}, {m['center_px'][1]:.1f}) "
                      f"hamming={m['hamming']} margin={m['decision_margin']} status={m['status']}")
            elif m["event"] == "lost":
                print(f"[LOST] {m['family']} ID={m['tag_id']} (последний кадр {m['last_seen_frame']})")
            if self.print_json:
                print(to_json(m))
        now = time.monotonic()
        if now - self._last < self.period_s:
            return
        self._last = now
        for m in r.current:
            if m["status"] == "LOST" or m["event"] == "lost":
                continue
            line = f"  {m['family']} ID={m['tag_id']} {m['status']}"
            if m.get("position_camera_m"):
                p = m["position_camera_m"]
                mark = "" if m["status"] == POSE_VALID else " (ПРИБЛИЗИТЕЛЬНО)"
                line += f" X={p['x']:+.3f} Y={p['y']:+.3f} Z={p['z']:+.3f} м DIST={m['distance_m']:.3f} м reproj={m['reprojection_error_px']:.2f}px{mark}"
            if m.get("status_codes") and m["status"] != POSE_VALID:
                line += f" [{', '.join(m['status_codes'])}]"
            print(line)


class StopFlag:
    def __init__(self):
        self.stop = False
        for name in ("SIGINT", "SIGTERM", "SIGBREAK"):
            sig = getattr(signal, name, None)
            if sig is None:
                continue
            try:
                signal.signal(sig, self._handler)
            except (ValueError, OSError):  # не главный поток
                pass

    def _handler(self, *_):
        self.stop = True


def run_stream(pipeline: Pipeline, frames: Iterable[Frame], window: bool = True, on_result: Callable[[FrameResult], None] | None = None,
               save_dir: Path = Path("."), on_key: Callable[[int, FrameResult], bool] | None = None, accuracy: bool = False,
               stop: StopFlag | None = None) -> FrameResult | None:
    """Общий цикл Live/Video. Возвращает последний результат."""
    last = None
    for frame in frames:
        if stop is not None and stop.stop:
            break
        r = pipeline.process(frame)
        last = r
        if on_result:
            on_result(r)
        if not window:
            continue
        if frame.image is None:
            key = cv2.waitKey(1) & 0xFF
        else:
            canvas = draw(frame.image, r.current, pipeline.overlay_info(r, accuracy), pipeline.estimator.cal)
            key = show(WINDOW, canvas)
            if key == ord("s"):
                save_dir.mkdir(parents=True, exist_ok=True)
                stamp = time.strftime("%Y%m%d_%H%M%S")
                cv2.imwrite(str(save_dir / f"apriltag_raw_{stamp}_{frame.frame_id}.png"), frame.image)
                cv2.imwrite(str(save_dir / f"apriltag_result_{stamp}_{frame.frame_id}.png"), canvas)
                print(f"Сохранено: apriltag_raw_{stamp}_{frame.frame_id}.png, apriltag_result_{stamp}_{frame.frame_id}.png")
        if key in (ord("q"), 27):
            break
        if on_key and key != 255 and on_key(key, r):
            break
    return last


# ---------------- проверка точности ----------------


@dataclass
class AccuracyRow:
    actual_cm: float
    measured_cm: float | None
    samples: int
    std_mm: float | None
    reproj_px: float | None

    @property
    def abs_err_cm(self) -> float | None:
        return None if self.measured_cm is None else self.measured_cm - self.actual_cm

    @property
    def rel_err_pct(self) -> float | None:
        return None if self.measured_cm is None else 100.0 * (self.measured_cm - self.actual_cm) / self.actual_cm


class AccuracyCollector:
    """Собирает N достоверных сырых измерений одной метки (сглаживание не используется)."""

    def __init__(self, key: str, n: int, metric: str = "distance"):
        self.key = key
        self.n = n
        self.metric = metric  # distance | z
        self.values: list[float] = []
        self.reproj: list[float] = []

    def feed(self, measurements: list[dict]) -> bool:
        for m in measurements:
            if f"{m['family']}:{m['tag_id']}" != self.key or m.get("event") == "lost" or m.get("status") != POSE_VALID:
                continue
            v = m["distance_m"] if self.metric == "distance" else m["position_camera_m"]["z"]
            self.values.append(float(v))
            self.reproj.append(float(m["reprojection_error_px"]))
        return len(self.values) >= self.n

    def row(self, actual_cm: float) -> AccuracyRow:
        if not self.values:
            return AccuracyRow(actual_cm, None, 0, None, None)
        v = np.array(self.values[: self.n])
        return AccuracyRow(actual_cm, float(np.median(v)) * 100, len(v), float(v.std()) * 1000, float(np.median(self.reproj[: self.n])))


def accuracy_table(rows: list[AccuracyRow]) -> str:
    head = f"{'Факт, см':>9} | {'Измерено, см':>12} | {'Абс. ошибка, см':>15} | {'Отн. ошибка, %':>14} | {'σ, мм':>6} | {'N':>3} | {'reproj, px':>10}"
    lines = [head, "-" * len(head)]
    for r in rows:
        if r.measured_cm is None:
            lines.append(f"{r.actual_cm:>9.1f} | {'нет данных':>12} | {'—':>15} | {'—':>14} | {'—':>6} | {0:>3} | {'—':>10}")
        else:
            lines.append(
                f"{r.actual_cm:>9.1f} | {r.measured_cm:>12.2f} | {r.abs_err_cm:>+15.2f} | {r.rel_err_pct:>+14.2f} | {r.std_mm:>6.2f} | {r.samples:>3} | {r.reproj_px:>10.2f}"
            )
    return "\n".join(lines)


def write_accuracy_csv(path: Path, rows: list[AccuracyRow], meta: dict):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        for k, v in meta.items():
            w.writerow([f"# {k}", v])
        w.writerow(["actual_cm", "measured_cm", "abs_error_cm", "rel_error_pct", "std_mm", "samples", "reproj_px"])
        for r in rows:
            w.writerow([r.actual_cm, *(None if r.measured_cm is None else round(x, 3) for x in (r.measured_cm, r.abs_err_cm, r.rel_err_pct, r.std_mm)), r.samples,
                        None if r.reproj_px is None else round(r.reproj_px, 3)])


# ---------------- программный интерфейс ----------------


class TrackingSession:
    """Запуск распознавания в фоновом потоке для другого Python-модуля.

        from apriltag_tracking.app import TrackingSession
        s = TrackingSession.from_cli(["--ip", "169.254.19.203", "--calibration", "calibration.json"])
        s.hub.on_tag_detected(lambda m: print("появилась", m["tag_id"]))
        s.start()
        ...
        m = s.latest("tag16h5:3")          # последнее измерение или None
        if m and m["pose_valid"]: print(m["position_camera_m"])
        s.stop()
    """

    def __init__(self, pipeline: Pipeline, source, jsonl_path: str | None = None):
        self.pipeline = pipeline
        self.source = source
        self.hub = pipeline.hub or MeasurementHub()
        pipeline.hub = self.hub
        if jsonl_path:
            from .export import JsonlWriter

            self.hub.subscribe(JsonlWriter(jsonl_path))
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.error: BaseException | None = None

    @classmethod
    def from_cli(cls, argv: list[str]) -> "TrackingSession":
        from .cli import build_parser, make_pipeline, make_source

        args = build_parser().parse_args(argv)
        source = make_source(args)
        pipeline = make_pipeline(args, source)
        return cls(pipeline, source, args.save_jsonl)

    def _run(self):
        try:
            for frame in self.source.frames():
                if self._stop.is_set():
                    break
                self.pipeline.process(frame)
        except BaseException as e:  # noqa: BLE001 — сохраняем для вызывающего
            self.error = e
            log.exception("сессия распознавания остановлена ошибкой")
        finally:
            self.source.release()

    def start(self):
        self._thread = threading.Thread(target=self._run, name="apriltag-session", daemon=True)
        self._thread.start()
        return self

    def latest(self, key: str | None = None, only_valid: bool = False):
        return self.hub.latest(key, only_valid)

    def stop(self, timeout: float = 5.0):
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)
        self.source.release()
        self.hub.close()


def dumps_pretty(m: dict) -> str:
    return json.dumps(m, ensure_ascii=False, indent=2)
