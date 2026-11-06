"""Мост: apriltag-tracking (камера Hikrobot, обнаружение, фильтры) → позиция погрузчика на плане склада.

Модуль компьютерного зрения apriltag-tracking (папка apriltag-tracking/ в репозитории) не изменяется:
он подключает камеру через MVS SDK, находит метки (pupil-apriltags, hamming/margin, проверка геометрии
и порядка углов), сопровождает их и выдаёт по каждому кадру измерения apriltag-measurement/1 с углами
метки в пикселях, положением метки относительно камеры, статусом и временем кадра.

Здесь эти измерения переводятся в систему склада:

    T_world_body = T_world_tag · (T_cam_tag)⁻¹ · (T_body_cam)⁻¹

  T_world_tag — поза метки из реестра Route (x, y на плане, высота, крепление, курс), не придумывается;
  T_cam_tag   — PnP по углам метки с калибровкой камеры (тот же calibration.json, что у apriltag-tracking);
  T_body_cam  — крепление камеры на погрузчике (cameraToForklift).

При нескольких метках в кадре решается общий PnP по всем углам; противоречивые метки отбрасываются
(PoseEstimator). Скачки и потери обрабатывает PoseTracker; на сервер уходит время кадра, а не время отправки,
поэтому старое измерение не выдаётся за новое (сервер отвергает измерения старше принятого).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from .detector import Detection
from .geometry import PlanFrame
from .pose import Calibration, PoseEstimator, PoseLimits
from .tracker import PoseTracker, TrackerConfig

log = logging.getLogger("route-localization.bridge")

# статусы apriltag-tracking, при которых углы метки пригодны для расчёта позиции в мире
USABLE_STATUSES = {"POSE_VALID": 1.0, "POSE_UNCERTAIN": 0.6}


def import_apriltag_tracking(path: str | None):
    """Подключить модуль apriltag-tracking (по пути из конфигурации или установленный в окружение)."""
    if path:
        p = os.path.abspath(os.path.expanduser(path))
        if not os.path.isdir(os.path.join(p, "apriltag_tracking")):
            raise RuntimeError(f"apriltag-tracking не найден в {p}: ожидается папка apriltag_tracking внутри")
        if p not in sys.path:
            sys.path.insert(0, p)
    import apriltag_tracking  # noqa: F401  (проверка наличия)

    return apriltag_tracking


def calibration_version(data: dict) -> str:
    """Версия калибровки — отпечаток параметров объектива и разрешения (меняется при любой перекалибровке)."""
    key = json.dumps(
        {
            "K": data.get("camera_matrix") or data.get("cameraMatrix"),
            "d": data.get("dist_coeffs") or data.get("distCoeffs"),
            "w": data.get("image_width") or data.get("width"),
            "h": data.get("image_height") or data.get("height"),
        },
        sort_keys=True,
    )
    return "cal-" + hashlib.sha1(key.encode()).hexdigest()[:10]


@dataclass
class CalibrationInfo:
    calibration: Calibration
    version: str
    calibrated: bool
    rms_px: float | None
    accuracy_checked: bool
    accuracy_note: str
    camera_id: str | None
    created: str | None


def calibration_from_tracking_file(path: str, camera_to_forklift: dict, accuracy_report: str | None = None) -> CalibrationInfo:
    """calibration.json из apriltag-tracking → калибровка для расчёта позиции в мире.

    Ошибка перепроецирования не доказывает точность расстояний, поэтому отдельно отмечается,
    есть ли отчёт проверки рулеткой (accuracy_report.csv из режима --accuracy-cm).
    """
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    if "camera_matrix" not in d:
        raise RuntimeError(f"{path}: нет camera_matrix — это не калибровка apriltag-tracking")
    if not d.get("calibrated", False):
        raise RuntimeError(
            f"{path}: calibrated=false (номинальные параметры). Для позиционирования погрузчика нужна калибровка по доске: "
            "py main.py --mode calib-capture ..."
        )
    if not camera_to_forklift or camera_to_forklift.get("measured") is not True:
        raise RuntimeError(
            "cameraToForklift не подтверждено: измерьте положение камеры на погрузчике рулеткой (x вперёд, y влево, z вверх "
            'от опорной точки), впишите и поставьте "measured": true'
        )
    checked, note = False, "точность расстояний рулеткой не проверялась (нет accuracy_report.csv)"
    if accuracy_report and os.path.isfile(accuracy_report):
        checked, note = accuracy_report_ok(accuracy_report)
    cal = Calibration(
        K=np.array(d["camera_matrix"], dtype=float),
        dist=np.array(d.get("dist_coeffs") or [0, 0, 0, 0, 0], dtype=float),
        width=int(d["image_width"]),
        height=int(d["image_height"]),
        camera_to_forklift=camera_to_forklift,
        version=None,
        serial=d.get("camera_serial"),
    )
    return CalibrationInfo(cal, calibration_version(d), True, d.get("rms_px"), checked, note, d.get("camera_id"), d.get("created"))


def accuracy_report_ok(path: str, max_error_pct: float = 2.0) -> tuple[bool, str]:
    """Отчёт проверки точности apriltag-tracking: все точки в пределах max_error_pct."""
    import csv

    rows = []
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.reader(f, delimiter=";"):
            if len(r) >= 2:
                try:
                    actual, measured = float(r[0].replace(",", ".")), float(r[1].replace(",", "."))
                except ValueError:
                    continue
                if actual > 0:
                    rows.append((actual, measured))
    if len(rows) < 2:
        return False, f"{path}: меньше двух проверенных расстояний"
    worst = max(abs(m - a) / a * 100 for a, m in rows)
    ok = worst <= max_error_pct
    return ok, f"проверено расстояний: {len(rows)}, наибольшая ошибка {worst:.1f}%" + ("" if ok else f" (> {max_error_pct}%)")


def measurements_to_detections(measurements: list[dict], frame_id: int) -> tuple[list[Detection], dict[tuple[str, int], float], list[tuple[int, str]]]:
    """Измерения кадра → обнаружения для PoseEstimator. Возвращает (обнаружения, вес по метке, отброшенные)."""
    dets: list[Detection] = []
    weight: dict[tuple[str, int], float] = {}
    skipped: list[tuple[int, str]] = []
    for m in measurements:
        if m.get("frame_id") != frame_id or m.get("event") == "lost":
            continue
        tid = int(m["tag_id"])
        st = m.get("status")
        if st not in USABLE_STATUSES:
            skipped.append((tid, f"статус {st}: {'; '.join(m.get('status_reasons') or [])}"))
            continue
        corners = m.get("corners_px")
        if not corners or len(corners) != 4:
            skipped.append((tid, "нет углов метки"))
            continue
        dets.append(Detection(m["family"], tid, np.array(corners, dtype=np.float64), m.get("decision_margin"), m.get("hamming")))
        weight[(m["family"], tid)] = USABLE_STATUSES[st]
    return dets, weight, skipped


@dataclass
class BridgeState:
    """Диагностика для сервера и консоли."""

    camera: str = "starting"  # starting | ok | no_frames | error
    camera_error: str | None = None
    frames: int = 0
    frames_missing: int = 0
    capture_fps: float = 0.0
    last_frame_at: float | None = None
    last_fix_at: float | None = None
    visible: list[str] = field(default_factory=list)
    used: list[int] = field(default_factory=list)
    rejected: list[tuple[int, str]] = field(default_factory=list)
    position_state: str = "unknown"

    def as_dict(self) -> dict:
        return {
            "camera": self.camera,
            "cameraError": self.camera_error,
            "frames": self.frames,
            "framesMissing": self.frames_missing,
            "captureFps": round(self.capture_fps, 1),
            "lastFrameAt": self.last_frame_at,
            "lastFixAt": self.last_fix_at,
            "visibleTags": self.visible,
            "usedTags": self.used,
            "rejected": [{"tagId": t, "reason": r} for t, r in self.rejected[:10]],
            "positionState": self.position_state,
        }


class TrackingLocalizer:
    """Чистая логика без камеры и сети: кадр apriltag-tracking → оценка позиции → трекер.

    Используется службой и тестами.
    """

    def __init__(self, frame: PlanFrame, markers, info: CalibrationInfo, limits: PoseLimits | None = None, tracker_cfg: TrackerConfig | None = None):
        self.info = info
        self.estimator = PoseEstimator(frame, markers, info.calibration, limits)
        self.tracker = PoseTracker(tracker_cfg or TrackerConfig(meters_per_unit=frame.meters_per_unit))
        self.state = BridgeState()

    def on_frame(self, frame_id: int, t: float, t_wall: float, measurements: list[dict], current: list[dict] | None = None, has_image: bool = True):
        """Обработать результат кадра. Возвращает (TrackOutput | None, PoseEstimate | None)."""
        st = self.state
        st.frames += 1
        if not has_image:
            st.frames_missing += 1
        else:
            st.last_frame_at = t_wall
        seen = current if current is not None else measurements
        st.visible = sorted({f"{m['family']}:{m['tag_id']}" for m in seen if m.get("frame_id") == frame_id and m.get("event") != "lost"})
        dets, weight, skipped = measurements_to_detections(seen, frame_id)
        est = self.estimator.estimate(dets) if dets else None
        st.rejected = skipped + (est.rejected if est else [])
        if est is not None:
            w = min(weight.get((d.family, d.tag_id), 1.0) for d in dets if d.tag_id in est.tag_ids) if est.tag_ids else 1.0
            out = self.tracker.update(t, est.x, est.y, est.heading_deg, round(est.quality * w, 3))
            st.used = est.tag_ids
            if out is not None:
                st.last_fix_at = t_wall
                st.position_state = out.state
                # время измерения — время кадра (UNIX), а не время отправки
                out.measured_at = t_wall
            return out, est
        st.used = []
        out = self.tracker.tick(t)
        if out is not None:
            st.position_state = out.state
            out.measured_at = t_wall
        return out, None


class TrackingBridgeService:
    """Служба: apriltag-tracking + реестр меток Route + отправка позиции.

    Конфигурация (localizer.json), раздел tracking:
      {"path": "../apriltag-tracking", "ip": "169.254.19.203", "exposureUs": 2000, "families": "tag16h5",
       "minMargin": 15, "mvsPath": null, "calibrationFile": "calibration.json", "accuracyReport": "accuracy_report.csv"}
    """

    def __init__(self, cfg, tracking: dict, camera_to_forklift: dict):
        from .server import Publisher, RouteClient

        self.cfg = cfg
        self.tracking = tracking
        self.camera_to_forklift = camera_to_forklift
        import_apriltag_tracking(tracking.get("path"))
        self.client = RouteClient(cfg.server_url, cfg.token, cfg.site_code, cfg.kara_id)
        self.publisher = Publisher(self.client, max_hz=cfg.max_hz, log=log.warning)
        self.loc: TrackingLocalizer | None = None
        self._stop = threading.Event()
        self._last_status = 0.0
        self.pipeline = None
        self.source = None

    def _argv(self) -> list[str]:
        t = self.tracking
        argv = ["--no-window", "--calibration", t["calibrationFile"]]
        if t.get("ip"):
            argv += ["--ip", str(t["ip"])]
        if t.get("exposureUs"):
            argv += ["--exposure-us", str(t["exposureUs"])]
        if t.get("families"):
            argv += ["--families", str(t["families"])]
        if t.get("minMargin") is not None:
            argv += ["--min-margin", str(t["minMargin"])]
        if t.get("mvsPath"):
            argv += ["--mvs-path", str(t["mvsPath"])]
        if t.get("video"):
            argv += ["--video", str(t["video"])]
        return argv

    def reload(self):
        from .service import markers_from_server

        info = calibration_from_tracking_file(self.tracking["calibrationFile"], self.camera_to_forklift, self.tracking.get("accuracyReport"))
        remote = self.client.fetch_config(info.calibration.serial or info.camera_id or "apriltag-tracking")
        coord = remote.get("coord") or {}
        mpu = coord.get("metersPerUnit")
        if not mpu:
            raise RuntimeError("в Route не задан масштаб карты (metersPerUnit) — без него координаты меток нельзя перевести в метры")
        markers = markers_from_server(remote.get("markers") or [])
        if not markers:
            raise RuntimeError("в реестре Route нет меток с координатами: привяжите метки в /route/editor → AprilTag")
        if any(m.family == "tag16h5" for m in markers):
            log.warning("tag16h5 — тестовое семейство (30 ID, выше риск ложных срабатываний); для склада — tag36h11")
        if not info.accuracy_checked:
            log.warning("калибровка %s: %s", info.version, info.accuracy_note)
        self.loc = TrackingLocalizer(
            PlanFrame(float(mpu)),
            markers,
            info,
            PoseLimits(max_reproj_px=self.cfg.max_reproj_px),
            TrackerConfig(meters_per_unit=float(mpu), lost_after_s=self.cfg.lost_after_s, predict_max_s=self.cfg.predict_max_s),
        )
        self._apply_tag_sizes(markers)
        log.info("меток в реестре: %d, калибровка %s (RMS %s px), масштаб %.4f м/ед.", len(markers), info.version, info.rms_px, float(mpu))

    def _apply_tag_sizes(self, markers):
        """Размеры меток для собственной оценки позы apriltag-tracking берутся из реестра Route."""
        if self.pipeline is None:
            return
        cal = self.pipeline.estimator.cal
        if cal is not None:
            cal.tag_sizes_m = {f"{m.family}:{m.tag_id}": m.size_m for m in markers}

    def _status(self, force: bool = False):
        now = time.time()
        if not force and now - self._last_status < 5:
            return
        self._last_status = now
        st = self.loc.state.as_dict() if self.loc else BridgeState().as_dict()
        info = self.loc.info if self.loc else None
        body = {
            "source": "apriltag-tracking",
            **st,
            "calibration": None
            if info is None
            else {"version": info.version, "rmsPx": info.rms_px, "accuracyChecked": info.accuracy_checked, "note": info.accuracy_note},
        }
        try:
            self.client.send_status(body)
        except Exception as e:  # статус — диагностика, работу не останавливает
            log.debug("статус не отправлен: %s", e)

    def run(self):
        import signal

        from apriltag_tracking.app import TrackingSession

        signal.signal(signal.SIGTERM, lambda *_: self._stop.set())
        self.reload()
        session = TrackingSession.from_cli(self._argv())
        self.pipeline, self.source = session.pipeline, session.source
        self._apply_tag_sizes(self.loc.estimator.markers.values())
        self.loc.state.camera = "ok"
        self._status(force=True)
        loaded = time.time()
        try:
            for frame in self.source.frames():
                if self._stop.is_set():
                    break
                r = self.pipeline.process(frame)
                g = getattr(self.pipeline, "grabber", None)
                if g is not None:
                    self.loc.state.capture_fps = g.capture_fps
                out, est = self.loc.on_frame(frame.frame_id, frame.t, frame.t_wall, r.measurements, r.current, frame.image is not None)
                self.loc.state.camera = "ok" if frame.image is not None else "no_frames"
                if out is not None:
                    self.publisher.offer(out, est.tag_ids if est else None, est.reproj_error_px if est else None, self.loc.info.version)
                self._status()
                if time.time() - loaded > self.cfg.refresh_config_s:
                    try:
                        self.reload()
                    except Exception as e:
                        log.warning("конфигурация не обновлена: %s", e)
                    loaded = time.time()
        except Exception as e:
            if self.loc:
                self.loc.state.camera = "error"
                self.loc.state.camera_error = str(e)
                self._status(force=True)
            raise
        finally:
            self.source.release()
            self.publisher.stop()
