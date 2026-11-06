# -*- coding: utf-8 -*-
"""Live AprilTag test + optional pose estimate for Hikrobot MV-CU013-A0GM via MVS SDK.

Install (Windows x64): py -m pip install numpy opencv-python pupil-apriltags
Run (detection only): py apriltag_hikrobot_pose.py
Run (pose): py apriltag_hikrobot_pose.py --tag-size-mm 100 --fx 997.28 --fy 997.28
Offline: py apriltag_hikrobot_pose.py --image frame.png
Exit: Q / Esc; S saves last view and unmodified grayscale frame.

IMPORTANT: Close MVS before starting live acquisition.
"""

import argparse
import ctypes
import importlib
import os
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from pupil_apriltags import Detector

DEFAULT_IP = "169.254.19.203"  # Camera IP shown in MVS
DEFAULT_FAMILIES = ("tag16h5",)
DEFAULT_MIN_MARGIN = 15.0  # Adjustable starting threshold, not a universal cutoff
DEFAULT_MAX_HAMMING = 0


def create_detectors(families):
    return [
        (family, Detector(families=family, nthreads=2, quad_decimate=1.0, refine_edges=1))
        for family in families
    ]


def detect_tags(gray, detectors, min_margin=DEFAULT_MIN_MARGIN,
                max_hamming=DEFAULT_MAX_HAMMING, pose_args=None):
    found = []
    if pose_args is not None:
        fx, fy, cx, cy, tag_size_m = pose_args
        camera_params = (fx, fy, gray.shape[1] / 2 if cx is None else cx,
                         gray.shape[0] / 2 if cy is None else cy)
    for family, detector in detectors:
        detections = detector.detect(
            gray,
            estimate_tag_pose=pose_args is not None,
            camera_params=camera_params if pose_args is not None else None,
            tag_size=tag_size_m if pose_args is not None else None,
        )
        for tag in detections:
            if tag.hamming > max_hamming or tag.decision_margin < min_margin:
                continue
            found.append((family, tag))
    return found


def pose_values(tag):
    """Return camera-frame x/y/z and Euclidean range, all in meters."""
    if tag.pose_t is None:
        return None
    xyz = np.asarray(tag.pose_t, dtype=float).reshape(-1)
    if len(xyz) != 3 or not np.isfinite(xyz).all():
        return None
    return float(xyz[0]), float(xyz[1]), float(xyz[2]), float(np.linalg.norm(xyz))


def format_found(family, tag):
    msg = (f"FOUND {family}: ID={tag.tag_id}, center={tag.center.round(1)}, "
           f"hamming={tag.hamming}, margin={tag.decision_margin:.1f}")
    xyz = pose_values(tag)
    if xyz is not None:
        x, y, z, distance = xyz
        msg += f"  X={x:.3f}m Y={y:.3f}m Z={z:.3f}m DIST={distance:.3f}m"
    return msg


def annotate(gray, found, fps, pose_args=None):
    output = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    for family, tag in found:
        corners = np.rint(tag.corners).astype(np.int32)
        center = tuple(np.rint(tag.center).astype(int))
        cv2.polylines(output, [corners], True, (0, 255, 0), 3)
        cv2.circle(output, center, 5, (0, 0, 255), -1)
        label = f"{family} ID={tag.tag_id} H={tag.hamming} M={tag.decision_margin:.1f}"
        origin = (max(8, min(center[0] - 130, output.shape[1] - 530)), max(55, center[1] - 36))
        cv2.putText(output, label, origin, cv2.FONT_HERSHEY_SIMPLEX, 0.61, (0, 255, 0), 2)
        xyz = pose_values(tag)
        if xyz is not None:
            x, y, z, distance = xyz
            cv2.putText(output, f"Z={z:.3f}m  DIST={distance:.3f}m", (origin[0], origin[1] + 23),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.61, (0, 255, 255), 2)
    status = (f"AprilTags: {len(found)}  |  FPS: {fps:.1f}  |  "
              + ("Pose ON (calibration required)" if pose_args else "Pose OFF: set --tag-size-mm --fx --fy")
              + "  |  S: save  Q: quit")
    cv2.rectangle(output, (0, 0), (output.shape[1], 35), (0, 0, 0), -1)
    cv2.putText(output, status, (10, 25), cv2.FONT_HERSHEY_SIMPLEX,
                0.57, (255, 255, 255), 2)
    return output


