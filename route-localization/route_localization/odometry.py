"""Одометрия/IMU погрузчика — источник кратковременного прогноза при потере меток.

Интерфейс: delta(t) → (dx_вперёд_м, dy_влево_м, dθ_град) с прошлого вызова или None.
Подключение к CAN/контроллеру погрузчика зависит от модели — реализуется на объекте.
UdpOdometry — простой вариант: контроллер шлёт JSON {"dx":..,"dy":..,"dth":..} по UDP.
"""
from __future__ import annotations

import json
import socket


class NoOdometry:
    def delta(self, t: float):
        return None


class UdpOdometry:  # pragma: no cover - зависит от оборудования
    def __init__(self, port: int, host: str = "0.0.0.0"):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((host, port))
        self.sock.setblocking(False)

    def delta(self, t: float):
        dx = dy = dth = 0.0
        got = False
        while True:
            try:
                data, _ = self.sock.recvfrom(1024)
            except BlockingIOError:
                break
            try:
                m = json.loads(data)
                dx += float(m.get("dx", 0))
                dy += float(m.get("dy", 0))
                dth += float(m.get("dth", 0))
                got = True
            except Exception:
                continue
        return (dx, dy, dth) if got else None


def open_odometry(cfg: dict):
    if cfg.get("kind") == "udp":
        return UdpOdometry(int(cfg.get("port", 47110)))
    return NoOdometry()
