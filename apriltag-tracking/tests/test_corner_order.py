# -*- coding: utf-8 -*-
"""Порядок углов метки для SOLVEPNP_IPPE_SQUARE."""
import numpy as np
import pytest

from apriltag_tracking.calibration import Calibration
from apriltag_tracking.detection import DetectorBank, TagDetection, pupil_available, pupil_corners_to_ippe, signed_area_ydown
from apriltag_tracking.pose import PoseEstimator, rotation_angle_deg
from synthetic import H, K, W, facing_pose, render, tag_corners_ippe

CAL = Calibration(K, np.zeros(5), W, H, True, 0.1)


def _det(corners):
    c = np.asarray(corners, float)
    return TagDetection("tag16h5", 3, c, c.mean(axis=0), 0, 30.0, "test")


def test_ippe_order_is_clockwise_from_top_left():
    R, t = facing_pose(0.5, 15, -10, 25)
    c = tag_corners_ippe(0.1, R, t)
    # первый угол — верхний левый рисунка метки: при yaw=25° он левее и выше центра
    assert c[0][0] < c.mean(axis=0)[0] and c[0][1] < c.mean(axis=0)[1]
    assert signed_area_ydown(c) > 0


def test_pupil_order_conversion():
    """pupil-apriltags: против часовой от нижнего левого (НЛ, НП, ВП, ВЛ) → IPPE (ВЛ, ВП, НП, НЛ)."""
    R, t = facing_pose(0.5, 10, 5, -40)
    ippe = tag_corners_ippe(0.1, R, t)
    pupil_style = ippe[[3, 2, 1, 0]]
    assert signed_area_ydown(pupil_style) < 0  # против часовой стрелки на экране, как у apriltag
    np.testing.assert_allclose(pupil_corners_to_ippe(pupil_style), ippe)


def test_opencv_backend_returns_ippe_order():
    R, t = facing_pose(0.5, 20, -10, 30, (0.03, -0.02))
    img, truth = render([("tag16h5", 3, 0.1, R, t)])
    dets, _ = DetectorBank(["tag16h5"], backend="opencv").detect(img)
    assert len(dets) == 1
    assert np.abs(dets[0].corners_px - truth["tag16h5:3"][0]).max() < 1.0


@pytest.mark.skipif(not pupil_available(), reason="pupil-apriltags не установлен")
def test_pupil_backend_returns_ippe_order_after_conversion():
    for yaw in (0, 30, 100, -150):
        R, t = facing_pose(0.5, 15, -10, yaw, (0.02, 0.01))
        img, truth = render([("tag16h5", 3, 0.1, R, t)])
        dets, _ = DetectorBank(["tag16h5"], backend="pupil", min_margin=0).detect(img)
        assert len(dets) == 1, f"yaw={yaw}"
        assert np.abs(dets[0].corners_px - truth["tag16h5:3"][0]).max() < 1.0, f"yaw={yaw}: порядок углов pupil не совпал с IPPE"


def test_mirrored_order_is_rejected_by_filter():
    R, t = facing_pose(0.5, 10, 0, 0)
    good = tag_corners_ippe(0.1, R, t)

    class Mirror:
        name = "stub"

        def detect(self, gray):
            return [_det(good[[1, 0, 3, 2]])]  # зеркальная перестановка

    dets, stats = DetectorBank(["tag16h5"], _backends=[Mirror()]).detect(np.zeros((10, 10), np.uint8))
    assert dets == [] and stats.rejected == {"corner_order": 1}


def test_cyclic_shift_keeps_position_rotates_frame_90deg():
    R, t = facing_pose(0.6, 12, -8, 20, (0.05, 0.02))
    c = tag_corners_ippe(0.1, R, t)
    est = PoseEstimator(CAL)
    a = est.estimate(_det(c))
    b = est.estimate(_det(np.roll(c, -1, axis=0)))
    np.testing.assert_allclose(a.position_camera_m, t, atol=1e-6)
    np.testing.assert_allclose(b.position_camera_m, t, atol=1e-6)
    assert abs(rotation_angle_deg(a.chosen.R, b.chosen.R) - 90) < 1e-3
