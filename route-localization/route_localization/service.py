"""Основной цикл сервиса позиционирования."""
from __future__ import annotations

import json
import logging
import signal
import time
from dataclasses import dataclass

import numpy as np

from .camera import open_source
from .detector import AprilTagDetector
from .geometry import PlanFrame
from .odometry import NoOdometry, open_odometry
from .pose import Calibration, MarkerInfo, PoseEstimator, PoseLimits
from .server import Publisher, RouteClient
from .tracker import PoseTracker, TrackerConfig

log = logging.getLogger("route-localization")


@dataclass
class ServiceConfig:
    server_url: str
    token: str
    site_code: str
    kara_id: str
    camera: dict
    families: list[str]
    calibration_file: str | None
    max_hz: float
    lost_after_s: float
    predict_max_s: float
    max_reproj_px: float
    odometry: dict | None
    refresh_config_s: float

    @staticmethod
    def load(path: str) -> "ServiceConfig":
        with open(path, encoding="utf-8") as f:
            c = json.load(f)
        return ServiceConfig(
            server_url=c["serverUrl"],
            token=c["deviceToken"],
            site_code=c.get("siteCode", "skeet"),
            kara_id=c["karaId"],
            camera=c.get("camera", {"kind": "hikrobot"}),
            families=c.get("families", ["tag36h11"]),
            calibration_file=c.get("calibrationFile"),
            max_hz=float(c.get("maxHz", 4)),
            lost_after_s=float(c.get("lostAfterS", 3)),
            predict_max_s=float(c.get("predictMaxS", 1.5)),
            max_reproj_px=float(c.get("maxReprojPx", 2.0)),
            odometry=c.get("odometry"),
            refresh_config_s=float(c.get("refreshConfigS", 300)),
        )


def load_calibration(data: dict) -> Calibration:
    return Calibration(
        K=np.array(data["cameraMatrix"], dtype=float),
        dist=np.array(data["distCoeffs"], dtype=float),
        width=int(data["width"]),
        height=int(data["height"]),
        camera_to_forklift=data["cameraToForklift"],
        version=data.get("version"),
        serial=data.get("cameraSerial"),
    )


def markers_from_server(rows: list[dict]) -> list[MarkerInfo]:
    out = []
    for m in rows:
        z = m.get("mountHeightM") if m.get("mountHeightM") is not None else m.get("zM", 0.0)
        out.append(
            MarkerInfo(
                family=m["family"],
                tag_id=int(m["tagId"]),
                x=float(m["x"]),
                y=float(m["y"]),
                z_m=float(z),
                size_m=float(m["sizeM"]),
                yaw_deg=float(m.get("yawDeg", 0.0)),
                pitch_deg=float(m.get("pitchDeg", 0.0)),
                roll_deg=float(m.get("rollDeg", 0.0)),
                active=bool(m.get("active", True)),
            )
        )
    return out


class LocalizationService:
    def __init__(self, cfg: ServiceConfig):
        self.cfg = cfg
        self.client = RouteClient(cfg.server_url, cfg.token, cfg.site_code, cfg.kara_id)
        self.publisher = Publisher(self.client, max_hz=cfg.max_hz, log=log.warning)
        self.source = open_source(cfg.camera)
        self.detectors = [AprilTagDetector(f) for f in cfg.families]
        self.odometry = open_odometry(cfg.odometry) if cfg.odometry else NoOdometry()
        self.estimator: PoseEstimator | None = None
        self.tracker: PoseTracker | None = None
        self._loaded_at = 0.0
        self._stop = False

    def reload(self):
        remote = self.client.fetch_config(self.source.serial)
        coord = remote.get("coord") or {}
        mpu = float(coord.get("metersPerUnit") or (0.8 / 12))
        calib_data = remote.get("calibration")
        if self.cfg.calibration_file:
            with open(self.cfg.calibration_file, encoding="utf-8") as f:
                calib_data = json.load(f)
        if not calib_data:
            raise RuntimeError(f"нет калибровки для камеры {self.source.serial}: загрузите её в Route или укажите calibrationFile")
        calib = load_calibration(calib_data)
        markers = markers_from_server(remote.get("markers") or [])
        families = sorted({m.family for m in markers})
        if "tag16h5" in families:
            log.warning("используется tag16h5 — тестовое семейство, высок риск ложных срабатываний")
        limits = PoseLimits(max_reproj_px=self.cfg.max_reproj_px)
        self.estimator = PoseEstimator(PlanFrame(mpu), markers, calib, limits)
        if self.tracker is None:
            self.tracker = PoseTracker(TrackerConfig(meters_per_unit=mpu, lost_after_s=self.cfg.lost_after_s, predict_max_s=self.cfg.predict_max_s))
        self._loaded_at = time.time()
        log.info("конфигурация: меток %d, калибровка v%s (%s), масштаб %.4f м/px", len(markers), calib.version, calib.serial, mpu)

    def step(self, img: np.ndarray, t: float):
        assert self.estimator and self.tracker
        dets = []
        if img.size:
            for d in self.detectors:
                dets.extend(d.detect(img))
        est = self.estimator.estimate(dets) if dets else None
        if est:
            out = self.tracker.update(t, est.x, est.y, est.heading_deg, est.quality)
            if out:
                self.publisher.offer(out, est.tag_ids, est.reproj_error_px)
            else:
                log.debug("измерение отброшено фильтром (скачок)")
            return est
        out = self.tracker.tick(t, self.odometry.delta(t))
        if out:
            self.publisher.offer(out)
        return None

    def run(self):
        signal.signal(signal.SIGTERM, lambda *_: setattr(self, "_stop", True))
        self.reload()
        try:
            for img, t in self.source.frames():
                if self._stop:
                    break
                if time.time() - self._loaded_at > self.cfg.refresh_config_s:
                    try:
                        self.reload()
                    except Exception as e:
                        log.warning("конфигурация не обновлена: %s", e)
                self.step(img, t)
        finally:
            self.publisher.stop()
            self.source.close()
