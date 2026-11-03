"""Системы координат.

План склада (Route/WMS): x вправо, y вниз, единица — пиксель плана (metersPerUnit из карты),
курс в градусах: 0° — вдоль +x плана, 90° — вдоль +y плана (вниз по экрану).

Мир (здесь): правая система, метры. X = x·m, Y = −y·m (север «вверх» плана), Z — вверх.
Корпус погрузчика: x — вперёд, y — влево, z — вверх.
Камера (OpenCV): x — вправо по кадру, y — вниз по кадру, z — оптическая ось.
Метка (OpenCV IPPE_SQUARE): x — вправо, y — вверх по метке, z — из метки к наблюдателю.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


def rot_x(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=float)


def rot_y(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=float)


def rot_z(a: float) -> np.ndarray:
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=float)


def make_T(R: np.ndarray, t) -> np.ndarray:
    T = np.eye(4)
    T[:3, :3] = R
    T[:3, 3] = np.asarray(t, dtype=float).reshape(3)
    return T


def inv_T(T: np.ndarray) -> np.ndarray:
    R = T[:3, :3]
    t = T[:3, 3]
    return make_T(R.T, -R.T @ t)


@dataclass(frozen=True)
class PlanFrame:
    meters_per_unit: float

    def plan_to_world(self, x: float, y: float, z_m: float = 0.0) -> np.ndarray:
        return np.array([x * self.meters_per_unit, -y * self.meters_per_unit, z_m], dtype=float)

    def world_to_plan(self, X: float, Y: float) -> tuple[float, float]:
        return X / self.meters_per_unit, -Y / self.meters_per_unit


def plan_heading_to_world_yaw(heading_deg: float) -> float:
    return math.radians(-heading_deg)


def world_yaw_to_plan_heading(yaw: float) -> float:
    h = -math.degrees(yaw)
    return (h + 180.0) % 360.0 - 180.0


def marker_pose_world(frame: PlanFrame, x: float, y: float, z_m: float, yaw_deg: float, pitch_deg: float = 0.0, roll_deg: float = 0.0) -> np.ndarray:
    """Поза метки на потолке, лицом вниз. yaw_deg — направление оси +x метки в терминах курса плана."""
    psi = plan_heading_to_world_yaw(yaw_deg)
    x_axis = np.array([math.cos(psi), math.sin(psi), 0.0])
    z_axis = np.array([0.0, 0.0, -1.0])
    y_axis = np.cross(z_axis, x_axis)
    R = np.column_stack([x_axis, y_axis, z_axis])
    R = R @ rot_x(math.radians(roll_deg)) @ rot_y(math.radians(pitch_deg))
    return make_T(R, frame.plan_to_world(x, y, z_m))


def camera_in_body(extr: dict) -> np.ndarray:
    """Положение камеры на корпусе. Базовая ориентация: камера смотрит вверх, верх кадра — вперёд по ходу.

    extr: {"x": м, "y": м, "z": м, "yawDeg": .., "pitchDeg": .., "rollDeg": ..} — смещения от базовой.
    """
    base = np.column_stack([[0.0, 1.0, 0.0], [-1.0, 0.0, 0.0], [0.0, 0.0, 1.0]])
    R = (
        rot_z(math.radians(float(extr.get("yawDeg", 0.0))))
        @ rot_y(math.radians(float(extr.get("pitchDeg", 0.0))))
        @ rot_x(math.radians(float(extr.get("rollDeg", 0.0))))
        @ base
    )
    return make_T(R, [float(extr.get("x", 0.0)), float(extr.get("y", 0.0)), float(extr.get("z", 0.0))])


def tag_corners_local(size_m: float) -> np.ndarray:
    """Углы метки в её системе, порядок OpenCV: верх-лево, верх-право, низ-право, низ-лево."""
    h = size_m / 2.0
    return np.array([[-h, h, 0.0], [h, h, 0.0], [h, -h, 0.0], [-h, -h, 0.0]], dtype=float)
