"""Цепочка «кадр → детектор → поза камеры → корпус погрузчика» на синтетических кадрах с известной позой."""
import math

import numpy as np
import pytest

from route_localization.detector import AprilTagDetector
from route_localization.geometry import PlanFrame
from route_localization.pose import MarkerInfo, PoseEstimator
from route_localization.synthetic import ceiling_grid, default_calibration, render

MPU = 0.8 / 12  # масштаб плана склада ГП
FRAME = PlanFrame(MPU)


def _err(est, x, y, h):
    d = math.hypot(est.x - x, est.y - y) * MPU
    dh = abs((est.heading_deg - h + 180) % 360 - 180)
    return d, dh


@pytest.mark.parametrize(
    "x,y,h",
    [(2000.0, 900.0, 0.0), (2030.0, 920.0, 37.0), (1990.0, 880.0, -120.0), (2015.0, 935.0, 179.0)],
)
def test_pose_several_tags(x, y, h):
    markers = ceiling_grid(MPU, 1930, 830, 7, 7, 1.5)
    calib = default_calibration()
    img = render(FRAME, markers, calib, x, y, h, noise=2.0)
    det = AprilTagDetector("tag36h11").detect(img)
    assert len(det) >= 2
    est = PoseEstimator(FRAME, markers, calib).estimate(det)
    assert est is not None
    d, dh = _err(est, x, y, h)
    assert d < 0.03, f"ошибка положения {d:.3f} м"
    assert dh < 1.0, f"ошибка курса {dh:.2f}°"
    assert est.reproj_error_px < 1.0
    assert 0.5 < est.quality <= 1.0


def test_pose_single_tag_and_offset_camera():
    markers = [MarkerInfo("tag36h11", 7, 2000.0, 900.0, 6.0, 0.3, yaw_deg=25.0)]
    calib = default_calibration(extr={"x": 0.8, "y": -0.3, "z": 2.0, "yawDeg": 90.0})
    img = render(FRAME, markers, calib, 2006.0, 897.0, 63.0, noise=1.5)
    det = AprilTagDetector("tag36h11").detect(img)
    assert [d.tag_id for d in det] == [7]
    est = PoseEstimator(FRAME, markers, calib).estimate(det)
    assert est is not None
    d, dh = _err(est, 2006.0, 897.0, 63.0)
    assert d < 0.05 and dh < 1.5, (d, dh)


def test_unknown_and_wrong_size_tags_are_rejected():
    markers = ceiling_grid(MPU, 1950, 850, 3, 3, 1.5)
    calib = default_calibration()
    img = render(FRAME, markers, calib, 1990.0, 880.0, 10.0)
    det = AprilTagDetector("tag36h11").detect(img)
    # реестр знает только часть меток — остальные не используются
    known = [m for m in markers if m.tag_id in (0, 1)]
    est = PoseEstimator(FRAME, known, calib).estimate(det)
    assert est is not None and set(est.tag_ids) <= {0, 1}
    assert any(why == "нет в реестре меток" for _, why in est.rejected)
    # метка, координаты которой в реестре неверны (сдвинута на 3 м), не портит позу по остальным
    moved = [MarkerInfo(m.family, m.tag_id, m.x + (45 if m.tag_id == 4 else 0), m.y, m.z_m, m.size_m, m.yaw_deg) for m in markers]
    est2 = PoseEstimator(FRAME, moved, calib).estimate(det)
    assert est2 is not None
    d, _ = _err(est2, 1990.0, 880.0, 10.0)
    assert d < 0.5, f"смещённая метка испортила позу: {d:.2f} м"


def test_no_tags_no_pose():
    calib = default_calibration()
    img = np.full((calib.height, calib.width), 128, np.uint8)
    assert AprilTagDetector("tag36h11").detect(img) == []
    assert PoseEstimator(FRAME, [], calib).estimate([]) is None
