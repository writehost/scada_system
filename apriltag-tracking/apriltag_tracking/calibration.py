# -*- coding: utf-8 -*-
"""Параметры объектива и размер метки.

calibration.json:
{
  "image_width": 1280, "image_height": 1024,
  "camera_matrix": [[fx, 0, cx], [0, fy, cy], [0, 0, 1]],
  "dist_coeffs": [k1, k2, p1, p2, k3],
  "tag_size_mm": 100,
  "tag_sizes_mm": {"tag16h5:3": 100},      # необязательно: размер для конкретной метки
  "calibrated": false,                       # true — только для настоящей калибровки этой камеры
  "camera_id": "...", "lens": "...", "rms_px": 0.3, "created": "..."   # необязательно
}

`calibrated: false` означает «номинальные параметры»: положение считается, но статус не выше
POSE_UNCERTAIN и calibration_valid = false. Без матрицы камеры или без размера метки метры не выдаются
(NO_CALIBRATION).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np


class CalibrationError(ValueError):
    pass


@dataclass
class Calibration:
    camera_matrix: np.ndarray
    dist_coeffs: np.ndarray
    image_width: int | None
    image_height: int | None
    calibrated: bool
    tag_size_m: float | None
    tag_sizes_m: dict[str, float] = field(default_factory=dict)
    source: str = "none"
    meta: dict = field(default_factory=dict)

    @property
    def fx(self) -> float:
        return float(self.camera_matrix[0, 0])

    @property
    def fy(self) -> float:
        return float(self.camera_matrix[1, 1])

    @property
    def cx(self) -> float:
        return float(self.camera_matrix[0, 2])

    @property
    def cy(self) -> float:
        return float(self.camera_matrix[1, 2])

    def size_for(self, family: str, tag_id: int) -> float | None:
        return self.tag_sizes_m.get(f"{family}:{tag_id}", self.tag_size_m)

    def matches_frame(self, width: int, height: int) -> tuple[bool, str]:
        if self.image_width is None or self.image_height is None:
            return True, ""
        if (self.image_width, self.image_height) != (width, height):
            return False, (
                f"калибровка для {self.image_width}×{self.image_height}, а кадр {width}×{height} "
                "(разрешение/биннинг/ROI изменены — нужна калибровка для этого режима)"
            )
        return True, ""

    def summary(self) -> str:
        d = ", ".join(f"{v:.4g}" for v in self.dist_coeffs.ravel())
        size = f"{self.tag_size_m * 1000:.1f} мм" if self.tag_size_m else "не задан"
        state = "ПОДТВЕРЖДЕНА" if self.calibrated else "НЕ ПОДТВЕРЖДЕНА (номинальные параметры)"
        res = f"{self.image_width}×{self.image_height}" if self.image_width else "не указано"
        extra = ""
        if self.tag_sizes_m:
            extra = "\n  размеры отдельных меток: " + ", ".join(f"{k}={v * 1000:.1f} мм" for k, v in self.tag_sizes_m.items())
        return (
            f"Калибровка: {state}; источник: {self.source}\n"
            f"  разрешение: {res}\n"
            f"  fx={self.fx:.2f} fy={self.fy:.2f} cx={self.cx:.2f} cy={self.cy:.2f}\n"
            f"  дисторсия: [{d}]\n"
            f"  размер метки: {size}{extra}"
        )

    def to_json(self) -> dict:
        return {
            "image_width": self.image_width,
            "image_height": self.image_height,
            "camera_matrix": self.camera_matrix.tolist(),
            "dist_coeffs": self.dist_coeffs.ravel().tolist(),
            "tag_size_mm": None if self.tag_size_m is None else round(self.tag_size_m * 1000, 3),
            "tag_sizes_mm": {k: round(v * 1000, 3) for k, v in self.tag_sizes_m.items()},
            "calibrated": self.calibrated,
            **self.meta,
        }


def _matrix(raw) -> np.ndarray:
    K = np.asarray(raw, dtype=float)
    if K.shape != (3, 3) or not np.isfinite(K).all():
        raise CalibrationError("camera_matrix должна быть матрицей 3×3 из чисел")
    if K[0, 0] <= 0 or K[1, 1] <= 0:
        raise CalibrationError("fx и fy должны быть положительными")
    if abs(K[2, 2] - 1.0) > 1e-9 or abs(K[1, 0]) > 1e-9 or abs(K[2, 0]) > 1e-9 or abs(K[2, 1]) > 1e-9:
        raise CalibrationError("camera_matrix должна иметь вид [[fx,s,cx],[0,fy,cy],[0,0,1]]")
    return K


def _dist(raw) -> np.ndarray:
    d = np.asarray(raw if raw is not None else [0, 0, 0, 0, 0], dtype=float).ravel()
    if d.size not in (4, 5, 8, 12, 14) or not np.isfinite(d).all():
        raise CalibrationError("dist_coeffs: 4, 5, 8, 12 или 14 чисел (формат OpenCV)")
    return d


def load_calibration(path: str | Path) -> Calibration:
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise CalibrationError(f"файл калибровки не найден: {p}") from None
    except json.JSONDecodeError as e:
        raise CalibrationError(f"{p}: некорректный JSON ({e})") from None
    K = _matrix(data.get("camera_matrix"))
    w, h = data.get("image_width"), data.get("image_height")
    if (w is None) != (h is None):
        raise CalibrationError("image_width и image_height задаются вместе")
    if w is not None:
        w, h = int(w), int(h)
        if not (0 < K[0, 2] < w and 0 < K[1, 2] < h):
            raise CalibrationError(f"cx, cy ({K[0, 2]}, {K[1, 2]}) вне кадра {w}×{h}")
    size = data.get("tag_size_mm")
    if size is not None and float(size) <= 0:
        raise CalibrationError("tag_size_mm должен быть положительным")
    sizes = {}
    for key, v in (data.get("tag_sizes_mm") or {}).items():
        if float(v) <= 0:
            raise CalibrationError(f"tag_sizes_mm[{key}] должен быть положительным")
        sizes[str(key)] = float(v) / 1000.0
    meta = {k: v for k, v in data.items() if k not in {"image_width", "image_height", "camera_matrix", "dist_coeffs", "tag_size_mm", "tag_sizes_mm", "calibrated"}}
    return Calibration(
        camera_matrix=K,
        dist_coeffs=_dist(data.get("dist_coeffs")),
        image_width=w,
        image_height=h,
        calibrated=bool(data.get("calibrated", False)),
        tag_size_m=None if size is None else float(size) / 1000.0,
        tag_sizes_m=sizes,
        source=str(p),
        meta=meta,
    )


def build_calibration(
    path: str | Path | None,
    tag_size_mm: float | None = None,
    fx: float | None = None,
    fy: float | None = None,
    cx: float | None = None,
    cy: float | None = None,
    frame_size: tuple[int, int] | None = None,
) -> Calibration | None:
    """Файл калибровки + переопределения из командной строки (совместимость со старым --fx/--fy).

    Возвращает None, если нет ни файла, ни fx/fy — тогда положение в метрах не считается.
    Параметры, заданные только через --fx/--fy, считаются НЕ подтверждённой калибровкой.
    """
    cal: Calibration | None = None
    if path:
        cal = load_calibration(path)
    if fx is not None or fy is not None:
        if fx is None or fy is None or fx <= 0 or fy <= 0:
            raise CalibrationError("--fx и --fy задаются вместе и должны быть положительными")
        w, h = frame_size if frame_size else ((cal.image_width, cal.image_height) if cal and cal.image_width else (None, None))
        ccx = cx if cx is not None else (cal.cx if cal else (w / 2 if w else None))
        ccy = cy if cy is not None else (cal.cy if cal else (h / 2 if h else None))
        if ccx is None or ccy is None:
            raise CalibrationError("укажите --cx/--cy или файл калибровки с разрешением кадра")
        K = np.array([[fx, 0.0, ccx], [0.0, fy, ccy], [0.0, 0.0, 1.0]])
        cal = Calibration(
            camera_matrix=K,
            dist_coeffs=cal.dist_coeffs if cal else np.zeros(5),
            image_width=cal.image_width if cal else (w if w else None),
            image_height=cal.image_height if cal else (h if h else None),
            calibrated=False,
            tag_size_m=cal.tag_size_m if cal else None,
            tag_sizes_m=cal.tag_sizes_m if cal else {},
            source=(cal.source + " + " if cal else "") + "--fx/--fy",
        )
    if cal is not None and tag_size_mm is not None:
        if tag_size_mm <= 0:
            raise CalibrationError("--tag-size-mm должен быть положительным")
        cal.tag_size_m = tag_size_mm / 1000.0
    return cal


def _find_board(gray, cols: int, rows: int):
    """Углы доски: сначала устойчивый findChessboardCornersSB, затем классический поиск."""
    import cv2

    ok, corners = cv2.findChessboardCornersSB(gray, (cols, rows), cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
    if ok:
        return corners
    ok, corners = cv2.findChessboardCorners(gray, (cols, rows), cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE)
    if ok:
        return cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 60, 1e-4))
    return None


def detect_board_size(images: list[str], max_images: int = 6, log=print) -> tuple[int, int] | None:
    """Подбор числа ВНУТРЕННИХ углов доски (колонки × строки) по нескольким снимкам."""
    import cv2

    sizes = sorted(((c, r) for c in range(3, 16) for r in range(3, 12) if c >= r), key=lambda x: -x[0] * x[1])
    for f in images[:max_images]:
        g = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
        if g is None:
            continue
        small = cv2.resize(g, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
        for c, r in sizes:
            ok, _ = cv2.findChessboardCornersSB(small, (c, r), 0)
            if ok:
                log(f"Доска распознана на {Path(f).name}: {c}×{r} внутренних углов ({c + 1}×{r + 1} клеток)")
                return c, r
    return None


def calibrate_chessboard(images: list[str], cols: int, rows: int, square_mm: float, debug_dir: str | None = None,
                         log=print) -> tuple[dict, list[str]]:
    """Калибровка по шахматной доске (внутренние углы cols×rows). Возвращает (данные для JSON, использованные файлы).

    Для каждого снимка печатается, найдена ли доска; в debug_dir сохраняются снимки с отмеченными углами.
    """
    import cv2

    if debug_dir:
        Path(debug_dir).mkdir(parents=True, exist_ok=True)
    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * (square_mm / 1000.0)
    obj, img, used, size = [], [], [], None
    for f in images:
        g = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
        if g is None:
            log(f"  {Path(f).name}: не читается")
            continue
        if size is not None and g.shape[::-1] != size:
            raise CalibrationError(f"{f}: другое разрешение {g.shape[::-1]}, ожидалось {size}")
        size = g.shape[::-1]
        corners = _find_board(g, cols, rows)
        sharp = cv2.Laplacian(g, cv2.CV_64F).var()
        overexposed = float((g >= 250).mean()) * 100
        if corners is None:
            hint = []
            if sharp < 30:
                hint.append(f"нерезко (резкость {sharp:.0f})")
            if overexposed > 5:
                hint.append(f"пересвет {overexposed:.0f}% кадра")
            log(f"  {Path(f).name}: доска {cols}×{rows} НЕ найдена" + (f" — {', '.join(hint)}" if hint else ""))
            if debug_dir:
                vis = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
                cv2.putText(vis, f"board {cols}x{rows} NOT FOUND", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.4, (0, 0, 255), 3)
                cv2.imwrite(str(Path(debug_dir) / (Path(f).stem + "_notfound.jpg")), vis)
            continue
        pts = corners.reshape(-1, 2)
        cover = (pts[:, 0].max() - pts[:, 0].min()) * (pts[:, 1].max() - pts[:, 1].min()) / (size[0] * size[1]) * 100
        log(f"  {Path(f).name}: OK, доска занимает ~{cover:.0f}% кадра, резкость {sharp:.0f}")
        if debug_dir:
            vis = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
            cv2.drawChessboardCorners(vis, (cols, rows), corners, True)
            cv2.imwrite(str(Path(debug_dir) / (Path(f).stem + "_ok.jpg")), vis)
        obj.append(objp)
        img.append(corners.reshape(-1, 1, 2).astype(np.float32))
        used.append(f)
    if len(obj) < 8:
        raise CalibrationError(f"доска {cols}×{rows} найдена на {len(obj)} снимках из {len(images)}; нужно не меньше 8")
    rms, K, dist, rvecs, tvecs = cv2.calibrateCamera(obj, img, size, None, None)
    per_view = []
    for o, i, rv, tv, f in zip(obj, img, rvecs, tvecs, used):
        proj, _ = cv2.projectPoints(o, rv, tv, K, dist)
        per_view.append((float(np.sqrt(np.mean(np.sum((proj - i) ** 2, axis=2)))), f))
    worst = sorted(per_view, reverse=True)[:3]
    log("  худшие снимки по ошибке: " + ", ".join(f"{Path(f).name} {e:.2f} px" for e, f in worst))
    return (
        {
            "image_width": int(size[0]),
            "image_height": int(size[1]),
            "camera_matrix": K.tolist(),
            "dist_coeffs": dist.ravel().tolist(),
            "rms_px": round(float(rms), 4),
            "frames_used": len(obj),
            "board_inner_corners": f"{cols}x{rows}",
            "square_mm": square_mm,
            "calibrated": True,
        },
        used,
    )
