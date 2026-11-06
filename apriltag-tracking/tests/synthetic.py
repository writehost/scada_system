# -*- coding: utf-8 -*-
"""Синтетические кадры с метками AprilTag в точно известной позе (только для автотестов).

Рисунок метки — cv2.aruco DICT_APRILTAG_* (те же коды, что у семейств AprilTag). Кадр строится
гомографией K·[r1 r2 t] из плоскости метки, поэтому истинные углы и расстояние известны точно.
Это проверка геометрии и логики, а не подтверждение точности реальной камеры.
"""
from __future__ import annotations

import math

import cv2
import numpy as np

W, H = 1280, 1024
F = 997.28
K = np.array([[F, 0, W / 2], [0, F, H / 2], [0, 0, 1]], dtype=float)
DICTS = {"tag16h5": cv2.aruco.DICT_APRILTAG_16h5, "tag36h11": cv2.aruco.DICT_APRILTAG_36h11, "tag25h9": cv2.aruco.DICT_APRILTAG_25h9}


def rx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def ry(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rz(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def facing_pose(distance_m=0.5, tilt_x_deg=0.0, tilt_y_deg=0.0, yaw_deg=0.0, offset=(0.0, 0.0)):
    """Поза метки в системе камеры: метка лицом к камере, затем наклоны в системе метки."""
    R0 = np.diag([1.0, -1.0, -1.0])  # X метки → X камеры, Y метки (вверх) → −Y камеры, Z метки → к камере
    R = R0 @ rx(math.radians(tilt_x_deg)) @ ry(math.radians(tilt_y_deg)) @ rz(math.radians(yaw_deg))
    t = np.array([offset[0], offset[1], distance_m], dtype=float)
    return R, t


def project(pts, R, t, K_=K):
    p = (R @ np.asarray(pts, float).T).T + t
    uv = (K_ @ p.T).T
    return uv[:, :2] / uv[:, 2:3]


def tag_corners_ippe(size_m, R, t, K_=K):
    h = size_m / 2
    return project([[-h, h, 0], [h, h, 0], [h, -h, 0], [-h, -h, 0]], R, t, K_)


def background(seed=0, w=W, h=H, level=128, noise=3.0):
    rng = np.random.default_rng(seed)
    return np.clip(level + rng.normal(0, noise, (h, w)), 0, 255).astype(np.uint8)


def draw_tag(img, family, tag_id, size_m, R, t, K_=K, res=600, white=255, black=0):
    """Метка (чёрный квадрат size_m) с белым полем шириной в 1 ячейку вокруг."""
    marker = cv2.aruco.generateImageMarker(cv2.aruco.getPredefinedDictionary(DICTS[family]), tag_id, res)
    marker = np.where(marker > 127, white, black).astype(np.uint8)
    bits = {"tag16h5": 6, "tag25h9": 7, "tag36h11": 8}[family]
    pad = res // bits
    tile = np.full((res + 2 * pad, res + 2 * pad), white, np.uint8)
    tile[pad : pad + res, pad : pad + res] = marker
    S = float(res)
    c = pad + (res - 1) / 2.0  # центр квадрата; края пикселей — на ±0.5
    # пиксель (u, v) плитки → (x, y, 1) в плоскости метки, y вверх
    A = np.array([[size_m / S, 0, -c * size_m / S], [0, -size_m / S, c * size_m / S], [0, 0, 1]])
    Hm = K_ @ np.column_stack([R[:, 0], R[:, 1], t]) @ A
    h, w = img.shape
    warped = cv2.warpPerspective(tile, Hm, (w, h), flags=cv2.INTER_AREA, borderValue=0)
    mask = cv2.warpPerspective(np.full_like(tile, 255), Hm, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    img[mask > 0] = warped[mask > 0]
    return img


def render(tags, seed=0, blur=0.6, noise=3.0, K_=K, w=W, h=H):
    """tags: [(family, id, size_m, R, t)] → (gray, {key: истинные углы IPPE})"""
    img = background(seed, w, h, noise=0)
    truth = {}
    for fam, tid, size, R, t in tags:
        draw_tag(img, fam, tid, size, R, t, K_)
        truth[f"{fam}:{tid}"] = (tag_corners_ippe(size, R, t, K_), R, t)
    if blur > 0:
        img = cv2.GaussianBlur(img, (0, 0), blur)
    if noise > 0:
        rng = np.random.default_rng(seed + 1000)
        img = np.clip(img.astype(float) + rng.normal(0, noise, img.shape), 0, 255).astype(np.uint8)
    return img, truth


def calibration_dict(calibrated=True, tag_size_mm=100.0, K_=K, w=W, h=H):
    return {
        "image_width": w,
        "image_height": h,
        "camera_matrix": K_.tolist(),
        "dist_coeffs": [0, 0, 0, 0, 0],
        "tag_size_mm": tag_size_mm,
        "calibrated": calibrated,
    }


def chessboard_views(cols=9, rows=6, square_m=0.025, n=14, seed=0):
    """Снимки шахматной доски под разными углами (для теста Calibration Mode)."""
    rng = np.random.default_rng(seed)
    sq = 60
    board = np.zeros(((rows + 1) * sq, (cols + 1) * sq), np.uint8)
    for r in range(rows + 1):
        for c in range(cols + 1):
            if (r + c) % 2 == 0:
                board[r * sq : (r + 1) * sq, c * sq : (c + 1) * sq] = 255
    pad = sq
    tile = np.full((board.shape[0] + 2 * pad, board.shape[1] + 2 * pad), 255, np.uint8)
    tile[pad:-pad, pad:-pad] = board
    out = []
    for i in range(n):
        R, t = facing_pose(0.45 + 0.1 * rng.random(), rng.uniform(-25, 25), rng.uniform(-25, 25), rng.uniform(-20, 20),
                           (rng.uniform(-0.08, 0.08), rng.uniform(-0.06, 0.06)))
        s = square_m / sq
        cx, cy = (tile.shape[1] - 1) / 2, (tile.shape[0] - 1) / 2
        A = np.array([[s, 0, -cx * s], [0, -s, cy * s], [0, 0, 1]])
        Hm = K @ np.column_stack([R[:, 0], R[:, 1], t]) @ A
        img = cv2.warpPerspective(tile, Hm, (W, H), flags=cv2.INTER_AREA, borderValue=110)
        out.append(cv2.GaussianBlur(img, (0, 0), 0.7))
    return out
