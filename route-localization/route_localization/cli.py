"""Командная строка.

  route-localization run --config /etc/scada-route/localizer.json
  route-localization check --config cfg.json --image frame.png     # один кадр: что видно и какая поза
  route-localization calibrate --images 'calib/*.png' --cols 9 --rows 6 --square 0.025 \
        --serial DA1234567 --lens 'MVL-HF0628M-6MP' --extr '{"x":0.4,"y":0,"z":2.1}' --out calib.json
  route-localization simulate --out frames/          # синтетические кадры для стенда
"""
from __future__ import annotations

import argparse
import json
import logging
import sys


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="route-localization")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--config", required=True)
    r.add_argument("--verbose", action="store_true")
    c = sub.add_parser("check")
    c.add_argument("--config", required=True)
    c.add_argument("--image", required=True)
    k = sub.add_parser("calibrate")
    k.add_argument("--images", required=True)
    k.add_argument("--cols", type=int, required=True)
    k.add_argument("--rows", type=int, required=True)
    k.add_argument("--square", type=float, required=True)
    k.add_argument("--serial", required=True)
    k.add_argument("--lens", required=True)
    k.add_argument("--extr", required=True, help='положение камеры на корпусе, JSON {"x":..,"y":..,"z":..,"yawDeg":..}')
    k.add_argument("--out", required=True)
    s = sub.add_parser("simulate")
    s.add_argument("--out", required=True)
    s.add_argument("--frames", type=int, default=20)
    a = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if getattr(a, "verbose", False) else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if a.cmd == "run":
        from .service import LocalizationService, ServiceConfig

        LocalizationService(ServiceConfig.load(a.config)).run()
        return 0
    if a.cmd == "check":
        import cv2

        from .service import LocalizationService, ServiceConfig

        cfg = ServiceConfig.load(a.config)
        cfg.camera = {"kind": "folder", "pattern": a.image, "fps": 0}
        svc = LocalizationService(cfg)
        svc.reload()
        img = cv2.imread(a.image, cv2.IMREAD_GRAYSCALE)
        dets = [d for det in svc.detectors for d in det.detect(img)]
        print(f"меток в кадре: {[d.tag_id for d in dets]}")
        est = svc.estimator.estimate(dets) if dets else None
        print(json.dumps(est.__dict__ if est else {"pose": None}, ensure_ascii=False, indent=2, default=str))
        svc.publisher.stop()
        return 0
    if a.cmd == "calibrate":
        from .calibrate import calibrate_chessboard, write_calibration

        data = calibrate_chessboard(a.images, a.cols, a.rows, a.square)
        out = write_calibration(a.out, data, a.serial, a.lens, json.loads(a.extr))
        print(f"RMS {out['rmsPx']} px по {out['frames']} снимкам → {a.out}")
        if out["rmsPx"] > 0.8:
            print("ВНИМАНИЕ: RMS > 0.8 px — переснимите доску (резкость, охват углов кадра)", file=sys.stderr)
        return 0
    if a.cmd == "simulate":
        import os

        import cv2

        from .geometry import PlanFrame
        from .synthetic import ceiling_grid, default_calibration, render

        mpu = 0.8 / 12
        os.makedirs(a.out, exist_ok=True)
        markers = ceiling_grid(mpu, 1930, 830, 7, 7, 1.5)
        calib = default_calibration()
        for i in range(a.frames):
            x, y, h = 1960 + i * 3.0, 880 + i * 1.0, 15.0
            cv2.imwrite(f"{a.out}/frame_{i:04d}.png", render(PlanFrame(mpu), markers, calib, x, y, h, seed=i))
        with open(f"{a.out}/markers.json", "w", encoding="utf-8") as f:
            json.dump([m.__dict__ for m in markers], f, ensure_ascii=False)
        print(f"{a.frames} кадров → {a.out}")
        return 0
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
