# -*- coding: utf-8 -*-
"""Источники кадров: Hikrobot MVS (Live), файл изображения (Image), видеофайл (Video).

HikrobotSource сохраняет подключение исходного open_hikrobot()/live_loop(): поиск GigE-камеры по IP,
CreateHandle → OpenDevice → AcquisitionMode=Continuous, TriggerMode=Off, ExposureAuto=Off, Mono8,
ExposureTime=5000 мкс → PayloadSize → StartGrabbing, кадры через MV_CC_GetOneFrameTimeout в свой буфер.

Добавлено:
  * понятная обработка MV_E_ACCESS_DENIED (камера открыта в MVS или другой программе);
  * освобождение SDK при любом завершении (release() идемпотентен, atexit, with);
  * модель/серийный номер камеры для camera_id;
  * таймауты кадров не прерывают работу сразу: источник отдаёт None (метки уходят в LOST),
    после серии таймаутов перезапускает захват, и только потом сообщает об ошибке.
"""
from __future__ import annotations

import atexit
import ctypes
import importlib
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import cv2
import numpy as np

log = logging.getLogger("apriltag_tracking")

MV_E_ACCESS_DENIED = 0x80000203
MV_E_NODATA = 0x80000007


@dataclass
class Frame:
    image: np.ndarray | None  # Mono8; None — кадр не получен (таймаут)
    frame_id: int
    t: float  # время для сопровождения: monotonic (live) или позиция в видео (video)
    t_wall: float  # время UNIX для отметки в JSON
    camera_frame_num: int | None = None
    lost_packets: int = 0
    error: str | None = None


class FrameSourceError(RuntimeError):
    pass


# ---------------- Hikrobot MVS ----------------


def add_mvs_paths(extra: str | None = None):
    """Поиск MvImport и DLL MVS (как в исходном скрипте) + путь из --mvs-path / MVCAM_COMMON_RUNENV."""
    roots = []
    if extra:
        roots.append(Path(extra))
    env = os.environ.get("MVCAM_COMMON_RUNENV")
    if env:
        roots.append(Path(env).parent / "Development" / "Samples" / "Python" / "MvImport")
    roots += [
        Path(r"C:\Program Files (x86)\MVS\Development\Samples\Python\MvImport"),
        Path(r"C:\Program Files\MVS\Development\Samples\Python\MvImport"),
        Path(__file__).resolve().parent.parent / "MvImport",
        Path("/opt/MVS/Samples/64/Python/MvImport"),
    ]
    for folder in roots:
        if (folder / "MvCameraControl_class.py").exists():
            if str(folder) not in sys.path:
                sys.path.insert(0, str(folder))
            break
    else:
        raise FrameSourceError(
            "MVS Python SDK не найден. Найдите MvImport/MvCameraControl_class.py в установке MVS "
            "и укажите папку через --mvs-path или скопируйте MvImport рядом с main.py."
        )
    handles = []
    if hasattr(os, "add_dll_directory"):
        for folder in (
            Path(r"C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64"),
            Path(r"C:\Program Files\Common Files\MVS\Runtime\Win64_x64"),
        ):
            if folder.is_dir():
                handles.append(os.add_dll_directory(str(folder)))
    return handles


def ip_from_int(n: int) -> str:
    return ".".join(str((n >> shift) & 255) for shift in (24, 16, 8, 0))


def _cstr(arr) -> str:
    try:
        return bytes(arr).split(b"\0")[0].decode("ascii", errors="ignore").strip()
    except Exception:
        return ""


