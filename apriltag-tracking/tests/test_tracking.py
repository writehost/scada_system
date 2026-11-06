# -*- coding: utf-8 -*-
"""События, потеря метки, восстановление после отсутствия кадров, сглаживание."""
import math

import numpy as np

from apriltag_tracking.calibration import Calibration
from apriltag_tracking.detection import TagDetection
from apriltag_tracking.pose import POSE_UNCERTAIN, POSE_VALID, PoseEstimator, euler_xyz_deg, quat_to_rotmat
from apriltag_tracking.tracking import LOST, Tracker, TrackerConfig
from synthetic import H, K, W, facing_pose, tag_corners_ippe

CAL = Calibration(K, np.zeros(5), W, H, True, 0.1)
EST = PoseEstimator(CAL)


def obs(t_xyz, yaw=0.0, tilt=8.0, noise=0.0, rng=None, tid=3):
    R, t = facing_pose(t_xyz[2], tilt, 0, yaw, (t_xyz[0], t_xyz[1]))
    c = tag_corners_ippe(0.1, R, t)
    if noise:
        c = c + rng.normal(0, noise, c.shape)
    d = TagDetection("tag16h5", tid, c, c.mean(axis=0), 0, 30.0, "test")
    return d


def step(tr, frame, t, dets):
    items = [(d, EST.estimate(d, tr.prior_for(d.key, t))) for d in dets]
    return tr.update(frame, t, items)


def test_events_detected_update_lost_and_recovery_after_gap():
    tr = Tracker(TrackerConfig(lost_timeout_s=0.5, reset_after_s=2.0))
    ev = []
    for i in range(5):
        ev += [(u.event, u.status) for u in step(tr, i, i * 0.15, [obs((0, 0, 0.5))])]
    assert ev[0] == ("detected", POSE_VALID)
    assert all(e == ("update", POSE_VALID) for e in ev[1:])
    # камера перестала отдавать кадры: tick по времени без изображения
    assert tr.tick(6, 0.9) == []
    lost = tr.tick(7, 1.3)
    assert [(u.event, u.status) for u in lost] == [("lost", LOST)]
    assert tr.tick(8, 1.6) == []  # потеря сообщается один раз
    assert tr.tracks["tag16h5:3"].state == LOST
    # кадры вернулись через 3 с: снова detected, старое сглаженное состояние не используется
    u = step(tr, 30, 4.5, [obs((0.2, 0, 0.8))])[0]
    assert u.event == "detected" and u.status == POSE_VALID
    np.testing.assert_allclose(u.smoothed_position, [0.2, 0, 0.8], atol=1e-6)


def test_short_disappearance_keeps_track_but_reports_lost():
    tr = Tracker(TrackerConfig(lost_timeout_s=0.3, reset_after_s=2.0))
    step(tr, 1, 0.0, [obs((0, 0, 0.5))])
    assert [u.event for u in step(tr, 2, 0.5, [])] == ["lost"]
    u = step(tr, 3, 0.7, [obs((0, 0, 0.8))])[0]  # пока не было видно, метку переставили на 30 см
    assert u.event == "detected" and u.status == POSE_VALID  # не «скачок»: после потери фильтр начат заново
    np.testing.assert_allclose(u.smoothed_position, [0, 0, 0.8], atol=1e-6)
    assert tr.tracks["tag16h5:3"].first_frame == 1  # тот же трек: пауза меньше reset_after_s


def test_multiple_tags_independent():
    tr = Tracker(TrackerConfig(lost_timeout_s=0.3))
    step(tr, 1, 0.0, [obs((0, 0, 0.5), tid=3), obs((0.2, 0, 0.6), tid=7)])
    out = step(tr, 2, 0.5, [obs((0, 0, 0.5), tid=3)])
    assert {(u.track.tag_id, u.event) for u in out} == {(3, "update"), (7, "lost")}


def test_smoothing_reduces_noise_without_lag_on_real_motion():
    rng = np.random.default_rng(0)
    tr = Tracker(TrackerConfig(alpha=0.4, max_jump_m=0.10))
    raw, sm = [], []
    for i in range(60):
        u = step(tr, i, i * 0.14, [obs((0.03, -0.02, 0.8), noise=0.3, rng=rng)])[0]
        if u.status == POSE_VALID:
            raw.append(u.pose.position_camera_m)
            sm.append(u.smoothed_position)
    raw, sm = np.array(raw[10:]), np.array(sm[10:])
    assert len(raw) > 30
    assert sm[:, 2].std() < 0.75 * raw[:, 2].std()
    # реальное перемещение на 5 см (меньше порога скачка) отслеживается за несколько кадров
    for i in range(60, 72):
        u = step(tr, i, i * 0.14, [obs((0.03, -0.02, 0.85), noise=0.3, rng=rng)])[0]
    assert abs(u.smoothed_position[2] - 0.85) < 0.01


def test_single_jump_rejected_consistent_jump_accepted():
    tr = Tracker(TrackerConfig(alpha=0.5, max_jump_m=0.10, jump_confirm_frames=3))
    for i in range(5):
        step(tr, i, i * 0.15, [obs((0, 0, 0.5))])
    u = step(tr, 5, 0.75, [obs((0, 0, 0.9))])[0]  # одиночный выброс
    assert u.status == POSE_UNCERTAIN and "jump_rejected" in u.codes
    np.testing.assert_allclose(u.smoothed_position, [0, 0, 0.5], atol=1e-6)
    u = step(tr, 6, 0.9, [obs((0, 0, 0.5))])[0]
    assert u.status == POSE_VALID
    # метку переставили: три согласованных кадра подряд → принимаем новое положение
    outs = [step(tr, 7 + k, 1.05 + k * 0.15, [obs((0, 0, 0.9))])[0] for k in range(3)]
    assert [o.status for o in outs] == [POSE_UNCERTAIN, POSE_UNCERTAIN, POSE_VALID]
    assert "jump_confirmed" in outs[-1].codes
    np.testing.assert_allclose(outs[-1].smoothed_position, [0, 0, 0.9], atol=1e-6)


def test_rotation_smoothing_has_no_wraparound_jump():
    """Поворот метки вокруг оси камеры через ±180°: сглаженный угол меняется плавно."""
    tr = Tracker(TrackerConfig(alpha=0.5))
    prev = None
    for i, yaw in enumerate(np.linspace(170, 190, 21)):
        u = step(tr, i, i * 0.15, [obs((0, 0, 0.5), yaw=float(yaw), tilt=0.0)])[0]
        assert u.status == POSE_VALID
        z = euler_xyz_deg(quat_to_rotmat(u.smoothed_q))[2]
        if prev is not None:
            d = (z - prev + 180) % 360 - 180
            assert abs(d) < 3.0, (yaw, z, prev)
        prev = z
    # итог близок к истинному повороту (yaw 190° ≡ −170°)
    R_true, _ = facing_pose(0.5, 0, 0, 190)
    from apriltag_tracking.pose import rotation_angle_deg

    assert rotation_angle_deg(quat_to_rotmat(u.smoothed_q), R_true) < 2.0
    assert math.isfinite(prev)


def test_stability_and_history():
    rng = np.random.default_rng(2)
    tr = Tracker(TrackerConfig(stability_window=20))
    for i in range(25):
        step(tr, i, i * 0.15, [obs((0, 0, 0.5), noise=0.2, rng=rng)])
    s = tr.tracks["tag16h5:3"].stability(20)
    assert s["samples"] == 20 and 0 < s["distance_std_mm"] < 5
