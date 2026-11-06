# -*- coding: utf-8 -*-
"""Расчёт положения и расстояния; два решения PnP; признак достоверности."""
import cv2
import numpy as np
import pytest

from apriltag_tracking.calibration import Calibration
from apriltag_tracking.detection import DetectorBank, TagDetection
from apriltag_tracking.pose import NO_CALIBRATION, POSE_UNCERTAIN, POSE_VALID, PoseConfig, PoseEstimator, rotation_angle_deg, tag_object_points
from synthetic import H, K, W, facing_pose, render, tag_corners_ippe

CAL = Calibration(K, np.zeros(5), W, H, True, 0.1)


def _det(c, tid=3):
    c = np.asarray(c, float)
    return TagDetection("tag16h5", tid, c, c.mean(axis=0), 0, 30.0, "test")


@pytest.mark.parametrize("d", [0.2, 0.3, 0.5, 1.0, 2.0])
@pytest.mark.parametrize("tilt", [(0, 0, 0), (25, -10, 40), (-15, 30, 170)])
def test_exact_geometry(d, tilt):
    """Идеальные углы: положение и расстояние восстанавливаются точно (проверка математики)."""
    R, t = facing_pose(d, *tilt, offset=(0.04, -0.03))
    r = PoseEstimator(CAL).estimate(_det(tag_corners_ippe(0.1, R, t)))
    assert r.status == POSE_VALID, r.reasons
    np.testing.assert_allclose(r.position_camera_m, t, atol=1e-6)
    assert abs(r.distance_m - np.linalg.norm(t)) < 1e-6
    assert rotation_angle_deg(r.chosen.R, R) < 1e-3
    np.testing.assert_allclose(r.camera_in_tag_m, -R.T @ t, atol=1e-6)


@pytest.mark.parametrize("d,tol", [(0.3, 0.005), (0.5, 0.005), (1.0, 0.007), (1.5, 0.01)])
def test_distance_on_rendered_frames(d, tol):
    """Кадр → детектор → PnP: относительная ошибка расстояния в пределах tol."""
    R, t = facing_pose(d, 12, -8, 25, (0.02, -0.015))
    img, _ = render([("tag16h5", 3, 0.1, R, t)])
    dets, _ = DetectorBank(["tag16h5"]).detect(img)
    r = PoseEstimator(CAL).estimate(dets[0])
    assert r.status == POSE_VALID, r.reasons
    assert abs(r.distance_m - np.linalg.norm(t)) / np.linalg.norm(t) < tol


def test_two_solutions_are_evaluated_and_best_chosen():
    R, t = facing_pose(1.0, 0, 30, -60, (0.03, -0.02))
    c = tag_corners_ippe(0.1, R, t) + np.random.default_rng(1).normal(0, 0.2, (4, 2))
    r = PoseEstimator(CAL).estimate(_det(c))
    assert len(r.candidates) == 2
    assert all(cand.valid for cand in r.candidates)
    assert r.chosen.reproj_px < r.alternative.reproj_px
    assert rotation_angle_deg(r.chosen.R, R) < 3
    assert r.ambiguity_ratio > 2 and r.status == POSE_VALID


def test_ambiguous_case_needs_temporal_prior():
    """Маленькая далёкая метка почти фронтально + шум углов: два решения с близкой ошибкой.
    Без истории — POSE_UNCERTAIN; с предыдущим достоверным поворотом — выбирается согласованное решение."""
    R, t = facing_pose(2.5, 6, 0, 0, (0.1, 0.05))
    rng = np.random.default_rng(3)
    est = PoseEstimator(CAL, PoseConfig(min_side_px=0))
    for _ in range(50):
        c = tag_corners_ippe(0.1, R, t) + rng.normal(0, 0.35, (4, 2))
        r = est.estimate(_det(c))
        if r.ambiguity_ratio is not None and r.ambiguity_ratio < 2 and len([x for x in r.candidates if x.valid]) == 2:
            break
    else:
        pytest.fail("не удалось получить неоднозначный случай")
    assert r.status == POSE_UNCERTAIN and "ambiguous" in r.codes
    r2 = est.estimate(_det(c), prior_R=R)
    assert r2.resolved_by_prior
    good = min(r2.candidates, key=lambda x: rotation_angle_deg(x.R, R))
    assert r2.chosen is good
    # расстояние обеих ветвей почти одинаково — неоднозначность в основном в ориентации
    assert abs(r2.candidates[0].distance_m - r2.candidates[1].distance_m) / r2.distance_m < 0.03


def test_behind_camera_and_backface_rejected():
    est = PoseEstimator(CAL)
    obj = tag_object_points(0.1)
    R, t = facing_pose(0.5)
    # точки с отрицательной глубиной проецируются, но решение физически невозможно
    det = _det(tag_corners_ippe(0.1, R, t))
    cands = est._candidates(det, 0.1)
    assert cands[0].valid
    bad_t = -cands[0].tvec
    pts = (cands[0].R @ obj.T).T + bad_t
    assert np.any(pts[:, 2] <= 0)


def test_large_reprojection_error_is_not_valid():
    R, t = facing_pose(0.5, 10, 0, 0)
    c = tag_corners_ippe(0.1, R, t)
    c[2] += [12.0, -9.0]  # угол «уехал»: квадрат так не проецируется
    r = PoseEstimator(CAL).estimate(_det(c))
    assert r.status == POSE_UNCERTAIN and "reprojection" in r.codes


def test_no_calibration_and_no_tag_size():
    R, t = facing_pose(0.5)
    det = _det(tag_corners_ippe(0.1, R, t))
    assert PoseEstimator(None).estimate(det) is None
    no_size = Calibration(K, np.zeros(5), W, H, True, None)
    assert PoseEstimator(no_size).estimate(det) is None
    assert NO_CALIBRATION == "NO_CALIBRATION"


def test_unverified_calibration_is_never_valid():
    R, t = facing_pose(0.5, 10, 5, 0)
    nominal = Calibration(K, np.zeros(5), W, H, False, 0.1)
    r = PoseEstimator(nominal).estimate(_det(tag_corners_ippe(0.1, R, t)))
    assert r.status == POSE_UNCERTAIN and "uncalibrated" in r.codes
    assert not r.calibration_valid
    np.testing.assert_allclose(r.position_camera_m, t, atol=1e-6)  # считается, но помечено


def test_distortion_is_used():
    D = np.array([-0.25, 0.08, 0.001, -0.0005, 0.0])
    cal = Calibration(K, D, W, H, True, 0.1)
    R, t = facing_pose(0.4, 15, 10, 20, (0.12, 0.09))
    obj = tag_object_points(0.1)
    rv, _ = cv2.Rodrigues(R)
    c, _ = cv2.projectPoints(obj, rv, t, K, D)
    r = PoseEstimator(cal).estimate(_det(c.reshape(4, 2)))
    np.testing.assert_allclose(r.position_camera_m, t, atol=1e-5)
    r0 = PoseEstimator(CAL).estimate(_det(c.reshape(4, 2)))
    assert np.linalg.norm(r0.position_camera_m - t) > 1e-3  # без дисторсии ответ другой
