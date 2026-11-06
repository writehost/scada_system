# -*- coding: utf-8 -*-
"""Структура измерения и сериализация в JSON (для JSONL, UDP, WebSocket, других модулей Python)."""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np

from .pose import POSE_VALID, euler_xyz_deg, quat_to_rotmat, rotmat_to_quat, tag_tilt_deg
from .tracking import TrackUpdate

SCHEMA = "apriltag-measurement/1"

FORKLIFT_REASON = (
    "координаты погрузчика не вычисляются: не заданы мировые координаты меток и преобразование камера → корпус"
)


def iso_utc(t_wall: float) -> str:
    return datetime.fromtimestamp(t_wall, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _r(v, n=4):
    if v is None:
        return None
    v = float(v)
    return round(v, n) if math.isfinite(v) else None


def _xyz(v, n=4):
    if v is None:
        return None
    return {"x": _r(v[0], n), "y": _r(v[1], n), "z": _r(v[2], n)}


@dataclass
class SourceInfo:
    camera_id: str
    camera_ip: str | None
    source: str  # live | image | video
    backend: str


def build_measurement(u: TrackUpdate, frame_id: int, t_wall: float, src: SourceInfo, calibration_valid: bool,
                      calibration_source: str, stability_window: int, pose_enabled: bool = True) -> dict:
    tr = u.track
    status = u.status
    if not pose_enabled and status not in ("LOST",):
        status = "DETECTED"
    m: dict = {
        "schema": SCHEMA,
        "event": u.event,
        "camera_id": src.camera_id,
        "camera_ip": src.camera_ip,
        "source": src.source,
        "timestamp": iso_utc(t_wall),
        "frame_id": frame_id,
        "family": tr.family,
        "tag_id": tr.tag_id,
        "status": status,
        "status_reasons": list(u.reasons),
        "status_codes": list(u.codes),
        "pose_valid": status == POSE_VALID,
        "calibration_valid": bool(calibration_valid),
        "calibration_source": calibration_source,
        "detector_backend": src.backend,
        "track": {
            "first_seen_frame": tr.first_frame,
            "frames_seen": tr.frames_seen,
            "last_seen_frame": tr.last_frame,
            "jumps_rejected": tr.jumps_rejected,
        },
        "forklift_pose": None,
        "forklift_pose_reason": FORKLIFT_REASON,
    }
    if u.event == "lost":
        m.update({"center_px": None, "position_camera_m": None, "distance_m": None, "last_seen_frame": tr.last_frame})
        return m
    d = u.detection
    m.update(
        {
            "center_px": [_r(d.center_px[0], 2), _r(d.center_px[1], 2)],
            "corners_px": [[_r(x, 2), _r(y, 2)] for x, y in d.corners_px],
            "hamming": d.hamming,
            "decision_margin": _r(d.decision_margin, 2),
            "tag_side_px": _r(d.min_side_px, 1),
        }
    )
    p = u.pose
    if p is None or not p.has_pose:
        m.update({"position_camera_m": None, "distance_m": None, "reprojection_error_px": None})
        if p is not None:
            m["pnp_candidates"] = [{"reprojection_error_px": _r(c.reproj_px, 3), "valid": c.valid, "reason": c.reason} for c in p.candidates]
        return m
    c = p.chosen
    q = rotmat_to_quat(c.R)
    m.update(
        {
            "tag_size_m": _r(p.tag_size_m, 4),
            "position_camera_m": _xyz(c.tvec),
            "distance_m": _r(c.distance_m),
            "rotation_tag_to_camera": {
                "rvec": [_r(v, 6) for v in c.rvec],
                "matrix": [[_r(v, 6) for v in row] for row in c.R],
                "quaternion_wxyz": [_r(v, 6) for v in q],
                "euler_xyz_deg": [_r(v, 2) for v in euler_xyz_deg(c.R)],
                "tilt_deg": _r(tag_tilt_deg(c.R), 2),
            },
            "camera_in_tag_m": _xyz(p.camera_in_tag_m),
            "reprojection_error_px": _r(c.reproj_px, 3),
            "pnp": {
                "solutions": len(p.candidates),
                "ambiguity_ratio": p.ambiguity_ratio,
                "resolved_by_prior": p.resolved_by_prior,
                "alternative": None
                if p.alternative is None
                else {"reprojection_error_px": _r(p.alternative.reproj_px, 3), "distance_m": _r(p.alternative.distance_m), "valid": p.alternative.valid},
            },
        }
    )
    if u.smoothed_position is not None:
        Rs = quat_to_rotmat(u.smoothed_q)
        m["smoothed"] = {
            "position_camera_m": _xyz(u.smoothed_position),
            "distance_m": _r(float(np.linalg.norm(u.smoothed_position))),
            "quaternion_wxyz": [_r(v, 6) for v in u.smoothed_q],
            "euler_xyz_deg": [_r(v, 2) for v in euler_xyz_deg(Rs)],
        }
    else:
        m["smoothed"] = None
    m["stability"] = tr.stability(stability_window)
    return m


def to_json(m: dict) -> str:
    return json.dumps(m, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
