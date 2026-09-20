"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import { AlertTriangle, Box, Layers, Move, Plus, RefreshCcw, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { WmsItemPicker, WmsLocationPicker } from "@/components/wms/wms-pickers";
import { WmsSiteCodeField } from "@/components/wms/wms-shared";
import { FocusModal } from "@/components/ui/focus-modal";
import {
  createWmsVirtualLayout,
  createWmsVirtualNode,
  deleteWmsVirtualNode,
  getDefaultWmsSiteCode,
  getWmsVirtualLayout,
  getWmsVirtualNodeContents,
  listWmsVirtualLayouts,
  rememberWmsSiteCode,
  saveWmsVirtualNodeContents,
  updateWmsVirtualLayout,
  updateWmsVirtualNode,
} from "@/lib/wms/client";
import type {
  WmsVirtualContentRow,
  WmsVirtualLayoutSummary,
  WmsVirtualNodeRow,
  WmsVirtualNodeType,
} from "@/lib/wms/types";
import { getRackShelfPlacement, normalizeVirtualLayout } from "./virtual-warehouse-layout-normalize";

type LayoutState = {
  layoutId: string;
  layoutCode: string;
  name: string;
  description: string | null;
  warehouseCode: string | null;
  zoneCode: string | null;
  scenePrefs: Record<string, unknown> | null;
  nodes: WmsVirtualNodeRow[];
};

function radiansToDegrees(value: number) {
  return Number(((value * 180) / Math.PI).toFixed(1));
}

function degreesToRadians(valueText: string) {
  const value = Number(valueText || "0");
  return Number.isFinite(value) ? (value * Math.PI) / 180 : 0;
}

function rotateOffset(offsetX: number, offsetZ: number, rotY: number) {
  const cos = Math.cos(rotY);
  const sin = Math.sin(rotY);
  return {
    x: offsetX * cos - offsetZ * sin,
    z: offsetX * sin + offsetZ * cos,
  };
}

