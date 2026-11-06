"""Калибровка камеры по шахматной доске.

Результат — JSON с матрицей камеры, дисторсией, RMS, разрешением, серийным номером и объективом.
Калибровка привязана к камере + объективу + разрешению; в Route каждая загрузка — новая версия
(POST /api/route/calibrations, роль администратора карты).
"""
from __future__ import annotations

import glob
import json

import cv2
import numpy as np


def calibrate_chessboard(pattern: str, cols: int, rows: int, square_m: float) -> dict:
    files = sorted(glob.glob(pattern))
    if len(files) < 8:
        raise SystemExit(f"нужно не меньше 8 снимков доски, найдено {len(files)}")
    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * square_m
    obj, img, size = [], [], None
    for f in files:
        g = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
        size = g.shape[::-1]
        ok, corners = cv2.findChessboardCorners(g, (cols, rows), None)
        if not ok:
            continue
        corners = cv2.cornerSubPix(g, corners, (11, 11), (-1, -1), (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 1e-4))
        obj.append(objp)
        img.append(corners)
    if len(obj) < 8:
        raise SystemExit(f"доска найдена только на {len(obj)} снимках из {len(files)}")
    rms, K, dist, _, _ = cv2.calibrateCamera(obj, img, size, None, None)
    return {"width": int(size[0]), "height": int(size[1]), "cameraMatrix": K.tolist(), "distCoeffs": dist.reshape(-1).tolist(), "rmsPx": round(float(rms), 4), "frames": len(obj)}


def write_calibration(path: str, data: dict, serial: str, lens: str, extr: dict):
    out = {**data, "cameraSerial": serial, "lens": lens, "cameraToForklift": extr}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out
