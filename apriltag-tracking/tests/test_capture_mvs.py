# -*- coding: utf-8 -*-
"""Логика HikrobotSource на имитации MVS SDK (без камеры): выбор по IP, MV_E_ACCESS_DENIED,
освобождение SDK при ошибках и завершении, таймауты кадров и перезапуск захвата."""
import ctypes
import types

import numpy as np
import pytest

from apriltag_tracking.capture import FrameSourceError, HikrobotSource

MONO8 = 0x01080001


class GigE(ctypes.Structure):
    _fields_ = [("nCurrentIp", ctypes.c_uint), ("chModelName", ctypes.c_ubyte * 32), ("chSerialNumber", ctypes.c_ubyte * 16)]


class Special(ctypes.Structure):
    _fields_ = [("stGigEInfo", GigE)]


class DevInfo(ctypes.Structure):
    _fields_ = [("nTLayerType", ctypes.c_uint), ("SpecialInfo", Special)]


class DevList(ctypes.Structure):
    _fields_ = [("nDeviceNum", ctypes.c_uint), ("pDeviceInfo", ctypes.POINTER(DevInfo) * 8)]


class IntValue(ctypes.Structure):
    _fields_ = [("nCurValue", ctypes.c_int64)]


class FrameInfo(ctypes.Structure):
    _fields_ = [("nWidth", ctypes.c_ushort), ("nHeight", ctypes.c_ushort), ("enPixelType", ctypes.c_uint), ("nFrameNum", ctypes.c_uint), ("nLostPacket", ctypes.c_uint)]


def ip_int(ip):
    a = [int(x) for x in ip.split(".")]
    return (a[0] << 24) | (a[1] << 16) | (a[2] << 8) | a[3]


def fake_mvs(open_rc=0, frame_rcs=None, w=64, h=48):
    calls = []
    devs_keep = []
    frame_rcs = list(frame_rcs or [])

    class MvCamera:
        @staticmethod
        def MV_CC_EnumDevices(kind, lst):
            for i, (ip, model) in enumerate([("169.254.10.10", "OTHER"), ("169.254.19.203", "MV-CU013-A0GM")]):
                d = DevInfo()
                d.SpecialInfo.stGigEInfo.nCurrentIp = ip_int(ip)
                for j, ch in enumerate(model.encode()):
                    d.SpecialInfo.stGigEInfo.chModelName[j] = ch
                for j, ch in enumerate(b"DA0000001"):
                    d.SpecialInfo.stGigEInfo.chSerialNumber[j] = ch
                devs_keep.append(d)
                lst.pDeviceInfo[i] = ctypes.pointer(d)
            lst.nDeviceNum = 2
            return 0

        def MV_CC_CreateHandle(self, info):
            calls.append("CreateHandle")
            return 0

        def MV_CC_OpenDevice(self):
            calls.append("OpenDevice")
            return open_rc

        def MV_CC_SetEnumValue(self, name, value):
            calls.append(f"set {name}={value}")
            return 0

        def MV_CC_SetFloatValue(self, name, value):
            calls.append(f"set {name}={value}")
            return 0

        def MV_CC_GetIntValue(self, name, v):
            v.nCurValue = w * h
            return 0

        def MV_CC_StartGrabbing(self):
            calls.append("StartGrabbing")
            return 0

        def MV_CC_StopGrabbing(self):
            calls.append("StopGrabbing")
            return 0

        def MV_CC_CloseDevice(self):
            calls.append("CloseDevice")
            return 0

        def MV_CC_DestroyHandle(self):
            calls.append("DestroyHandle")
            return 0

        def MV_CC_GetOneFrameTimeout(self, buf, size, info, timeout):
            rc = frame_rcs.pop(0) if frame_rcs else 0
            if rc:
                return rc
            info.nWidth, info.nHeight, info.enPixelType = w, h, MONO8
            info.nFrameNum += 1
            for i in range(w * h):
                buf[i] = i % 251
            return 0

    mod = types.SimpleNamespace(
        MvCamera=MvCamera, MV_CC_DEVICE_INFO_LIST=DevList, MV_CC_DEVICE_INFO=DevInfo, MV_GIGE_DEVICE=1,
        MVCC_INTVALUE=IntValue, MV_FRAME_OUT_INFO_EX=FrameInfo, PixelType_Gvsp_Mono8=MONO8, MV_E_ACCESS_DENIED=0x80000203,
    )
    return mod, calls


