# -*- coding: utf-8 -*-
"""Обнаружение AprilTag и фильтрация.

Основной детектор — pupil-apriltags (как в исходном create_detectors()).
Положение через pupil (estimate_tag_pose=True) НЕ вычисляется: внутренний алгоритм библиотеки
печатает «more than one new minima found» и иногда даёт неверную ветку решения. Положение считает
pose.py через cv2.solvePnPGeneric(SOLVEPNP_IPPE_SQUARE).

Порядок углов (проверено тестами tests/test_corner_order.py):
  * SOLVEPNP_IPPE_SQUARE требует объектные точки
        0: (-s/2,  s/2, 0)   верх-лево
        1: ( s/2,  s/2, 0)   верх-право
        2: ( s/2, -s/2, 0)   низ-право
        3: (-s/2, -s/2, 0)   низ-лево
    т.е. на изображении (ось y вниз) обход по часовой стрелке, начиная с верхнего левого угла.
  * pupil-apriltags (библиотека apriltag 3) отдаёт tag.corners против часовой стрелки на изображении,
    начиная с нижнего левого угла метки: низ-лево, низ-право, верх-право, верх-лево.
    → перестановка [3, 2, 1, 0].
  * OpenCV aruco (запасной детектор) уже отдаёт верх-лево, верх-право, низ-право, низ-лево.

Дополнительная защита: у реальной метки, видимой с лицевой стороны, обход углов в порядке IPPE
всегда по часовой стрелке (положительная ориентированная площадь при y вниз). Если это не так —
порядок углов перепутан (зеркальная перестановка), такая детекция отбрасывается, а не превращается
в неверное положение.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

PUPIL_TO_IPPE = (3, 2, 1, 0)

OPENCV_DICTS = {
    "tag16h5": "DICT_APRILTAG_16h5",
    "tag25h9": "DICT_APRILTAG_25h9",
    "tag36h10": "DICT_APRILTAG_36h10",
    "tag36h11": "DICT_APRILTAG_36h11",
}


@dataclass
class TagDetection:
    family: str
    tag_id: int
    corners_px: np.ndarray  # 4×2 в порядке SOLVEPNP_IPPE_SQUARE
    center_px: np.ndarray  # 2
    hamming: int | None
    decision_margin: float | None
    backend: str
    raw_corners_px: np.ndarray | None = None  # как отдал детектор (для диагностики)

    @property
    def key(self) -> str:
        return f"{self.family}:{self.tag_id}"

    @property
    def min_side_px(self) -> float:
        return min_side(self.corners_px)


@dataclass
class DetectionStats:
    raw: int = 0
    accepted: int = 0
    rejected: dict[str, int] = field(default_factory=dict)

    def reject(self, reason: str):
        self.rejected[reason] = self.rejected.get(reason, 0) + 1


def pupil_corners_to_ippe(corners) -> np.ndarray:
    c = np.asarray(corners, dtype=np.float64).reshape(4, 2)
    return c[list(PUPIL_TO_IPPE)].copy()


def signed_area_ydown(corners) -> float:
    """Ориентированная площадь при оси y вниз: > 0 — обход по часовой стрелке на экране."""
    c = np.asarray(corners, dtype=np.float64).reshape(4, 2)
    x, y = c[:, 0], c[:, 1]
    return 0.5 * float(np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y))


def min_side(corners) -> float:
    c = np.asarray(corners, dtype=np.float64).reshape(4, 2)
    return float(min(np.linalg.norm(c[i] - c[(i + 1) % 4]) for i in range(4)))


def is_convex(corners) -> bool:
    c = np.asarray(corners, dtype=np.float64).reshape(4, 2)
    signs = []
    for i in range(4):
        a, b, d = c[i], c[(i + 1) % 4], c[(i + 2) % 4]
        signs.append(np.sign((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])))
    return all(s > 0 for s in signs) or all(s < 0 for s in signs)


class _PupilBackend:
    name = "pupil-apriltags"

    def __init__(self, family: str, nthreads: int, quad_decimate: float, refine_edges: int):
        from pupil_apriltags import Detector

        self.family = family
        self.det = Detector(families=family, nthreads=nthreads, quad_decimate=quad_decimate, refine_edges=refine_edges)

    def detect(self, gray):
        out = []
        for t in self.det.detect(gray, estimate_tag_pose=False):
            raw = np.asarray(t.corners, dtype=np.float64).reshape(4, 2)
            out.append(
                TagDetection(
                    family=self.family,
                    tag_id=int(t.tag_id),
                    corners_px=pupil_corners_to_ippe(raw),
                    center_px=np.asarray(t.center, dtype=np.float64).reshape(2),
                    hamming=int(t.hamming),
                    decision_margin=float(t.decision_margin),
                    backend=self.name,
                    raw_corners_px=raw,
                )
            )
        return out


class _OpenCVBackend:
    """Запасной детектор (cv2.aruco). Не даёт decision_margin; hamming = 0, т.к. коррекция ошибок выключена."""

    name = "opencv-aruco"

    def __init__(self, family: str):
        if cv2 is None or family not in OPENCV_DICTS:
            raise RuntimeError(f"OpenCV не поддерживает семейство {family}")
        self.family = family
        d = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, OPENCV_DICTS[family]))
        p = cv2.aruco.DetectorParameters()
        p.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_APRILTAG
        p.errorCorrectionRate = 0.0  # только точное совпадение кода
        self.det = cv2.aruco.ArucoDetector(d, p)

    def detect(self, gray):
        corners, ids, _ = self.det.detectMarkers(gray)
        out = []
        if ids is None:
            return out
        for c, i in zip(corners, ids.ravel()):
            c = np.asarray(c, dtype=np.float64).reshape(4, 2)
            out.append(TagDetection(self.family, int(i), c.copy(), c.mean(axis=0), 0, None, self.name, c.copy()))
        return out


def pupil_available() -> bool:
    try:
        import pupil_apriltags  # noqa: F401

        return True
    except Exception:
        return False


class DetectorBank:
    """Детекторы по семействам + фильтр (hamming, decision margin, геометрия, повторы ID)."""

    def __init__(
        self,
        families,
        min_margin: float = 15.0,
        max_hamming: int = 0,
        backend: str = "auto",
        nthreads: int = 2,
        quad_decimate: float = 1.0,
        refine_edges: int = 1,
        min_side_px: float = 8.0,
        _backends=None,
    ):
        self.families = list(families)
        self.min_margin = float(min_margin)
        self.max_hamming = int(max_hamming)
        self.min_side_px = float(min_side_px)
        if _backends is not None:  # для тестов
            self.backends = _backends
        else:
            use_pupil = backend == "pupil" or (backend == "auto" and pupil_available())
            if backend == "pupil" and not pupil_available():
                raise RuntimeError("pupil-apriltags не установлен: py -m pip install pupil-apriltags")
            self.backends = [
                _PupilBackend(f, nthreads, quad_decimate, refine_edges) if use_pupil else _OpenCVBackend(f) for f in self.families
            ]
        self.backend_name = self.backends[0].name if self.backends else "none"

    def detect(self, gray: np.ndarray) -> tuple[list[TagDetection], DetectionStats]:
        if gray.ndim == 3:
            gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
        if gray.dtype != np.uint8:
            gray = gray.astype(np.uint8)
        gray = np.ascontiguousarray(gray)
        stats = DetectionStats()
        candidates: list[TagDetection] = []
        for b in self.backends:
            for d in b.detect(gray):
                stats.raw += 1
                if d.hamming is not None and d.hamming > self.max_hamming:
                    stats.reject("hamming")
                    continue
                if d.decision_margin is not None and d.decision_margin < self.min_margin:
                    stats.reject("margin")
                    continue
                if not np.isfinite(d.corners_px).all() or not is_convex(d.corners_px):
                    stats.reject("geometry")
                    continue
                if signed_area_ydown(d.corners_px) <= 0:
                    stats.reject("corner_order")
                    continue
                if d.min_side_px < self.min_side_px:
                    stats.reject("too_small")
                    continue
                candidates.append(d)
        # Одна и та же метка дважды в кадре — оставляем более уверенную, вторую считаем подозрительной.
        best: dict[str, TagDetection] = {}
        for d in candidates:
            cur = best.get(d.key)
            if cur is None:
                best[d.key] = d
                continue
            stats.reject("duplicate_id")
            if (d.decision_margin or 0) > (cur.decision_margin or 0):
                best[d.key] = d
        out = sorted(best.values(), key=lambda d: (d.family, d.tag_id))
        stats.accepted = len(out)
        return out, stats
