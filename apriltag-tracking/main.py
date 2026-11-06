# -*- coding: utf-8 -*-
"""Точка входа: Hikrobot MV-CU013-A0GM + AprilTag — распознавание, положение, измерения в JSON.

Примеры (Windows):
  py main.py --calibration calibration.json --save-jsonl measurements.jsonl            # Live Mode
  py main.py --image frame.png --calibration calibration.json                           # Image Mode
  py main.py --video test.avi --calibration calibration.json --no-window --save-jsonl out.jsonl
  py main.py --mode calibration --calibration calibration.json --image frame.png        # Calibration Mode
Справка: py main.py --help
"""
import sys

from apriltag_tracking.cli import main

if __name__ == "__main__":
    sys.exit(main())
