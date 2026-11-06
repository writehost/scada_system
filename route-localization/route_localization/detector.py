"""Обнаружение AprilTag.

OpenCV (aruco): tag16h5, tag25h9, tag36h10, tag36h11.
pupil-apriltags (если установлен): также tagStandard41h12, tagStandard52h13 — для тысяч уникальных ID.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

try:  # pragma: no cover - зависит от окружения
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None

OPENCV_FAMILIES = {
    "tag16h5": "DICT_APRILTAG_16h5",
    "tag25h9": "DICT_APRILTAG_25h9",
    "tag36h10": "DICT_APRILTAG_36h10",
    "tag36h11": "DICT_APRILTAG_36h11",
}


@dataclass
class Detection:
    family: str
    tag_id: int
    corners: np.ndarray  # 4×2, порядок: верх-лево, верх-право, низ-право, низ-лево
    margin: float | None = None
    hamming: int | None = None


class AprilTagDetector:
    def __init__(self, family: str, min_side_px: float = 18.0, min_margin: float = 20.0, backend: str = "auto"):
        self.family = family
        self.min_side_px = min_side_px
        self.min_margin = min_margin
        self._pupil = None
        self._aruco = None
        if backend in ("auto", "pupil"):
            try:
                from pupil_apriltags import Detector  # type: ignore

                self._pupil = Detector(families=family, nthreads=2, quad_decimate=1.0, refine_edges=1)
            except Exception:
                if backend == "pupil":
                    raise
        if self._pupil is None:
            if cv2 is None:
                raise RuntimeError("нужен opencv-contrib-python или pupil-apriltags")
            name = OPENCV_FAMILIES.get(family)
            if not name:
                raise ValueError(f"семейство {family} не поддерживается OpenCV — установите pupil-apriltags")
            dictionary = cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, name))
            params = cv2.aruco.DetectorParameters()
            params.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_APRILTAG
            params.errorCorrectionRate = 0.0 if family == "tag16h5" else 0.3
            self._aruco = cv2.aruco.ArucoDetector(dictionary, params)

    @property
    def backend(self) -> str:
        return "pupil-apriltags" if self._pupil is not None else "opencv-aruco"

    def detect(self, gray: np.ndarray) -> list[Detection]:
        if gray.ndim == 3:
            gray = cv2.cvtColor(gray, cv2.COLOR_BGR2GRAY)
        out: list[Detection] = []
        if self._pupil is not None:
            for d in self._pupil.detect(gray):
                if d.decision_margin < self.min_margin or d.hamming > (0 if self.family == "tag16h5" else 1):
                    continue
                # pupil: углы против часовой от низ-лево → приводим к порядку OpenCV
                c = np.asarray(d.corners, dtype=float)[[3, 2, 1, 0]]
                out.append(Detection(self.family, int(d.tag_id), c, float(d.decision_margin), int(d.hamming)))
        else:
            corners, ids, _ = self._aruco.detectMarkers(gray)
            if ids is not None:
                for c, i in zip(corners, ids.flatten()):
                    out.append(Detection(self.family, int(i), np.asarray(c, dtype=float).reshape(4, 2)))
        return [d for d in out if _min_side(d.corners) >= self.min_side_px]


def _min_side(c: np.ndarray) -> float:
    return float(min(np.linalg.norm(c[i] - c[(i + 1) % 4]) for i in range(4)))
