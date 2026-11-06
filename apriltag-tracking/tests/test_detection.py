# -*- coding: utf-8 -*-
"""Распознавание ID и отсутствие ложных меток после фильтрации."""
import cv2
import numpy as np

from apriltag_tracking.detection import DetectorBank, TagDetection
from synthetic import facing_pose, render, tag_corners_ippe


def bank():
    return DetectorBank(["tag16h5"], min_margin=15, max_hamming=0, backend="auto")


def test_detects_id3():
    img, _ = render([("tag16h5", 3, 0.1, *facing_pose(0.5, 10, -5, 15))])
    dets, stats = bank().detect(img)
    assert [d.tag_id for d in dets] == [3]
    assert dets[0].family == "tag16h5"
    assert dets[0].hamming == 0


def test_several_tags_independent():
    tags = [
        ("tag16h5", 1, 0.08, *facing_pose(0.7, 5, 0, 0, (-0.15, -0.1))),
        ("tag16h5", 3, 0.1, *facing_pose(0.7, -10, 10, 40, (0.1, 0.0))),
        ("tag16h5", 7, 0.08, *facing_pose(0.7, 0, -15, -30, (-0.1, 0.12))),
    ]
    img, truth = render(tags)
    dets, _ = bank().detect(img)
    assert sorted(d.tag_id for d in dets) == [1, 3, 7]
    for d in dets:
        assert np.abs(d.corners_px - truth[d.key][0]).max() < 1.0


def test_no_false_tags_on_clutter():
    rng = np.random.default_rng(5)
    b = bank()
    images = [rng.integers(0, 256, (1024, 1280), dtype=np.uint8)]
    # шахматка, прямоугольники, «текст» — типичные источники ложных квадратов
    chess = np.kron((np.indices((16, 20)).sum(axis=0) % 2) * 255, np.ones((64, 64))).astype(np.uint8)
    images.append(chess)
    clutter = np.full((1024, 1280), 140, np.uint8)
    for _ in range(300):
        x, y = rng.integers(0, 1200), rng.integers(0, 950)
        w, h = rng.integers(8, 120, 2)
        cv2.rectangle(clutter, (int(x), int(y)), (int(x + w), int(y + h)), int(rng.integers(0, 2) * 255), int(rng.choice([-1, 2, 5])))
    for _ in range(80):
        cv2.putText(clutter, "AB12#", (int(rng.integers(0, 1100)), int(rng.integers(20, 1000))), cv2.FONT_HERSHEY_SIMPLEX, float(rng.uniform(0.5, 3)), 0, 3)
    images.append(clutter)
    for img in images:
        dets, _ = b.detect(img)
        assert dets == [], [d.key for d in dets]


class _Stub:
    name = "stub"

    def __init__(self, items):
        self.items = items

    def detect(self, gray):
        return self.items


def _d(tid, hamming, margin, shift=0.0):
    R, t = facing_pose(0.5, 0, 0, 0, (shift, 0))
    c = tag_corners_ippe(0.1, R, t)
    return TagDetection("tag16h5", tid, c, c.mean(axis=0), hamming, margin, "stub")


def test_filter_hamming_and_margin():
    items = [_d(3, 0, 26.2), _d(4, 1, 30.0, 0.2), _d(5, 0, 10.0, -0.2)]
    dets, stats = DetectorBank(["tag16h5"], min_margin=15, max_hamming=0, _backends=[_Stub(items)]).detect(np.zeros((4, 4), np.uint8))
    assert [d.tag_id for d in dets] == [3]
    assert stats.rejected == {"hamming": 1, "margin": 1}
    # пороги настраиваются
    dets, _ = DetectorBank(["tag16h5"], min_margin=5, max_hamming=1, _backends=[_Stub(items)]).detect(np.zeros((4, 4), np.uint8))
    assert sorted(d.tag_id for d in dets) == [3, 4, 5]


def test_duplicate_id_keeps_most_confident():
    items = [_d(3, 0, 20.0), _d(3, 0, 40.0, 0.2)]
    dets, stats = DetectorBank(["tag16h5"], _backends=[_Stub(items)]).detect(np.zeros((4, 4), np.uint8))
    assert len(dets) == 1 and dets[0].decision_margin == 40.0
    assert stats.rejected == {"duplicate_id": 1}
