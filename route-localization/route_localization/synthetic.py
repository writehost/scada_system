"""Синтетические кадры: рендер меток на потолке в камеру погрузчика по известной позе.

Используется в тестах (проверка цепочки детектор → поза → корпус) и для отладки без склада.
Это НЕ подтверждение точности на объекте: реальная точность проверяется на складе.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

from .geometry import PlanFrame, camera_in_body, inv_T, make_T, marker_pose_world, plan_heading_to_world_yaw, rot_z, tag_corners_local
from .pose import Calibration, MarkerInfo

DICTS = {
    "tag16h5": cv2.aruco.DICT_APRILTAG_16h5,
    "tag25h9": cv2.aruco.DICT_APRILTAG_25h9,
    "tag36h10": cv2.aruco.DICT_APRILTAG_36h10,
    "tag36h11": cv2.aruco.DICT_APRILTAG_36h11,
}


def default_calibration(width=1280, height=1024, f=900.0, extr=None) -> Calibration:
    K = np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1]], dtype=float)
    return Calibration(K=K, dist=np.zeros(5), width=width, height=height, camera_to_forklift=extr or {"x": 0.4, "y": 0.0, "z": 2.2})


def body_pose_world(frame: PlanFrame, x: float, y: float, heading_deg: float) -> np.ndarray:
    return make_T(rot_z(plan_heading_to_world_yaw(heading_deg)), frame.plan_to_world(x, y, 0.0))


def render(frame: PlanFrame, markers: list[MarkerInfo], calib: Calibration, x: float, y: float, heading_deg: float, noise: float = 2.0, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    img = np.full((calib.height, calib.width), 170, np.uint8)
    T_w_c = body_pose_world(frame, x, y, heading_deg) @ camera_in_body(calib.camera_to_forklift)
    T_c_w = inv_T(T_w_c)
    rvec, _ = cv2.Rodrigues(T_c_w[:3, :3])
    tvec = T_c_w[:3, 3]
    for m in markers:
        T_w_m = marker_pose_world(frame, m.x, m.y, m.z_m, m.yaw_deg, m.pitch_deg, m.roll_deg)
        # метка с белой рамкой (1/4 размера с каждой стороны)
        outer = m.size_m * 1.5
        world = (T_w_m[:3, :3] @ tag_corners_local(outer).T).T + T_w_m[:3, 3]
        cam = (T_c_w[:3, :3] @ world.T).T + tvec
        if np.any(cam[:, 2] <= 0.1):
            continue
        pts, _ = cv2.projectPoints(world, rvec, tvec, calib.K, calib.dist)
        pts = pts.reshape(4, 2).astype(np.float32)
        if np.any(pts < -calib.width) or np.any(pts > 2 * calib.width):
            continue
        side = 400
        tag = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(DICTS[m.family]), m.tag_id, side)
        pad = side // 4
        tile = np.full((side + 2 * pad, side + 2 * pad), 255, np.uint8)
        tile[pad : pad + side, pad : pad + side] = tag
        s = tile.shape[0] - 1
        src = np.array([[0, 0], [s, 0], [s, s], [0, s]], dtype=np.float32)
        H = cv2.getPerspectiveTransform(src, pts)
        warped = cv2.warpPerspective(tile, H, (calib.width, calib.height), flags=cv2.INTER_LINEAR, borderValue=0)
        mask = cv2.warpPerspective(np.full_like(tile, 255), H, (calib.width, calib.height), flags=cv2.INTER_NEAREST, borderValue=0)
        img[mask > 0] = warped[mask > 0]
    if noise > 0:
        img = np.clip(img.astype(float) + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    return img


def ceiling_grid(frame_mpu: float, x0: float, y0: float, cols: int, rows: int, step_m: float, z_m: float = 6.0, size_m: float = 0.25, family: str = "tag36h11", start_id: int = 0) -> list[MarkerInfo]:
    out = []
    k = start_id
    for r in range(rows):
        for c in range(cols):
            out.append(MarkerInfo(family, k, x0 + c * step_m / frame_mpu, y0 + r * step_m / frame_mpu, z_m, size_m, yaw_deg=(k * 37) % 360))
            k += 1
    return out


__all__ = ["render", "default_calibration", "ceiling_grid", "body_pose_world", "math"]