class HikrobotSource:
    def __init__(self, ip: str, exposure_us: float = 5000.0, timeout_ms: int = 1500, mvs_path: str | None = None,
                 max_timeouts: int = 10, mvs_module=None):
        self.ip = ip
        self.exposure_us = exposure_us
        self.timeout_ms = timeout_ms
        self.max_timeouts = max_timeouts
        self.camera_id = "Hikrobot"
        self.serial = ""
        self._dll_handles = []
        self.mvs = mvs_module
        self.camera = None
        self._created = self._opened = self._grabbing = False
        self._released = False
        self._stop_requested = False
        self._frame_id = 0
        self._open()
        atexit.register(self.release)

    # -- открытие (логика open_hikrobot) --
    def _open(self):
        if self.mvs is None:
            self._dll_handles = add_mvs_paths(os.environ.get("MVS_PYTHON_PATH"))
            self.mvs = importlib.import_module("MvCameraControl_class")
        mvs = self.mvs
        self.E_ACCESS_DENIED = getattr(mvs, "MV_E_ACCESS_DENIED", MV_E_ACCESS_DENIED)
        devices = mvs.MV_CC_DEVICE_INFO_LIST()
        self._check(mvs.MvCamera.MV_CC_EnumDevices(mvs.MV_GIGE_DEVICE, devices), "EnumDevices")
        if devices.nDeviceNum == 0:
            raise FrameSourceError("GigE-камера не найдена: проверьте кабель, сетевую карту (IP 169.254.x.x) и драйвер MVS.")
        found, match = [], None
        for i in range(devices.nDeviceNum):
            info = ctypes.cast(devices.pDeviceInfo[i], ctypes.POINTER(mvs.MV_CC_DEVICE_INFO)).contents
            gige = info.SpecialInfo.stGigEInfo
            ip = ip_from_int(gige.nCurrentIp)
            found.append(f"{ip} {_cstr(gige.chModelName)} {_cstr(gige.chSerialNumber)}".strip())
            if ip == self.ip and match is None:
                match = info
                self.camera_id = _cstr(gige.chModelName) or "Hikrobot"
                self.serial = _cstr(gige.chSerialNumber)
        log.info("Найдены GigE-камеры: %s", "; ".join(found))
        if match is None:
            raise FrameSourceError(f"Камера {self.ip} не найдена. Доступны: {', '.join(found)}. Укажите --ip.")

        accessible = getattr(mvs.MvCamera, "MV_CC_IsDeviceAccessible", None)
        if accessible is not None:
            try:
                if not accessible(match, getattr(mvs, "MV_ACCESS_Exclusive", 1)):
                    raise FrameSourceError(self._access_denied_text())
            except FrameSourceError:
                raise
            except Exception:
                pass

        self.camera = mvs.MvCamera()
        try:
            self._check(self.camera.MV_CC_CreateHandle(match), "CreateHandle")
            self._created = True
            rc = self.camera.MV_CC_OpenDevice()
            if rc == self.E_ACCESS_DENIED:
                raise FrameSourceError(self._access_denied_text())
            self._check(rc, "OpenDevice")
            self._opened = True
            if hasattr(self.camera, "MV_CC_GetOptimalPacketSize"):
                size = int(self.camera.MV_CC_GetOptimalPacketSize())
                if size > 0:
                    self.camera.MV_CC_SetIntValue("GevSCPSPacketSize", size)
            for name, value in (
                ("AcquisitionMode", 2),  # Continuous
                ("TriggerMode", 0),  # Off
                ("ExposureAuto", 0),  # Off
                ("PixelFormat", mvs.PixelType_Gvsp_Mono8),
            ):
                self._check(self.camera.MV_CC_SetEnumValue(name, value), f"set {name}")
            self._check(self.camera.MV_CC_SetFloatValue("ExposureTime", float(self.exposure_us)), f"set ExposureTime={self.exposure_us:g}us")
            payload = mvs.MVCC_INTVALUE()
            self._check(self.camera.MV_CC_GetIntValue("PayloadSize", payload), "get PayloadSize")
            self.buf_size = int(payload.nCurValue)
            if self.buf_size <= 0:
                raise FrameSourceError(f"Некорректный PayloadSize: {self.buf_size}")
            self.buf = (ctypes.c_ubyte * self.buf_size)()
            self.info = mvs.MV_FRAME_OUT_INFO_EX()
            self._check(self.camera.MV_CC_StartGrabbing(), "StartGrabbing")
            self._grabbing = True
            log.info("Подключено: %s %s (%s), Mono8, Continuous, Trigger Off, Exposure %g мкс", self.camera_id, self.serial, self.ip, self.exposure_us)
        except Exception:
            self.release()
            raise

    def _access_denied_text(self) -> str:
        return (
            f"Камера {self.ip} занята (MV_E_ACCESS_DENIED 0x{self.E_ACCESS_DENIED:08X}): она открыта в MVS или другой программе. "
            "Закройте MVS (или отключите камеру в нём кнопкой Disconnect) и запустите снова."
        )

    @staticmethod
    def _check(code: int, label: str):
        if code != 0:
            raise FrameSourceError(f"MVS {label}: ошибка 0x{code & 0xFFFFFFFF:08X}")

    # -- захват (логика live_loop) --
    def frames(self) -> Iterator[Frame]:
        mvs = self.mvs
        timeouts = 0
        restarted = False
        while not self._released and not self._stop_requested:
            rc = self.camera.MV_CC_GetOneFrameTimeout(self.buf, self.buf_size, self.info, self.timeout_ms)
            self._frame_id += 1
            now_m, now_w = time.monotonic(), time.time()
            if rc != 0:
                timeouts += 1
                msg = f"нет кадра: 0x{rc & 0xFFFFFFFF:08X} ({timeouts} подряд)"
                log.warning(msg)
                yield Frame(None, self._frame_id, now_m, now_w, error=msg)
                if timeouts >= self.max_timeouts:
                    if restarted:
                        raise FrameSourceError("Камера не отдаёт кадры: проверьте сеть, MVS и режим триггера.")
                    log.warning("перезапуск захвата")
                    self.camera.MV_CC_StopGrabbing()
                    self._check(self.camera.MV_CC_StartGrabbing(), "StartGrabbing (повтор)")
                    restarted, timeouts = True, 0
                continue
            timeouts, restarted = 0, False
            if self.info.enPixelType != mvs.PixelType_Gvsp_Mono8:
                raise FrameSourceError(f"Ожидался Mono8, получен PixelType=0x{self.info.enPixelType:08X}")
            w, h = int(self.info.nWidth), int(self.info.nHeight)
            gray = np.ctypeslib.as_array(self.buf)[: w * h].reshape(h, w).copy()
            yield Frame(gray, self._frame_id, now_m, now_w, int(getattr(self.info, "nFrameNum", 0)), int(getattr(self.info, "nLostPacket", 0)))

    def request_stop(self):
        """Попросить цикл захвата завершиться (из другого потока); SDK освобождает release()."""
        self._stop_requested = True

    def release(self):
        """Остановить захват, закрыть камеру, уничтожить дескриптор. Безопасно вызывать повторно."""
        if self._released:
            return
        self._released = True
        cam = self.camera
        if cam is None:
            return
        for flag, call in (("_grabbing", "MV_CC_StopGrabbing"), ("_opened", "MV_CC_CloseDevice"), ("_created", "MV_CC_DestroyHandle")):
            if getattr(self, flag):
                try:
                    getattr(cam, call)()
                except Exception:
                    log.exception("MVS %s", call)
                setattr(self, flag, False)
        log.info("Камера освобождена")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.release()


