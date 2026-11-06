# -*- coding: utf-8 -*-
"""Диагностическое окно: кадр с разметкой меток + отдельная панель измерений справа (не перекрывает метку).

Надписи в окне латиницей: шрифты Hershey в OpenCV не умеют кириллицу.
"""
from __future__ import annotations

import cv2
import numpy as np

PANEL_W = 430
GREEN, RED, YELLOW, ORANGE, GRAY, WHITE, CYAN = (0, 220, 0), (0, 0, 255), (0, 230, 255), (0, 150, 255), (150, 150, 150), (255, 255, 255), (255, 220, 0)

STATUS_COLOR = {"POSE_VALID": GREEN, "POSE_UNCERTAIN": ORANGE, "NO_CALIBRATION": YELLOW, "DETECTED": YELLOW, "LOST": GRAY}

FONT = cv2.FONT_HERSHEY_SIMPLEX


def _t(img, text, org, color=WHITE, scale=0.5, th=1):
    cv2.putText(img, text, org, FONT, scale, (0, 0, 0), th + 2, cv2.LINE_AA)
    cv2.putText(img, text, org, FONT, scale, color, th, cv2.LINE_AA)


def _xyz(p):
    if not p:
        return "n/a"
    return f"X {p['x']:+.3f}  Y {p['y']:+.3f}  Z {p['z']:+.3f} m"


def draw(gray: np.ndarray, measurements: list[dict], info: dict, calibration=None, show_axes: bool = True) -> np.ndarray:
    img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR) if gray.ndim == 2 else gray.copy()
    h, w = img.shape[:2]
    lw = max(2, int(round(w / 640)))
    for m in measurements:
        if m.get("event") == "lost" or not m.get("corners_px"):
            continue
        color = STATUS_COLOR.get(m["status"], GREEN)
        c = np.rint(np.array(m["corners_px"], dtype=float)).astype(np.int32)
        cv2.polylines(img, [c], True, GREEN if m["status"] == "POSE_VALID" else color, lw + 1)
        cv2.circle(img, (int(round(c[0][0])), int(round(c[0][1]))), lw + 2, CYAN, -1)  # первый угол (верх-лево для PnP)
        ctr = tuple(int(round(v)) for v in m["center_px"])
        cv2.circle(img, ctr, lw + 3, RED, -1)
        if show_axes and calibration is not None and m.get("rotation_tag_to_camera") and m.get("tag_size_m"):
            rv = np.array(m["rotation_tag_to_camera"]["rvec"], dtype=float)
            p = m["position_camera_m"]
            tv = np.array([p["x"], p["y"], p["z"]], dtype=float)
            try:
                cv2.drawFrameAxes(img, calibration.camera_matrix, calibration.dist_coeffs, rv, tv, m["tag_size_m"] * 0.5, lw)
            except cv2.error:
                pass
        top = int(c[:, 1].min())
        left = int(c[:, 0].min())
        label = f"{m['family']} ID {m['tag_id']}"
        if m.get("distance_m") is not None:
            label += f"  {m['distance_m'] * 100:.1f} cm" + ("" if m["status"] == "POSE_VALID" else " ?")
        y = top - 10 if top > 30 else int(c[:, 1].max()) + 24
        _t(img, label, (max(4, min(left, w - 330)), y), color, 0.6 * lw / 2 + 0.3, lw)

    panel = np.full((h, PANEL_W, 3), 24, np.uint8)
    y = 26
    s = max(0.5, h / 1600)
    step = int(26 * s / 0.62)

    def line(text, color=WHITE, scale=s, bold=1):
        nonlocal y
        if y < h - 6:
            _t(panel, text, (10, y), color, scale, bold)
        y += step

    line("AprilTag tracking", CYAN, s * 1.15, 2)
    line(f"capture {info.get('capture_fps', 0):.1f} fps  proc {info.get('proc_fps', 0):.1f} fps  {info.get('proc_ms', 0):.0f} ms")
    line(f"frame {info.get('frame_id', '-')}  {info.get('source', '')}  {info.get('backend', '')}", GRAY)
    if info.get("dropped"):
        line(f"skipped (processing slower than camera): {info['dropped']}", ORANGE)
    cal = info.get("calibration", "none")
    line(f"calibration: {cal}", GREEN if cal == "verified" else (YELLOW if cal == "nominal" else ORANGE))
    if info.get("warning"):
        line(info["warning"][:48], ORANGE)
    line(f"tags visible: {sum(1 for m in measurements if m.get('status') != 'LOST')}   rejected: {info.get('rejected', 0)}", GRAY)
    y += 4
    for m in sorted(measurements, key=lambda m: (m.get("status") == "LOST", m["family"], m["tag_id"])):
        if y > h - 3 * step:
            line("...", GRAY)
            break
        st = m["status"]
        color = STATUS_COLOR.get(st, WHITE)
        cv2.line(panel, (8, y - step + 8), (PANEL_W - 8, y - step + 8), (60, 60, 60), 1)
        line(f"{m['family']} #{m['tag_id']}   {st}", color, s * 1.05, 2)
        if st == "LOST":
            line(f"last seen frame {m.get('last_seen_frame')} - no current data", GRAY)
            continue
        line(f"margin {m['decision_margin'] if m['decision_margin'] is not None else 'n/a'}  hamming {m['hamming']}  side {m.get('tag_side_px')} px", GRAY)
        line(f"center px ({m['center_px'][0]:.1f}, {m['center_px'][1]:.1f})")
        if m.get("position_camera_m") is None:
            if st == "NO_CALIBRATION":
                line("metres: n/a (no calibration / tag size)", YELLOW)
            elif st == "DETECTED":
                line("pose disabled", YELLOW)
            else:
                line("pose: no valid PnP solution", ORANGE)
            continue
        approx = "" if st == "POSE_VALID" else "~"
        line(f"raw  {approx}{_xyz(m['position_camera_m'])}", WHITE if st == "POSE_VALID" else ORANGE)
        sm = m.get("smoothed")
        if sm:
            line(f"smth  {_xyz(sm['position_camera_m'])}", CYAN)
        d = m["distance_m"]
        sd = f"  smooth {sm['distance_m'] * 100:.1f} cm" if sm else ""
        line(f"dist {approx}{d:.3f} m = {d * 100:.1f} cm{sd}", WHITE if st == "POSE_VALID" else ORANGE, s * 1.1, 2)
        rot = m["rotation_tag_to_camera"]
        line(f"reproj {m['reprojection_error_px']:.2f} px  tilt {rot['tilt_deg']:.0f} deg  sol {m['pnp']['solutions']}", GRAY)
        stab = m.get("stability")
        if stab:
            line(f"std({stab['samples']}) dist {stab['distance_std_mm']:.1f} mm", GRAY)
        if st != "POSE_VALID" and m.get("status_codes"):
            line("why: " + ",".join(m["status_codes"])[:44], ORANGE)
    _t(panel, "S save  Q/Esc quit" + ("  SPACE measure" if info.get("accuracy") else ""), (10, h - 10), GRAY, s * 0.9)
    return np.hstack([img, panel])


def show(win: str, canvas: np.ndarray, max_w: int = 1500, max_h: int = 900) -> int:
    h, w = canvas.shape[:2]
    scale = min(max_w / w, max_h / h, 1.0)
    disp = cv2.resize(canvas, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA) if scale < 1 else canvas
    cv2.imshow(win, disp)
    return cv2.waitKey(1) & 0xFF
