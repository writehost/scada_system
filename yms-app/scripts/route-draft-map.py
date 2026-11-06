#!/usr/bin/env python3
"""
Черновик топологии проездов склада ГП из реального плана.

Вход:
  - data/route/fg-plan-rows.json — ряды плана WMS (координаты hotspots на плане 3503×2562);
  - public/warehouse-plan/fg/warehouse-plan-screen.png — сам план (стены = чёрные линии).

Что делает:
  1. Строит маску препятствий: стеллажи (с отступом), чёрные линии плана (стены, колонны),
     всё вне контура здания.
  2. Скелетизирует свободное пространство — получаются осевые линии реальных проездов.
  3. Превращает скелет в граф (узлы на перекрёстках и изломах), выкидывает короткие «усы».
  4. Для каждого ряда ставит узел доступа у торца ряда, выходящего в проезд,
     и короткий подъезд к ближайшему проезду. Подъезд проверяется по маске.
  5. Привязывает адрес WMS FG-<ряд> к узлу доступа.

Результат — ЧЕРНОВИК (status=draft). Его нужно проверить в редакторе карты по факту
и опубликовать вручную. Никакой автоматической публикации.

Запуск:  python3 scripts/route-draft-map.py [--out data/route/fg-map-draft.json] [--preview out.png]
"""
from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.morphology import skeletonize

HERE = Path(__file__).resolve().parent.parent
REPO = HERE.parent

PLAN_W, PLAN_H = 3503, 2562
METERS_PER_PX = 0.8 / 12  # 12 px плана = ширина евро-палеты 0,8 м (ряд A: 26 мест на 312 px)
SCALE = 2  # работаем на половинном разрешении

# Контур здания (план-пиксели): основной корпус, крыло F, помещение M.
# Сняты с плана; всё вне — не проезд для погрузчика склада.
FOOTPRINT = [
    (80, 80, 3378, 1401),
    (1902, 1390, 2277, 2562),
    (1584, 1390, 1811, 1822),
]

ARROWS = None
DOORS: list = []
RACK_CLEARANCE_PX = 8  # ≈0,5 м отступа от стеллажа
ACCESS_OFFSET_PX = 10  # узел доступа — в 10 px от торца ряда
SPUR_MAX_PX = 90
MIN_SPUR_PX = 30  # короче — «ус» скелета


def load_rows():
    data = json.loads((HERE / "data/route/fg-plan-rows.json").read_text("utf8"))
    racks = []
    for row in data["rows"]:
        for i, hs in enumerate(row.get("hotspots") or []):
            racks.append(
                {
                    "id": row["id"] if i == 0 else f"{row['id']}#{i}",
                    "rowId": row["id"],
                    "zone": row["zone"],
                    "x": hs["x"],
                    "y": hs["y"],
                    "w": hs["width"],
                    "h": hs["height"],
                }
            )
    return racks


def obstacle_mask(racks):
    img = Image.open(REPO / "public/warehouse-plan/fg/warehouse-plan-screen.png").convert("RGB")
    a = np.asarray(img).astype(np.int16)
    dark = (a[:, :, 0] < 90) & (a[:, :, 1] < 90) & (a[:, :, 2] < 90)
    global ARROWS
    # синие стрелки направления движения — на плане ими отмечены проёмы и ворота
    r_, g_, b_ = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    ARROWS = (abs(r_ - 68) <= 40) & (abs(g_ - 114) <= 40) & (abs(b_ - 196) <= 40) & (b_ - g_ >= 55) & (g_ - r_ >= 25)
    inside = np.zeros((PLAN_H, PLAN_W), bool)
    for x0, y0, x1, y1 in FOOTPRINT:
        inside[y0:y1, x0:x1] = True
    rack = np.zeros((PLAN_H, PLAN_W), bool)
    for r in racks:
        c = RACK_CLEARANCE_PX
        rack[max(0, r["y"] - c) : r["y"] + r["h"] + c, max(0, r["x"] - c) : r["x"] + r["w"] + c] = True
    # Проёмы: синие стрелки движения на плане стоят у дверей и ворот. В рамке пары стрелок
    # стену «прорезаем», чтобы скелет прошёл через проём. Стеллажи остаются препятствием.
    global DOORS
    DOORS = []
    rack_pad = np.zeros((PLAN_H, PLAN_W), bool)
    for r in racks:
        rack_pad[max(0, r["y"] - 5) : r["y"] + r["h"] + 5, max(0, r["x"] - 5) : r["x"] + r["w"] + 5] = True
    wall_only = dark & ~rack_pad
    lab, n = ndimage.label(ndimage.binary_dilation(ARROWS, iterations=6))
    for sl in ndimage.find_objects(lab):
        if sl is None:
            continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if (y1 - y0) * (x1 - x0) < 300:
            continue
        pad = 6
        box = (max(0, x0 - pad), max(0, y0 - pad), min(PLAN_W, x1 + pad), min(PLAN_H, y1 + pad))
        sub = wall_only[box[1] : box[3], box[0] : box[2]]
        # стена проходит через рамку стрелок насквозь — значит это проём в стене
        if not (sub.mean(axis=0).max() > 0.7 or sub.mean(axis=1).max() > 0.7):
            continue
        DOORS.append(box)
        dark = dark.copy() if not dark.flags.writeable else dark
        dark[box[1] : box[3], box[0] : box[2]] = False
    walls = ndimage.binary_dilation(dark, iterations=3)
    blocked = walls | rack | ~inside
    rack_core = np.zeros((PLAN_H, PLAN_W), bool)
    for r in racks:
        rack_core[max(0, r["y"] - 2) : r["y"] + r["h"] + 2, max(0, r["x"] - 2) : r["x"] + r["w"] + 2] = True
    return blocked, dark | rack_core | ~inside, rack_core, dark