function inverseRotateOffset(worldX: number, worldZ: number, rotY: number) {
  return rotateOffset(worldX, worldZ, -rotY);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapToGrid(value: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function isBoxLike(nodeType: string) {
  return nodeType === "box" || nodeType === "bin" || nodeType === "container" || nodeType === "pallet" || nodeType === "pallet_slot";
}

type EditableContentRow = {
  id: string;
  itemCode: string;
  qty: string;
  uomCode: string;
  lotCode: string;
  note: string;
};

type NodeStatusCode = "empty" | "occupied" | "warning" | "full";

type NodeStatus = {
  code: NodeStatusCode;
  label: string;
  colorHex: number;
  colorClass: string;
  preview: string;
  detail: string | null;
};

function fmtQty(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
}

function fmtDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("ru-RU");
  } catch {
    return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function getNumericProp(props: Record<string, unknown> | null, key: string) {
  const value = props?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function buildNodeTree(nodes: WmsVirtualNodeRow[]) {
  const byParent = new Map<string, WmsVirtualNodeRow[]>();
  for (const node of nodes) {
    const key = node.parentNodeId ?? "root";
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || Number(a.nodeId) - Number(b.nodeId));
  }
  return byParent;
}

function collectDescendantNodeIds(nodes: WmsVirtualNodeRow[], rootId: string) {
  const childMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentNodeId) continue;
    const list = childMap.get(node.parentNodeId) ?? [];
    list.push(node.nodeId);
    childMap.set(node.parentNodeId, list);
  }
  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const childId of childMap.get(current) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

function contentHasFefoWarning(row: WmsVirtualContentRow) {
  if (!row.isPerishable) return false;
  const dateText = row.expiryAt ?? row.bestBeforeAt;
  if (!dateText) return false;
  const ts = new Date(dateText).getTime();
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  const warningDays = Math.max(row.expiryWarningDays ?? 0, 0);
  return ts <= now + warningDays * 24 * 60 * 60 * 1000;
}

function buildNodeStatus(node: WmsVirtualNodeRow, contents: WmsVirtualContentRow[] | null): NodeStatus {
  if (contents == null) {
    const preview = node.locationCode ? node.locationCode : "—";
    return {
      code: "empty",
      label: "…",
      colorHex: 0x94a3b8,
      colorClass: "bg-slate-100 text-slate-700",
      preview,
      detail: "Содержимое ещё не загружено",
    };
  }
  const totalQty = contents.reduce((sum, row) => sum + row.qty, 0);
  const capacityQty = getNumericProp(asRecord(node.props), "capacityQty");
  const first = contents[0] ?? null;
  const preview = first
    ? `${first.itemCode} · ${fmtQty(first.qty)} ${first.uomCode}`
    : node.locationCode
      ? node.locationCode
      : "пусто";

  if (contents.length === 0) {
    return {
      code: "empty",
      label: "Пусто",
      colorHex: 0xcbd5e1,
      colorClass: "bg-slate-100 text-slate-700",
      preview,
      detail: node.locationCode ? `Адрес: ${node.locationCode}` : "Объект не заполнен",
    };
  }

  const warningContent = contents.find((row) => contentHasFefoWarning(row));
  if (warningContent) {
    return {
      code: "warning",
      label: "FEFO",
      colorHex: 0xef4444,
      colorClass: "bg-red-100 text-red-700",
      preview,
      detail: `${warningContent.itemCode} · срок ${fmtDate(warningContent.expiryAt ?? warningContent.bestBeforeAt)}`,
    };
  }

  if (capacityQty != null && totalQty >= capacityQty * 0.95) {
    return {
      code: "full",
      label: "Заполнено",
      colorHex: 0xf59e0b,
      colorClass: "bg-amber-100 text-amber-700",
      preview,
      detail: `Нагрузка ${fmtQty(totalQty)} / ${fmtQty(capacityQty)}`,
    };
  }

  return {
    code: "occupied",
    label: "Занято",
    colorHex: 0x10b981,
    colorClass: "bg-emerald-100 text-emerald-700",
    preview,
    detail: capacityQty != null ? `Нагрузка ${fmtQty(totalQty)} / ${fmtQty(capacityQty)}` : `${fmtQty(totalQty)} всего`,
  };
}

function nodeColor(node: WmsVirtualNodeRow, status: NodeStatus, selected: boolean) {
  if (selected) return 0x4f8cff;
  if (node.nodeType === "box" || node.nodeType === "bin" || node.nodeType === "container" || node.nodeType === "pallet_slot") {
    return status.colorHex;
  }
  switch (node.nodeType) {
    case "rack":
      return 0x5b6472;
    case "shelf":
      return 0xcaa86b;
    default:
      return 0x8792a2;
  }
}

function makeTextSprite(text: string, background: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 28px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const clipped = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  ctx.fillText(clipped, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.userData = { kind: "label" };
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

const stickerTextureCache = new Map<string, THREE.Texture>();
const floorPlanTextureCache = new Map<string, THREE.Texture>();

function makeStickerTexture(text: string, fontPx = 34) {
  const key = `${(text || "").trim()}\t${fontPx}`;
  const cached = stickerTextureCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(15, 23, 42, 0.25)";
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  ctx.fillStyle = "#0f172a";
  ctx.font = `bold ${Math.round(fontPx)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const raw = (text || "").trim();
  const maxChars = Math.max(8, Math.floor(520 / (fontPx * 0.55)));
  const clipped = raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw;
  ctx.fillText(clipped || "—", canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  texture.userData = { kind: "sticker" };
  stickerTextureCache.set(key, texture);
  return texture;
}

function registerPickHulls(group: THREE.Object3D, nodeId: string, map: Map<THREE.Object3D, string>) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && (obj.userData as { pickHull?: boolean }).pickHull) {
      map.set(obj, nodeId);
    }
  });
}

function disposeObject3D(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Sprite) {
      const mesh = obj as THREE.Mesh;
      const geometry = (mesh as unknown as { geometry?: THREE.BufferGeometry }).geometry;
      if (geometry) geometry.dispose();
      const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const mat of materials) {
        const maybe = mat as unknown as { map?: THREE.Texture };
        if (maybe.map && (maybe.map.userData as { kind?: string } | undefined)?.kind !== "sticker") {
          maybe.map.dispose();
        }
        mat.dispose();
      }
    }
  });
}

function buildRackGroup(node: WmsVirtualNodeRow, selected: boolean) {
  const group = new THREE.Group();
  const width = Math.max(node.sizeX, 0.6);
  const height = Math.max(node.sizeY, 0.8);
  const depth = Math.max(node.sizeZ, 0.4);
  const props = asRecord(node.props);
  const levels = Math.max(Math.trunc(getNumericProp(props, "shelfCount") ?? 4), 1);
  const postThickness = getNumericProp(props, "postThickness") ?? Math.min(width, depth) * 0.05;
  const beamHeight = getNumericProp(props, "beamHeight") ?? Math.max(height * 0.03, 0.06);

  const metalMaterial = new THREE.MeshStandardMaterial({
    color: selected ? 0x4f8cff : 0x275a8a,
    metalness: 0.75,
    roughness: 0.38,
  });
  const railMaterial = new THREE.MeshStandardMaterial({
    color: selected ? 0x93c5fd : 0xf28c28,
    metalness: 0.7,
    roughness: 0.35,
  });

  const halfW = width / 2;
  const halfD = depth / 2;
  const postGeometry = new THREE.BoxGeometry(postThickness, height, postThickness);
  const postPositions = [
    [-halfW, height / 2, -halfD],
    [halfW, height / 2, -halfD],
    [-halfW, height / 2, halfD],
    [halfW, height / 2, halfD],
  ];
  for (const [x, y, z] of postPositions) {
    const post = new THREE.Mesh(postGeometry, metalMaterial);
    post.position.set(x, y, z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
  }

  const levelGap = height / (levels + 1);
  for (let i = 0; i < levels; i += 1) {
    const y = levelGap * (i + 1);
    const beamGeometryX = new THREE.BoxGeometry(width, beamHeight, postThickness * 1.4);
    const frontBeam = new THREE.Mesh(beamGeometryX, railMaterial);
    frontBeam.position.set(0, y, halfD);
    frontBeam.castShadow = true;
    frontBeam.receiveShadow = true;
    group.add(frontBeam);

    const backBeam = new THREE.Mesh(beamGeometryX, railMaterial);
    backBeam.position.set(0, y, -halfD);
    backBeam.castShadow = true;
    backBeam.receiveShadow = true;
    group.add(backBeam);

    const beamGeometryZ = new THREE.BoxGeometry(postThickness * 1.4, beamHeight, depth);
    const leftBeam = new THREE.Mesh(beamGeometryZ, metalMaterial);
    leftBeam.position.set(-halfW, y, 0);
    leftBeam.castShadow = true;
    leftBeam.receiveShadow = true;
    group.add(leftBeam);

    const rightBeam = new THREE.Mesh(beamGeometryZ, metalMaterial);
    rightBeam.position.set(halfW, y, 0);
    rightBeam.castShadow = true;
    rightBeam.receiveShadow = true;
    group.add(rightBeam);
  }

  const pickMesh = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.16, height + 0.08, depth + 0.16),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pickMesh.position.set(0, height / 2, 0);
  pickMesh.userData.pickHull = true;
  group.add(pickMesh);

  group.position.set(node.posX, node.posY, node.posZ);
  group.rotation.set(node.rotX, node.rotY, node.rotZ);
  group.userData = { nodeId: node.nodeId };
  return group;
}

function buildBoxGroup(node: WmsVirtualNodeRow, selected: boolean) {
  const group = new THREE.Group();
  const width = Math.max(node.sizeX, 0.2);
  const height = Math.max(node.sizeY, 0.18);
  const depth = Math.max(node.sizeZ, 0.2);
  const props = asRecord(node.props);
  const noteText = typeof props?.note === "string" ? props.note : "";
  const stickerScale = clamp(getNumericProp(props, "stickerScale") ?? 1, 0.35, 2);
  const stickerFontPx = clamp(getNumericProp(props, "stickerFontPx") ?? 34, 12, 72);
  const stickerOffsetX = getNumericProp(props, "stickerOffsetX") ?? 0;
  const stickerOffsetY = getNumericProp(props, "stickerOffsetY") ?? 0.62;
  const stickerZPad = getNumericProp(props, "stickerZPad") ?? 0.002;
  const isPallet = node.nodeType === "pallet";
  const isSlot = node.nodeType === "pallet_slot";
  const cardboard = new THREE.MeshStandardMaterial({
    color: isPallet ? (selected ? 0x60a5fa : 0x8b5e34) : selected ? 0x6ea8ff : 0xc68a4b,
    roughness: isPallet ? 0.9 : 0.92,
    metalness: 0.02,
  });
  const seam = new THREE.MeshStandardMaterial({
    color: isPallet ? (selected ? 0x93c5fd : 0x6b3f1c) : selected ? 0x4f8cff : 0x8d5a2b,
    roughness: 0.95,
    metalness: 0.01,
  });

  const bodyHeight = isPallet ? Math.max(Math.min(height, 0.18), 0.09) : height;
  const body = new THREE.Mesh(new THREE.BoxGeometry(width, bodyHeight, depth), cardboard);
  body.position.set(0, bodyHeight / 2, 0);
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);

  if (!isPallet && !isSlot) {
    const tape = new THREE.Mesh(new THREE.BoxGeometry(width * 0.2, 0.012, depth * 0.92), seam);
    tape.position.set(0, height + 0.006, 0);
    tape.castShadow = true;
    tape.receiveShadow = true;
    group.add(tape);
  }

  if (isPallet) {
    // Pallet base (more realistic than a single slab).
    const palletBlue = new THREE.MeshStandardMaterial({
      color: selected ? 0x93c5fd : 0x2563eb,
      roughness: 0.65,
      metalness: 0.04,
    });
    const wood = new THREE.MeshStandardMaterial({ color: 0x8b5e34, roughness: 0.9, metalness: 0.02 });

    const topDeck = new THREE.Mesh(new THREE.BoxGeometry(width * 0.98, 0.02, depth * 0.98), palletBlue);
    topDeck.position.set(0, bodyHeight + 0.02, 0);
    group.add(topDeck);

    const runnerGeo = new THREE.BoxGeometry(width * 0.92, 0.06, 0.08);
    for (const z of [-depth * 0.32, 0, depth * 0.32]) {
      const r = new THREE.Mesh(runnerGeo, wood);
      r.position.set(0, 0.03, z);
      group.add(r);
    }

    const blockGeo = new THREE.BoxGeometry(0.12, 0.08, 0.12);
    const bx = [-width * 0.35, 0, width * 0.35];
    const bz = [-depth * 0.32, 0, depth * 0.32];
    for (const x of bx) {
      for (const z of bz) {
        const b = new THREE.Mesh(blockGeo, wood);
        b.position.set(x, 0.09, z);
        group.add(b);
      }
    }

    // Visualize shrink-wrapped water packs on the pallet using instancing (fast).
    const rowsX = Math.max(Math.trunc(getNumericProp(props, "palletRowsX") ?? 7), 1);
    const rowsZ = Math.max(Math.trunc(getNumericProp(props, "palletRowsZ") ?? 3), 1);
    const layers = Math.max(Math.trunc(getNumericProp(props, "palletLayers") ?? 1), 1);
    const frac = clamp(getNumericProp(props, "palletFraction") ?? 1, 0.25, 1);
    const effX = Math.max(Math.trunc(rowsX * frac), 1);
    const total = effX * rowsZ * layers;
    const maxVis = 220;
    const vis = Math.min(total, maxVis);

    const gapX = width / effX;
    const gapZ = depth / rowsZ;
    const packX = Math.max(Math.min(gapX * 0.78, 0.22), 0.12);
    const packZ = Math.max(Math.min(gapZ * 0.78, 0.22), 0.12);
    const packY = 0.12;
    const startX = -width / 2 + gapX / 2;
    const startZ = -depth / 2 + gapZ / 2;

    const packGeo = new THREE.BoxGeometry(packX, packY, packZ);
    const packMat = new THREE.MeshPhysicalMaterial({
      color: selected ? 0x93c5fd : 0x7dd3fc,
      roughness: 0.22,
      metalness: 0.0,
      transmission: 0.55,
      thickness: 0.12,
      transparent: true,
      opacity: 0.92,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
    });
    const inst = new THREE.InstancedMesh(packGeo, packMat, vis);
    inst.castShadow = false;
    inst.receiveShadow = false;

    const m = new THREE.Matrix4();
    let placed = 0;
    for (let i = 0; i < layers && placed < vis; i += 1) {
      for (let z = 0; z < rowsZ && placed < vis; z += 1) {
        for (let x = 0; x < effX && placed < vis; x += 1) {
          const px = startX + x * gapX;
          const pz = startZ + z * gapZ;
          const py = bodyHeight + 0.02 + 0.022 + packY / 2 + i * (packY + 0.02);
          m.makeTranslation(px, py, pz);
          inst.setMatrixAt(placed, m);
          placed += 1;
        }
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);

    // Cardboard separators between layers (common for bottled water pallets).
    if (layers > 1) {
      const sepGeo = new THREE.BoxGeometry(width * 0.985, 0.008, depth * 0.985);
      const sepMat = new THREE.MeshStandardMaterial({ color: 0xd6b68a, roughness: 0.92, metalness: 0.02, opacity: 0.95, transparent: true });
      const seps = new THREE.InstancedMesh(sepGeo, sepMat, Math.min(layers - 1, 10));
      const sm = new THREE.Matrix4();
      let si = 0;
      for (let i = 0; i < layers - 1 && si < seps.count; i += 1) {
        const y = bodyHeight + 0.02 + 0.022 + (i + 1) * (packY + 0.02);
        sm.makeTranslation(0, y, 0);
        seps.setMatrixAt(si, sm);
        si += 1;
      }
      seps.instanceMatrix.needsUpdate = true;
      group.add(seps);
    }

    // Bottle caps hint on the top layer only (cheap, but clearly "water", not boxes).
    const bottlesPerPack = Math.max(Math.trunc(getNumericProp(props, "bottlesPerPack") ?? 12), 1);
    const capGrid =
      bottlesPerPack >= 12 ? ({ gx: 4, gz: 3 } as const) : bottlesPerPack >= 6 ? ({ gx: 3, gz: 2 } as const) : ({ gx: 2, gz: 2 } as const);
    const packsOnTop = effX * rowsZ;
    const maxCaps = 800;
    const capsCount = Math.min(packsOnTop * capGrid.gx * capGrid.gz, maxCaps);
    if (capsCount > 0) {
      const capGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.01, 12);
      const capMat = new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.28, metalness: 0.08 });
      const caps = new THREE.InstancedMesh(capGeo, capMat, capsCount);
      caps.castShadow = false;
      caps.receiveShadow = false;
      const cm = new THREE.Matrix4();
      let ci = 0;
      // Caps on the top-most layer only.
      const topLayerY = bodyHeight + 0.02 + 0.022 + packY + 0.012 + (layers - 1) * (packY + 0.02);
      for (let z = 0; z < rowsZ && ci < capsCount; z += 1) {
        for (let x = 0; x < effX && ci < capsCount; x += 1) {
          const packCenterX = startX + x * gapX;
          const packCenterZ = startZ + z * gapZ;
          for (let gz = 0; gz < capGrid.gz && ci < capsCount; gz += 1) {
            for (let gx = 0; gx < capGrid.gx && ci < capsCount; gx += 1) {
              const dx = ((gx + 0.5) / capGrid.gx - 0.5) * (packX * 0.72);
              const dz = ((gz + 0.5) / capGrid.gz - 0.5) * (packZ * 0.72);
              cm.makeTranslation(packCenterX + dx, topLayerY, packCenterZ + dz);
              caps.setMatrixAt(ci, cm);
              ci += 1;
            }
          }
        }
      }
      caps.instanceMatrix.needsUpdate = true;
      group.add(caps);

      // Bottle bodies (only on selected pallet, top layer, capped to stay fast).
      if (selected) {
        const maxBottles = 420;
        const bottleCount = Math.min(packsOnTop * capGrid.gx * capGrid.gz, maxBottles);
        const bottleGeo = new THREE.CylinderGeometry(0.022, 0.028, 0.09, 12);
        const bottleMat = new THREE.MeshPhysicalMaterial({
          color: 0xcffafe,
          roughness: 0.08,
          metalness: 0.0,
          transmission: 0.92,
          thickness: 0.18,
          transparent: true,
          opacity: 0.92,
        });
        const bottles = new THREE.InstancedMesh(bottleGeo, bottleMat, bottleCount);
        bottles.castShadow = false;
        bottles.receiveShadow = false;
        const bm = new THREE.Matrix4();
        let bi = 0;
        const bottleY = topLayerY - 0.055;
        for (let z = 0; z < rowsZ && bi < bottleCount; z += 1) {
          for (let x = 0; x < effX && bi < bottleCount; x += 1) {
            const packCenterX = startX + x * gapX;
            const packCenterZ = startZ + z * gapZ;
            for (let gz = 0; gz < capGrid.gz && bi < bottleCount; gz += 1) {
              for (let gx = 0; gx < capGrid.gx && bi < bottleCount; gx += 1) {
                const dx = ((gx + 0.5) / capGrid.gx - 0.5) * (packX * 0.72);
                const dz = ((gz + 0.5) / capGrid.gz - 0.5) * (packZ * 0.72);
                bm.makeTranslation(packCenterX + dx, bottleY, packCenterZ + dz);
                bottles.setMatrixAt(bi, bm);
                bi += 1;
              }
            }
          }
        }
        bottles.instanceMatrix.needsUpdate = true;
        group.add(bottles);
      }
    }
  }

  const edgeLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
    new THREE.LineBasicMaterial({ color: 0x5b3a1e, transparent: true, opacity: 0.45 })
  );
  edgeLines.position.set(0, (isPallet ? bodyHeight : height) / 2, 0);
  group.add(edgeLines);

  const stickerTexture = makeStickerTexture(noteText, stickerFontPx);
  if (stickerTexture) {
    const sw = Math.min(width * 0.72, 0.42) * stickerScale;
    const sh = Math.min(height * 0.34, 0.18) * stickerScale;
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshBasicMaterial({
        map: stickerTexture,
        transparent: true,
        depthWrite: false,
      })
    );
    sticker.position.set(
      clamp(stickerOffsetX, -width * 0.45, width * 0.45),
      height * clamp(stickerOffsetY, 0.08, 0.98),
      depth / 2 + stickerZPad
    );
    group.add(sticker);
  }

  const pickHull = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.2, height * 1.25, depth * 1.2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pickHull.position.set(0, height / 2, 0);
  pickHull.userData.pickHull = true;
  group.add(pickHull);

  const rawFaceTurns = getNumericProp(props, "onShelfFaceTurns") ?? 0;
  const faceTurns = ((Math.trunc(rawFaceTurns) % 4) + 4) % 4;
  const extraYaw = faceTurns * (Math.PI / 2);

  group.position.set(node.posX, node.posY, node.posZ);
  group.rotation.set(node.rotX, node.rotY + extraYaw, node.rotZ);
  group.userData = { nodeId: node.nodeId };
  return group;
}

export function VirtualWarehouseEditor() {
  const urlParams = useSearchParams();
  const [siteCode, setSiteCode] = React.useState(getDefaultWmsSiteCode());
  const [layouts, setLayouts] = React.useState<WmsVirtualLayoutSummary[]>([]);
  const [selectedLayoutId, setSelectedLayoutId] = React.useState("");
  const [layoutState, setLayoutState] = React.useState<LayoutState | null>(null);
  const contentsCacheRef = React.useRef(new Map<string, WmsVirtualContentRow[]>());
  const [contentsVersion, setContentsVersion] = React.useState(0);
  const [selectedNodeId, setSelectedNodeId] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const [newLayoutCode, setNewLayoutCode] = React.useState("MAIN-VIRTUAL");
  const [newLayoutName, setNewLayoutName] = React.useState("Основной виртуальный склад");
  const [newWarehouseCode, setNewWarehouseCode] = React.useState("");
  const [newZoneCode, setNewZoneCode] = React.useState("");

  const [nodeLabel, setNodeLabel] = React.useState("");
  const [nodeCode, setNodeCode] = React.useState("");
  const [locationCode, setLocationCode] = React.useState("");
  const [sizeX, setSizeX] = React.useState("1.2");
  const [sizeY, setSizeY] = React.useState("0.4");
  const [sizeZ, setSizeZ] = React.useState("0.8");
  const [rotX, setRotX] = React.useState("0");
  const [rotY, setRotY] = React.useState("0");
  const [rotZ, setRotZ] = React.useState("0");
  const [shelfCount, setShelfCount] = React.useState("4");
  const [postThickness, setPostThickness] = React.useState("");
  const [beamHeight, setBeamHeight] = React.useState("");
  const [capacityQty, setCapacityQty] = React.useState("");
  const [loadUnitCode, setLoadUnitCode] = React.useState("");
  const [targetSupportId, setTargetSupportId] = React.useState("");
  const [boxOffsetX, setBoxOffsetX] = React.useState("0");
  const [boxOffsetZ, setBoxOffsetZ] = React.useState("0");
  const [boxStackLevel, setBoxStackLevel] = React.useState("0");
  const [boxNote, setBoxNote] = React.useState("");
  const [palletRowsX, setPalletRowsX] = React.useState("7");
  const [palletRowsZ, setPalletRowsZ] = React.useState("3");
  const [palletLayers, setPalletLayers] = React.useState("6");
  const [palletFraction, setPalletFraction] = React.useState("1");
  const [bottlesPerPack, setBottlesPerPack] = React.useState("12");
  const [packsPerPallet, setPacksPerPallet] = React.useState("126");
  const [stickerScale, setStickerScale] = React.useState("1");
  const [stickerFontPx, setStickerFontPx] = React.useState("34");
  const [stickerOffsetX, setStickerOffsetX] = React.useState("0");
  const [stickerOffsetY, setStickerOffsetY] = React.useState("0.62");
  const [stickerZPad, setStickerZPad] = React.useState("0.002");
  const [contentRows, setContentRows] = React.useState<EditableContentRow[]>([
    { id: "row-1", itemCode: "", qty: "1", uomCode: "pcs", lotCode: "", note: "" },
  ]);
  const [dragRackMode, setDragRackMode] = React.useState(false);
  const [dragBoxMode, setDragBoxMode] = React.useState(false);
  const [sceneTools, setSceneTools] = React.useState<{ open: boolean; nodeId: string; x: number; y: number }>({
    open: false,
    nodeId: "",
    x: 0,
    y: 0,
  });
  const sceneToolsRef = React.useRef<HTMLDivElement | null>(null);
  const [showNewLayoutForm, setShowNewLayoutForm] = React.useState(false);
  const [boxGeomModalOpen, setBoxGeomModalOpen] = React.useState(false);
  const [floorPlanDraft, setFloorPlanDraft] = React.useState("");
  const [floorLinesJson, setFloorLinesJson] = React.useState("[]");
  const [showPalletSlotsInTree, setShowPalletSlotsInTree] = React.useState(false);

  const palletClipboardKey = "wmsVirtual.palletClipboard.v1";

  const canvasHostRef = React.useRef<HTMLDivElement | null>(null);
  const sceneViewportRef = React.useRef<HTMLDivElement | null>(null);
  const sceneOverlayRef = React.useRef<HTMLDivElement | null>(null);
  const threeRef = React.useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    nodeIdByMesh: Map<THREE.Object3D, string>;
    floorPlane: THREE.Plane;
    dragPoint: THREE.Vector3;
    draggedRackId: string;
    draggedBoxId: string;
    dragOffsetX: number;
    dragOffsetZ: number;
    boxDragOffsetX: number;
    boxDragOffsetZ: number;
    frame: number;
    needsRebuild: boolean;
    needsRender: boolean;
  } | null>(null);
  const layoutStateRef = React.useRef<LayoutState | null>(null);
  const statusByNodeRef = React.useRef<Map<string, NodeStatus>>(new Map());
  const selectedNodeIdRef = React.useRef("");
  const hoveredNodeIdRef = React.useRef("");
  const dragRackModeRef = React.useRef(false);
  const dragBoxModeRef = React.useRef(false);
  const selectedNode = React.useMemo(
    () => layoutState?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null,
    [layoutState, selectedNodeId]
  );

  const statusByNode = React.useMemo(() => {
    const map = new Map<string, NodeStatus>();
    for (const node of layoutState?.nodes ?? []) {
      const cached =
        isBoxLike(node.nodeType) ? (contentsCacheRef.current.get(node.nodeId) ?? null) : ([] as WmsVirtualContentRow[]);
      map.set(node.nodeId, buildNodeStatus(node, cached));
    }
    return map;
  }, [layoutState, contentsVersion]);

  React.useEffect(() => {
    const lc = urlParams.get("locationCode")?.trim();
    const sc = urlParams.get("siteCode")?.trim();
    if (sc) setSiteCode(sc);
    if (lc) setLocationCode(lc);
  }, [urlParams]);

  React.useEffect(() => {
    layoutStateRef.current = layoutState;
    if (threeRef.current) {
      threeRef.current.needsRebuild = true;
      threeRef.current.needsRender = true;
    }
  }, [layoutState]);

  React.useEffect(() => {
    statusByNodeRef.current = statusByNode;
    if (threeRef.current) {
      threeRef.current.needsRebuild = true;
      threeRef.current.needsRender = true;
    }
  }, [statusByNode]);

  React.useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    if (threeRef.current) {
      threeRef.current.needsRebuild = true;
      threeRef.current.needsRender = true;
    }
  }, [selectedNodeId]);

  React.useEffect(() => {
    dragRackModeRef.current = dragRackMode;
    const current = threeRef.current;
    if (current) {
      current.renderer.domElement.style.cursor = dragBoxModeRef.current ? "crosshair" : dragRackMode ? "grab" : "default";
    }
  }, [dragRackMode]);

  React.useEffect(() => {
    dragBoxModeRef.current = dragBoxMode;
    const current = threeRef.current;
    if (current) {
      current.renderer.domElement.style.cursor = dragBoxMode ? "crosshair" : dragRackModeRef.current ? "grab" : "default";
    }
  }, [dragBoxMode]);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const data = await listWmsVirtualLayouts({ siteCode });
        if (cancelled) return;
        setLayouts(data.layouts ?? []);
        setSelectedLayoutId((current) => current || data.layouts?.[0]?.layoutId || "");
        rememberWmsSiteCode(siteCode);
      } catch (error) {
        if (cancelled) return;
        setLayouts([]);
        toast.error(error instanceof Error ? error.message : "Ошибка загрузки layout");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [siteCode]);

  const reloadLayout = React.useCallback(async () => {
    if (!selectedLayoutId) {
      setLayoutState(null);
      setSelectedNodeId("");
      return;
    }
    setLoading(true);
    try {
      const prevLayoutId = layoutStateRef.current?.layoutId ?? null;
      const data = await getWmsVirtualLayout({
        siteCode,
        layoutId: selectedLayoutId,
        includeContents: false,
      });
      const normalizedNodes = normalizeVirtualLayout(data.nodes);
      if (prevLayoutId && prevLayoutId !== data.layout.layoutId) {
        contentsCacheRef.current.clear();
        setContentsVersion((v) => v + 1);
      }
      setLayoutState({
        layoutId: data.layout.layoutId,
        layoutCode: data.layout.layoutCode,
        name: data.layout.name,
        description: data.layout.description,
        warehouseCode: data.layout.warehouseCode,
        zoneCode: data.layout.zoneCode,
        scenePrefs: data.layout.scenePrefs ?? null,
        nodes: normalizedNodes,
      });
      setSelectedNodeId((current) =>
        current && normalizedNodes.some((node) => node.nodeId === current) ? current : normalizedNodes[0]?.nodeId || ""
      );
    } catch (error) {
      setLayoutState(null);
      setSelectedNodeId("");
      toast.error(error instanceof Error ? error.message : "Ошибка загрузки структуры склада");
    } finally {
      setLoading(false);
    }
  }, [selectedLayoutId, siteCode]);

  React.useEffect(() => {
    void reloadLayout();
  }, [reloadLayout]);

  React.useEffect(() => {
    if (!selectedNode) return;
    const node = selectedNode;
    setNodeLabel(node.label);
    setNodeCode(node.code ?? "");
    setLocationCode(node.locationCode ?? "");
    setSizeX(String(node.sizeX));
    setSizeY(String(node.sizeY));
    setSizeZ(String(node.sizeZ));
    setRotX(String(radiansToDegrees(node.rotX)));
    setRotY(String(radiansToDegrees(node.rotY)));
    setRotZ(String(radiansToDegrees(node.rotZ)));
    setShelfCount(String(Math.trunc(getNumericProp(asRecord(node.props), "shelfCount") ?? 4)));
    setPostThickness(String(getNumericProp(asRecord(node.props), "postThickness") ?? ""));
    setBeamHeight(String(getNumericProp(asRecord(node.props), "beamHeight") ?? ""));
    setCapacityQty(String(getNumericProp(asRecord(node.props), "capacityQty") ?? ""));
    setLoadUnitCode(node.loadUnitCode ?? "");
    setTargetSupportId(node.parentNodeId ?? "");
    setBoxOffsetX(String(getNumericProp(asRecord(node.props), "offsetX") ?? 0));
    setBoxOffsetZ(String(getNumericProp(asRecord(node.props), "offsetZ") ?? 0));
    setBoxStackLevel(String(Math.trunc(getNumericProp(asRecord(node.props), "stackLevel") ?? 0)));
    setBoxNote(String(asRecord(node.props)?.note ?? ""));
    const pprops = asRecord(node.props);
    setPalletRowsX(String(Math.max(Math.trunc(getNumericProp(pprops, "palletRowsX") ?? 7), 1)));
    setPalletRowsZ(String(Math.max(Math.trunc(getNumericProp(pprops, "palletRowsZ") ?? 3), 1)));
    setPalletLayers(String(Math.max(Math.trunc(getNumericProp(pprops, "palletLayers") ?? 1), 1)));
    setPalletFraction(String(clamp(getNumericProp(pprops, "palletFraction") ?? 1, 0.25, 1)));
    setBottlesPerPack(String(Math.max(Math.trunc(getNumericProp(pprops, "bottlesPerPack") ?? 12), 1)));
    setPacksPerPallet(String(Math.max(Math.trunc(getNumericProp(pprops, "packsPerPallet") ?? 126), 1)));
    if (isBoxLike(node.nodeType)) {
      const bp = asRecord(node.props);
      setStickerScale(String(getNumericProp(bp, "stickerScale") ?? 1));
      setStickerFontPx(String(getNumericProp(bp, "stickerFontPx") ?? 34));
      setStickerOffsetX(String(getNumericProp(bp, "stickerOffsetX") ?? 0));
      setStickerOffsetY(String(getNumericProp(bp, "stickerOffsetY") ?? 0.62));
      setStickerZPad(String(getNumericProp(bp, "stickerZPad") ?? 0.002));
    }
    let cancelled = false;
    async function ensureContentsLoaded() {
      if (!isBoxLike(node.nodeType)) {
        setContentRows([{ id: "row-1", itemCode: "", qty: "1", uomCode: "pcs", lotCode: "", note: "" }]);
        return;
      }

      const cached = contentsCacheRef.current.get(node.nodeId) ?? null;
      if (!cached) {
        try {
          const resp = await getWmsVirtualNodeContents({ siteCode, nodeId: node.nodeId });
          if (cancelled) return;
          contentsCacheRef.current.set(node.nodeId, resp.contents ?? []);
          setContentsVersion((v) => v + 1);
        } catch {
          // ignore: keep "not loaded" state
        }
      }

      const contents = contentsCacheRef.current.get(node.nodeId) ?? [];
      if (cancelled) return;
      setContentRows(
        contents.length > 0
          ? contents.map((content, index) => ({
              id: content.virtualContentId || `row-${index + 1}`,
              itemCode: content.itemCode,
              qty: String(content.qty),
              uomCode: content.uomCode,
              lotCode: content.lotCode ?? "",
              note: content.note ?? "",
            }))
          : [{ id: "row-1", itemCode: "", qty: "1", uomCode: "pcs", lotCode: "", note: "" }]
      );
    }
    void ensureContentsLoaded();
    return () => {
      cancelled = true;
    };
  }, [selectedNode, siteCode]);

  React.useEffect(() => {
    if (!layoutState) {
      setFloorPlanDraft("");
      setFloorLinesJson("[]");
      return;
    }
    const sp = layoutState.scenePrefs;
    const u = sp && typeof sp.floorPlanDataUrl === "string" ? sp.floorPlanDataUrl : "";
    setFloorPlanDraft(u);
    try {
      setFloorLinesJson(JSON.stringify(sp?.floorLines ?? [], null, 2));
    } catch {
      setFloorLinesJson("[]");
    }
  }, [layoutState?.layoutId, layoutState?.scenePrefs]);

  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9eef3);
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 1000);
    camera.position.set(7, 5, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(host.clientWidth, host.clientHeight);
    // Shadows are expensive and cause jank on large scenes.
    renderer.shadowMap.enabled = false;
    host.innerHTML = "";
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    // Damping forces continuous re-render; disable for performance.
    controls.enableDamping = false;
    controls.target.set(0, 1.8, 0);
    const mouseButtons = controls.mouseButtons as unknown as { LEFT: number; MIDDLE: number; RIGHT: number };
    mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    mouseButtons.RIGHT = 8;

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    ambient.userData = { persistent: true };
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(10, 18, 12);
    dirLight.castShadow = false;
    dirLight.shadow.mapSize.set(1024, 1024);
    dirLight.userData = { persistent: true };
    scene.add(dirLight);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 30),
      new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.97, metalness: 0.04 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData = { persistent: true };
    scene.add(floor);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const nodeIdByMesh = new Map<THREE.Object3D, string>();
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const dragPoint = new THREE.Vector3();

    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      raycaster,
      pointer,
      nodeIdByMesh,
      floorPlane,
      dragPoint,
      draggedRackId: "",
      draggedBoxId: "",
      dragOffsetX: 0,
      dragOffsetZ: 0,
      boxDragOffsetX: 0,
      boxDragOffsetZ: 0,
      frame: 0,
      needsRebuild: true,
      needsRender: true,
    };

    const setPointer = (event: PointerEvent | MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pickNodeId = () => {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...nodeIdByMesh.keys()]);
      const hit = hits[0];
      return hit ? nodeIdByMesh.get(hit.object) ?? "" : "";
    };

    const rebuild = () => {
      const current = threeRef.current;
      if (!current) return;
      const state = layoutStateRef.current;
      if (!state) return;

      nodeIdByMesh.clear();
      for (let i = scene.children.length - 1; i >= 0; i -= 1) {
        const child = scene.children[i];
        if ((child.userData as { persistent?: boolean } | undefined)?.persistent) continue;
        disposeObject3D(child);
        scene.remove(child);
      }

      const selectedId = selectedNodeIdRef.current;
      const statuses = statusByNodeRef.current;

      const prefs = state.scenePrefs;
      const planUrl = prefs && typeof prefs.floorPlanDataUrl === "string" ? prefs.floorPlanDataUrl.trim() : "";
      if (planUrl) {
        const cachedTex = floorPlanTextureCache.get(planUrl);
        if (cachedTex) {
          const overlay = new THREE.Mesh(
            new THREE.PlaneGeometry(28, 28),
            new THREE.MeshBasicMaterial({ map: cachedTex, transparent: true, opacity: 0.9, depthWrite: false })
          );
          overlay.rotation.x = -Math.PI / 2;
          overlay.position.y = 0.018;
          overlay.renderOrder = 2;
          scene.add(overlay);
        } else {
          new THREE.TextureLoader().load(
            planUrl,
            (tex) => {
              tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
              floorPlanTextureCache.set(planUrl, tex);
              const tr = threeRef.current;
              if (tr) {
                tr.needsRebuild = true;
                tr.needsRender = true;
              }
            },
            undefined,
            () => {}
          );
        }
      }
      const rawLines = prefs && Array.isArray(prefs.floorLines) ? prefs.floorLines : [];
      for (const L of rawLines) {
        if (typeof L !== "object" || !L) continue;
        const rec = L as Record<string, unknown>;
        const x1 = Number(rec.x1);
        const z1 = Number(rec.z1);
        const x2 = Number(rec.x2);
        const z2 = Number(rec.z2);
        const dashed = Boolean(rec.dashed);
        if (![x1, z1, x2, z2].every((n) => Number.isFinite(n))) continue;
        const g = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(x1, 0.025, z1),
          new THREE.Vector3(x2, 0.025, z2),
        ]);
        if (dashed) {
          const ln = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0xf8fafc, dashSize: 0.14, gapSize: 0.12 }));
          ln.computeLineDistances();
          scene.add(ln);
        } else {
          scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe2e8f0 })));
        }
      }

      for (const node of state.nodes) {
        const status = statuses.get(node.nodeId) ?? buildNodeStatus(node, []);
        const emphasized = node.nodeId === selectedId;
        if (node.nodeType === "rack") {
          const rackGroup = buildRackGroup(node, emphasized);
          scene.add(rackGroup);
          registerPickHulls(rackGroup, node.nodeId, nodeIdByMesh);
        } else if (node.nodeType === "shelf" && !node.parentNodeId) {
          continue;
        } else if (isBoxLike(node.nodeType)) {
          const boxGroup = buildBoxGroup(node, emphasized);
          scene.add(boxGroup);
          registerPickHulls(boxGroup, node.nodeId, nodeIdByMesh);
        } else {
          const geometry = new THREE.BoxGeometry(
            Math.max(node.sizeX, 0.15),
            Math.max(node.sizeY, 0.03),
            Math.max(node.sizeZ, 0.15)
          );
          const material = new THREE.MeshStandardMaterial({
            color: nodeColor(node, status, emphasized),
            transparent: false,
            opacity: 0.96,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(node.posX, node.posY + node.sizeY / 2, node.posZ);
          mesh.rotation.set(node.rotX, node.rotY, node.rotZ);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          scene.add(mesh);
          const isShelf = node.nodeType === "shelf";
          if (!isShelf) nodeIdByMesh.set(mesh, node.nodeId);
          const pick = new THREE.Mesh(
            new THREE.BoxGeometry(
              Math.max(node.sizeX, 0.15) * (isShelf ? 1.55 : 1.25),
              Math.max(node.sizeY, 0.06) * (isShelf ? 2.4 : 2.2),
              Math.max(node.sizeZ, 0.15) * (isShelf ? 1.55 : 1.25)
            ),
            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
          );
          pick.userData.pickHull = true;
          mesh.add(pick);
          nodeIdByMesh.set(pick, node.nodeId);
          mesh.add(
            new THREE.LineSegments(
              new THREE.EdgesGeometry(geometry),
              new THREE.LineBasicMaterial({ color: 0x1f2937, transparent: true, opacity: 0.35 })
            )
          );
        }

        // Labels are expensive at scale; show only for the selected node.
        if (isBoxLike(node.nodeType) && node.nodeId === selectedId) {
          const labelText = `${node.label}${node.code ? ` · ${node.code}` : ""}`;
          const label = makeTextSprite(
            labelText,
            status.code === "warning" ? "#dc2626" : status.code === "full" ? "#d97706" : "#111827"
          );
          if (label) {
            label.position.set(node.posX, node.posY + node.sizeY + 0.45, node.posZ);
            scene.add(label);
          }
        }
      }

      current.needsRebuild = false;
      current.needsRender = true;
    };

    const onClick = (event: MouseEvent) => {
      setPointer(event);
      const nodeId = pickNodeId();
      if (nodeId) setSelectedNodeId(nodeId);
      setSceneTools((m) => (m.open ? { open: false, nodeId: "", x: 0, y: 0 } : m));
    };

    const onPointerDown = (event: PointerEvent) => {
      const current = threeRef.current;
      const state = layoutStateRef.current;
      if (!current || !state) return;
      const shiftDrag = event.shiftKey;
      if (!shiftDrag && !dragRackModeRef.current && !dragBoxModeRef.current) return;

      setPointer(event);
      const selectedId = selectedNodeIdRef.current;
      const selectedRack = state.nodes.find((entry) => entry.nodeId === selectedId && entry.nodeType === "rack");
      const selectedBox = state.nodes.find((entry) => entry.nodeId === selectedId && isBoxLike(entry.nodeType));
      const hitId = pickNodeId();
      const hitNode = state.nodes.find((entry) => entry.nodeId === hitId) ?? null;
      const nodeId = shiftDrag
        ? hitId
        : dragRackModeRef.current
          ? selectedRack?.nodeId ?? hitId
          : selectedBox?.nodeId ?? hitId;
      const node = state.nodes.find((entry) => entry.nodeId === nodeId);

      const shouldRackDrag = (dragRackModeRef.current || shiftDrag) && node?.nodeType === "rack";
      const shouldBoxDrag = (dragBoxModeRef.current || shiftDrag) && node && isBoxLike(node.nodeType);

      if (shouldRackDrag && node?.nodeType === "rack") {
        raycaster.setFromCamera(pointer, camera);
        if (raycaster.ray.intersectPlane(floorPlane, dragPoint)) {
          current.dragOffsetX = node.posX - dragPoint.x;
          current.dragOffsetZ = node.posZ - dragPoint.z;
        } else {
          current.dragOffsetX = 0;
          current.dragOffsetZ = 0;
        }
        current.draggedRackId = node.nodeId;
        controls.enabled = false;
        renderer.domElement.style.cursor = "grabbing";
      } else if (shouldBoxDrag && node && isBoxLike(node.nodeType)) {
        const support = state.nodes.find((entry) => entry.nodeId === node.parentNodeId) ?? null;
        raycaster.setFromCamera(pointer, camera);
        if (support) {
          const supportNormal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(support.rotX, support.rotY, support.rotZ));
          const supportPoint = new THREE.Vector3(support.posX, support.posY + support.sizeY, support.posZ);
          const supportPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(supportNormal, supportPoint);
          if (raycaster.ray.intersectPlane(supportPlane, dragPoint)) {
            const local = inverseRotateOffset(dragPoint.x - support.posX, dragPoint.z - support.posZ, support.rotY);
            const props = asRecord(node.props);
            const currentOffsetX = getNumericProp(props, "offsetX") ?? 0;
            const currentOffsetZ = getNumericProp(props, "offsetZ") ?? 0;
            current.boxDragOffsetX = currentOffsetX - local.x;
            current.boxDragOffsetZ = currentOffsetZ - local.z;
          } else {
            current.boxDragOffsetX = 0;
            current.boxDragOffsetZ = 0;
          }
        } else {
          // Root-level object (e.g. pallet on floor): drag by changing posX/posZ on floor plane.
          if (raycaster.ray.intersectPlane(floorPlane, dragPoint)) {
            current.boxDragOffsetX = node.posX - dragPoint.x;
            current.boxDragOffsetZ = node.posZ - dragPoint.z;
          } else {
            current.boxDragOffsetX = 0;
            current.boxDragOffsetZ = 0;
          }
        }
        current.draggedBoxId = node.nodeId;
        controls.enabled = false;
        renderer.domElement.style.cursor = "grabbing";
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = threeRef.current;
      if (!current) return;
      setPointer(event);
      const id = pickNodeId();
      if (id !== hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = id;
        // Important: don't trigger React state updates/rebuild on hover.
      }

      if (dragBoxModeRef.current && current.draggedBoxId) {
        current.needsRebuild = true;
        current.needsRender = true;
        const draggedBoxId = current.draggedBoxId;
        setLayoutState((state) => {
          if (!state) return state;
          const box = state.nodes.find((entry) => entry.nodeId === draggedBoxId);
          if (!box) return state;
          const support = state.nodes.find((entry) => entry.nodeId === box.parentNodeId) ?? null;
          raycaster.setFromCamera(pointer, camera);
          if (!support) {
            if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return state;
            const nextX = Number((dragPoint.x + current.boxDragOffsetX).toFixed(3));
            const nextZ = Number((dragPoint.z + current.boxDragOffsetZ).toFixed(3));
            return {
              ...state,
              nodes: state.nodes.map((entry) =>
                entry.nodeId === draggedBoxId ? { ...entry, posX: nextX, posZ: nextZ, posY: 0 } : entry
              ),
            };
          }
          const supportNormal = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(support.rotX, support.rotY, support.rotZ));
          const supportPoint = new THREE.Vector3(support.posX, support.posY + support.sizeY, support.posZ);
          const supportPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(supportNormal, supportPoint);
          if (!raycaster.ray.intersectPlane(supportPlane, dragPoint)) return state;
          const local = inverseRotateOffset(dragPoint.x - support.posX, dragPoint.z - support.posZ, support.rotY);
          const supportHalfX = Math.max(support.sizeX / 2 - box.sizeX / 2, 0);
          const supportHalfZ = Math.max(support.sizeZ / 2 - box.sizeZ / 2, 0);
          const snapStepX = Math.max(Math.min(box.sizeX / 4, 0.25), 0.05);
          const snapStepZ = Math.max(Math.min(box.sizeZ / 4, 0.25), 0.05);
          const nextProps = {
            ...(asRecord(box.props) ?? {}),
            offsetX: Number(
              snapToGrid(clamp(local.x + current.boxDragOffsetX, -supportHalfX, supportHalfX), snapStepX).toFixed(3)
            ),
            offsetZ: Number(
              snapToGrid(clamp(local.z + current.boxDragOffsetZ, -supportHalfZ, supportHalfZ), snapStepZ).toFixed(3)
            ),
            stackLevel: Math.max(Math.trunc(getNumericProp(asRecord(box.props), "stackLevel") ?? 0), 0),
          };
          return {
            ...state,
            nodes: normalizeVirtualLayout(state.nodes.map((entry) => (entry.nodeId === draggedBoxId ? { ...entry, props: nextProps } : entry))),
          };
        });
        return;
      }

      if (!dragRackModeRef.current || !current.draggedRackId) return;
      current.needsRebuild = true;
      current.needsRender = true;
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(floorPlane, dragPoint)) return;
      const draggedRackId = current.draggedRackId;
      setLayoutState((state) => {
        if (!state) return state;
        const rack = state.nodes.find((entry) => entry.nodeId === draggedRackId);
        if (!rack) return state;
        const nextRackX = Number((dragPoint.x + current.dragOffsetX).toFixed(3));
        const nextRackZ = Number((dragPoint.z + current.dragOffsetZ).toFixed(3));
        const deltaX = nextRackX - rack.posX;
        const deltaZ = nextRackZ - rack.posZ;
        const affectedIds = collectDescendantNodeIds(state.nodes, draggedRackId);
        return {
          ...state,
          nodes: state.nodes.map((entry) =>
            affectedIds.has(entry.nodeId)
              ? {
                  ...entry,
                  posX: Number((entry.posX + deltaX).toFixed(3)),
                  posZ: Number((entry.posZ + deltaZ).toFixed(3)),
                }
              : entry
          ),
        };
      });
    };

    const onPointerUp = () => {
      const current = threeRef.current;
      const state = layoutStateRef.current;
      if (!current || !state) return;

      if (dragBoxModeRef.current && current.draggedBoxId) {
        const nodeId = current.draggedBoxId;
        current.draggedBoxId = "";
        controls.enabled = true;
        renderer.domElement.style.cursor = dragBoxModeRef.current ? "crosshair" : dragRackModeRef.current ? "grab" : "default";
        const box = state.nodes.find((entry) => entry.nodeId === nodeId);
        if (!box) return;
        void updateWmsVirtualNode({
          siteCode,
          nodeId: box.nodeId,
          parentNodeId: box.parentNodeId ?? undefined,
          props: asRecord(box.props) ?? null,
          posX: box.posX,
          posY: box.posY,
          posZ: box.posZ,
          rotX: box.rotX,
          rotY: box.rotY,
          rotZ: box.rotZ,
        }).catch((error) => {
          toast.error(error instanceof Error ? error.message : "Не удалось сохранить позицию короба");
        });
        return;
      }

      if (!dragRackModeRef.current || !current.draggedRackId) return;
      const nodeId = current.draggedRackId;
      current.draggedRackId = "";
      controls.enabled = true;
      renderer.domElement.style.cursor = dragBoxModeRef.current ? "crosshair" : dragRackModeRef.current ? "grab" : "default";
      const affectedIds = collectDescendantNodeIds(state.nodes, nodeId);
      void Promise.all(
        state.nodes
          .filter((entry) => affectedIds.has(entry.nodeId))
          .map((entry) =>
            updateWmsVirtualNode({
              siteCode,
              nodeId: entry.nodeId,
              posX: entry.posX,
              posZ: entry.posZ,
            })
          )
      ).catch((error) => {
        toast.error(error instanceof Error ? error.message : "Не удалось сохранить новую позицию стеллажа");
      });
    };

    const onPointerLeave = () => {
      const current = threeRef.current;
      if (!current) return;
      if (hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = "";
      }
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setPointer(event);
      const nodeId = pickNodeId();
      if (nodeId) setSelectedNodeId(nodeId);
      const menuW = 280;
      const menuH = 220;
      const pad = 8;
      const x = Math.max(pad, Math.min(event.clientX, window.innerWidth - menuW - pad));
      const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - menuH - pad));
      setSceneTools({ open: true, nodeId: nodeId || "", x, y });
    };

    const onResize = () => {
      camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
      renderer.setSize(host.clientWidth, host.clientHeight);
    };

    const animate = () => {
      // With damping off, controls.update() is cheap; render only when dirty or camera changes.
      controls.update();
      const current = threeRef.current;
      if (!current) return;
      if (current.needsRebuild) {
        rebuild();
        current.needsRebuild = false;
        current.needsRender = true;
      }
      if (current.needsRender) {

        const overlay = sceneOverlayRef.current;
        const viewport = sceneViewportRef.current;
        const state = layoutStateRef.current;
        const selectedNodeLocal = state?.nodes.find((node) => node.nodeId === selectedNodeIdRef.current) ?? null;
        if (overlay && viewport && selectedNodeLocal) {
          const anchor = new THREE.Vector3(
            selectedNodeLocal.posX,
            selectedNodeLocal.posY + Math.max(selectedNodeLocal.sizeY, 0.16) + 0.28,
            selectedNodeLocal.posZ
          );
          anchor.project(camera);
          const left = ((anchor.x + 1) / 2) * viewport.clientWidth;
          const top = ((-anchor.y + 1) / 2) * viewport.clientHeight;
          const visible = anchor.z > -1 && anchor.z < 1;
          overlay.style.display = visible ? "flex" : "none";
          overlay.style.left = `${left}px`;
          overlay.style.top = `${top}px`;
        } else if (overlay) {
          overlay.style.display = "none";
        }

        renderer.render(scene, camera);
        current.needsRender = false;
      }
      current.frame = requestAnimationFrame(animate);
    };

    threeRef.current.frame = requestAnimationFrame(animate);
    // Mark dirty on camera moves.
    controls.addEventListener("change", () => {
      const cur = threeRef.current;
      if (cur) cur.needsRender = true;
    });
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", onResize);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            onResize();
          })
        : null;
    if (resizeObserver) resizeObserver.observe(host);
    renderer.domElement.style.cursor = dragBoxModeRef.current ? "crosshair" : dragRackModeRef.current ? "grab" : "default";

    return () => {
      const current = threeRef.current;
      if (current) cancelAnimationFrame(current.frame);
      controls.dispose();
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      renderer.dispose();
      host.innerHTML = "";
      threeRef.current = null;
    };
  }, [siteCode]);

  async function refreshLayoutsAndCurrent(nextLayoutId?: string) {
    const layoutsData = await listWmsVirtualLayouts({ siteCode });
    setLayouts(layoutsData.layouts ?? []);
    setSelectedLayoutId(nextLayoutId ?? selectedLayoutId ?? layoutsData.layouts?.[0]?.layoutId ?? "");
  }

  async function handleCreateLayout() {
    setSaving(true);
    try {
      const data = await createWmsVirtualLayout({
        siteCode,
        layoutCode: newLayoutCode,
        name: newLayoutName,
        warehouseCode: newWarehouseCode || undefined,
        zoneCode: newZoneCode || undefined,
      });
      await refreshLayoutsAndCurrent(data.layout.layoutId);
      setLayoutState({
        layoutId: data.layout.layoutId,
        layoutCode: data.layout.layoutCode,
        name: data.layout.name,
        description: data.layout.description,
        warehouseCode: data.layout.warehouseCode,
        zoneCode: data.layout.zoneCode,
        scenePrefs: data.layout.scenePrefs ?? null,
        nodes: data.nodes,
      });
      contentsCacheRef.current.clear();
      setContentsVersion((v) => v + 1);
      setShowNewLayoutForm(false);
      toast.success("Виртуальный layout создан");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать layout");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveScenePrefs() {
    if (!layoutState) return;
    let lines: unknown = [];
    try {
      lines = JSON.parse(floorLinesJson || "[]") as unknown;
      if (!Array.isArray(lines)) throw new Error("not array");
    } catch {
      toast.error("Неверный JSON для floorLines (нужен массив объектов {x1,z1,x2,z2,dashed?}).");
      return;
    }
    setSaving(true);
    try {
      await updateWmsVirtualLayout({
        siteCode,
        layoutId: layoutState.layoutId,
        name: layoutState.name,
        scenePrefs: {
          ...(layoutState.scenePrefs ?? {}),
          floorPlanDataUrl: floorPlanDraft.trim() || null,
          floorLines: lines,
        },
      });
      await reloadLayout();
      toast.success("Пол и разметка сохранены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить сцену");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateRackTemplate() {
    if (!layoutState) return;
    setSaving(true);
    try {
      const rackIndex = layoutState.nodes.filter((node) => node.nodeType === "rack").length + 1;
      const rackX = (rackIndex - 1) * 2.6;
      const shelfCount = 4;
      const rack = await createWmsVirtualNode({
        siteCode,
        layoutId: layoutState.layoutId,
        parentNodeId: null,
        nodeType: "rack",
        label: `Стеллаж ${rackIndex}`,
        code: `RACK-${String(rackIndex).padStart(2, "0")}`,
        posX: rackX,
        posY: 0,
        posZ: 0,
        sizeX: 1.7,
        sizeY: 3.2,
        sizeZ: 0.9,
        sortOrder: rackIndex * 10,
        props: { shelfCount, postThickness: 0.08, beamHeight: 0.1 },
      });
      for (let i = 0; i < shelfCount; i += 1) {
        const placement = getRackShelfPlacement(
          {
            posX: rackX,
            posY: 0,
            posZ: 0,
            sizeX: 1.7,
            sizeY: 3.2,
            sizeZ: 0.9,
            props: { shelfCount, postThickness: 0.08, beamHeight: 0.1 },
          },
          i,
          0.05
        );
        await createWmsVirtualNode({
          siteCode,
          layoutId: layoutState.layoutId,
          parentNodeId: rack.nodeId,
          nodeType: "shelf",
          label: `Полка ${rackIndex}.${i + 1}`,
          code: `SHELF-${String(rackIndex).padStart(2, "0")}-${i + 1}`,
          posX: placement.posX,
          posY: placement.posY,
          posZ: placement.posZ,
          sizeX: placement.sizeX,
          sizeY: placement.sizeY,
          sizeZ: placement.sizeZ,
          sortOrder: (i + 1) * 10,
        });
      }
      await reloadLayout();
      toast.success("Стеллаж с полками добавлен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить стеллаж");
    } finally {
      setSaving(false);
    }
  }

  async function handleGenerateShelves() {
    if (!layoutState || !selectedNode || selectedNode.nodeType !== "rack") return;
    setSaving(true);
    try {
      const props = asRecord(selectedNode.props);
      const targetShelfCount = Math.max(Math.trunc(getNumericProp(props, "shelfCount") ?? 4), 1);
      const existingShelves = layoutState.nodes
        .filter((node) => node.parentNodeId === selectedNode.nodeId && node.nodeType === "shelf")
        .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.nodeId) - Number(b.nodeId));
      const excessShelves = existingShelves.slice(targetShelfCount);
      for (const s of excessShelves) {
        await deleteWmsVirtualNode({ siteCode, nodeId: s.nodeId });
      }
      const keptCount = existingShelves.length - excessShelves.length;
      for (let i = keptCount; i < targetShelfCount; i += 1) {
        const placement = getRackShelfPlacement(selectedNode, i, 0.1);
        await createWmsVirtualNode({
          siteCode,
          layoutId: layoutState.layoutId,
          parentNodeId: selectedNode.nodeId,
          nodeType: "shelf",
          label: `Полка ${selectedNode.label} ${i + 1}`,
          code: `${selectedNode.code ?? "SHELF"}-${i + 1}`,
          posX: placement.posX,
          posY: placement.posY,
          posZ: placement.posZ,
          sizeX: placement.sizeX,
          sizeY: placement.sizeY,
          sizeZ: placement.sizeZ,
          sortOrder: (i + 1) * 10,
        });
      }
      await reloadLayout();
      toast.success("Полки сгенерированы");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сгенерировать полки");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateNode(nodeType: WmsVirtualNodeType) {
    if (!layoutState) return;
    setSaving(true);
    try {
      if (nodeType === "shelf" && selectedNode?.nodeType !== "rack") {
        toast.error("Сначала выберите стеллаж");
        return;
      }
      // Pallet can be created on shelf, in room, or directly on the floor (layout root) for legacy layouts without "room".
      if (nodeType === "pallet_slot" && selectedNode?.nodeType !== "pallet") {
        toast.error("Сначала выберите палету");
        return;
      }
      if (nodeType === "box" && selectedNode?.nodeType !== "shelf") {
        if (
          selectedNode?.nodeType !== "box" &&
          selectedNode?.nodeType !== "bin" &&
          selectedNode?.nodeType !== "container" &&
          selectedNode?.nodeType !== "pallet" &&
          selectedNode?.nodeType !== "pallet_slot"
        ) {
          toast.error("Сначала выберите полку или короб-опору");
          return;
        }
      }

      const selectedIsSupport =
        selectedNode?.nodeType === "shelf" ||
        selectedNode?.nodeType === "box" ||
        selectedNode?.nodeType === "bin" ||
        selectedNode?.nodeType === "container" ||
        selectedNode?.nodeType === "pallet" ||
        selectedNode?.nodeType === "pallet_slot";

      if (nodeType === "box" && !selectedIsSupport) {
        toast.error("Сначала выберите полку или короб-опору");
        return;
      }

      const siblings = layoutState.nodes.filter((node) => node.parentNodeId === selectedNodeId);
      if (nodeType === "shelf" && selectedNode) {
        const nextShelfCount = siblings.length + 1;
        const rackProps = { ...(asRecord(selectedNode.props) ?? {}) } as Record<string, unknown>;
        rackProps.shelfCount = nextShelfCount;
        const currentH = Math.max(selectedNode.sizeY, 0.8);
        const targetGap = 0.65;
        const desiredH = Math.max(currentH, targetGap * (nextShelfCount + 1));
        if (desiredH !== selectedNode.sizeY || (getNumericProp(asRecord(selectedNode.props), "shelfCount") ?? 0) !== nextShelfCount) {
          await updateWmsVirtualNode({
            siteCode,
            nodeId: selectedNode.nodeId,
            sizeY: desiredH,
            props: rackProps,
          });
        }
        const placement = getRackShelfPlacement({ ...selectedNode, sizeY: desiredH, props: rackProps }, siblings.length, 0.1);
        await createWmsVirtualNode({
          siteCode,
          layoutId: layoutState.layoutId,
          parentNodeId: selectedNode.nodeId,
          nodeType: "shelf",
          label: `Полка ${siblings.length + 1}`,
          code: `${selectedNode.code ?? "SHELF"}-${siblings.length + 1}`,
          posX: placement.posX,
          posY: placement.posY,
          posZ: placement.posZ,
          sizeX: placement.sizeX,
          sizeY: placement.sizeY,
          sizeZ: placement.sizeZ,
          sortOrder: (siblings.length + 1) * 10,
        });
      }

      if (nodeType === "box" && selectedNode && selectedIsSupport) {
        const rowLength = Math.max(Math.floor(selectedNode.sizeX / 0.55), 1);
        const index = siblings.length;
        const col = index % rowLength;
        const row = Math.floor(index / rowLength);
        const boxHeight = 0.42;
        const startOffsetX = -selectedNode.sizeX / 2 + 0.34;
        const offsetX = startOffsetX + col * 0.62;
        const offsetZ = 0;
        const rotated = rotateOffset(offsetX, offsetZ, selectedNode.rotY);
        await createWmsVirtualNode({
          siteCode,
          layoutId: layoutState.layoutId,
          parentNodeId: selectedNode.nodeId,
          nodeType: "box",
          label: `Короб ${siblings.length + 1}`,
          code: `${selectedNode.code ?? "BOX"}-${siblings.length + 1}`,
          posX: selectedNode.posX + rotated.x,
          posY: selectedNode.posY + selectedNode.sizeY + row * (boxHeight + 0.04),
          posZ: selectedNode.posZ + rotated.z,
          sizeX: 0.5,
          sizeY: boxHeight,
          sizeZ: 0.5,
          rotX: selectedNode.rotX,
          rotY: selectedNode.rotY,
          rotZ: selectedNode.rotZ,
          sortOrder: (siblings.length + 1) * 10,
          props: { capacityQty: 100, offsetX, offsetZ, stackLevel: row, note: "" },
        });
      }

      if (nodeType === "pallet") {
        const support =
          selectedNode?.nodeType === "shelf" || selectedNode?.nodeType === "room" ? selectedNode : null;
        const rootSiblings = layoutState.nodes.filter((node) => node.parentNodeId == null);
        const index = (support ? siblings : rootSiblings).filter((n) => n.nodeType === "pallet").length;
        const baseSizeX = support?.sizeX ?? 18;
        const rowLength = Math.max(Math.floor(baseSizeX / 1.35), 1);
        const col = index % rowLength;
        const row = Math.floor(index / rowLength);
        const palletH = 0.16;
        const startOffsetX = -(support?.sizeX ?? (rowLength * 1.35)) / 2 + 0.62;
        const offsetX = startOffsetX + col * 1.32;
        const offsetZ = -2.4 - row * 1.02; // spread pallets along Z on the floor/shelf
        const rotated = rotateOffset(offsetX, offsetZ, support?.rotY ?? 0);
        // Euro pallet default size.
        await createWmsVirtualNode({
          siteCode,
          layoutId: layoutState.layoutId,
          parentNodeId: support ? support.nodeId : null,
          nodeType: "pallet",
          label: `Палета ${index + 1}`,
          code: `${support?.code ?? "PALLET"}-${index + 1}`,
          posX: (support?.posX ?? 0) + rotated.x,
          posY:
            support?.nodeType === "shelf"
              ? support.posY + support.sizeY + row * (palletH + 0.04)
              : support?.nodeType === "room"
                ? support.posY
                : 0,
          posZ: (support?.posZ ?? 0) + rotated.z,
          sizeX: 1.2,
          sizeY: palletH,
          sizeZ: 0.8,
          rotX: support?.rotX ?? 0,
          rotY: support?.rotY ?? 0,
          rotZ: support?.rotZ ?? 0,
          sortOrder: (index + 1) * 10,
          props: {
            capacityQty: 0,
            offsetX: support ? offsetX : 0,
            offsetZ: support ? offsetZ : 0,
            stackLevel: support ? row : 0,
            note: "",
            palletRowsX: 7,
            palletRowsZ: 3,
            palletLayers: 6,
            palletFraction: 1,
            bottlesPerPack: 12,
            packsPerPallet: 126,
          },
        });
      }

      if (nodeType === "pallet_slot" && selectedNode?.nodeType === "pallet") {
        const index = siblings.length;
        const offsetX = 0;
        const offsetZ = 0;
        const rotated = rotateOffset(offsetX, offsetZ, selectedNode.rotY);
        await createWmsVirtualNode({
          siteCode,
          layoutId: layoutState.layoutId,
          parentNodeId: selectedNode.nodeId,
          nodeType: "pallet_slot",
          label: `Слот ${index + 1}`,
          code: `${selectedNode.code ?? "SLOT"}-${index + 1}`,
          posX: selectedNode.posX + rotated.x,
          posY: selectedNode.posY + selectedNode.sizeY,
          posZ: selectedNode.posZ + rotated.z,
          sizeX: 0.3,
          sizeY: 0.18,
          sizeZ: 0.3,
          rotX: selectedNode.rotX,
          rotY: selectedNode.rotY,
          rotZ: selectedNode.rotZ,
          sortOrder: (index + 1) * 10,
          props: { capacityQty: 0, offsetX, offsetZ, stackLevel: 0, note: "" },
        });
      }

      await reloadLayout();
      toast.success(nodeType === "shelf" ? "Полка добавлена" : nodeType === "pallet" ? "Палета добавлена" : "Короб добавлен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить объект");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveNode(): Promise<boolean> {
    if (!selectedNode) return false;
    setSaving(true);
    try {
      const nextProps = { ...(asRecord(selectedNode.props) ?? {}) } as Record<string, unknown>;
      if (capacityQty.trim()) nextProps.capacityQty = Number(capacityQty);
      else delete nextProps.capacityQty;
      if (selectedNode.nodeType === "rack") {
        nextProps.shelfCount = Math.max(Math.trunc(Number(shelfCount || "4")), 1);
        if (postThickness.trim()) nextProps.postThickness = Number(postThickness);
        else delete nextProps.postThickness;
        if (beamHeight.trim()) nextProps.beamHeight = Number(beamHeight);
        else delete nextProps.beamHeight;
      } else if (
        selectedNode.nodeType === "box" ||
        selectedNode.nodeType === "bin" ||
        selectedNode.nodeType === "container" ||
        selectedNode.nodeType === "pallet" ||
        selectedNode.nodeType === "pallet_slot"
      ) {
        nextProps.offsetX = Number(boxOffsetX || "0");
        nextProps.offsetZ = Number(boxOffsetZ || "0");
        nextProps.stackLevel = Math.max(Math.trunc(Number(boxStackLevel || "0")), 0);
        nextProps.note = boxNote.trim();
        nextProps.stickerScale = clamp(Number(stickerScale || "1"), 0.35, 2);
        nextProps.stickerFontPx = clamp(Math.round(Number(stickerFontPx || "34")), 12, 72);
        nextProps.stickerOffsetX = Number(stickerOffsetX || "0");
        nextProps.stickerOffsetY = clamp(Number(stickerOffsetY || "0.62"), 0.08, 0.98);
        nextProps.stickerZPad = Number(stickerZPad || "0.002");
      }
      if (selectedNode.nodeType === "pallet") {
        nextProps.palletRowsX = Math.max(Math.trunc(Number(palletRowsX || "7")), 1);
        nextProps.palletRowsZ = Math.max(Math.trunc(Number(palletRowsZ || "3")), 1);
        nextProps.palletLayers = Math.max(Math.trunc(Number(palletLayers || "1")), 1);
        nextProps.palletFraction = clamp(Number(palletFraction || "1"), 0.25, 1);
        nextProps.bottlesPerPack = Math.max(Math.trunc(Number(bottlesPerPack || "12")), 1);
        nextProps.packsPerPallet = Math.max(Math.trunc(Number(packsPerPallet || "126")), 1);
      }

      const nextSizeX = Number(sizeX);
      const nextSizeY = Number(sizeY);
      const nextSizeZ = Number(sizeZ);

      const nextRotX = degreesToRadians(rotX);
      const nextRotY = degreesToRadians(rotY);
      const nextRotZ = degreesToRadians(rotZ);

      await updateWmsVirtualNode({
        siteCode,
        nodeId: selectedNode.nodeId,
        label: nodeLabel,
        code: nodeCode || undefined,
        parentNodeId:
          selectedNode.nodeType === "box" && targetSupportId.trim() ? targetSupportId.trim() : undefined,
        locationCode: locationCode || null,
        loadUnitCode: loadUnitCode || null,
        rotX: nextRotX,
        rotY: nextRotY,
        rotZ: nextRotZ,
        sizeX: nextSizeX,
        sizeY: nextSizeY,
        sizeZ: nextSizeZ,
        props: nextProps,
      });

      if (selectedNode.nodeType === "rack" && layoutState) {
        const rawLevels = Math.trunc(Number(nextProps.shelfCount));
        const levels = Number.isFinite(rawLevels) && rawLevels > 0 ? rawLevels : 1;
        const shelvesSorted = layoutState.nodes
          .filter((n) => n.parentNodeId === selectedNode.nodeId && n.nodeType === "shelf")
          .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.nodeId) - Number(b.nodeId));
        const excessShelves = shelvesSorted.slice(levels);
        for (const s of excessShelves) {
          await deleteWmsVirtualNode({ siteCode, nodeId: s.nodeId });
        }

        const data = await getWmsVirtualLayout({ siteCode, layoutId: layoutState.layoutId, includeContents: false });
        const normalizedNodes = normalizeVirtualLayout(data.nodes);
        const affectedIds = collectDescendantNodeIds(normalizedNodes, selectedNode.nodeId);
        await Promise.all(
          normalizedNodes
            .filter((node) => affectedIds.has(node.nodeId) && node.nodeId !== selectedNode.nodeId)
            .map((node) =>
              updateWmsVirtualNode({
                siteCode,
                nodeId: node.nodeId,
                posX: node.posX,
                posY: node.posY,
                posZ: node.posZ,
                sizeX: node.sizeX,
                sizeY: node.sizeY,
                sizeZ: node.sizeZ,
              })
            )
        );
      }

      await saveWmsVirtualNodeContents({
        siteCode,
        nodeId: selectedNode.nodeId,
        contents: contentRows
          .filter((row) => row.itemCode.trim())
          .map((row, index) => ({
            itemCode: row.itemCode.trim(),
            qty: Number(row.qty || "0"),
            uomCode: row.uomCode.trim() || "pcs",
            lotCode: row.lotCode.trim() || undefined,
            note: row.note.trim() || undefined,
            sortOrder: (index + 1) * 10,
          })),
      });
      try {
        const refreshed = await getWmsVirtualNodeContents({ siteCode, nodeId: selectedNode.nodeId });
        contentsCacheRef.current.set(selectedNode.nodeId, refreshed.contents ?? []);
        setContentsVersion((v) => v + 1);
      } catch {
        // ignore
      }
      await reloadLayout();
      toast.success("Узел сохранён");
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить узел");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteNode() {
    if (!selectedNode) return;
    setSaving(true);
    try {
      await deleteWmsVirtualNode({ siteCode, nodeId: selectedNode.nodeId });
      setSelectedNodeId("");
      await reloadLayout();
      toast.success("Узел удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить узел");
    } finally {
      setSaving(false);
    }
  }

  async function handleGeneratePalletSlots() {
    if (!layoutState || !selectedNode || selectedNode.nodeType !== "pallet") return;
    setSaving(true);
    try {
      const props = asRecord(selectedNode.props);
      const rowsX = Math.max(Math.trunc(getNumericProp(props, "palletRowsX") ?? Number(palletRowsX || "7")), 1);
      const rowsZ = Math.max(Math.trunc(getNumericProp(props, "palletRowsZ") ?? Number(palletRowsZ || "3")), 1);
      const layers = Math.max(Math.trunc(getNumericProp(props, "palletLayers") ?? Number(palletLayers || "1")), 1);
      const frac = clamp(getNumericProp(props, "palletFraction") ?? Number(palletFraction || "1"), 0.25, 1);
      const effectiveRowsX = Math.max(Math.trunc(rowsX * frac), 1);

      const existing = layoutState.nodes
        .filter((n) => n.parentNodeId === selectedNode.nodeId && n.nodeType === "pallet_slot")
        .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.nodeId) - Number(b.nodeId));
      const needed = effectiveRowsX * rowsZ * layers;

      const slotGapX = selectedNode.sizeX / Math.max(effectiveRowsX, 1);
      const slotGapZ = selectedNode.sizeZ / Math.max(rowsZ, 1);
      const slotSizeX = Math.max(Math.min(slotGapX * 0.78, 0.48), 0.18);
      const slotSizeZ = Math.max(Math.min(slotGapZ * 0.78, 0.48), 0.18);
      const slotSizeY = 0.18;

      const startX = -selectedNode.sizeX / 2 + slotGapX / 2;
      const startZ = -selectedNode.sizeZ / 2 + slotGapZ / 2;

      for (let idx = 0; idx < needed; idx += 1) {
        const layer = Math.floor(idx / (effectiveRowsX * rowsZ));
        const inLayer = idx % (effectiveRowsX * rowsZ);
        const rz = Math.floor(inLayer / effectiveRowsX);
        const rx = inLayer % effectiveRowsX;

        const offsetX = Number((startX + rx * slotGapX).toFixed(3));
        const offsetZ = Number((startZ + rz * slotGapZ).toFixed(3));

        const label = `Слот ${idx + 1}`;
        const code = `${selectedNode.code ?? "SLOT"}-${idx + 1}`;
        const baseProps = { capacityQty: 0, offsetX, offsetZ, stackLevel: layer, note: "" };

        const existingNode = existing[idx];
        if (!existingNode) {
          await createWmsVirtualNode({
            siteCode,
            layoutId: layoutState.layoutId,
            parentNodeId: selectedNode.nodeId,
            nodeType: "pallet_slot",
            label,
            code,
            posX: selectedNode.posX,
            posY: selectedNode.posY + selectedNode.sizeY,
            posZ: selectedNode.posZ,
            sizeX: slotSizeX,
            sizeY: slotSizeY,
            sizeZ: slotSizeZ,
            rotX: selectedNode.rotX,
            rotY: selectedNode.rotY,
            rotZ: selectedNode.rotZ,
            sortOrder: (idx + 1) * 10,
            props: baseProps,
          });
        } else {
          await updateWmsVirtualNode({
            siteCode,
            nodeId: existingNode.nodeId,
            label,
            code,
            sizeX: slotSizeX,
            sizeY: slotSizeY,
            sizeZ: slotSizeZ,
            props: { ...(asRecord(existingNode.props) ?? {}), ...baseProps },
          });
        }
      }

      const excess = existing.slice(needed);
      for (const n of excess) {
        await deleteWmsVirtualNode({ siteCode, nodeId: n.nodeId });
      }

      await reloadLayout();
      toast.success("Слоты палеты обновлены");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сгенерировать слоты палеты");
    } finally {
      setSaving(false);
    }
  }

  function handleCopyPallet() {
    if (!selectedNode || selectedNode.nodeType !== "pallet") return;
    try {
      const payload = {
        sizeX: selectedNode.sizeX,
        sizeY: selectedNode.sizeY,
        sizeZ: selectedNode.sizeZ,
        props: asRecord(selectedNode.props) ?? {},
      };
      localStorage.setItem(palletClipboardKey, JSON.stringify(payload));
      toast.success("Палета скопирована");
    } catch {
      toast.error("Не удалось скопировать палету");
    }
  }

  function handlePastePallet() {
    if (!selectedNode || selectedNode.nodeType !== "pallet") return;
    try {
      const raw = localStorage.getItem(palletClipboardKey);
      if (!raw) {
        toast.error("Буфер палеты пуст");
        return;
      }
      const parsed = JSON.parse(raw) as { sizeX?: number; sizeY?: number; sizeZ?: number; props?: Record<string, unknown> };
      const p = parsed?.props && typeof parsed.props === "object" ? parsed.props : {};
      setSizeX(String(parsed.sizeX ?? selectedNode.sizeX));
      setSizeY(String(parsed.sizeY ?? selectedNode.sizeY));
      setSizeZ(String(parsed.sizeZ ?? selectedNode.sizeZ));
      setPalletRowsX(String(Math.trunc(Number(p.palletRowsX ?? palletRowsX))));
      setPalletRowsZ(String(Math.trunc(Number(p.palletRowsZ ?? palletRowsZ))));
      setPalletLayers(String(Math.trunc(Number(p.palletLayers ?? palletLayers))));
      setPalletFraction(String(Number(p.palletFraction ?? palletFraction)));
      setBottlesPerPack(String(Math.trunc(Number(p.bottlesPerPack ?? bottlesPerPack))));
      setPacksPerPallet(String(Math.trunc(Number(p.packsPerPallet ?? packsPerPallet))));
      toast.success("Настройки палеты вставлены (нажмите Сохранить)");
    } catch {
      toast.error("Не удалось вставить палету");
    }
  }

  const tree = React.useMemo(() => buildNodeTree(layoutState?.nodes ?? []), [layoutState?.nodes]);
  const selectedContents = React.useMemo(() => {
    if (!selectedNode) return [];
    return contentsCacheRef.current.get(selectedNode.nodeId) ?? [];
  }, [selectedNode, contentsVersion]);
  const selectedStatus = selectedNode ? statusByNode.get(selectedNode.nodeId) ?? null : null;
  const boxSupportOptions = React.useMemo(
    () =>
      layoutState?.nodes.filter(
        (node) =>
          node.nodeType === "shelf" ||
          node.nodeType === "box" ||
          node.nodeType === "bin" ||
          node.nodeType === "container" ||
          node.nodeType === "pallet" ||
          node.nodeType === "pallet_slot"
      ) ?? [],
    [layoutState?.nodes]
  );

  function updateContentRow(id: string, patch: Partial<EditableContentRow>) {
    setContentRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function addContentRow() {
    setContentRows((current) => [
      ...current,
      {
        id: `row-${Date.now()}-${current.length + 1}`,
        itemCode: "",
        qty: "1",
        uomCode: "pcs",
        lotCode: "",
        note: "",
      },
    ]);
  }

  function removeContentRow(id: string) {
    setContentRows((current) => {
      const next = current.filter((row) => row.id !== id);
      return next.length > 0 ? next : [{ id: "row-1", itemCode: "", qty: "1", uomCode: "pcs", lotCode: "", note: "" }];
    });
  }

  function renderTree(parentId: string | null, depth = 0): React.ReactNode {
    const items = tree.get(parentId ?? "root") ?? [];
    return items.map((node) => {
      if (!showPalletSlotsInTree && node.nodeType === "pallet_slot") return null;
      const status = statusByNode.get(node.nodeId) ?? buildNodeStatus(node, []);
      return (
        <div key={node.nodeId} className="space-y-1" style={{ marginLeft: depth * 8 }}>
          <button
            type="button"
            onClick={() => setSelectedNodeId(node.nodeId)}
            className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
              node.nodeId === selectedNodeId ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
            }`}
          >
            <div className="flex items-center justify-between gap-1.5">
              <div className="truncate font-medium">{node.label}</div>
              <div className="text-muted-foreground shrink-0 text-[10px] uppercase">{node.nodeType}</div>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`rounded px-1 py-0.5 text-[9px] font-medium ${status.colorClass}`}>{status.label}</span>
              <span className="text-muted-foreground truncate text-[10px]">{status.preview}</span>
            </div>
          </button>
          <div className="space-y-1">{renderTree(node.nodeId, depth + 1)}</div>
        </div>
      );
    });
  }

  React.useEffect(() => {
    if (!sceneTools.open) return;
    const close = () => setSceneTools({ open: false, nodeId: "", x: 0, y: 0 });
    const onDown = (e: PointerEvent) => {
      if (sceneToolsRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [sceneTools.open]);

  return (
    <>
    <div className="bg-background flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="flex min-h-0 min-w-0 flex-1 flex-row">
        <aside className="border-border bg-muted/25 flex min-h-0 w-[min(280px,26vw)] min-w-[220px] max-w-[300px] shrink-0 flex-col border-r">
          <div className="border-border shrink-0 space-y-2 border-b px-2.5 py-2">
            <div className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">Проект</div>
            <WmsSiteCodeField
              value={siteCode}
              onChange={setSiteCode}
              id="virtual-site-code"
              inputClassName="h-8 w-full max-w-none"
            />
            <div className="space-y-1">
              <Label className="text-muted-foreground text-[10px] uppercase">Layout</Label>
              <select
                value={selectedLayoutId}
                onChange={(e) => setSelectedLayoutId(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Выберите…</option>
                {layouts.map((layout) => (
                  <option key={layout.layoutId} value={layout.layoutId}>
                    {layout.layoutCode} · {layout.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 w-full text-xs"
              onClick={() => void reloadLayout()}
              disabled={loading}
            >
              <RefreshCcw className="size-3.5 shrink-0" /> Обновить
            </Button>
            <label className="text-muted-foreground flex items-center gap-1.5 pt-1 text-[10px] font-medium">
              <input type="checkbox" checked={showPalletSlotsInTree} onChange={(e) => setShowPalletSlotsInTree(e.target.checked)} />
              показывать слоты палет
            </label>
          </div>

          {showNewLayoutForm ? (
            <div className="border-border shrink-0 space-y-2 border-b bg-background/80 px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">Новый layout</span>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowNewLayoutForm(false)}>
                  ✕
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] uppercase">Код</Label>
                <Input className="h-8 text-xs" value={newLayoutCode} onChange={(e) => setNewLayoutCode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground text-[10px] uppercase">Название</Label>
                <Input className="h-8 text-xs" value={newLayoutName} onChange={(e) => setNewLayoutName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px] uppercase">Склад</Label>
                  <Input className="h-8 text-xs" value={newWarehouseCode} onChange={(e) => setNewWarehouseCode(e.target.value)} placeholder="FG" />
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px] uppercase">Зона</Label>
                  <Input className="h-8 text-xs" value={newZoneCode} onChange={(e) => setNewZoneCode(e.target.value)} placeholder="RACK" />
                </div>
              </div>
              <Button type="button" size="sm" className="h-8 w-full text-xs" onClick={() => void handleCreateLayout()} disabled={saving}>
                <Plus className="size-3.5" /> Создать
              </Button>
            </div>
          ) : (
            <div className="border-border shrink-0 border-b px-2 py-1.5">
              <Button type="button" variant="ghost" size="sm" className="h-7 w-full justify-start px-2 text-xs" onClick={() => setShowNewLayoutForm(true)}>
                <Plus className="size-3.5" /> Новый layout…
              </Button>
            </div>
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="border-border text-muted-foreground flex shrink-0 items-center gap-1.5 border-b px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
              <Layers className="size-3.5 opacity-70" />
              Иерархия
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-1.5 py-2 pr-3">
                {layoutState ? renderTree(null) : <div className="text-muted-foreground px-1 text-xs">Layout не выбран.</div>}
              </div>
            </ScrollArea>
          </div>
        </aside>

        <main className="bg-muted/15 flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="border-border bg-muted/40 flex h-9 shrink-0 flex-wrap items-center gap-1 border-b px-1.5 py-0.5 shadow-sm">
            <span className="text-muted-foreground hidden max-w-[200px] truncate text-[11px] sm:inline" title={layoutState?.name}>
              {layoutState ? layoutState.layoutCode : "—"}
            </span>
            {layoutState ? (
              <span className="text-muted-foreground hidden truncate text-[11px] md:inline" title={layoutState.name}>
                · {layoutState.name}
              </span>
            ) : null}
            <Separator orientation="vertical" className="mx-0.5 hidden h-5 sm:block" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              title="Шаблон стеллажа с полками"
              onClick={() => void handleCreateRackTemplate()}
              disabled={!layoutState || saving}
            >
              <Sparkles className="size-3.5" />
              <span className="hidden lg:inline">Стеллаж</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              title="Добавить палету (на пол или на полку)"
              onClick={() => void handleCreateNode("pallet")}
              disabled={!layoutState || saving}
            >
              <Plus className="size-3.5" />
              <span className="hidden lg:inline">Палета</span>
            </Button>
            <Button
              type="button"
              variant={dragRackMode ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              title="Перенос стеллажей"
              onClick={() => setDragRackMode((current) => !current)}
            >
              <Move className="size-3.5" />
              <span className="hidden lg:inline">Стелл.</span>
            </Button>
            <Button
              type="button"
              variant={dragBoxMode ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              title="Перенос коробов"
              onClick={() => setDragBoxMode((current) => !current)}
            >
              <Box className="size-3.5" />
              <span className="hidden lg:inline">Короб</span>
            </Button>
            <Separator orientation="vertical" className="mx-0.5 h-5" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              title="Сгенерировать полки"
              onClick={() => void handleGenerateShelves()}
              disabled={!layoutState || !selectedNode || selectedNode.nodeType !== "rack" || saving}
            >
              <Layers className="size-3.5" />
              <span className="hidden xl:inline">Полки</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void handleCreateNode("shelf")}
              disabled={!layoutState || !selectedNode || selectedNode.nodeType !== "rack" || saving}
            >
              <Plus className="size-3.5" /> <span className="hidden lg:inline">Полка</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void handleCreateNode("box")}
              disabled={!layoutState || !selectedNode || selectedNode.nodeType !== "shelf" || saving}
            >
              <Plus className="size-3.5" /> <span className="hidden lg:inline">Короб</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => void handleCreateNode("pallet")}
              disabled={!layoutState || !selectedNode || (selectedNode.nodeType !== "room" && selectedNode.nodeType !== "shelf") || saving}
            >
              <Plus className="size-3.5" /> <span className="hidden lg:inline">Палета</span>
            </Button>
          </div>
          <div ref={sceneViewportRef} className="relative min-h-0 flex-1 bg-zinc-950">
            <div ref={canvasHostRef} className="absolute inset-0 min-h-[160px]" />
              <div
                ref={sceneOverlayRef}
                className="absolute hidden -translate-x-1/2 -translate-y-full items-center gap-1 rounded-lg border bg-background/95 px-2 py-1 shadow-sm backdrop-blur"
              >
                {selectedNode?.nodeType === "rack" ? (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void handleCreateNode("shelf")} disabled={saving}>
                      + Полка
                    </Button>
                    <Button
                      type="button"
                      variant={dragRackMode ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setDragRackMode((current) => !current)}
                    >
                      Тянуть
                    </Button>
                  </>
                ) : null}
                {selectedNode?.nodeType === "shelf" ? (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void handleCreateNode("box")} disabled={saving}>
                      + Короб
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void handleCreateNode("pallet")} disabled={saving}>
                      + Палета
                    </Button>
                  </>
                ) : null}
                {selectedNode &&
                (selectedNode.nodeType === "box" ||
                  selectedNode.nodeType === "bin" ||
                  selectedNode.nodeType === "container" ||
                  selectedNode.nodeType === "pallet" ||
                  selectedNode.nodeType === "pallet_slot") ? (
                  <>
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void handleCreateNode("box")} disabled={saving}>
                      + Сверху
                    </Button>
                    {selectedNode.nodeType === "pallet" ? (
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={() => void handleCreateNode("pallet_slot")} disabled={saving}>
                        + Слот
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant={dragBoxMode ? "default" : "outline"}
                      size="sm"
                      className="h-7 px-2"
                      onClick={() => setDragBoxMode((current) => !current)}
                    >
                      Тянуть
                    </Button>
                  </>
                ) : null}
              </div>
          </div>
          <footer className="border-border bg-background/95 text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-2 py-1 text-[10px]">
            <span className="inline-flex items-center gap-1">
              <span className="rounded bg-slate-200 px-1 py-0.5 text-slate-800 dark:bg-slate-700 dark:text-slate-100">Пусто</span>
              <span className="rounded bg-emerald-200/80 px-1 py-0.5 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100">Занято</span>
              <span className="rounded bg-red-200/80 px-1 py-0.5 text-red-900 dark:bg-red-900/50 dark:text-red-100">FEFO</span>
              <span className="rounded bg-amber-200/80 px-1 py-0.5 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100">Переполн.</span>
            </span>
            <Separator orientation="vertical" className="hidden h-4 sm:block" />
            <span className="hidden sm:inline">ЛКМ вращение · Shift+ЛКМ сдвиг · колесо масштаб · средняя кнопка сдвиг · ПКМ меню у курсора</span>
            {selectedNode && selectedStatus ? (
              <span className="ml-auto flex min-w-0 max-w-[55%] items-center gap-2 truncate sm:max-w-none">
                <span className="truncate font-medium text-foreground">{selectedNode.label}</span>
                <span className={`shrink-0 rounded px-1 py-0.5 font-medium ${selectedStatus.colorClass}`}>{selectedStatus.label}</span>
                <span className="text-muted-foreground hidden truncate lg:inline">{selectedStatus.detail ?? selectedStatus.preview}</span>
              </span>
            ) : null}
          </footer>
        </main>

        <aside className="border-border bg-card flex min-h-0 w-[min(400px,34vw)] min-w-[260px] max-w-[420px] shrink-0 flex-col border-l">
          <div className="border-border shrink-0 border-b px-3 py-2">
            <div className="text-xs font-semibold tracking-tight">Свойства</div>
            <div className="text-muted-foreground text-[10px] leading-tight">Пол сцены и параметры узла</div>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">
            {layoutState ? (
              <details className="rounded-lg border bg-muted/15 px-2 py-1.5">
                <summary className="cursor-pointer select-none text-xs font-medium">Пол сцены (план и линии)</summary>
                <div className="mt-2 space-y-2 pb-1">
                  <p className="text-muted-foreground text-[11px] leading-snug">
                    План — файл или data URL. Линии — JSON{" "}
                    <code className="text-[10px]">{"{ x1, z1, x2, z2, dashed?: boolean }"}</code> в метрах.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      className="max-w-[200px] text-xs"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = () => setFloorPlanDraft(typeof reader.result === "string" ? reader.result : "");
                        reader.readAsDataURL(file);
                      }}
                    />
                    <Button type="button" size="sm" variant="outline" onClick={() => setFloorPlanDraft("")} disabled={saving}>
                      Сбросить картинку
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleSaveScenePrefs()} disabled={saving}>
                      Сохранить пол
                    </Button>
                  </div>
                  <Textarea
                    value={floorPlanDraft}
                    onChange={(e) => setFloorPlanDraft(e.target.value)}
                    placeholder="data:image/png;base64,…"
                    className="min-h-[48px] font-mono text-[11px]"
                  />
                  <Label className="text-muted-foreground text-[10px] uppercase">Линии (JSON)</Label>
                  <Textarea
                    value={floorLinesJson}
                    onChange={(e) => setFloorLinesJson(e.target.value)}
                    className="min-h-[64px] font-mono text-[11px]"
                  />
                </div>
              </details>
            ) : null}
            {!selectedNode ? (
              <div className="text-muted-foreground text-sm">Выберите объект в структуре или на сцене.</div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-muted-foreground text-[10px] uppercase">Название</Label>
                    <Input value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-muted-foreground text-[10px] uppercase">Код объекта</Label>
                    <Input value={nodeCode} onChange={(e) => setNodeCode(e.target.value)} placeholder="RACK-01 / BOX-40x40" />
                  </div>
                  {isBoxLike(selectedNode.nodeType) ? (
                    <>
                      <div className="border-border bg-muted/25 space-y-2 rounded-lg border p-2 sm:col-span-2">
                        <div className="text-muted-foreground text-[10px] font-semibold uppercase">Габариты и положение</div>
                        <div className="text-foreground font-mono text-xs leading-relaxed">
                          {sizeX} × {sizeY} × {sizeZ} м
                          <span className="text-muted-foreground">
                            {" "}
                            · сдвиг X/Z {boxOffsetX} / {boxOffsetZ} · стопка {boxStackLevel}
                          </span>
                        </div>
                        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setBoxGeomModalOpen(true)}>
                          Размеры и положение…
                        </Button>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Capacity qty</Label>
                        <Input value={capacityQty} onChange={(e) => setCapacityQty(e.target.value)} placeholder="100" />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Ширина</Label>
                        <Input value={sizeX} onChange={(e) => setSizeX(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Высота</Label>
                        <Input value={sizeY} onChange={(e) => setSizeY(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Глубина</Label>
                        <Input value={sizeZ} onChange={(e) => setSizeZ(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Capacity qty</Label>
                        <Input value={capacityQty} onChange={(e) => setCapacityQty(e.target.value)} placeholder="100" />
                      </div>
                    </>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px] uppercase">Поворот X, градусы</Label>
                    <Input value={rotX} onChange={(e) => setRotX(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px] uppercase">Поворот Y, градусы</Label>
                    <Input value={rotY} onChange={(e) => setRotY(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px] uppercase">Поворот Z, градусы</Label>
                    <Input value={rotZ} onChange={(e) => setRotZ(e.target.value)} />
                  </div>
                </div>
                {selectedNode.nodeType === "rack" ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Число полок</Label>
                      <Input value={shelfCount} onChange={(e) => setShelfCount(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Толщина стойки</Label>
                      <Input value={postThickness} onChange={(e) => setPostThickness(e.target.value)} placeholder="0.08" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Высота балки</Label>
                      <Input value={beamHeight} onChange={(e) => setBeamHeight(e.target.value)} placeholder="0.1" />
                    </div>
                  </div>
                ) : null}
                {selectedNode.nodeType === "pallet" ? (
                  <div className="space-y-2 rounded-lg border bg-muted/15 p-2">
                    <div className="text-muted-foreground text-[10px] font-semibold uppercase">Палета (ряды/слои/упаковка)</div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Рядов X</Label>
                        <Input value={palletRowsX} onChange={(e) => setPalletRowsX(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Рядов Z</Label>
                        <Input value={palletRowsZ} onChange={(e) => setPalletRowsZ(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Слоёв</Label>
                        <Input value={palletLayers} onChange={(e) => setPalletLayers(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Доля палеты</Label>
                        <select
                          value={palletFraction}
                          onChange={(e) => setPalletFraction(e.target.value)}
                          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                        >
                          <option value="1">1 (полная)</option>
                          <option value="0.5">0.5 (половина)</option>
                          <option value="0.25">0.25</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Бутылок в упак.</Label>
                        <Input value={bottlesPerPack} onChange={(e) => setBottlesPerPack(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-muted-foreground text-[10px] uppercase">Упаковок в палете</Label>
                        <Input value={packsPerPallet} onChange={(e) => setPacksPerPallet(e.target.value)} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button type="button" size="sm" onClick={() => void handleGeneratePalletSlots()} disabled={saving}>
                        Сгенерировать слоты
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={handleCopyPallet} disabled={saving}>
                        Копировать
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={handlePastePallet} disabled={saving}>
                        Вставить
                      </Button>
                    </div>
                  </div>
                ) : null}

                <WmsLocationPicker siteCode={siteCode} label="Привязка к locationCode" value={locationCode} onChange={setLocationCode} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-muted-foreground text-[10px] uppercase">Load unit code</Label>
                    <Input value={loadUnitCode} onChange={(e) => setLoadUnitCode(e.target.value)} placeholder="PALLET-001" />
                  </div>
                  {selectedNode.nodeType === "box" ? (
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Опора: полка или короб</Label>
                      <select
                        value={targetSupportId}
                        onChange={(e) => setTargetSupportId(e.target.value)}
                        className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                      >
                        <option value="">Выберите опору…</option>
                        {boxSupportOptions
                          .filter((node) => node.nodeId !== selectedNode.nodeId)
                          .map((support) => (
                          <option key={support.nodeId} value={support.nodeId}>
                            {support.label} · {support.nodeType} {support.code ? `· ${support.code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
                {isBoxLike(selectedNode.nodeType) ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-muted-foreground text-[10px] uppercase">Записка на короб</Label>
                      <Input value={boxNote} onChange={(e) => setBoxNote(e.target.value)} placeholder="Например: брак / срочно / отбор" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Стикер: масштаб</Label>
                      <Input value={stickerScale} onChange={(e) => setStickerScale(e.target.value)} inputMode="decimal" placeholder="1" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Стикер: кегль</Label>
                      <Input value={stickerFontPx} onChange={(e) => setStickerFontPx(e.target.value)} inputMode="numeric" placeholder="34" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Стикер: сдвиг X</Label>
                      <Input value={stickerOffsetX} onChange={(e) => setStickerOffsetX(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground text-[10px] uppercase">Стикер: высота (0–1)</Label>
                      <Input value={stickerOffsetY} onChange={(e) => setStickerOffsetY(e.target.value)} />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-muted-foreground text-[10px] uppercase">Стикер: отступ от грани Z</Label>
                      <Input value={stickerZPad} onChange={(e) => setStickerZPad(e.target.value)} />
                    </div>
                  </div>
                ) : null}

                <div className="rounded-lg border border-dashed p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium">Содержимое</div>
                    <Button type="button" variant="outline" size="sm" onClick={addContentRow}>
                      <Plus className="size-4" /> Строка
                    </Button>
                  </div>
                  <div className="mt-3 space-y-3">
                    {contentRows.map((row, index) => (
                      <div key={row.id} className="rounded-lg border bg-background p-3">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <div className="text-xs font-medium">Строка {index + 1}</div>
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeContentRow(row.id)}>
                            Удалить
                          </Button>
                        </div>
                        <div className="space-y-3">
                          <WmsItemPicker
                            siteCode={siteCode}
                            label="Номенклатура"
                            value={row.itemCode}
                            onChange={(value) => updateContentRow(row.id, { itemCode: value })}
                          />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px] uppercase">Количество</Label>
                              <Input value={row.qty} onChange={(e) => updateContentRow(row.id, { qty: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px] uppercase">Ед. изм.</Label>
                              <Input value={row.uomCode} onChange={(e) => updateContentRow(row.id, { uomCode: e.target.value })} />
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px] uppercase">Партия / lot</Label>
                              <Input value={row.lotCode} onChange={(e) => updateContentRow(row.id, { lotCode: e.target.value })} placeholder="LOT-001" />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-muted-foreground text-[10px] uppercase">Комментарий</Label>
                              <Input value={row.note} onChange={(e) => updateContentRow(row.id, { note: e.target.value })} />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {selectedContents.length > 0 ? (
                      <div className="space-y-2 rounded-lg border bg-muted/30 p-2 text-xs">
                        {selectedContents.map((row) => {
                          const fefo = contentHasFefoWarning(row);
                          return (
                            <div key={row.virtualContentId} className="rounded border bg-background p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="font-medium">
                                  {row.itemCode} · {row.itemName}
                                </div>
                                {fefo ? (
                                  <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                                    <AlertTriangle className="size-3" /> FEFO
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-muted-foreground mt-1">
                                {fmtQty(row.qty)} {row.uomCode}
                                {row.lotCode ? ` · ${row.lotCode}` : ""}
                                {row.locationAvailableQty != null ? ` · avail ${fmtQty(row.locationAvailableQty)}` : ""}
                                {row.expiryAt || row.bestBeforeAt ? ` · срок ${fmtDate(row.expiryAt ?? row.bestBeforeAt)}` : ""}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-muted-foreground text-xs">Содержимое пока не задано.</div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => void handleSaveNode()} disabled={saving}>
                    <Save className="size-4" /> Сохранить
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => void handleDeleteNode()} disabled={saving}>
                    <Trash2 className="size-4" /> Удалить
                  </Button>
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
    {sceneTools.open ? (
      <div
        ref={sceneToolsRef}
        role="menu"
        aria-label="Инструменты сцены"
        className="bg-popover text-popover-foreground border-border fixed z-[200] flex w-[min(280px,calc(100vw-16px))] flex-col gap-2 rounded-lg border p-2 shadow-lg"
        style={{ left: sceneTools.x, top: sceneTools.y }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-muted-foreground text-[10px] font-semibold uppercase">Сцена (ПКМ)</div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant={dragRackMode ? "secondary" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDragRackMode((v) => !v)}>
            Стеллажи
          </Button>
          <Button type="button" variant={dragBoxMode ? "secondary" : "outline"} size="sm" className="h-8 text-xs" onClick={() => setDragBoxMode((v) => !v)}>
            Короба
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={!selectedNode || selectedNode.nodeType !== "rack" || saving}
            onClick={() => {
              void handleCreateNode("shelf");
              setSceneTools({ open: false, nodeId: "", x: 0, y: 0 });
            }}
          >
            + Полка
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={!selectedNode || selectedNode.nodeType !== "shelf" || saving}
            onClick={() => {
              void handleCreateNode("box");
              setSceneTools({ open: false, nodeId: "", x: 0, y: 0 });
            }}
          >
            + Короб
          </Button>
        </div>
        <p className="text-muted-foreground text-[10px] leading-snug">Shift+ЛКМ — сдвиг без режимов «Стеллажи/Короба».</p>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground h-8 w-full text-xs" onClick={() => setSceneTools({ open: false, nodeId: "", x: 0, y: 0 })}>
          Закрыть
        </Button>
      </div>
    ) : null}
    <FocusModal
      open={boxGeomModalOpen}
      onOpenChange={setBoxGeomModalOpen}
      title="Размеры и положение короба"
      description="Габариты и сдвиг в метрах сцены. Сохраните — позиция на полке пересчитается."
      widthClassName="max-w-lg"
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10px] uppercase">Ширина</Label>
            <Input value={sizeX} onChange={(e) => setSizeX(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10px] uppercase">Высота</Label>
            <Input value={sizeY} onChange={(e) => setSizeY(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10px] uppercase">Глубина</Label>
            <Input value={sizeZ} onChange={(e) => setSizeZ(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10px] uppercase">Смещение X</Label>
            <Input value={boxOffsetX} onChange={(e) => setBoxOffsetX(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10px] uppercase">Смещение Z</Label>
            <Input value={boxOffsetZ} onChange={(e) => setBoxOffsetZ(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-muted-foreground text-[10px] uppercase">Уровень стопки</Label>
            <Input value={boxStackLevel} onChange={(e) => setBoxStackLevel(e.target.value)} inputMode="numeric" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            type="button"
            onClick={() => void handleSaveNode().then((ok) => ok && setBoxGeomModalOpen(false))}
            disabled={saving || !selectedNode || !isBoxLike(selectedNode.nodeType)}
          >
            <Save className="size-4" /> Сохранить и закрыть
          </Button>
          <Button type="button" variant="outline" onClick={() => setBoxGeomModalOpen(false)}>
            Отмена
          </Button>
        </div>
      </div>
    </FocusModal>
    </>
  );
}
