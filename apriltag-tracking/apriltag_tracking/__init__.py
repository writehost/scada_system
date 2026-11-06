# -*- coding: utf-8 -*-
"""AprilTag Tracking для Hikrobot MVS: распознавание меток, положение метки относительно камеры, измерения в JSON.

Программный интерфейс:
    from apriltag_tracking import TrackingSession
    s = TrackingSession.from_cli(["--ip", "169.254.19.203", "--calibration", "calibration.json"]).start()
    s.hub.on_tag_detected(lambda m: print(m["tag_id"], m["status"]))
    print(s.latest("tag16h5:3"))
    s.stop()
"""
__version__ = "2.0.0"

from .app import Pipeline, PipelineConfig, TrackingSession  # noqa: E402,F401
from .export import MeasurementHub, latest_from_jsonl, read_jsonl  # noqa: E402,F401
