# -*- coding: utf-8 -*-
"""Выдача измерений другим программам, не блокируя захват кадров.

MeasurementHub
  * publish() вызывается из цикла обработки: обновляет «последние данные» под блокировкой и кладёт
    измерения в ограниченную очередь. Если подписчики не успевают, лишние измерения отбрасываются
    (счётчик dropped), видеозахват не ждёт.
  * Подписчики (JSONL, UDP, ваши callback) вызываются в отдельном потоке.
  * latest() / latest_json() — снимок последних измерений по меткам для другого Python-модуля.

Callback:
    hub.on_tag_detected(lambda m: ...)   # появление метки (event == "detected")
    hub.on_measurement(lambda m: ...)    # каждое измерение
    hub.on_tag_lost(lambda m: ...)       # потеря метки
"""
from __future__ import annotations

import json
import logging
import queue
import socket
import threading
import time
from pathlib import Path
from typing import Callable

from .measurement import to_json

log = logging.getLogger("apriltag_tracking")

Callback = Callable[[dict], None]


class MeasurementHub:
    def __init__(self, max_queue: int = 2000):
        self._lock = threading.Lock()
        self._latest: dict[str, dict] = {}
        self._q: queue.Queue = queue.Queue(maxsize=max_queue)
        self._subs: list[tuple[str, Callback]] = []
        self.dropped = 0
        self.delivered = 0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="measurement-hub", daemon=True)
        self._thread.start()

    # -- подписки --
    def subscribe(self, cb: Callback, kind: str = "all") -> Callback:
        self._subs.append((kind, cb))
        return cb

    def on_measurement(self, cb: Callback) -> Callback:
        return self.subscribe(cb, "all")

    def on_tag_detected(self, cb: Callback) -> Callback:
        return self.subscribe(cb, "detected")

    def on_tag_lost(self, cb: Callback) -> Callback:
        return self.subscribe(cb, "lost")

    # -- публикация --
    def publish(self, items: list[dict]) -> None:
        with self._lock:
            for m in items:
                self._latest[f"{m['family']}:{m['tag_id']}"] = m
        for m in items:
            try:
                self._q.put_nowait(m)
            except queue.Full:
                self.dropped += 1

    # -- чтение --
    def latest(self, key: str | None = None, only_valid: bool = False) -> dict | list[dict] | None:
        with self._lock:
            if key is not None:
                m = self._latest.get(key)
                return None if m is None or (only_valid and not m.get("pose_valid")) else dict(m)
            vals = [dict(m) for m in self._latest.values()]
        return [m for m in vals if not only_valid or m.get("pose_valid")]

    def latest_json(self) -> str:
        return json.dumps(self.latest(), ensure_ascii=False)

    def visible(self) -> list[dict]:
        """Метки, видимые сейчас (не LOST)."""
        return [m for m in self.latest() if m.get("status") != "LOST"]

    # -- поток доставки --
    def _run(self):
        while not self._stop.is_set() or not self._q.empty():
            try:
                m = self._q.get(timeout=0.2)
            except queue.Empty:
                continue
            for kind, cb in list(self._subs):
                if kind != "all" and m.get("event") != kind:
                    continue
                try:
                    cb(m)
                except Exception:  # чужой код не должен ронять обработку
                    log.exception("ошибка в обработчике измерений")
            self.delivered += 1

    def close(self, timeout: float = 3.0):
        self._stop.set()
        self._thread.join(timeout=timeout)
        for _, cb in self._subs:
            close = getattr(cb, "close", None)
            if callable(close):
                close()


class JsonlWriter:
    """Подписчик: пишет каждое измерение строкой JSON. Сбрасывает на диск не чаще flush_s."""

    def __init__(self, path: str | Path, flush_s: float = 0.5, events_only: bool = False):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.path, "a", encoding="utf-8", newline="\n")
        self.flush_s = flush_s
        self.events_only = events_only
        self._last = time.monotonic()
        self.lines = 0

    def __call__(self, m: dict):
        if self.events_only and m.get("event") == "update":
            return
        self.f.write(to_json(m) + "\n")
        self.lines += 1
        now = time.monotonic()
        if now - self._last >= self.flush_s:
            self.f.flush()
            self._last = now

    def close(self):
        try:
            self.f.flush()
            self.f.close()
        except Exception:
            pass


class UdpSender:
    """Подписчик: измерение — одна UDP-датаграмма с JSON (UTF-8)."""

    def __init__(self, host: str, port: int):
        self.addr = (host, int(port))
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def __call__(self, m: dict):
        data = to_json(m).encode("utf-8")
        if len(data) > 60000:
            return
        self.sock.sendto(data, self.addr)

    def close(self):
        self.sock.close()


def read_jsonl(path: str | Path) -> list[dict]:
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def latest_from_jsonl(path: str | Path, tail_bytes: int = 256 * 1024) -> dict[str, dict]:
    """Последнее измерение по каждой метке из файла JSONL (для программ, читающих файл)."""
    p = Path(path)
    with open(p, "rb") as f:
        size = f.seek(0, 2)
        f.seek(max(0, size - tail_bytes))
        chunk = f.read().decode("utf-8", errors="ignore")
    latest: dict[str, dict] = {}
    for line in chunk.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            m = json.loads(line)
        except json.JSONDecodeError:
            continue  # обрезанная первая строка хвоста
        latest[f"{m['family']}:{m['tag_id']}"] = m
    return latest
