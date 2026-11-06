# -*- coding: utf-8 -*-
"""Положение метки относительно камеры: cv2.solvePnPGeneric(SOLVEPNP_IPPE_SQUARE).

Системы координат
  Камера (OpenCV): X — вправо по кадру, Y — вниз по кадру, Z — по оптической оси от камеры.
  Метка: начало — центр метки, X — вправо, Y — вверх по рисунку метки, Z — из лицевой стороны метки
  (к камере, которая её видит).

  position_camera_m = t   — центр метки в системе КАМЕРЫ (то, что спрашивают «где метка»).
  R (rvec)                 — поворот метка → камера: p_cam = R · p_tag + t.
  camera_in_tag_m = −Rᵀt   — положение КАМЕРЫ в системе МЕТКИ (нужно позже для позиционирования).
  distance_m = |t|         — расстояние по прямой от центра проекции до центра метки.

Плоская PnP-задача для квадрата имеет до двух решений (IPPE). Для каждого проверяем:
  * Z центра и всех углов > 0 (метка перед камерой);
  * лицевая сторона обращена к камере;
  * ошибку перепроецирования.
Если два решения близки по ошибке — неоднозначность; её разрешает только согласованность с предыдущим
достоверным положением этой же метки. Иначе статус POSE_UNCERTAIN.

Координаты погрузчика на складе здесь НЕ вычисляются: для этого нужны мировые координаты меток и
преобразование камера → корпус. Поля forklift_* в выходе всегда null с причиной.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

from .calibration import Calibration
from .detection import TagDetection

POSE_VALID = "POSE_VALID"
POSE_UNCERTAIN = "POSE_UNCERTAIN"
NO_CALIBRATION = "NO_CALIBRATION"


def tag_object_points(size_m: float) -> np.ndarray:
    h = size_m / 2.0
    return np.array([[-h, h, 0.0], [h, h, 0.0], [h, -h, 0.0], [-h, -h, 0.0]], dtype=np.float64)


@dataclass
class PoseCandidate:
    rvec: np.ndarray
    tvec: np.ndarray
    R: np.ndarray
    reproj_px: float
    valid: bool
    reason: str = ""

    @property
    def distance_m(self) -> float:
        return float(np.linalg.norm(self.tvec))


@dataclass
class PoseResult:
    status: str
    reasons: list[str]
    candidates: list[PoseCandidate]
    chosen: PoseCandidate | None
    alternative: PoseCandidate | None
    ambiguity_ratio: float | None
    tag_size_m: float
    calibration_valid: bool
    resolved_by_prior: bool = False
    extra: dict = field(default_factory=dict)
    codes: list[str] = field(default_factory=list)  # короткие коды причин (для окна и программ)

    @property
    def has_pose(self) -> bool:
        return self.chosen is not None

    @property
    def valid(self) -> bool:
        return self.status == POSE_VALID

    @property
    def position_camera_m(self) -> np.ndarray | None:
        return None if self.chosen is None else self.chosen.tvec.copy()

    @property
    def distance_m(self) -> float | None:
        return None if self.chosen is None else self.chosen.distance_m

    @property
    def reproj_px(self) -> float | None:
        return None if self.chosen is None else self.chosen.reproj_px

    @property
    def camera_in_tag_m(self) -> np.ndarray | None:
        if self.chosen is None:
            return None
        return -self.chosen.R.T @ self.chosen.tvec


# ---------------- вращения ----------------


def rotmat_to_quat(R: np.ndarray) -> np.ndarray:
    """Кватернион (w, x, y, z), w ≥ 0."""
    R = np.asarray(R, dtype=float)
    tr = np.trace(R)
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = math.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = math.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = math.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q, dtype=float)
    q /= np.linalg.norm(q)
    return q if q[0] >= 0 else -q


def quat_to_rotmat(q) -> np.ndarray:
    w, x, y, z = np.asarray(q, dtype=float) / np.linalg.norm(q)
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def quat_slerp(q0, q1, a: float) -> np.ndarray:
    q0 = np.asarray(q0, dtype=float)
    q1 = np.asarray(q1, dtype=float)
    d = float(np.dot(q0, q1))
    if d < 0:  # кратчайший путь: q и −q — один и тот же поворот
        q1, d = -q1, -d
    if d > 0.9995:
        q = q0 + a * (q1 - q0)
    else:
        th = math.acos(d)
        q = (math.sin((1 - a) * th) * q0 + math.sin(a * th) * q1) / math.sin(th)
    q /= np.linalg.norm(q)
    return q if q[0] >= 0 else -q


def rotation_angle_deg(R1: np.ndarray, R2: np.ndarray) -> float:
    c = (np.trace(R1.T @ R2) - 1.0) / 2.0
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def euler_xyz_deg(R: np.ndarray) -> tuple[float, float, float]:
    """Только для отображения: R = Rz·Ry·Rx, углы (x, y, z) в градусах."""
    sy = math.hypot(R[0, 0], R[1, 0])
    if sy > 1e-6:
        x = math.atan2(R[2, 1], R[2, 2])
        y = math.atan2(-R[2, 0], sy)
        z = math.atan2(R[1, 0], R[0, 0])
    else:
        x = math.atan2(-R[1, 2], R[1, 1])
        y = math.atan2(-R[2, 0], sy)
        z = 0.0
    return math.degrees(x), math.degrees(y), math.degrees(z)


def tag_tilt_deg(R: np.ndarray) -> float:
    """Угол между нормалью метки и направлением на камеру (0° — метка смотрит прямо в камеру)."""
    n = R[:, 2]
    return math.degrees(math.acos(max(-1.0, min(1.0, -float(n[2])))))


# ---------------- оценка ----------------


@dataclass
class PoseConfig:
    max_reproj_px: float = 2.0
    ambiguity_ratio: float = 2.0  # err2/err1 ниже — решения считаются неоднозначными
    error_floor_px: float = 0.15  # шум субпиксельных углов: меньше не различаем
    prior_max_angle_deg: float = 20.0  # насколько выбранное решение может отличаться от предыдущего
    min_side_px: float = 12.0  # мельче — расстояние недостоверно
    max_tilt_deg: float = 75.0


class PoseEstimator:
    def __init__(self, calibration: Calibration | None, config: PoseConfig | None = None):
        self.cal = calibration
        self.cfg = config or PoseConfig()

    def can_estimate(self, det: TagDetection) -> tuple[bool, str]:
        if self.cal is None:
            return False, "нет параметров объектива (calibration.json или --fx/--fy)"
        if self.cal.size_for(det.family, det.tag_id) is None:
            return False, "не задан размер метки (--tag-size-mm или tag_size_mm)"
        return True, ""

    def _reproj(self, obj, img2, rvec, tvec) -> float:
        proj, _ = cv2.projectPoints(obj, rvec, tvec, self.cal.camera_matrix, self.cal.dist_coeffs)
        return float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - img2) ** 2, axis=1))))

    def _raw_solutions(self, obj: np.ndarray, img: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, str]]:
        """IPPE_SQUARE (до двух решений) + SQPNP; каждое уточняется Левенбергом–Марквардтом.

        Уточнение нужно: для метки, видимой почти строго фронтально, OpenCV IPPE_SQUARE возвращает верное
        смещение, но вырожденный поворот (ошибка в несколько пикселей даже на идеальных углах).
        LM от этого же начального приближения и независимое решение SQPNP это исправляют.
        """
        K, D = self.cal.camera_matrix, self.cal.dist_coeffs
        sols = []
        n, rvecs, tvecs, _ = cv2.solvePnPGeneric(obj, img, K, D, flags=cv2.SOLVEPNP_IPPE_SQUARE)
        sols += [(np.asarray(rvecs[i], float).reshape(3, 1), np.asarray(tvecs[i], float).reshape(3, 1), "ippe_square") for i in range(int(n))]
        sqpnp = getattr(cv2, "SOLVEPNP_SQPNP", None)
        if sqpnp is not None:
            try:
                ok, rv, tv = cv2.solvePnP(obj, img, K, D, flags=sqpnp)
                if ok:
                    sols.append((np.asarray(rv, float).reshape(3, 1), np.asarray(tv, float).reshape(3, 1), "sqpnp"))
            except cv2.error:
                pass
        out = []
        img2 = img.reshape(-1, 2)
        for rv, tv, how in sols:
            e0 = self._reproj(obj, img2, rv, tv)
            try:
                rv2, tv2 = cv2.solvePnPRefineLM(obj, img, K, D, rv.copy(), tv.copy())
                if np.isfinite(rv2).all() and np.isfinite(tv2).all() and self._reproj(obj, img2, rv2, tv2) <= e0:
                    rv, tv = rv2, tv2
            except cv2.error:
                pass
            out.append((rv.reshape(3), tv.reshape(3), how))
        return out

    def _candidates(self, det: TagDetection, size_m: float) -> list[PoseCandidate]:
        obj = tag_object_points(size_m)
        img = det.corners_px.astype(np.float64).reshape(4, 1, 2)
        out: list[PoseCandidate] = []
        for rvec, tvec, how in self._raw_solutions(obj, img):
            R, _ = cv2.Rodrigues(rvec)
            # одинаковые решения (IPPE и SQPNP часто сходятся к одному) считаем одним
            if any(rotation_angle_deg(R, c.R) < 0.5 and np.linalg.norm(tvec - c.tvec) < 1e-4 * max(1.0, np.linalg.norm(tvec)) for c in out):
                continue
            err = self._reproj(obj, det.corners_px, rvec, tvec)
            cand = PoseCandidate(rvec, tvec, R, err, True)
            pts_cam = (R @ obj.T).T + tvec
            if not np.isfinite(tvec).all() or not np.isfinite(err):
                cand.valid, cand.reason = False, "нечисловое решение"
            elif tvec[2] <= 0 or np.any(pts_cam[:, 2] <= 0):
                cand.valid, cand.reason = False, "Z ≤ 0 (метка за камерой)"
            elif float(R[:, 2] @ tvec) >= 0:
                cand.valid, cand.reason = False, "к камере обращена обратная сторона метки"
            out.append(cand)
        out.sort(key=lambda c: (not c.valid, c.reproj_px))
        return out

    def estimate(self, det: TagDetection, prior_R: np.ndarray | None = None) -> PoseResult | None:
        ok, _ = self.can_estimate(det)
        if not ok:
            return None
        size = float(self.cal.size_for(det.family, det.tag_id))
        cands = self._candidates(det, size)
        valid = [c for c in cands if c.valid]
        reasons: list[str] = []
        cal_ok = bool(self.cal.calibrated)
        res = PoseResult(POSE_UNCERTAIN, reasons, cands, None, None, None, size, cal_ok)
        if not valid:
            res.codes.append("no_valid_solution")
            reasons.append("нет физически допустимого решения PnP: " + "; ".join(c.reason for c in cands))
            return res
        best = valid[0]
        alt = valid[1] if len(valid) > 1 else None
        chosen = best
        if alt is not None:
            ratio = max(alt.reproj_px, self.cfg.error_floor_px) / max(best.reproj_px, self.cfg.error_floor_px)
            res.ambiguity_ratio = round(ratio, 3)
            if ratio < self.cfg.ambiguity_ratio:
                if prior_R is not None:
                    a_best = rotation_angle_deg(prior_R, best.R)
                    a_alt = rotation_angle_deg(prior_R, alt.R)
                    chosen, other_angle = (best, a_alt) if a_best <= a_alt else (alt, a_best)
                    if min(a_best, a_alt) <= self.cfg.prior_max_angle_deg and other_angle > min(a_best, a_alt):
                        res.resolved_by_prior = True
                    else:
                        res.codes.append("ambiguous")
                        reasons.append(
                            f"два решения PnP близки (ошибки {best.reproj_px:.2f}/{alt.reproj_px:.2f} px), "
                            "предыдущее положение их не различает"
                        )
                else:
                    res.codes.append("ambiguous")
                    reasons.append(
                        f"два решения PnP близки (ошибки {best.reproj_px:.2f}/{alt.reproj_px:.2f} px), "
                        "нет предыдущего достоверного положения"
                    )
        res.chosen = chosen
        res.alternative = alt if chosen is best else best
        if chosen.reproj_px > self.cfg.max_reproj_px:
            res.codes.append("reprojection")
            reasons.append(f"ошибка перепроецирования {chosen.reproj_px:.2f} px > {self.cfg.max_reproj_px:.2f}")
        if det.min_side_px < self.cfg.min_side_px:
            res.codes.append("too_small")
            reasons.append(f"метка слишком мала в кадре ({det.min_side_px:.0f} px)")
        tilt = tag_tilt_deg(chosen.R)
        res.extra["tilt_deg"] = round(tilt, 1)
        if tilt > self.cfg.max_tilt_deg:
            res.codes.append("steep_angle")
            reasons.append(f"метка видна под острым углом ({tilt:.0f}°)")
        if not cal_ok:
            res.codes.append("uncalibrated")
            reasons.append("калибровка не подтверждена (calibrated=false): расстояние приблизительное")
        res.status = POSE_VALID if not reasons else POSE_UNCERTAIN
        return res
