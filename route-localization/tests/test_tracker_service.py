"""Фильтр, потеря меток и отправка позиции в Route (на локальном HTTP-сервере)."""
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np

from route_localization.geometry import PlanFrame
from route_localization.server import Publisher, RouteClient
from route_localization.service import LocalizationService, ServiceConfig
from route_localization.synthetic import ceiling_grid, default_calibration, render
from route_localization.tracker import PoseTracker, TrackerConfig

MPU = 0.8 / 12


def test_tracker_smooths_and_rejects_jump():
    tr = PoseTracker(TrackerConfig(meters_per_unit=MPU))
    t = 100.0
    rng = np.random.default_rng(1)
    for i in range(20):
        out = tr.update(t + i * 0.2, 2000 + i * 3 + rng.normal(0, 0.5), 900 + rng.normal(0, 0.5), 0.0, 0.9)
        assert out and out.state == "ok"
    # ложный скачок на 20 м — отброшен, позиция не прыгает
    assert tr.update(t + 4.2, 2300, 900, 0.0, 0.9) is None
    out = tr.update(t + 4.4, 2000 + 22 * 3, 900, 0.0, 0.9)
    assert out and abs(out.x - 2066) < 3


def test_tracker_relocalizes_on_consistent_new_place():
    tr = PoseTracker(TrackerConfig(meters_per_unit=MPU, relocalize_after=3))
    tr.update(0.0, 1000, 1000, 0, 0.9)
    tr.update(0.2, 1000, 1000, 0, 0.9)
    assert tr.update(0.4, 1500, 1000, 0, 0.9) is None
    assert tr.update(0.6, 1500, 1000, 0, 0.9) is None
    out = tr.update(0.8, 1500, 1000, 0, 0.9)
    assert out and abs(out.x - 1500) < 1


def test_tracker_loss_keeps_last_point_then_lost():
    tr = PoseTracker(TrackerConfig(meters_per_unit=MPU, lost_after_s=3.0, predict_max_s=1.5))
    tr.update(0.0, 2000, 900, 90.0, 0.9)
    assert tr.tick(1.0) is None  # без одометрии не прогнозируем
    lost = tr.tick(3.1)
    assert lost and lost.state == "lost" and lost.quality == 0 and abs(lost.x - 2000) < 1e-6
    assert tr.tick(3.5) is None  # о потере сообщаем один раз


def test_tracker_predicts_with_odometry_short_time_only():
    tr = PoseTracker(TrackerConfig(meters_per_unit=MPU, lost_after_s=3.0, predict_max_s=1.5))
    tr.update(0.0, 2000, 900, 90.0, 0.9)  # курс 90° = вниз по плану (+y)
    p = tr.tick(0.5, (1.0, 0.0, 0.0))  # 1 м вперёд
    assert p and p.state == "predicted"
    assert abs(p.y - (900 + 1.0 / MPU)) < 0.5 and abs(p.x - 2000) < 0.5
    assert tr.tick(2.0, (1.0, 0.0, 0.0)) is None  # дольше predict_max_s — не прогнозируем


class _Sink(BaseHTTPRequestHandler):
    got: list = []

    def do_GET(self):  # конфигурация локализатора
        mk = ceiling_grid(MPU, 1930, 830, 7, 7, 1.5)
        cal = default_calibration()
        body = {
            "karaId": "kara-1",
            "coord": {"metersPerUnit": MPU},
            "markers": [{"family": m.family, "tagId": m.tag_id, "x": m.x, "y": m.y, "mountHeightM": m.z_m, "sizeM": m.size_m, "yawDeg": m.yaw_deg, "active": True} for m in mk],
            "calibration": {"cameraMatrix": cal.K.tolist(), "distCoeffs": cal.dist.tolist(), "width": cal.width, "height": cal.height, "cameraToForklift": cal.camera_to_forklift, "version": 1, "cameraSerial": "SIM"},
        }
        assert self.headers["authorization"] == "Bearer rdev_test"
        self._send(body)

    def do_POST(self):
        n = int(self.headers["content-length"])
        _Sink.got.append((self.path, json.loads(self.rfile.read(n))))
        self._send({"accepted": True})

    def _send(self, body):
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


def test_service_end_to_end_with_route_api(tmp_path):
    srv = HTTPServer(("127.0.0.1", 0), _Sink)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    frames = tmp_path / "frames"
    frames.mkdir()
    import cv2

    mk = ceiling_grid(MPU, 1930, 830, 7, 7, 1.5)
    cal = default_calibration()
    truth = []
    for i in range(6):
        x, y, h = 1990 + i * 4.0, 900.0, 20.0
        truth.append((x, y, h))
        cv2.imwrite(str(frames / f"f{i:02d}.png"), render(PlanFrame(MPU), mk, cal, x, y, h, seed=i))
    cfgp = tmp_path / "cfg.json"
    cfgp.write_text(
        json.dumps(
            {
                "serverUrl": f"http://127.0.0.1:{srv.server_port}",
                "deviceToken": "rdev_test",
                "siteCode": "skeet",
                "karaId": "kara-1",
                "camera": {"kind": "folder", "pattern": str(frames / "*.png"), "fps": 0, "serial": "SIM"},
                "maxHz": 1000,
            }
        )
    )
    svc = LocalizationService(ServiceConfig.load(str(cfgp)))
    svc.reload()
    t0 = time.time()
    for i, (img, _) in enumerate(svc.source.frames()):
        est = svc.step(img, t0 + i * 0.25)
        assert est is not None
        time.sleep(0.05)
    # кадр без меток → через lostAfterS сообщение о потере
    svc.step(np.full((cal.height, cal.width), 120, np.uint8), t0 + 10)
    time.sleep(0.5)
    svc.publisher.stop()
    srv.shutdown()
    posts = [b for p, b in _Sink.got if p.startswith("/api/route/forklifts/kara-1/position")]
    assert posts, "позиции отправлены в Route"
    ok = [b for b in posts if b["state"] == "ok"]
    last = ok[-1]
    assert abs(last["x"] - truth[-1][0]) < 2.5 and abs(last["y"] - truth[-1][1]) < 2.5, last
    assert last["source"] == "apriltag" and last["tagIds"]
    assert posts[-1]["state"] == "lost"
    assert "siteCode=skeet" in _Sink.got[-1][0]


def test_publisher_keeps_only_latest(monkeypatch):
    sent = []

    class C(RouteClient):
        def send(self, out, tag_ids=None, reproj=None):
            time.sleep(0.05)
            sent.append(out.x)
            return {"accepted": True}

    from route_localization.tracker import TrackOutput

    p = Publisher(C("http://x", "t", "s", "k"), max_hz=1000)
    for i in range(50):
        p.offer(TrackOutput(float(i), 0.0, 0.0, 0.9, "ok", time.time()))
    time.sleep(0.4)
    p.stop()
    assert sent[-1] == 49.0 and len(sent) < 50