def downsample(mask):
    h, w = mask.shape
    m = mask[: h - h % SCALE, : w - w % SCALE]
    return m.reshape(h // SCALE, SCALE, w // SCALE, SCALE).any(axis=(1, 3))


NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def skeleton_graph(free_small):
    # Убираем щели уже ~1,2 м (меньше ширины погрузчика): открытие маски свободного места
    free = ndimage.binary_opening(free_small, structure=np.ones((5, 5)))
    lab, n = ndimage.label(free)
    sizes = ndimage.sum(free, lab, range(1, n + 1))
    keep = np.zeros_like(free)
    for i, s in enumerate(sizes, start=1):
        if s > 4000:
            keep |= lab == i
    sk = skeletonize(keep)
    pts = set(zip(*np.nonzero(sk)))

    def nbrs(p):
        y, x = p
        return [(y + dy, x + dx) for dy, dx in NB if (y + dy, x + dx) in pts]

    deg = {p: len(nbrs(p)) for p in pts}
    key = {p for p, d in deg.items() if d != 2}
    edges = []
    visited = set()
    for k in key:
        for nb in nbrs(k):
            if (k, nb) in visited:
                continue
            path = [k, nb]
            visited.add((k, nb))
            prev, cur = k, nb
            while cur not in key:
                nxt = [q for q in nbrs(cur) if q != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                path.append(cur)
            visited.add((path[-1], path[-2]))
            edges.append(path)
    # чистые циклы без ключевых точек
    return edges, keep


def rdp(points, eps):
    if len(points) < 3:
        return points
    a, b = np.array(points[0], float), np.array(points[-1], float)
    ab = b - a
    n = np.hypot(*ab)
    best, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        p = np.array(points[i], float)
        d = abs(ab[0] * (p - a)[1] - ab[1] * (p - a)[0]) / n if n else float(np.hypot(*(p - a)))
        if d > best:
            best, idx = d, i
    if best > eps:
        return rdp(points[: idx + 1], eps)[:-1] + rdp(points[idx:], eps)
    return [points[0], points[-1]]


def build(racks):
    blocked, dark, rack_core_mask, dark_only = obstacle_mask(racks)
    free_small = ~downsample(blocked)
    paths, free_kept = skeleton_graph(free_small)

    # в план-пиксели (x, y)
    def P(p):
        return (p[1] * SCALE + SCALE / 2, p[0] * SCALE + SCALE / 2)

    node_id = {}
    nodes = []
    by_id = {}
    counter = [0]

    def node_at(xy, kind="way"):
        k = (round(xy[0]), round(xy[1]))
        if k in node_id:
            return node_id[k]
        counter[0] += 1
        nid = f"n{counter[0]}"
        node_id[k] = nid
        nodes.append({"id": nid, "x": float(k[0]), "y": float(k[1]), "kind": kind})
        by_id[nid] = nodes[-1]
        return nid

    raw_edges = []
    for path in paths:
        simp = rdp([P(p) for p in path], eps=5.0)
        for a, b in zip(simp, simp[1:]):
            if a == b:
                continue
            raw_edges.append((node_at(a), node_at(b)))

    # обрезка «усов»: висячие ветви короче MIN_SPUR_PX
    def prune(edges):
        changed = True
        while changed:
            changed = False
            deg = defaultdict(int)
            for a, b in edges:
                deg[a] += 1
                deg[b] += 1
            out = []
            for a, b in edges:
                la = math.dist((by_id[a]["x"], by_id[a]["y"]), (by_id[b]["x"], by_id[b]["y"]))
                if (deg[a] == 1 or deg[b] == 1) and la < MIN_SPUR_PX and not (deg[a] == 1 and deg[b] == 1):
                    changed = True
                    continue
                out.append((a, b))
            edges = out
        return edges

    raw_edges = list({tuple(sorted(e)) for e in raw_edges})
    raw_edges = prune(raw_edges)
    used = {x for e in raw_edges for x in e}
    nodes[:] = [n for n in nodes if n["id"] in used]
    for k in [k for k in by_id if k not in used]:
        del by_id[k]
    node_id = {k: v for k, v in node_id.items() if v in used}

    # ---- узлы доступа к рядам
    def clear_line(a, b):
        steps = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
        for i in range(steps + 1):
            t = i / steps
            x = int(round(a[0] + (b[0] - a[0]) * t))
            y = int(round(a[1] + (b[1] - a[1]) * t))
            if not (0 <= x < PLAN_W and 0 <= y < PLAN_H):
                return False
            if dark[max(0, y - 1) : y + 2, max(0, x - 1) : x + 2].any():
                return False
        return True

    edges = [{"a": a, "b": b} for a, b in raw_edges]

    def nearest_on_edges(p):
        best = None
        for idx, e in enumerate(edges):
            if e.get("spur"):
                continue  # к подъезду другого ряда не примыкаем — только к осевой проезда
            A, B = by_id[e["a"]], by_id[e["b"]]
            ax, ay, bx, by = A["x"], A["y"], B["x"], B["y"]
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / l2))
            q = (ax + dx * t, ay + dy * t)
            d = math.dist(p, q)
            if best is None or d < best[0]:
                best = (d, idx, t, q)
        return best

    addresses = []
    access_count = 0
    unreachable = []
    seen_rows = set()
    for r in racks:
        if r["rowId"] in seen_rows:
            continue
        vertical = r["h"] >= r["w"]
        cx, cy = r["x"] + r["w"] / 2, r["y"] + r["h"] / 2
        if vertical:
            ends = [((cx, r["y"]), (cx, r["y"] - ACCESS_OFFSET_PX)), ((cx, r["y"] + r["h"]), (cx, r["y"] + r["h"] + ACCESS_OFFSET_PX))]
        else:
            ends = [((r["x"], cy), (r["x"] - ACCESS_OFFSET_PX, cy)), ((r["x"] + r["w"], cy), (r["x"] + r["w"] + ACCESS_OFFSET_PX, cy))]
        options = []
        for _, acc in ends:
            hit = nearest_on_edges(acc)
            if not hit or hit[0] > SPUR_MAX_PX:
                continue
            d, idx, t, q = hit
            if not clear_line(acc, q):
                continue
            options.append((d, acc, idx, t, q))
        if not options:
            if r["rowId"] not in unreachable:
                unreachable.append(r["rowId"])
            continue
        options.sort(key=lambda o: o[0])
        d, acc, idx, t, q = options[0]
        e = edges[idx]
        A, B = by_id[e["a"]], by_id[e["b"]]
        # точка примыкания: ближний конец, если рядом, иначе делим ребро
        if math.dist(q, (A["x"], A["y"])) < 6:
            join = e["a"]
        elif math.dist(q, (B["x"], B["y"])) < 6:
            join = e["b"]
        else:
            join = node_at(q, "junction")
            edges[idx] = {"a": e["a"], "b": join}
            edges.append({"a": join, "b": e["b"]})
        acc_id = f"acc-{r['rowId']}"
        nodes.append({"id": acc_id, "x": round(acc[0], 1), "y": round(acc[1], 1), "kind": "access", "label": r["rowId"]})
        by_id[acc_id] = nodes[-1]
        if math.dist(acc, (by_id[join]["x"], by_id[join]["y"])) > 0.5:
            edges.append({"a": acc_id, "b": join, "spur": True})
        addresses.append({"locationCode": "FG-" + r["rowId"].upper(), "nodeId": acc_id})
        access_count += 1
        seen_rows.add(r["rowId"])

    out_edges = []
    seen = set()
    for e in edges:
        a, b = e["a"], e["b"]
        if a == b:
            continue
        k = tuple(sorted((a, b)))
        if k in seen:
            continue
        seen.add(k)
        out_edges.append({"id": f"e{len(out_edges) + 1}", "from": a, "to": b})

    # ---- двери: стены разрывают граф. Ищем короткие перемычки через тонкую стену
    # (не через стеллаж) между несвязанными частями. Помечаем как «проверить дверь».
    def components(edge_list):
        parent = {n["id"]: n["id"] for n in nodes}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for e in edge_list:
            ra, rb = find(e["from"]), find(e["to"])
            if ra != rb:
                parent[ra] = rb
        return find

    def wall_crossing_ok(a, b):
        steps = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
        dark_len = 0
        runs = 0
        prev_dark = False
        first_dark = None
        for i in range(steps + 1):
            t = i / steps
            x = int(round(a[0] + (b[0] - a[0]) * t))
            y = int(round(a[1] + (b[1] - a[1]) * t))
            if rack_core_mask[y, x]:
                return False
            d = bool(dark_only[y, x])
            if d:
                if first_dark is None:
                    first_dark = (x, y)
                dark_len += 1
                if not prev_dark:
                    runs += 1
            prev_dark = d
        if first_dark is None:
            return True
        if not (runs <= 4 and dark_len <= 16):
            return False
        x, y = first_dark
        near = ARROWS[max(0, y - 35) : y + 36, max(0, x - 35) : x + 36].sum()
        return near >= 15

    doors = []
    find = components(out_edges)
    way_nodes = [n for n in nodes if n["kind"] != "access"]
    cand = []
    for i, a in enumerate(way_nodes):
        for b in way_nodes[i + 1 :]:
            d = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
            if d > 90 or find(a["id"]) == find(b["id"]):
                continue
            cand.append((d, a, b))
    cand.sort(key=lambda c: c[0])
    for d, a, b in cand:
        find = components(out_edges)
        if find(a["id"]) == find(b["id"]):
            continue
        if not wall_crossing_ok((a["x"], a["y"]), (b["x"], b["y"])):
            continue
        out_edges.append(
            {
                "id": f"e{len(out_edges) + 1}",
                "from": a["id"],
                "to": b["id"],
                "penaltyS": 5,
                "note": "дверь/проём по плану — проверить на месте",
            }
        )
        doors.append(out_edges[-1]["id"])

    by_all = {n["id"]: n for n in nodes}
    for e in out_edges:
        a, b = by_all[e["from"]], by_all[e["to"]]
        mx, my = (a["x"] + b["x"]) / 2, (a["y"] + b["y"]) / 2
        for x0, y0, x1, y1 in DOORS:
            if x0 - 4 <= mx <= x1 + 4 and y0 - 4 <= my <= y1 + 4 and "note" not in e:
                e["note"] = "проём по стрелкам плана — проверить ширину и ворота"
                e["penaltyS"] = 3
                doors.append(e["id"])
                break

    for n in nodes:
        if n["kind"] == "way":
            deg = sum(1 for e in out_edges if e["from"] == n["id"] or e["to"] == n["id"])
            if deg >= 3:
                n["kind"] = "junction"

    geometry = {
        "coord": {
            "unit": "plan_px",
            "metersPerUnit": METERS_PER_PX,
            "width": PLAN_W,
            "height": PLAN_H,
            "background": "/route/plan/fg.png",
        },
        "nodes": nodes,
        "edges": out_edges,
        "areas": [],
        "points": [],
        "addresses": addresses,
        "racks": [{"id": r["id"], "zone": r["zone"], "x": r["x"], "y": r["y"], "w": r["w"], "h": r["h"]} for r in racks],
    }
    report = {
        "nodes": len(nodes),
        "edges": len(out_edges),
        "rows": len({r["rowId"] for r in racks}),
        "rowsWithAccess": access_count,
        "rowsWithoutAccess": unreachable,
        "doorEdges": doors,
        "doorsFromArrows": len(DOORS),
    }
    return geometry, report, free_kept