# ---------------- захват в отдельном потоке ----------------


class LatestFrameGrabber:
    """Захват в отдельном потоке, обработке отдаётся только самый свежий кадр.

    Если распознавание медленнее камеры, промежуточные кадры пропускаются (счётчик dropped), а не копятся
    в буфере SDK — иначе положение отставало бы от реальности всё сильнее. Частота камеры (capture_fps)
    считается здесь, отдельно от частоты обработки.
    """

    def __init__(self, source, join_timeout_s: float = 3.0):
        import threading

        self.source = source
        self.camera_id = getattr(source, "camera_id", "camera")
        self.ip = getattr(source, "ip", None)
        self.join_timeout_s = join_timeout_s
        self._cond = threading.Condition()
        self._latest: Frame | None = None
        self._seq = 0
        self._done = False
        self._error: BaseException | None = None
        self._stop = False
        self.captured = 0
        self.delivered = 0
        self.capture_fps = 0.0
        self._last_t: float | None = None
        self._thread = threading.Thread(target=self._run, name="frame-grabber", daemon=True)
        self._thread.start()

    @property
    def dropped(self) -> int:
        return max(0, self.captured - self.delivered)

    def _run(self):
        try:
            for f in self.source.frames():
                if self._stop:
                    break
                with self._cond:
                    if f.image is not None:
                        self.captured += 1
                        if self._last_t is not None and f.t > self._last_t:
                            inst = 1.0 / (f.t - self._last_t)
                            self.capture_fps = inst if self.capture_fps == 0 else 0.85 * self.capture_fps + 0.15 * inst
                        self._last_t = f.t
                    # кадр без изображения (таймаут) не затирает ещё не обработанный настоящий кадр
                    if f.image is not None or self._latest is None or self._latest.image is None:
                        self._latest = f
                        self._seq += 1
                    self._cond.notify_all()
        except BaseException as e:  # noqa: BLE001 — передаём в поток обработки
            self._error = e
        finally:
            with self._cond:
                self._done = True
                self._cond.notify_all()

    def frames(self) -> Iterator[Frame]:
        seen = 0
        while True:
            with self._cond:
                while self._seq == seen and not self._done and not self._stop:
                    self._cond.wait(0.2)
                if self._error is not None:
                    raise self._error
                if self._stop or (self._done and self._seq == seen):
                    return
                f, seen = self._latest, self._seq
            if f.image is not None:
                self.delivered += 1
            yield f

    def release(self):
        self._stop = True
        stop = getattr(self.source, "request_stop", None)
        if stop:
            stop()
        if self._thread.is_alive():
            self._thread.join(self.join_timeout_s)
        self.source.release()