def show_frame(output):
    height, width = output.shape[:2]
    max_width, max_height = 1100, 850
    scale = min(max_width / width, max_height / height, 1.0)
    display = cv2.resize(output, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else output
    cv2.imshow("Hikrobot - AprilTag live test", display)
    return cv2.waitKey(1) & 0xFF


def add_mvs_paths():
    roots = [
        Path(r"C:\Program Files (x86)\MVS\Development\Samples\Python\MvImport"),
        Path(r"C:\Program Files\MVS\Development\Samples\Python\MvImport"),
        Path(__file__).resolve().parent / "MvImport",
    ]
    for folder in roots:
        if (folder / "MvCameraControl_class.py").exists():
            sys.path.insert(0, str(folder))
            break
    else:
        raise FileNotFoundError(
            "MVS Python SDK not found. Locate MvImport/MvCameraControl_class.py "
            "under your MVS installation and copy MvImport next to this script."
        )
    # Keep DLL-directory handles alive for the duration of the process.
    dll_dirs = [
        Path(r"C:\Program Files (x86)\Common Files\MVS\Runtime\Win64_x64"),
        Path(r"C:\Program Files\Common Files\MVS\Runtime\Win64_x64"),
    ]
    handles = []
    if hasattr(os, "add_dll_directory"):
        for folder in dll_dirs:
            if folder.is_dir():
                handles.append(os.add_dll_directory(str(folder)))
    return handles


def ip_from_int(n):
    return ".".join(str((n >> shift) & 255) for shift in (24, 16, 8, 0))


def check_ok(code, label):
    if code != 0:
        raise RuntimeError(f"MVS {label} error: 0x{code:08X}")


def open_hikrobot(ip):
    dll_handles = add_mvs_paths()
    mvs = importlib.import_module("MvCameraControl_class")
    devices = mvs.MV_CC_DEVICE_INFO_LIST()
    check_ok(mvs.MvCamera.MV_CC_EnumDevices(mvs.MV_GIGE_DEVICE, devices), "EnumDevices")
    if devices.nDeviceNum == 0:
        raise RuntimeError("No GigE camera found. Check Ethernet cable, NIC and MVS driver.")

    matches = []
    print("Detected GigE cameras:")
    for i in range(devices.nDeviceNum):
        info = ctypes.cast(devices.pDeviceInfo[i], ctypes.POINTER(mvs.MV_CC_DEVICE_INFO)).contents
        found_ip = ip_from_int(info.SpecialInfo.stGigEInfo.nCurrentIp)
        print(f"  [{i}] {found_ip}")
        if found_ip == ip:
            matches.append(info)
    if not matches:
        raise RuntimeError(f"Camera {ip} not found; change --ip to one of the addresses above.")

    camera = mvs.MvCamera()
    created = opened = grabbing = False
    try:
        check_ok(camera.MV_CC_CreateHandle(matches[0]), "CreateHandle")
        created = True
        check_ok(camera.MV_CC_OpenDevice(), "OpenDevice (close MVS first)")
        opened = True

        # Screenshot configuration. Do not change width, height, gain or frame rate.
        settings = [
            ("AcquisitionMode", 2),      # Continuous
            ("TriggerMode", 0),          # Off (free running)
            ("ExposureAuto", 0),         # Off
            ("PixelFormat", mvs.PixelType_Gvsp_Mono8),
        ]
        for name, value in settings:
            check_ok(camera.MV_CC_SetEnumValue(name, value), f"set {name}")
        check_ok(camera.MV_CC_SetFloatValue("ExposureTime", 5000.0), "set ExposureTime=5000us")

        payload = mvs.MVCC_INTVALUE()
        check_ok(camera.MV_CC_GetIntValue("PayloadSize", payload), "get PayloadSize")
        data_size = int(payload.nCurValue)
        if data_size <= 0:
            raise RuntimeError(f"Invalid PayloadSize: {data_size}")
        frame_buf = (ctypes.c_ubyte * data_size)()
        frame_info = mvs.MV_FRAME_OUT_INFO_EX()

        check_ok(camera.MV_CC_StartGrabbing(), "StartGrabbing")
        grabbing = True
        print(f"Connected {ip}, Mono8, Continuous, Trigger Off, Exposure 5000us")
        print("Press S to save frame, Q or Esc to quit.")
        return camera, mvs, frame_buf, frame_info, data_size, (created, opened, grabbing), dll_handles
    except Exception:
        if grabbing:
            camera.MV_CC_StopGrabbing()
        if opened:
            camera.MV_CC_CloseDevice()
        if created:
            camera.MV_CC_DestroyHandle()
        raise


def live_loop(ip, detectors, min_margin, max_hamming, pose_args=None):
    camera, mvs, buf, info, buf_size, _, dll_handles = open_hikrobot(ip)
    last = time.perf_counter()
    last_print = 0.0
    no_frames = 0
    try:
        while True:
            rc = camera.MV_CC_GetOneFrameTimeout(buf, buf_size, info, 1500)
            if rc != 0:
                no_frames += 1
                print(f"Frame timeout/error: 0x{rc:08X} ({no_frames})")
                if no_frames >= 5:
                    raise RuntimeError("No frames from camera; check network, MVS and trigger mode.")
                continue
            no_frames = 0
            if info.enPixelType != mvs.PixelType_Gvsp_Mono8:
                raise RuntimeError(f"Expected Mono8, got PixelType=0x{info.enPixelType:08X}")

            width, height = int(info.nWidth), int(info.nHeight)
            gray = np.ctypeslib.as_array(buf)[:width * height].reshape(height, width).copy()
            found = detect_tags(gray, detectors, min_margin, max_hamming, pose_args)
            now = time.perf_counter()
            fps = (1.0 / max(now - last, 1e-5))
            last = now
            frame = annotate(gray, found, fps, pose_args)

            if found and now - last_print >= 0.5:
                for family, tag in found:
                    print(format_found(family, tag))
                last_print = now

            key = show_frame(frame)
            if key in (ord("q"), 27):
                break
            if key == ord("s"):
                cv2.imwrite("apriltag_raw.png", gray)
                cv2.imwrite("apriltag_result.png", frame)
                print("Saved apriltag_raw.png and apriltag_result.png")
    finally:
        camera.MV_CC_StopGrabbing()
        camera.MV_CC_CloseDevice()
        camera.MV_CC_DestroyHandle()
        cv2.destroyAllWindows()


def image_test(path, detectors, min_margin, max_hamming, pose_args=None):
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise RuntimeError(f"Cannot open image: {path}")
    found = detect_tags(img, detectors, min_margin, max_hamming)
    for family, tag in found:
        print(format_found(family, tag))
    if not found:
        print("No AprilTag found. Check tag family, sharpness, lighting and white border.")
    result = annotate(img, found, 0.0, pose_args)
    cv2.imwrite("apriltag_result.png", result)
    print("Saved apriltag_result.png")
    show_frame(result)
    cv2.waitKey(0)
    cv2.destroyAllWindows()


def main():
    parser = argparse.ArgumentParser(description="Hikrobot MVS + AprilTag test")
    parser.add_argument("--ip", default=DEFAULT_IP)
    parser.add_argument("--image", type=Path, help="Test on saved image instead of live camera")
    parser.add_argument("--families", nargs="+", default=DEFAULT_FAMILIES,
                        help="Tag family; default: tag16h5. Use --families tag36h11 for tag36h11 printed tags")
    parser.add_argument("--min-margin", type=float, default=DEFAULT_MIN_MARGIN,
                        help="Minimum confidence margin, default 15.0")
    parser.add_argument("--max-hamming", type=int, default=DEFAULT_MAX_HAMMING,
                        help="Maximum corrected bits, default 0")
    parser.add_argument("--tag-size-mm", type=float, help="Measured AprilTag side length in millimeters (between detection corners; NOT paper size)")
    parser.add_argument("--fx", type=float, help="Calibrated focal length in pixels, x")
    parser.add_argument("--fy", type=float, help="Calibrated focal length in pixels, y")
    parser.add_argument("--cx", type=float, default=None, help="Optical center x in pixels (default: image width / 2)")
    parser.add_argument("--cy", type=float, default=None, help="Optical center y in pixels (default: image height / 2)")
    args = parser.parse_args()
    pose_args = None
    if args.tag_size_mm is not None or args.fx is not None or args.fy is not None:
        if args.tag_size_mm is None or args.fx is None or args.fy is None:
            parser.error("For distance provide --tag-size-mm, --fx and --fy together")
        if args.tag_size_mm <= 0 or args.fx <= 0 or args.fy <= 0:
            parser.error("--tag-size-mm, --fx and --fy must be positive")
        pose_args = (args.fx, args.fy, args.cx, args.cy, args.tag_size_mm / 1000.0)
        print("Pose estimation enabled. Distances are reliable only with camera calibration and exact tag size.")
    else:
        print("Pose estimation OFF. For distance provide --tag-size-mm, --fx and --fy.")
    detectors = create_detectors(args.families)
    if args.image:
        image_test(args.image, detectors, args.min_margin, args.max_hamming, pose_args)
    else:
        live_loop(args.ip, detectors, args.min_margin, args.max_hamming, pose_args)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
