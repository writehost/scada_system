"""Источники кадров.

HikrobotCamera — промышленная камера Hikrobot через MVS SDK (Python-обёртка MvImport из установки MVS:
/opt/MVS/Samples/64/Python/MvImport, путь задаётся в конфиге). Режим непрерывной съёмки, Mono8.
OpenCVCamera — USB/RTSP/GigE через cv2.VideoCapture (стенд, резерв).
FolderCamera — последовательность файлов (отладка, повтор записи со склада).

Все источники возвращают (gray: np.ndarray uint8, t_capture: float — время UNIX в секундах).
"""
from __future__ import annotations

import ctypes
import glob
import os
import sys
import time
from typing import Iterator, Protocol

import numpy as np

try:  # pragma: no cover
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None


class FrameSource(Protocol):
    serial: str

    def frames(self) -> Iterator[tuple[np.ndarray, float]]: ...

    def close(self) -> None: ...


class HikrobotCamera:  # pragma: no cover - требует оборудования и MVS SDK
    """Hikrobot MVS SDK. Проверено по API образцов MVS (MvCameraControl_class); на объекте — пусконаладка."""

    def __init__(self, serial: str, mvimport_path: str = "/opt/MVS/Samples/64/Python/MvImport", exposure_us: float | None = 4000, gain_db: float | None = None, timeout_ms: int = 1000):
        if mvimport_path and mvimport_path not in sys.path:
            sys.path.append(mvimport_path)
        from MvCameraControl_class import (  # type: ignore
            MV_CC_DEVICE_INFO,
            MV_CC_DEVICE_INFO_LIST,
            MV_FRAME_OUT,
            MV_GIGE_DEVICE,
            MV_USB_DEVICE,
            MvCamera,
        )

        self._MV_FRAME_OUT = MV_FRAME_OUT
        self.serial = serial
        self.timeout_ms = timeout_ms
        devs = MV_CC_DEVICE_INFO_LIST()
        ret = MvCamera.MV_CC_EnumDevices(MV_GIGE_DEVICE | MV_USB_DEVICE, devs)
        if ret != 0 or devs.nDeviceNum == 0:
            raise RuntimeError(f"Hikrobot: камеры не найдены (код {ret:#x})")
        chosen = None
        for i in range(devs.nDeviceNum):
            info = ctypes.cast(devs.pDeviceInfo[i], ctypes.POINTER(MV_CC_DEVICE_INFO)).contents
            if info.nTLayerType == MV_GIGE_DEVICE:
                sn = bytes(info.SpecialInfo.stGigEInfo.chSerialNumber).split(b"\0")[0].decode()
            else:
                sn = bytes(info.SpecialInfo.stUsb3VInfo.chSerialNumber).split(b"\0")[0].decode()
            if not serial or sn == serial:
                chosen = info
                self.serial = sn
                break
        if chosen is None:
            raise RuntimeError(f"Hikrobot: камера {serial} не найдена")
        self.cam = MvCamera()
        self._check(self.cam.MV_CC_CreateHandle(chosen), "CreateHandle")
        self._check(self.cam.MV_CC_OpenDevice(), "OpenDevice")
        if chosen.nTLayerType == MV_GIGE_DEVICE:
            size = self.cam.MV_CC_GetOptimalPacketSize()
            if int(size) > 0:
                self.cam.MV_CC_SetIntValue("GevSCPSPacketSize", int(size))
        self.cam.MV_CC_SetEnumValue("TriggerMode", 0)
        self.cam.MV_CC_SetEnumValueByString("PixelFormat", "Mono8")
        if exposure_us:
            self.cam.MV_CC_SetEnumValue("ExposureAuto", 0)
            self.cam.MV_CC_SetFloatValue("ExposureTime", float(exposure_us))
        if gain_db is not None:
            self.cam.MV_CC_SetEnumValue("GainAuto", 0)
            self.cam.MV_CC_SetFloatValue("Gain", float(gain_db))
        self._check(self.cam.MV_CC_StartGrabbing(), "StartGrabbing")

    @staticmethod
    def _check(ret: int, what: str):
        if ret != 0:
            raise RuntimeError(f"Hikrobot {what}: код {ret:#x}")

    def frames(self) -> Iterator[tuple[np.ndarray, float]]:
        out = self._MV_FRAME_OUT()
        while True:
            ctypes.memset(ctypes.byref(out), 0, ctypes.sizeof(out))
            ret = self.cam.MV_CC_GetImageBuffer(out, self.timeout_ms)
            t = time.time()
            if ret != 0:
                yield np.empty((0, 0), np.uint8), t  # таймаут — сигнал «кадра нет»
                continue
            try:
                w, h = out.stFrameInfo.nWidth, out.stFrameInfo.nHeight
                n = out.stFrameInfo.nFrameLen
                buf = ctypes.string_at(out.pBufAddr, n)
                img = np.frombuffer(buf, dtype=np.uint8, count=w * h).reshape(h, w).copy()
            finally:
                self.cam.MV_CC_FreeImageBuffer(out)
            yield img, t

    def close(self) -> None:
        try:
            self.cam.MV_CC_StopGrabbing()
            self.cam.MV_CC_CloseDevice()
            self.cam.MV_CC_DestroyHandle()
        except Exception:
            pass


class OpenCVCamera:  # pragma: no cover - требует устройства
    def __init__(self, source: str | int, serial: str = "opencv"):
        self.serial = serial
        self.cap = cv2.VideoCapture(int(source) if str(source).isdigit() else source)
        if not self.cap.isOpened():
            raise RuntimeError(f"не открыт источник видео {source}")

    def frames(self) -> Iterator[tuple[np.ndarray, float]]:
        while True:
            ok, frame = self.cap.read()
            t = time.time()
            if not ok:
                yield np.empty((0, 0), np.uint8), t
                time.sleep(0.05)
                continue
            yield (cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame), t

    def close(self) -> None:
        self.cap.release()


class FolderCamera:
    def __init__(self, pattern: str, fps: float = 5.0, serial: str = "folder", loop: bool = False):
        self.files = sorted(glob.glob(pattern))
        if not self.files:
            raise RuntimeError(f"нет кадров по шаблону {pattern}")
        self.fps = fps
        self.serial = serial
        self.loop = loop

    def frames(self) -> Iterator[tuple[np.ndarray, float]]:
        while True:
            for f in self.files:
                img = cv2.imread(f, cv2.IMREAD_GRAYSCALE)
                yield img, time.time()
                if self.fps > 0:
                    time.sleep(1.0 / self.fps)
            if not self.loop:
                return

    def close(self) -> None:
        pass


def open_source(cfg: dict) -> FrameSource:
    kind = cfg.get("kind", "hikrobot")
    if kind == "hikrobot":
        return HikrobotCamera(
            serial=cfg.get("serial", ""),
            mvimport_path=cfg.get("mvimportPath", "/opt/MVS/Samples/64/Python/MvImport"),
            exposure_us=cfg.get("exposureUs", 4000),
            gain_db=cfg.get("gainDb"),
        )
    if kind == "opencv":
        return OpenCVCamera(cfg.get("source", 0), serial=cfg.get("serial", "opencv"))
    if kind == "folder":
        return FolderCamera(cfg["pattern"], fps=float(cfg.get("fps", 5)), serial=cfg.get("serial", "folder"), loop=bool(cfg.get("loop", False)))
    raise ValueError(f"неизвестный источник кадров: {kind}")


__all__ = ["FrameSource", "HikrobotCamera", "OpenCVCamera", "FolderCamera", "open_source", "os"]