def preview(geometry, path):
    img = Image.open(REPO / "public/warehouse-plan/fg/warehouse-plan-screen.png").convert("RGB")
    d = ImageDraw.Draw(img)
    by = {n["id"]: n for n in geometry["nodes"]}
    for e in geometry["edges"]:
        a, b = by[e["from"]], by[e["to"]]
        color = (230, 120, 0) if not (a["kind"] == "access" or b["kind"] == "access") else (0, 150, 70)
        d.line([(a["x"], a["y"]), (b["x"], b["y"])], fill=color, width=5)
    for n in geometry["nodes"]:
        r = 5 if n["kind"] == "access" else 4
        d.ellipse([n["x"] - r, n["y"] - r, n["x"] + r, n["y"] + r], fill=(200, 0, 0) if n["kind"] == "junction" else (0, 90, 200))
    img.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "data/route/fg-map-draft.json"))
    ap.add_argument("--preview")
    args = ap.parse_args()
    racks = load_rows()
    geometry, report, _ = build(racks)
    payload = {
        "version": 1,
        "status": "draft",
        "source": "scripts/route-draft-map.py: скелет свободного пространства плана warehouse-plan-screen.png + ряды fg-plan-rows.json",
        "note": "Черновик. Проверить проезды, двери и односторонние участки на складе, затем опубликовать в редакторе.",
        "report": report,
        "geometry": geometry,
    }
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False), "utf8")
    print(json.dumps(report, ensure_ascii=False))
    if args.preview:
        preview(geometry, args.preview)


if __name__ == "__main__":
    main()
