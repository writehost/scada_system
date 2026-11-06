# -*- coding: utf-8 -*-
"""JSON измерения, JSONL, программный интерфейс, неблокирующая выдача."""
import json
import socket
import threading
import time

import numpy as np

from apriltag_tracking.app import Pipeline, PipelineConfig
from apriltag_tracking.calibration import Calibration
from apriltag_tracking.capture import Frame
from apriltag_tracking.export import JsonlWriter, MeasurementHub, UdpSender, latest_from_jsonl, read_jsonl
from apriltag_tracking.measurement import SourceInfo, to_json
from synthetic import H, K, W, facing_pose, render

CAL = Calibration(K, np.zeros(5), W, H, True, 0.1, source="test")
REQUIRED = {
    "camera_id": str, "camera_ip": (str, type(None)), "timestamp": str, "frame_id": int, "family": str, "tag_id": int,
    "status": str, "center_px": list, "hamming": int, "decision_margin": (float, type(None)), "position_camera_m": dict,
    "distance_m": float, "reprojection_error_px": float, "calibration_valid": bool,
}


def make_pipe(hub=None, cal=CAL):
    return Pipeline(PipelineConfig(), cal, SourceInfo("MV-CU013-A0GM", "169.254.19.203", "live", ""), hub)


def frames(n, d=0.5, start=1, t0=0.0):
    R, t = facing_pose(d, 10, -5, 15, (0.02, -0.01))
    img, _ = render([("tag16h5", 3, 0.1, R, t)])
    return [Frame(img, start + i, t0 + i * 0.14, 1_793_779_200.0 + i * 0.14) for i in range(n)], t


def test_measurement_json_schema():
    pipe = make_pipe()
    fr, t = frames(1)
    m = pipe.process(fr[0]).measurements[0]
    s = to_json(m)  # allow_nan=False: NaN/Inf в JSON не попадут
    back = json.loads(s)
    for k, typ in REQUIRED.items():
        assert k in back and isinstance(back[k], typ), (k, back.get(k))
    assert back["camera_id"] == "MV-CU013-A0GM" and back["camera_ip"] == "169.254.19.203"
    assert back["timestamp"].endswith("Z") and back["timestamp"] == "2026-11-04T08:00:00.000Z"
    assert back["event"] == "detected" and back["status"] == "POSE_VALID" and back["pose_valid"] is True
    assert set(back["position_camera_m"]) == {"x", "y", "z"}
    assert abs(back["distance_m"] - float(np.linalg.norm(t))) < 0.005
    assert back["forklift_pose"] is None and back["forklift_pose_reason"]
    assert len(back["rotation_tag_to_camera"]["quaternion_wxyz"]) == 4
    assert back["camera_in_tag_m"]["z"] > 0  # камера перед лицевой стороной метки


def test_no_calibration_measurement_has_pixels_only():
    pipe = make_pipe(cal=None)
    fr, _ = frames(1)
    m = pipe.process(fr[0]).measurements[0]
    assert m["status"] == "NO_CALIBRATION" and m["position_camera_m"] is None and m["distance_m"] is None
    assert m["center_px"] and m["pose_valid"] is False
    json.loads(to_json(m))


def test_lost_measurement_has_no_stale_coordinates():
    pipe = make_pipe()
    fr, _ = frames(2)
    pipe.process(fr[0])
    r = pipe.process(Frame(None, 10, 5.0, 1_793_779_205.0))
    assert [m["event"] for m in r.measurements] == ["lost"]
    m = r.measurements[0]
    assert m["status"] == "LOST" and m["position_camera_m"] is None and m["distance_m"] is None
    assert pipe.current["tag16h5:3"]["status"] == "LOST"


def test_jsonl_hub_callbacks_and_latest(tmp_path):
    hub = MeasurementHub()
    path = tmp_path / "m.jsonl"
    hub.subscribe(JsonlWriter(path))
    detected, lost = [], []
    hub.on_tag_detected(detected.append)
    hub.on_tag_lost(lost.append)
    pipe = make_pipe(hub)
    fr, _ = frames(6)
    for f in fr:
        pipe.process(f)
    latest = hub.latest("tag16h5:3")
    assert latest["frame_id"] == 6 and latest["pose_valid"]
    assert hub.latest("tag16h5:3", only_valid=True) is not None
    assert json.loads(hub.latest_json())[0]["tag_id"] == 3
    pipe.process(Frame(None, 7, 5.0, 1_793_779_205.0))
    hub.close()
    rows = read_jsonl(path)
    assert [r["event"] for r in rows] == ["detected"] + ["update"] * 5 + ["lost"]
    assert len(detected) == 1 and len(lost) == 1  # одна метка не «появляется» каждый кадр
    assert latest_from_jsonl(path)["tag16h5:3"]["event"] == "lost"


def test_slow_consumer_does_not_block_processing():
    hub = MeasurementHub(max_queue=50)
    hub.on_measurement(lambda m: time.sleep(0.05))
    items = [{"family": "tag16h5", "tag_id": 3, "event": "update", "frame_id": i} for i in range(500)]
    t0 = time.perf_counter()
    for m in items:
        hub.publish([m])
    assert time.perf_counter() - t0 < 0.5
    assert hub.dropped > 0 and hub.latest("tag16h5:3")["frame_id"] == 499
    hub.close(timeout=0.1)


def test_bad_callback_does_not_break_hub():
    hub = MeasurementHub()
    got = []

    def bad(m):
        raise RuntimeError("ошибка потребителя")

    hub.on_measurement(bad)
    hub.on_measurement(got.append)
    hub.publish([{"family": "tag16h5", "tag_id": 3, "event": "detected"}])
    hub.close()
    assert len(got) == 1


def test_udp_sender_sends_json():
    rx = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    rx.bind(("127.0.0.1", 0))
    rx.settimeout(2)
    hub = MeasurementHub()
    hub.subscribe(UdpSender("127.0.0.1", rx.getsockname()[1]))
    pipe = make_pipe(hub)
    fr, _ = frames(1)
    pipe.process(fr[0])
    data, _ = rx.recvfrom(65535)
    hub.close()
    m = json.loads(data.decode("utf-8"))
    assert m["tag_id"] == 3 and m["status"] == "POSE_VALID"
    rx.close()


def test_tracking_session_api():
    from apriltag_tracking.app import TrackingSession

    class Src:
        camera_id, ip = "fake", None

        def __init__(self):
            self.released = 0

        def frames(self):
            fr, _ = frames(20)
            for f in fr:
                time.sleep(0.01)
                yield f

        def release(self):
            self.released += 1

    src = Src()
    s = TrackingSession(make_pipe(), src)
    seen = threading.Event()
    s.hub.on_tag_detected(lambda m: seen.set())
    s.start()
    assert seen.wait(3)
    time.sleep(0.3)
    m = s.latest("tag16h5:3")
    s.stop()
    assert m and m["pose_valid"] and src.released >= 1 and s.error is None
