# -*- coding: utf-8 -*-
"""Сопровождение меток между кадрами: события, сглаживание, отсев скачков, потеря.

События (поле `event` в измерении):
  detected — метка появилась (впервые или после потери);
  update   — новое измерение уже сопровождаемой метки;
  lost     — метки нет дольше lost_timeout_s (по времени кадров; срабатывает и когда кадры не приходят).

Сглаживание
  * X, Y, Z — экспоненциальное (alpha), только по достоверным измерениям (POSE_VALID);
  * ориентация — сферическая интерполяция кватернионов (без скачков на ±180°);
  * скачок больше max_jump_m относительно сглаженного положения отбрасывается, кроме случая, когда
    несколько подряд «скачков» согласованы между собой — это реальное перемещение, фильтр сбрасывается
    на новое положение (реальное движение не прячется);
  * после потери метки (LOST) сглаживание начинается заново: пока метки не было видно, её могли переставить;
    после паузы дольше reset_after_s заводится новый трек.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np

from .detection import TagDetection
from .pose import NO_CALIBRATION, POSE_UNCERTAIN, POSE_VALID, PoseResult, quat_slerp, quat_to_rotmat, rotmat_to_quat

DETECTED = "DETECTED"
LOST = "LOST"


@dataclass
class TrackerConfig:
    alpha: float = 0.5
    max_jump_m: float = 0.10
    jump_confirm_frames: int = 3
    lost_timeout_s: float = 0.6
    reset_after_s: float = 2.0
    history: int = 200
    stability_window: int = 30


@dataclass
class ValidSample:
    frame_id: int
    t: float
    position: np.ndarray
    distance: float
    reproj_px: float


@dataclass
class TagTrack:
    key: str
    family: str
    tag_id: int
    first_seen_t: float
    first_frame: int
    last_seen_t: float
    last_frame: int
    state: str = DETECTED
    frames_seen: int = 0
    smooth_pos: np.ndarray | None = None
    smooth_q: np.ndarray | None = None
    last_valid_t: float | None = None
    outliers: list[np.ndarray] = field(default_factory=list)
    history: deque = field(default_factory=lambda: deque(maxlen=200))
    last_detection: TagDetection | None = None
    jumps_rejected: int = 0

    def prior_R(self, t: float, reset_after_s: float) -> np.ndarray | None:
        if self.smooth_q is None or self.last_valid_t is None or t - self.last_valid_t > reset_after_s:
            return None
        return quat_to_rotmat(self.smooth_q)

    def stability(self, window: int) -> dict | None:
        pts = list(self.history)[-window:]
        if len(pts) < 2:
            return None
        P = np.array([p.position for p in pts])
        D = np.array([p.distance for p in pts])
        return {
            "samples": len(pts),
            "std_mm": {k: round(float(v) * 1000, 2) for k, v in zip("xyz", P.std(axis=0))},
            "distance_std_mm": round(float(D.std()) * 1000, 2),
            "distance_range_mm": round(float(D.max() - D.min()) * 1000, 2),
        }


@dataclass
class TrackUpdate:
    event: str  # detected | update | lost
    track: TagTrack
    detection: TagDetection | None
    pose: PoseResult | None
    status: str
    reasons: list[str]
    codes: list[str]
    smoothed_position: np.ndarray | None
    smoothed_q: np.ndarray | None
    frame_id: int
    t: float


class Tracker:
    def __init__(self, cfg: TrackerConfig | None = None):
        self.cfg = cfg or TrackerConfig()
        self.tracks: dict[str, TagTrack] = {}

    def prior_for(self, key: str, t: float) -> np.ndarray | None:
        tr = self.tracks.get(key)
        return tr.prior_R(t, self.cfg.reset_after_s) if tr and tr.state != LOST else None

    def update(self, frame_id: int, t: float, items: list[tuple[TagDetection, PoseResult | None]]) -> list[TrackUpdate]:
        out: list[TrackUpdate] = []
        seen = set()
        for det, pose in items:
            seen.add(det.key)
            tr = self.tracks.get(det.key)
            event = "update"
            if tr is None or tr.state == LOST:
                event = "detected"
                if tr is None or t - tr.last_seen_t > self.cfg.reset_after_s:
                    tr = TagTrack(det.key, det.family, det.tag_id, t, frame_id, t, frame_id)
                    tr.history = deque(maxlen=self.cfg.history)
                    self.tracks[det.key] = tr
                else:
                    # метку могли переставить, пока её не было видно: сглаживание и отсев скачков — заново
                    tr.smooth_pos, tr.smooth_q = None, None
                    tr.outliers.clear()
                tr.state = DETECTED
            tr.last_seen_t, tr.last_frame = t, frame_id
            tr.frames_seen += 1
            tr.last_detection = det
            status, reasons, codes = self._apply_pose(tr, pose, t, frame_id)
            tr.state = status
            out.append(TrackUpdate(event, tr, det, pose, status, reasons, codes, None if tr.smooth_pos is None else tr.smooth_pos.copy(),
                                   None if tr.smooth_q is None else tr.smooth_q.copy(), frame_id, t))
        out.extend(self.tick(frame_id, t, exclude=seen))
        return out

    def tick(self, frame_id: int, t: float, exclude: set | None = None) -> list[TrackUpdate]:
        """Вызывать и когда кадров нет (таймаут камеры): метки переходят в LOST по времени."""
        out = []
        for key, tr in self.tracks.items():
            if exclude and key in exclude:
                continue
            if tr.state != LOST and t - tr.last_seen_t > self.cfg.lost_timeout_s:
                tr.state = LOST
                tr.outliers.clear()
                out.append(TrackUpdate("lost", tr, None, None, LOST, [f"нет в кадре {t - tr.last_seen_t:.2f} с"], ["lost"], None, None, frame_id, t))
        return out

    def _apply_pose(self, tr: TagTrack, pose: PoseResult | None, t: float, frame_id: int) -> tuple[str, list[str], list[str]]:
        if pose is None:
            return NO_CALIBRATION, [], ["no_calibration"]
        reasons = list(pose.reasons)
        codes = list(pose.codes)
        if not pose.has_pose:
            return POSE_UNCERTAIN, reasons, codes
        if tr.last_valid_t is not None and t - tr.last_valid_t > self.cfg.reset_after_s:
            tr.smooth_pos, tr.smooth_q = None, None
        if pose.status != POSE_VALID:
            return POSE_UNCERTAIN, reasons, codes
        pos = pose.position_camera_m
        q = rotmat_to_quat(pose.chosen.R)
        a = self.cfg.alpha
        if tr.smooth_pos is None:
            tr.smooth_pos, tr.smooth_q = pos.copy(), q
            tr.outliers.clear()
        else:
            jump = float(np.linalg.norm(pos - tr.smooth_pos))
            if jump > self.cfg.max_jump_m:
                tr.outliers.append(pos.copy())
                n = self.cfg.jump_confirm_frames
                recent = tr.outliers[-n:]
                consistent = len(recent) >= n and float(np.max(np.linalg.norm(np.array(recent) - np.mean(recent, axis=0), axis=1))) < self.cfg.max_jump_m / 2
                if consistent:  # метка действительно переместилась
                    tr.smooth_pos, tr.smooth_q = pos.copy(), q
                    tr.outliers.clear()
                    reasons.append("резкое перемещение подтверждено несколькими кадрами — фильтр сброшен")
                    codes.append("jump_confirmed")
                else:
                    tr.jumps_rejected += 1
                    return (
                        POSE_UNCERTAIN,
                        reasons + [f"скачок {jump * 100:.1f} см > {self.cfg.max_jump_m * 100:.1f} см отброшен"],
                        codes + ["jump_rejected"],
                    )
            else:
                tr.outliers.clear()
                tr.smooth_pos = a * pos + (1 - a) * tr.smooth_pos
                tr.smooth_q = quat_slerp(tr.smooth_q, q, a)
        tr.last_valid_t = t
        tr.history.append(ValidSample(frame_id, t, pos.copy(), float(np.linalg.norm(pos)), float(pose.reproj_px)))
        return POSE_VALID, reasons, codes