def test_open_configures_like_original_and_releases_once():
    mvs, calls = fake_mvs()
    src = HikrobotSource("169.254.19.203", mvs_module=mvs)
    assert src.camera_id == "MV-CU013-A0GM" and src.serial == "DA0000001"
    for expected in ("set AcquisitionMode=2", "set TriggerMode=0", "set ExposureAuto=0", f"set PixelFormat={MONO8}", "set ExposureTime=5000.0", "StartGrabbing"):
        assert expected in calls
    f = next(src.frames())
    assert f.image.shape == (48, 64) and f.image.dtype == np.uint8 and f.camera_frame_num == 1
    src.release()
    src.release()
    assert calls[-3:] == ["StopGrabbing", "CloseDevice", "DestroyHandle"]
    assert calls.count("DestroyHandle") == 1


def test_access_denied_message_and_cleanup():
    mvs, calls = fake_mvs(open_rc=0x80000203)
    with pytest.raises(FrameSourceError) as e:
        HikrobotSource("169.254.19.203", mvs_module=mvs)
    assert "MV_E_ACCESS_DENIED" in str(e.value) and "MVS" in str(e.value)
    assert "DestroyHandle" in calls and "CloseDevice" not in calls


def test_unknown_ip_lists_available():
    mvs, _ = fake_mvs()
    with pytest.raises(FrameSourceError) as e:
        HikrobotSource("10.0.0.1", mvs_module=mvs)
    assert "169.254.19.203" in str(e.value)


def test_error_during_setup_releases_sdk():
    mvs, calls = fake_mvs()
    mvs.MvCamera.MV_CC_GetIntValue = lambda self, name, v: 0x80000004
    with pytest.raises(FrameSourceError):
        HikrobotSource("169.254.19.203", mvs_module=mvs)
    assert calls[-2:] == ["CloseDevice", "DestroyHandle"]


def test_frame_timeouts_yield_empty_frames_then_recover():
    mvs, calls = fake_mvs(frame_rcs=[0x80000007] * 3 + [0, 0])
    src = HikrobotSource("169.254.19.203", mvs_module=mvs, max_timeouts=3)
    it = src.frames()
    got = [next(it) for _ in range(5)]
    assert [g.image is None for g in got] == [True, True, True, False, False]
    assert calls.count("StartGrabbing") == 2  # после серии таймаутов захват перезапущен
    src.release()


def test_persistent_timeouts_raise_after_restart():
    mvs, calls = fake_mvs(frame_rcs=[0x80000007] * 10)
    src = HikrobotSource("169.254.19.203", mvs_module=mvs, max_timeouts=2)
    with pytest.raises(FrameSourceError):
        for _ in src.frames():
            pass
    src.release()
    assert calls.count("DestroyHandle") == 1


def test_latest_frame_grabber_drops_stale_frames_and_releases():
    import time

    from apriltag_tracking.capture import Frame, LatestFrameGrabber

    class Cam:
        camera_id, ip = "cam", "1.2.3.4"

        def __init__(self):
            self.stop = False
            self.released = 0

        def frames(self):
            i = 0
            while not self.stop:
                i += 1
                time.sleep(0.01)  # камера ~100 FPS
                yield Frame(np.full((4, 4), i % 255, np.uint8), i, time.monotonic(), time.time())

        def request_stop(self):
            self.stop = True

        def release(self):
            self.released += 1

    cam = Cam()
    g = LatestFrameGrabber(cam)
    ids = []
    for f in g.frames():
        ids.append(f.frame_id)
        time.sleep(0.05)  # обработка в 5 раз медленнее камеры
        if len(ids) == 8:
            break
    newest = g._latest.frame_id
    g.release()
    assert cam.released == 1 and cam.stop
    assert g.dropped > 0 and g.capture_fps > 40
    assert ids == sorted(ids) and ids[-1] - ids[0] > 20  # отдаются свежие кадры, а не очередь старых
    assert newest - ids[-1] <= 10


def test_latest_frame_grabber_propagates_camera_error():
    from apriltag_tracking.capture import FrameSourceError, LatestFrameGrabber

    class Broken:
        def frames(self):
            raise FrameSourceError("Камера не отдаёт кадры")
            yield

        def release(self):
            pass

    g = LatestFrameGrabber(Broken())
    with pytest.raises(FrameSourceError):
        list(g.frames())
    g.release()
