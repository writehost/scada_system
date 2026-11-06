"""Оценка позы погрузчика по меткам с известными мировыми координатами.

Одна метка — solvePnP IPPE_SQUARE (две гипотезы, выбираем правдоподобную: камера ниже потолка, малая ошибка).
Несколько меток — совместный solvePnP по всем углам в мировых координатах (устойчивее к шуму).
Всегда проверяем ошибку перепроецирования; ложные срабатывания (неизвестный ID, большая ошибка,
невозможная геометрия) отбрасываются.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np

try:  # pragma: no cover
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

from .detector import Detection
from .geometry import PlanFrame, camera_in_body, inv_T, make_T, marker_pose_world, tag_corners_local, world_yaw_to_plan_heading


@dataclass
class MarkerInfo:
    family: str
    tag_id: int
    x: float
    y: float
    z_m: float
    size_m: float
    yaw_deg: float = 0.0
    pitch_deg: float = 0.0
    roll_deg: float = 0.0
    active: bool = True
    mount: str = "ceiling"


@dataclass
class Calibration:
    K: np.ndarray
    dist: np.ndarray
    width: int
    height: int
    camera_to_forklift: dict
    version: int | None = None
    serial: str | None = None


@dataclass
class PoseEstimate:
    x: float  # план
    y: float
    z_m: float
    heading_deg: float
    quality: float
    reproj_error_px: float
    tag_ids: list[int]
    distance_m: float
    rejected: list[tuple[int, str]] = field(default_factory=list)


@dataclass
class PoseLimits:
    max_reproj_px: float = 2.0
    min_distance_m: float = 0.3
    max_distance_m: float = 15.0
    max_camera_height_m: float = 4.0  # камера на погрузчике не выше 4 м
    min_camera_below_tag_m: float = 0.2


class PoseEstimator:
    def __init__(self, frame: PlanFrame, markers: list[MarkerInfo], calib: Calibration, limits: PoseLimits | None = None):
        self.frame = frame
        self.calib = calib
        self.limits = limits or PoseLimits()
        self.markers = {(m.family, m.tag_id): m for m in markers if m.active}
        self.T_b_c = camera_in_body(calib.camera_to_forklift)
        self._world_corners: dict[tuple[str, int], np.ndarray] = {}
        for key, m in self.markers.items():
            T_w_m = marker_pose_world(frame, m.x, m.y, m.z_m, m.yaw_deg, m.pitch_deg, m.roll_deg, m.mount)
            local = tag_corners_local(m.size_m)
            self._world_corners[key] = (T_w_m[:3, :3] @ local.T).T + T_w_m[:3, 3]

    def _reproj(self, obj: np.ndarray, img: np.ndarray, rvec, tvec) -> float:
        proj, _ = cv2.projectPoints(obj, rvec, tvec, self.calib.K, self.calib.dist)
        return float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - img.reshape(-1, 2)) ** 2, axis=1))))

    def _camera_world(self, rvec, tvec) -> np.ndarray:
        R, _ = cv2.Rodrigues(rvec)
        return inv_T(make_T(R, tvec.reshape(3)))  # world←camera

    def _plausible(self, T_w_c: np.ndarray, m: "MarkerInfo", T_w_m: np.ndarray) -> str | None:
        cam_z = T_w_c[2, 3]
        if m.mount == "ceiling" and cam_z > m.z_m - self.limits.min_camera_below_tag_m:
            return "камера выше метки"
        # камера должна быть перед лицевой стороной метки (иначе это зеркальное решение PnP)
        if float(T_w_m[:3, 2] @ (T_w_c[:3, 3] - T_w_m[:3, 3])) <= 0:
            return "камера за меткой"
        if cam_z > self.limits.max_camera_height_m or cam_z < -0.5:
            return "невозможная высота камеры"
        return None

    def estimate(self, detections: list[Detection]) -> PoseEstimate | None:
        rejected: list[tuple[int, str]] = []
        usable: list[tuple[Detection, MarkerInfo]] = []
        for d in detections:
            m = self.markers.get((d.family, d.tag_id))
            if not m:
                rejected.append((d.tag_id, "нет в реестре меток"))
                continue
            usable.append((d, m))
        if not usable:
            return None

        # Отсев по каждой метке отдельно (IPPE): ложное срабатывание даёт большую ошибку или невозможную позу.
        good: list[tuple[Detection, MarkerInfo]] = []
        single: list[tuple[float, np.ndarray, MarkerInfo, np.ndarray, np.ndarray]] = []
        for d, m in usable:
            obj = tag_corners_local(m.size_m)
            ok, rvecs, tvecs, _ = cv2.solvePnPGeneric(obj, d.corners, self.calib.K, self.calib.dist, flags=cv2.SOLVEPNP_IPPE_SQUARE)
            if not ok:
                rejected.append((d.tag_id, "PnP не решён"))
                continue
            T_w_m = marker_pose_world(self.frame, m.x, m.y, m.z_m, m.yaw_deg, m.pitch_deg, m.roll_deg, m.mount)
            best = None
            for rv, tv in zip(rvecs, tvecs):
                err = self._reproj(obj, d.corners, rv, tv)
                R, _ = cv2.Rodrigues(rv)
                T_c_m = make_T(R, tv.reshape(3))
                T_w_c = T_w_m @ inv_T(T_c_m)
                why = self._plausible(T_w_c, m, T_w_m)
                dist = float(np.linalg.norm(tv))
                if why or not (self.limits.min_distance_m <= dist <= self.limits.max_distance_m):
                    continue
                if best is None or err < best[0]:
                    best = (err, T_w_c, m, rv, tv)
            if best is None:
                rejected.append((d.tag_id, "невозможная геометрия"))
                continue
            if best[0] > self.limits.max_reproj_px:
                rejected.append((d.tag_id, f"ошибка перепроецирования {best[0]:.2f} px"))
                continue
            good.append((d, m))
            single.append(best)
        if not good:
            return None

        if len(good) >= 2:
            obj = np.vstack([self._world_corners[(m.family, m.tag_id)] for _, m in good])
            img = np.vstack([d.corners for d, _ in good])
            # старт с лучшей одиночной позы
            T0 = inv_T(single[int(np.argmin([s[0] for s in single]))][1])
            rv0, _ = cv2.Rodrigues(T0[:3, :3])
            ok, rvec, tvec = cv2.solvePnP(obj, img, self.calib.K, self.calib.dist, rv0, T0[:3, 3].reshape(3, 1), True, cv2.SOLVEPNP_ITERATIVE)
            if not ok:
                return None
            err = self._reproj(obj, img, rvec, tvec)
            T_w_c = self._camera_world(rvec, tvec)
            if err > self.limits.max_reproj_px * 1.5:
                # противоречие между метками (одна из них, вероятно, ложная или смещена) — берём лучшую одиночную
                err, T_w_c = single[int(np.argmin([s[0] for s in single]))][:2]
                good = [good[int(np.argmin([s[0] for s in single]))]]
        else:
            err, T_w_c = single[0][0], single[0][1]

        T_w_b = T_w_c @ inv_T(self.T_b_c)
        X, Y, Z = T_w_b[:3, 3]
        yaw = math.atan2(T_w_b[1, 0], T_w_b[0, 0])
        px, py = self.frame.world_to_plan(X, Y)
        dists = [float(np.linalg.norm(T_w_c[:3, 3] - self.frame.plan_to_world(m.x, m.y, m.z_m))) for _, m in good]
        q_err = max(0.0, 1.0 - err / self.limits.max_reproj_px)
        q_n = min(1.0, 0.6 + 0.2 * len(good))
        q_d = max(0.3, 1.0 - max(0.0, min(dists) - 3.0) / 12.0)
        return PoseEstimate(
            x=float(px),
            y=float(py),
            z_m=float(Z),
            heading_deg=world_yaw_to_plan_heading(yaw),
            quality=round(max(0.0, min(1.0, q_err * q_n * q_d)), 3),
            reproj_error_px=round(float(err), 3),
            tag_ids=[m.tag_id for _, m in good],
            distance_m=round(min(dists), 2),
            rejected=rejected,
        )