# ---------------- файлы ----------------


def to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    if img.dtype == np.uint16:
        return (img >> 8).astype(np.uint8)
    return img


class ImageSource:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        img = cv2.imread(str(self.path), cv2.IMREAD_UNCHANGED)
        if img is None:
            raise FrameSourceError(f"Не удалось открыть изображение: {self.path}")
        self.image = to_gray(img)
        self.camera_id = f"file:{self.path.name}"
        self.ip = None

    def frames(self) -> Iterator[Frame]:
        yield Frame(self.image, 1, 0.0, os.path.getmtime(self.path))

    def release(self):
        pass


class VideoSource:
    """Видео для повторяемых тестов: время кадра берётся из видео (FPS файла), а не из часов."""

    def __init__(self, path: str | Path, realtime: bool = False):
        self.path = Path(path)
        self.cap = cv2.VideoCapture(str(self.path))
        if not self.cap.isOpened():
            raise FrameSourceError(f"Не удалось открыть видео: {self.path}")
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.fps = fps if fps and fps > 0 else 7.0
        self.realtime = realtime
        self.camera_id = f"video:{self.path.name}"
        self.ip = None
        self._t0_wall = time.time()

    def frames(self) -> Iterator[Frame]:
        i = 0
        start = time.monotonic()
        while True:
            ok, img = self.cap.read()
            if not ok:
                return
            i += 1
            t = (i - 1) / self.fps
            if self.realtime:
                delay = start + t - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
            g = to_gray(img)
            # Пустой (чёрный) кадр в записи = «кадр не получен» (так помечаются пропуски в тестовых видео).
            yield Frame(None if g.max() == 0 else g, i, t, self._t0_wall + t)

    def release(self):
        self.cap.release()
