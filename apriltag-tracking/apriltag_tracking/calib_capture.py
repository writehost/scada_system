"""Съёмка шахматной доски для калибровки с подсказками в реальном времени.

На каждом кадре ищется доска (на уменьшенном кадре — быстро). В окне сразу видно:
доска найдена (зелёные углы) или нет (красная надпись и причина: пересвет, темно, нерезко).
Кадр сохраняется автоматически, когда доска найдена, неподвижна (2 кадра подряд почти на месте)
и стоит заметно иначе, чем на уже сохранённых снимках. По достижении нужного числа снимков
сразу выполняется калибровка.
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)


def find_board_fast(gray: np.ndarray, cols: int, rows: int):
    """Поиск доски на половинном кадре; углы возвращаются в координатах полного кадра."""
    small = cv2.resize(gray, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA)
    ok, corners = cv2.findChessboardCornersSB(small, (cols, rows), 0)
    if not ok:
        return None
    return corners.reshape(-1, 2) * 2.0


def exposure_hint(gray: np.ndarray) -> tuple[str | None, float]:
    over = float((gray >= 250).mean()) * 100
    mean = float(gray.mean())
    if over > 5:
        return f"overexposed {over:.0f}% -> lower --exposure-us / remove glare", over
    if mean < 40:
        return "too dark -> raise --exposure-us", over
    return None, over


def pose_signature(pts: np.ndarray, cols: int, rows: int, w: int, h: int) -> np.ndarray:
    """Положение доски в кадре: 4 внешних угла, нормированные на размер кадра."""
    g = pts.reshape(rows, cols, 2)
    outer = np.array([g[0, 0], g[0, -1], g[-1, -1], g[-1, 0]], dtype=np.float64)
    return (outer / np.array([w, h])).ravel()


class CalibCapture:
    def __init__(self, cols: int, rows: int, out_dir: Path, target: int = 20, min_diff: float = 0.06, still_px: float = 3.0):
        self.cols, self.rows = cols, rows
        self.out_dir = out_dir
        self.target = target
        self.min_diff = min_diff
        self.still_px = still_px
        self.saved: list[Path] = []
        self.sigs: list[np.ndarray] = []
        self.prev = None
        self.coverage = np.zeros((3, 3), dtype=int)
        self.last_status = ""

    def process(self, gray: np.ndarray, save: bool = True, force: bool = False):
        """Возвращает (углы или None, статус-строка, сохранённый файл или None)."""
        h, w = gray.shape
        hint, _ = exposure_hint(gray)
        pts = find_board_fast(gray, self.cols, self.rows)
        if pts is None:
            self.prev = None
            return None, "board NOT found" + (f": {hint}" if hint else " (whole board in frame? flat? no glare?)"), None
        still = self.prev is not None and float(np.mean(np.linalg.norm(pts - self.prev, axis=1))) < self.still_px
        self.prev = pts
        sig = pose_signature(pts, self.cols, self.rows, w, h)
        diff = min((float(np.max(np.abs(sig - s))) for s in self.sigs), default=1.0)
        if not still and not force:
            return pts, "board found - hold still", None
        if diff < self.min_diff and not force:
            return pts, "already have this view - move/tilt the board", None
        if not save:
            return pts, "board found", None
        self.out_dir.mkdir(parents=True, exist_ok=True)
        f = self.out_dir / f"calib_{len(self.saved) + 1:02d}_{time.strftime('%H%M%S')}.png"
        cv2.imwrite(str(f), gray)
        self.saved.append(f)
        self.sigs.append(sig)
        c = pts.mean(axis=0)
        self.coverage[min(2, int(3 * c[1] / h)), min(2, int(3 * c[0] / w))] += 1
        self.prev = None
        return pts, f"SAVED {len(self.saved)}/{self.target}", f

    def hint_next(self) -> str:
        names = [["top-left", "top", "top-right"], ["left", "center", "right"], ["bottom-left", "bottom", "bottom-right"]]
        empty = [names[r][c] for r in range(3) for c in range(3) if self.coverage[r, c] == 0]
        return ("next: put board " + ", ".join(empty[:3])) if empty else "next: tilt board 30-40 deg, nearer/farther"

    def draw(self, gray: np.ndarray, pts, status: str) -> np.ndarray:
        vis = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
        h, w = gray.shape
        over = gray >= 250
        vis[over] = (0.5 * vis[over] + np.array([0, 0, 127])).astype(np.uint8)  # пересвет подкрашен красным
        if pts is not None:
            cv2.drawChessboardCorners(vis, (self.cols, self.rows), pts.reshape(-1, 1, 2).astype(np.float32), True)
        for r in range(3):
            for c in range(3):
                x0, y0 = c * w // 3, r * h // 3
                col = (0, 200, 0) if self.coverage[r, c] else (90, 90, 90)
                cv2.rectangle(vis, (x0 + 4, y0 + 4), (x0 + w // 3 - 4, y0 + h // 3 - 4), col, 1)
        color = (0, 220, 0) if pts is not None and ("SAVED" in status or status == "board found") else (0, 0, 255) if pts is None else (0, 200, 255)
        cv2.rectangle(vis, (0, 0), (w, 92), (0, 0, 0), -1)
        cv2.putText(vis, status, (12, 36), cv2.FONT_HERSHEY_SIMPLEX, 1.0, color, 2)
        cv2.putText(vis, f"saved {len(self.saved)}/{self.target}   {self.hint_next()}   [SPACE save, Q finish]", (12, 76),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
        return vis


def run_calib_capture(args, source, cols: int, rows: int) -> list[Path]:
    """Цикл съёмки. Возвращает список сохранённых снимков."""
    out_dir = Path(args.save_dir) / "calib" / time.strftime("%Y%m%d_%H%M%S")
    cap = CalibCapture(cols, rows, out_dir, target=args.calib_frames)
    window = not args.no_window
    print(f"Съёмка доски {cols}×{rows} внутренних углов → {out_dir}. Нужно {args.calib_frames} снимков.")
    print("Держите доску неподвижно — снимок сохранится сам. Красное в окне = пересвет. Q — закончить.")
    last_print = ""
    for frame in source.frames():
        if frame.image is None:
            continue
        pts, status, saved = cap.process(frame.image)
        if window:
            cv2.imshow("Calibration capture", cap.draw(frame.image, pts, status))
            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), 27):
                break
            if key == ord(" ") and pts is not None and saved is None:
                pts, status, saved = cap.process(frame.image, force=True)
        if saved is not None:
            print(f"  {status}: {saved.name}  ({cap.hint_next()})")
        elif status != last_print and not window:
            print(f"  {status}")
        last_print = status
        if len(cap.saved) >= cap.target:
            print("Снимков достаточно.")
            break
    if window:
        try:
            cv2.destroyWindow("Calibration capture")
        except cv2.error:
            pass
    return cap.saved
