# -*- coding: utf-8 -*-
"""Как получить измерения из другой программы на Python.

Вариант 1 — запустить распознавание внутри своей программы (фоновый поток, без окна).
Вариант 2 — читать файл JSONL, который пишет запущенный main.py --save-jsonl.
Вариант 3 — принимать UDP: main.py --udp 127.0.0.1:5005 (каждое измерение — одна датаграмма JSON).
"""
import json
import socket
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apriltag_tracking import TrackingSession, latest_from_jsonl  # noqa: E402


def variant_session():
    s = TrackingSession.from_cli(["--ip", "169.254.19.203", "--calibration", "calibration.json", "--save-jsonl", "measurements.jsonl"])

    @s.hub.on_tag_detected
    def on_tag_detected(m):  # вызывается один раз при появлении метки (и после её потери)
        print("появилась метка", m["family"], m["tag_id"], m["status"])

    s.hub.on_tag_lost(lambda m: print("метка потеряна", m["tag_id"]))
    s.start()
    try:
        for _ in range(30):
            m = s.latest("tag16h5:3")  # последнее измерение или None
            if m and m["pose_valid"]:
                p = m["position_camera_m"]
                print(f"ID3: X={p['x']:+.3f} Y={p['y']:+.3f} Z={p['z']:+.3f} м, dist={m['distance_m']:.3f} м")
            elif m:
                print("ID3:", m["status"], m.get("status_codes"))
            time.sleep(1)
            if s.error:
                raise s.error
    finally:
        s.stop()


def variant_jsonl(path="measurements.jsonl"):
    while True:
        latest = latest_from_jsonl(path)
        m = latest.get("tag16h5:3")
        print(m["status"], m.get("distance_m")) if m else print("нет данных")
        time.sleep(1)


def variant_udp(port=5005):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", port))
    while True:
        data, _ = sock.recvfrom(65535)
        m = json.loads(data.decode("utf-8"))
        print(m["event"], m["tag_id"], m["status"], m.get("distance_m"))


if __name__ == "__main__":
    {"session": variant_session, "jsonl": variant_jsonl, "udp": variant_udp}[sys.argv[1] if len(sys.argv) > 1 else "session"]()
