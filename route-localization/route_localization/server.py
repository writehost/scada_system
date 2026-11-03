"""Связь с SCADA System Route: конфигурация меток/калибровки и отправка позиции.

Отправка неблокирующая: в очереди всегда только последнее измерение (старые позиции бессмысленны),
частота ограничена (по умолчанию 4 Гц), сообщение о потере метки отправляется всегда.
"""
from __future__ import annotations

import json
import queue
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

from .tracker import TrackOutput


class RouteClient:
    def __init__(self, base_url: str, token: str, site_code: str, kara_id: str, timeout_s: float = 3.0):
        self.base = base_url.rstrip("/")
        self.token = token
        self.site = site_code
        self.kara = kara_id
        self.timeout = timeout_s

    def _req(self, method: str, path: str, body: dict | None = None) -> dict:
        sep = "&" if "?" in path else "?"
        url = f"{self.base}{path}{sep}siteCode={self.site}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("content-type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            payload = e.read()
            try:
                msg = json.loads(payload).get("error")
            except Exception:
                msg = payload[:200]
            raise RuntimeError(f"Route HTTP {e.code}: {msg}") from None

    def fetch_config(self, camera_serial: str) -> dict:
        return self._req("GET", f"/api/route/localizer/config?cameraSerial={urllib.request.quote(camera_serial)}")

    def send(self, out: TrackOutput, tag_ids: list[int] | None = None, reproj: float | None = None) -> dict:
        body = {
            "x": round(out.x, 2),
            "y": round(out.y, 2),
            "headingDeg": out.heading_deg,
            "quality": out.quality,
            "tagIds": tag_ids or [],
            "reprojErrorPx": reproj,
            "measuredAt": datetime.fromtimestamp(out.measured_at, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "source": "odometry" if out.state == "predicted" else "apriltag",
            "state": out.state,
        }
        return self._req("POST", f"/api/route/forklifts/{self.kara}/position", body)


class Publisher:
    def __init__(self, client: RouteClient, max_hz: float = 4.0, log=print):
        self.client = client
        self.min_dt = 1.0 / max_hz
        self.q: queue.Queue = queue.Queue(maxsize=1)
        self.log = log
        self.sent = 0
        self.failed = 0
        self._last = 0.0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def offer(self, out: TrackOutput, tag_ids: list[int] | None = None, reproj: float | None = None):
        """В очереди только последнее измерение; частоту ограничивает поток отправки."""
        try:
            self.q.get_nowait()
        except queue.Empty:
            pass
        self.q.put_nowait((out, tag_ids, reproj))

    def _run(self):
        while not self._stop.is_set():
            try:
                item = self.q.get(timeout=0.5)
            except queue.Empty:
                continue
            wait = self.min_dt - (time.time() - self._last)
            if wait > 0 and item[0].state == "ok":
                time.sleep(wait)
                try:  # за время ожидания могло прийти более свежее измерение
                    item = self.q.get_nowait()
                except queue.Empty:
                    pass
            self._last = time.time()
            try:
                res = self.client.send(*item)
                self.sent += 1
                if res.get("accepted") is False:
                    self.log(f"сервер отклонил позицию: {res.get('reason')}")
            except Exception as e:  # сеть: следующее измерение заменит это
                self.failed += 1
                self.log(f"позиция не отправлена: {e}")

    def stop(self):
        self._stop.set()
        self._t.join(timeout=2)
