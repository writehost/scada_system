"""Фильтрация и сглаживание позиции, обработка потери меток.

Модель: постоянная скорость (x, y, vx, vy) — фильтр Калмана, курс — отдельно с учётом перехода через ±180°.
Выброс (скачок) отбрасывается по расстоянию Махаланобиса; если подряд пришло несколько согласованных
«выбросов» — погрузчик действительно в новом месте (например, после подъёма вручную), фильтр переинициализируется.

Потеря меток:
  - позиция не перескакивает: публикуется последняя достоверная точка;
  - при наличии одометрии/IMU допускается кратковременный прогноз (state = predicted);
  - после lost_after_s без измерений — state = lost («Позиция не определена»).
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass
class TrackerConfig:
    meters_per_unit: float
    accel_noise: float = 1.5  # м/с²
    meas_noise_m: float = 0.05
    gate_chi2: float = 13.8  # 2 степени свободы, p≈0.001
    relocalize_after: int = 4
    predict_max_s: float = 1.5  # прогноз по одометрии не дольше
    lost_after_s: float = 3.0
    heading_alpha: float = 0.5


@dataclass
class TrackOutput:
    x: float
    y: float
    heading_deg: float | None
    quality: float
    state: str  # ok | predicted | lost
    measured_at: float


def _wrap(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


class PoseTracker:
    def __init__(self, cfg: TrackerConfig):
        self.cfg = cfg
        self.x: np.ndarray | None = None  # [x, y, vx, vy] в метрах (плановые оси)
        self.P = np.eye(4)
        self.heading: float | None = None
        self.t: float | None = None
        self.t_meas: float | None = None
        self.last_quality = 0.0
        self._outliers: list[tuple[float, float]] = []
        self._lost_reported = False

    def _m(self, v: float) -> float:
        return v * self.cfg.meters_per_unit

    def _predict(self, t: float):
        if self.x is None or self.t is None:
            return
        dt = max(0.0, t - self.t)
        F = np.eye(4)
        F[0, 2] = F[1, 3] = dt
        q = self.cfg.accel_noise**2
        G = np.array([[dt * dt / 2, 0], [0, dt * dt / 2], [dt, 0], [0, dt]])
        self.x = F @ self.x
        self.P = F @ self.P @ F.T + G @ (q * np.eye(2)) @ G.T
        self.t = t

    def update(self, t: float, x: float, y: float, heading_deg: float, quality: float) -> TrackOutput | None:
        """Измерение от камеры. Возвращает сглаженную позицию или None, если измерение отброшено."""
        z = np.array([self._m(x), self._m(y)])
        r = (self.cfg.meas_noise_m / max(0.2, quality)) ** 2
        if self.x is None:
            self.x = np.array([z[0], z[1], 0.0, 0.0])
            self.P = np.diag([r, r, 1.0, 1.0])
            self.t = t
            self.heading = heading_deg
        else:
            self._predict(t)
            H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=float)
            S = H @ self.P @ H.T + r * np.eye(2)
            innov = z - H @ self.x
            d2 = float(innov @ np.linalg.solve(S, innov))
            if d2 > self.cfg.gate_chi2:
                self._outliers.append((z[0], z[1]))
                if len(self._outliers) >= self.cfg.relocalize_after:
                    pts = np.array(self._outliers[-self.cfg.relocalize_after :])
                    if float(np.max(np.linalg.norm(pts - pts.mean(axis=0), axis=1))) < 0.5:
                        self.x = np.array([z[0], z[1], 0.0, 0.0])
                        self.P = np.diag([r, r, 1.0, 1.0])
                        self.heading = heading_deg
                        self._outliers.clear()
                        return self._emit(t, quality * 0.8, "ok")
                return None
            self._outliers.clear()
            K = self.P @ H.T @ np.linalg.inv(S)
            self.x = self.x + K @ innov
            self.P = (np.eye(4) - K @ H) @ self.P
            if self.heading is None:
                self.heading = heading_deg
            else:
                self.heading = _wrap(self.heading + self.cfg.heading_alpha * _wrap(heading_deg - self.heading))
        self.t_meas = t
        self._lost_reported = False
        return self._emit(t, quality, "ok")

    def tick(self, t: float, odometry: tuple[float, float, float] | None = None) -> TrackOutput | None:
        """Кадр без меток. odometry: (dx_вперёд_м, dy_влево_м, dθ_град) за интервал — если есть."""
        if self.x is None or self.t_meas is None:
            return None
        since = t - self.t_meas
        if since >= self.cfg.lost_after_s:
            if self._lost_reported:
                return None
            self._lost_reported = True
            return TrackOutput(self.x[0] / self.cfg.meters_per_unit, self.x[1] / self.cfg.meters_per_unit, self.heading, 0.0, "lost", t)
        if odometry is not None and since <= self.cfg.predict_max_s and self.heading is not None:
            dx, dy, dth = odometry
            # курс в плане: 0° — +x, 90° — +y (вниз); «влево» корпуса в плане = курс − 90°
            h = math.radians(self.heading)
            self.x[0] += dx * math.cos(h) + dy * math.cos(h - math.pi / 2)
            self.x[1] += dx * math.sin(h) + dy * math.sin(h - math.pi / 2)
            self.heading = _wrap(self.heading - dth)
            self.t = t
            q = max(0.1, self.last_quality * (1 - since / self.cfg.predict_max_s))
            return self._emit(t, q, "predicted", keep_quality=True)
        return None

    def _emit(self, t: float, quality: float, state: str, keep_quality: bool = False) -> TrackOutput:
        if not keep_quality:
            self.last_quality = quality
        return TrackOutput(
            x=float(self.x[0] / self.cfg.meters_per_unit),
            y=float(self.x[1] / self.cfg.meters_per_unit),
            heading_deg=None if self.heading is None else round(float(self.heading), 2),
            quality=round(float(quality), 3),
            state=state,
            measured_at=t,
        )
