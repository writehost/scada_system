"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three-stdlib";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Layers, Move, RefreshCcw, RotateCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FocusModal } from "@/components/ui/focus-modal";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WmsItemPicker } from "@/components/wms/wms-pickers";
import { WmsSiteCodeField } from "@/components/wms/wms-shared";
import {
  createWmsVirtualNode,
  getDefaultWmsSiteCode,
  getWmsItemOverview,
  getWmsVirtualLayout,
  listWmsVirtualLayouts,
  rememberWmsSiteCode,
  resolveVirtualLocationOnLayout,
  saveWmsVirtualNodeContents,
  updateWmsVirtualNode,
} from "@/lib/wms/client";
import { extractItemImageUrl } from "@/lib/wms/item-image";
import type { WmsVirtualContentRow, WmsVirtualLayoutSummary, WmsVirtualNodeRow } from "@/lib/wms/types";
import { cn } from "@/lib/utils";
import { normalizeVirtualLayout } from "./virtual-warehouse-layout-normalize";

type LayoutState = {
  layoutId: string;
  layoutCode: string;
  name: string;
  warehouseCode: string | null;
  zoneCode: string | null;
  scenePrefs: Record<string, unknown> | null;
  nodes: WmsVirtualNodeRow[];
  contents: WmsVirtualContentRow[];
};

const viewerFloorPlanTextureCache = new Map<string, THREE.Texture>();

function fmtQty(v: number) {
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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

function snapToGrid(value: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

function isBoxLikeNodeType(t: string) {
  return t === "box" || t === "bin" || t === "container" || t === "pallet_slot";
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
    color: 0xf28c28,
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

function registerPickHulls(group: THREE.Object3D, nodeId: string, map: Map<THREE.Object3D, string>) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh && (obj.userData as { pickHull?: boolean }).pickHull) {
      map.set(obj, nodeId);
    }
  });
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
  const cardboard = new THREE.MeshStandardMaterial({
    color: selected ? 0x6ea8ff : 0xc68a4b,
    roughness: 0.92,
    metalness: 0.02,
  });
  const seam = new THREE.MeshStandardMaterial({
    color: selected ? 0x4f8cff : 0x8d5a2b,
    roughness: 0.95,
    metalness: 0.01,
  });

  const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), cardboard);
  body.position.set(0, height / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const tape = new THREE.Mesh(new THREE.BoxGeometry(width * 0.2, 0.012, depth * 0.92), seam);
  tape.position.set(0, height + 0.006, 0);
  tape.castShadow = true;
  tape.receiveShadow = true;
  group.add(tape);

  const edgeLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
    new THREE.LineBasicMaterial({ color: 0x5b3a1e, transparent: true, opacity: 0.45 })
  );
  edgeLines.position.set(0, height / 2, 0);
  group.add(edgeLines);

  const stickerTexture = makeStickerTexture(noteText, stickerFontPx);

  if (stickerTexture) {
    const sw = Math.min(width * 0.72, 0.42) * stickerScale;
    const sh = Math.min(height * 0.34, 0.18) * stickerScale;
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(sw, sh),
      new THREE.MeshBasicMaterial({ map: stickerTexture, transparent: true, depthWrite: false })
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

function nodeColor(node: WmsVirtualNodeRow, selected: boolean, hasContents: boolean) {
  if (selected) return 0x4f8cff;
  if (node.nodeType === "box" || node.nodeType === "bin" || node.nodeType === "container" || node.nodeType === "pallet_slot") {
    return hasContents ? 0x10b981 : 0xcbd5e1;
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

function makeTextSprite(text: string) {
  const clipped = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  let texture = labelSpriteTextureCache.get(clipped);
  if (!texture) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#111827";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(clipped, canvas.width / 2, canvas.height / 2);
    texture = new THREE.CanvasTexture(canvas);
    texture.userData = { kind: "label" };
    labelSpriteTextureCache.set(clipped, texture);
  }
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 0.45, 1);
  return sprite;
}

const stickerTextureCache = new Map<string, THREE.Texture>();

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

function collectNodeContents(nodeId: string, contents: WmsVirtualContentRow[]) {
  return contents.filter((row) => row.nodeId === nodeId);
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

function VirtualHierarchyBranch({
  byParent,
  parentKey,
  depth,
  selectedId,
  onSelect,
  onNodeDoubleClick,
}: {
  byParent: Map<string, WmsVirtualNodeRow[]>;
  parentKey: string;
  depth: number;
  selectedId: string;
  onSelect: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
}) {
  const list = byParent.get(parentKey) ?? [];
  return (
    <div className="space-y-0.5">
      {list.map((node) => {
        const hasChildren = (byParent.get(node.nodeId) ?? []).length > 0;
        return (
          <div key={node.nodeId}>
            <button
              type="button"
              className={cn(
                "hover:bg-muted/70 w-full max-w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                selectedId === node.nodeId && "bg-muted font-medium"
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => onSelect(node.nodeId)}
              onDoubleClick={(e) => {
                e.preventDefault();
                onNodeDoubleClick?.(node.nodeId);
              }}
            >
              <span className="text-muted-foreground mr-1.5 font-mono text-[10px] opacity-70">{node.nodeType}</span>
              {node.label}
            </button>
            {hasChildren ? (
              <VirtualHierarchyBranch
                byParent={byParent}
                parentKey={node.nodeId}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
                onNodeDoubleClick={onNodeDoubleClick}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

const labelSpriteTextureCache = new Map<string, THREE.CanvasTexture>();

function clearHoverEmissive(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive.setHex(0x000000);
          mat.emissiveIntensity = 0;
        }
      }
    }
  });
}

function setHoverEmissive(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive.setHex(0x3b82f6);
          mat.emissiveIntensity = 0.28;
        }
      }
    }
  });
}

function computeSearchMatchUi(layout: LayoutState, qRaw: string) {
  const empty = { boxHitIds: new Set<string>(), rackBannerIds: new Set<string>() };
  const q = qRaw.trim().toLowerCase();
  if (!q) return empty;

  const nodeById = new Map(layout.nodes.map((n) => [n.nodeId, n]));
  const parentById = new Map<string, string | null>();
  for (const n of layout.nodes) parentById.set(n.nodeId, n.parentNodeId ?? null);

  const findAncestorRack = (nodeId: string): string | null => {
    let current: string | null = nodeId;
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      const n = nodeById.get(current);
      if (n?.nodeType === "rack") return current;
      current = parentById.get(current) ?? null;
    }
    return null;
  };

  const isBoxT = (t: string) => t === "box" || t === "bin" || t === "container" || t === "pallet_slot";

  const boxHitIds = new Set<string>();
  const rackBannerIds = new Set<string>();

  const matchesNodeText = (node: WmsVirtualNodeRow) => {
    const hay = `${node.label} ${node.code ?? ""} ${node.locationCode ?? ""}`.toLowerCase();
    return hay.includes(q);
  };

  const noteText = (node: WmsVirtualNodeRow) => {
    const props = asRecord(node.props);
    const note = props?.note;
    return typeof note === "string" ? note.toLowerCase() : "";
  };

  for (const node of layout.nodes) {
    if (!matchesNodeText(node) && !noteText(node).includes(q)) continue;
    if (node.nodeType === "rack") rackBannerIds.add(node.nodeId);
    else if (isBoxT(node.nodeType)) boxHitIds.add(node.nodeId);
    else {
      const rackId = findAncestorRack(node.nodeId);
      if (rackId) rackBannerIds.add(rackId);
    }
  }

  for (const row of layout.contents) {
    const node = nodeById.get(row.nodeId);
    const hay = `${row.itemCode} ${row.itemName} ${row.lotCode ?? ""} ${row.note ?? ""} ${node?.locationCode ?? ""}`.toLowerCase();
    if (!hay.includes(q)) continue;
    if (node && isBoxT(node.nodeType)) boxHitIds.add(row.nodeId);
    const rackId = findAncestorRack(row.nodeId);
    if (rackId) rackBannerIds.add(rackId);
  }

  return { boxHitIds, rackBannerIds };
}

function isVirtualBoxLikeType(t: WmsVirtualNodeRow["nodeType"]) {
  return t === "box" || t === "bin" || t === "container" || t === "pallet_slot";
}

function ContextMenuWarehouseActions({
  layoutState,
  targetNodeId,
  onSelectBox,
  onAddBoxToShelf,
}: {
  layoutState: LayoutState | null;
  targetNodeId: string;
  onSelectBox: (nodeId: string) => void;
  onAddBoxToShelf: (nodeId: string) => void;
}) {
  const target = layoutState?.nodes.find((n) => n.nodeId === targetNodeId) ?? null;

  return (
    <>
      <div className="px-2 py-1.5 text-[10px] font-medium text-muted-foreground uppercase">Содержимое</div>
      {!layoutState ? (
        <div className="text-muted-foreground px-2 py-1.5 text-xs">Выберите и загрузите layout</div>
      ) : !target ? (
        <div className="text-muted-foreground px-2 py-1.5 text-xs">Кликните по коробке или полке на сцене</div>
      ) : target.nodeType === "shelf" ? (
        <button
          type="button"
          className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => onAddBoxToShelf(target.nodeId)}
        >
          Добавить короб на эту полку
        </button>
      ) : isVirtualBoxLikeType(target.nodeType) ? (
        <button
          type="button"
          className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={() => onSelectBox(target.nodeId)}
        >
          Добавить в коробку «{target.label}»…
        </button>
      ) : (
        <div className="text-muted-foreground px-2 py-1.5 text-xs">
          Для «{target.label}» откройте контекстное меню на коробке или полке
        </div>
      )}
    </>
  );
}

export function VirtualWarehouseViewer() {
  const [siteCode, setSiteCode] = React.useState(getDefaultWmsSiteCode());
  const [layouts, setLayouts] = React.useState<WmsVirtualLayoutSummary[]>([]);
  const [selectedLayoutId, setSelectedLayoutId] = React.useState("");
  const [layoutState, setLayoutState] = React.useState<LayoutState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [errorText, setErrorText] = React.useState("");
  const [selectedNodeId, setSelectedNodeId] = React.useState("");
  const [boxLabel, setBoxLabel] = React.useState("");
  const [boxItemCode, setBoxItemCode] = React.useState("");
  const [boxQty, setBoxQty] = React.useState("1");
  const [boxUomCode, setBoxUomCode] = React.useState("pcs");
  const [boxLotCode, setBoxLotCode] = React.useState("");
  const [busyAction, setBusyAction] = React.useState(false);
  const [showAddBox, setShowAddBox] = React.useState(false);
  const [filterEmptyBoxes, setFilterEmptyBoxes] = React.useState(false);
  const [searchText, setSearchText] = React.useState("");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isInterfaceRoute = pathname?.startsWith("/virtual-warehouse") ?? false;
  const pendingNodeFocusRef = React.useRef<string | null>(null);
  /** После deep link — один кадр: прицелить камеру на узел (иначе сцена остаётся в дефолтном ракурсе). */
  const cameraJumpToNodeIdRef = React.useRef<string | null>(null);
  const deepLinkHandledMarkRef = React.useRef<string>("");
  const [dragBoxMode, setDragBoxMode] = React.useState(false);
  const [detailModalOpen, setDetailModalOpen] = React.useState(false);
  /** Краткая плашка у курсора после одного ЛКМ по объекту на сцене. */
  const [quickInfo, setQuickInfo] = React.useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [quickItemMeta, setQuickItemMeta] = React.useState<Record<string, { imageUrl: string | null }>>({});
  const [detailItemOverview, setDetailItemOverview] = React.useState<
    Record<
      string,
      {
        imageUrl: string | null;
        name: string;
        totals: { availableQty: number; reservedQty: number };
      }
    >
  >({});
  const [hierarchyModalOpen, setHierarchyModalOpen] = React.useState(false);
  const [scenePanel, setScenePanel] = React.useState<{
    open: boolean;
    targetNodeId: string;
    x: number;
    y: number;
  }>({
    open: false,
    targetNodeId: "",
    x: 0,
    y: 0,
  });
  const scenePanelRef = React.useRef<HTMLDivElement | null>(null);
  const canvasHostRef = React.useRef<HTMLDivElement | null>(null);
  const canvasWrapRef = React.useRef<HTMLDivElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const suppressDblClickRef = React.useRef(false);
  const dragBoxModeRef = React.useRef(false);
  const siteCodeRef = React.useRef(siteCode);
  const threeRef = React.useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2;
    nodeIdByMesh: Map<THREE.Object3D, string>;
    nodeGroups: Map<string, THREE.Object3D>;
    lastHoverId: string;
    frame: number;
    dirty: boolean;
    dragPoint: THREE.Vector3;
    draggedBoxId: string;
    boxDragOffsetX: number;
    boxDragOffsetZ: number;
  } | null>(null);
  const layoutStateRef = React.useRef<LayoutState | null>(null);
  const selectedNodeIdRef = React.useRef("");
  const hoveredNodeIdRef = React.useRef("");
  const searchTextRef = React.useRef("");

  React.useEffect(() => {
    siteCodeRef.current = siteCode;
  }, [siteCode]);

  React.useEffect(() => {
    dragBoxModeRef.current = dragBoxMode;
    const tr = threeRef.current;
    if (tr?.renderer) {
      tr.renderer.domElement.style.cursor = dragBoxMode ? "crosshair" : "default";
    }
  }, [dragBoxMode]);

  React.useEffect(() => {
    layoutStateRef.current = layoutState;
    if (threeRef.current) threeRef.current.dirty = true;
  }, [layoutState]);

  React.useEffect(() => {
    selectedNodeIdRef.current = selectedNodeId;
    if (threeRef.current) threeRef.current.dirty = true;
  }, [selectedNodeId]);

  React.useEffect(() => {
    searchTextRef.current = searchText;
    if (threeRef.current) threeRef.current.dirty = true;
  }, [searchText]);

  const searchMatchUi = React.useMemo(() => {
    if (!layoutState) return { boxHitIds: new Set<string>(), rackBannerIds: new Set<string>() };
    return computeSearchMatchUi(layoutState, searchText);
  }, [layoutState, searchText]);

  const virtualEditorHref = React.useMemo(() => {
    const q = new URLSearchParams();
    q.set("tab", "editor");
    const sc = searchParams.get("siteCode")?.trim();
    const lc = searchParams.get("locationCode")?.trim();
    if (sc) q.set("siteCode", sc);
    if (lc) q.set("locationCode", lc);
    return `${isInterfaceRoute ? "/virtual-warehouse" : "/wms/virtual"}?${q.toString()}`;
  }, [isInterfaceRoute, searchParams]);

  const itemHref = React.useCallback(
    (itemCode: string) => {
      const encodedItem = encodeURIComponent(itemCode);
      return isInterfaceRoute
        ? `/nomenclature?query=${encodedItem}`
        : `/wms/items/${encodedItem}?siteCode=${encodeURIComponent(siteCode)}`;
    },
    [isInterfaceRoute, siteCode]
  );

  React.useEffect(() => {
    const sc = searchParams.get("siteCode")?.trim();
    const lc = searchParams.get("locationCode")?.trim();
    if (sc && lc) setSiteCode(sc);
  }, [searchParams]);

  React.useEffect(() => {
    const locParam = searchParams.get("locationCode")?.trim();
    if (!locParam || layouts.length === 0) return;
    const locationCodeBound: string = locParam;
    const siteForResolve: string =
      (searchParams.get("siteCode")?.trim() || siteCode).trim() || getDefaultWmsSiteCode();
    const mark = `${siteForResolve}::${locationCodeBound}`;
    if (deepLinkHandledMarkRef.current === mark) return;

    let cancelled = false;
    async function run() {
      try {
        const resolved = await resolveVirtualLocationOnLayout({
          siteCode: siteForResolve,
          locationCode: locationCodeBound,
        });
        if (cancelled) return;
        const layoutId = resolved.layoutId;
        const nodeId = resolved.nodeId;
        if (layoutId != null && nodeId != null && layoutId !== "" && nodeId !== "") {
          deepLinkHandledMarkRef.current = mark;
          pendingNodeFocusRef.current = nodeId;
          setSearchText(locationCodeBound);
          setSelectedLayoutId(layoutId);
        } else {
          deepLinkHandledMarkRef.current = mark;
          toast.info(
            "Эта ячейка пока не привязана к 3D-схеме. Откройте «Редактор», выберите узел и укажите тот же код ячейки в поле привязки."
          );
        }
      } catch {
        if (!cancelled) {
          deepLinkHandledMarkRef.current = mark;
          toast.error("Не удалось открыть ячейку на виртуальном складе");
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [layouts, searchParams, siteCode]);

  React.useEffect(() => {
    const pending = pendingNodeFocusRef.current;
    if (!pending || !layoutState) return;
    const n = layoutState.nodes.find((x) => x.nodeId === pending);
    if (n) {
      setSelectedNodeId(pending);
      pendingNodeFocusRef.current = null;
      cameraJumpToNodeIdRef.current = pending;
    }
  }, [layoutState]);

  const filterEmptyBoxesRef = React.useRef(filterEmptyBoxes);
  React.useEffect(() => {
    filterEmptyBoxesRef.current = filterEmptyBoxes;
    if (threeRef.current) threeRef.current.dirty = true;
  }, [filterEmptyBoxes]);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setErrorText("");
      try {
        const data = await listWmsVirtualLayouts({ siteCode });
        if (cancelled) return;
        setLayouts(data.layouts ?? []);
        setSelectedLayoutId((current) => current || data.layouts?.[0]?.layoutId || "");
        rememberWmsSiteCode(siteCode);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Ошибка загрузки виртуального склада";
        setErrorText(message);
        setLayouts([]);
        toast.error(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [siteCode]);

  const reloadLayout = React.useCallback(async () => {
    if (!selectedLayoutId) {
      setLayoutState(null);
      return;
    }
    setLoading(true);
    setErrorText("");
    try {
      const data = await getWmsVirtualLayout({ siteCode, layoutId: selectedLayoutId });
      const normalizedNodes = normalizeVirtualLayout(data.nodes);
      setLayoutState({
        layoutId: data.layout.layoutId,
        layoutCode: data.layout.layoutCode,
        name: data.layout.name,
        warehouseCode: data.layout.warehouseCode,
        zoneCode: data.layout.zoneCode,
        scenePrefs: data.layout.scenePrefs ?? null,
        nodes: normalizedNodes,
        contents: data.contents,
      });
      setSelectedNodeId((current) => current || normalizedNodes[0]?.nodeId || "");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ошибка загрузки layout";
      setErrorText(message);
      setLayoutState(null);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [selectedLayoutId, siteCode]);

  React.useEffect(() => {
    void reloadLayout();
  }, [reloadLayout]);

  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9eef3);
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 1000);
    camera.position.set(7, 5, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.innerHTML = "";
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
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
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(2048, 2048);
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
    const dragPoint = new THREE.Vector3();
    const nodeIdByMesh = new Map<THREE.Object3D, string>();

    threeRef.current = {
      scene,
      camera,
      renderer,
      controls,
      raycaster,
      pointer,
      nodeIdByMesh,
      nodeGroups: new Map(),
      lastHoverId: "",
      frame: 0,
      dirty: true,
      dragPoint,
      draggedBoxId: "",
      boxDragOffsetX: 0,
      boxDragOffsetZ: 0,
    };

    function applyHoverHighlight() {
      const tr = threeRef.current;
      if (!tr?.nodeGroups) return;
      const next = hoveredNodeIdRef.current;
      const prev = tr.lastHoverId;
      if (next === prev) return;
      if (prev && tr.nodeGroups.has(prev)) {
        clearHoverEmissive(tr.nodeGroups.get(prev)!);
      }
      if (next && tr.nodeGroups.has(next)) {
        setHoverEmissive(tr.nodeGroups.get(next)!);
      }
      tr.lastHoverId = next;
    }

    const setPointer = (event: MouseEvent | PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const pickNodeIdAny = () => {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...nodeIdByMesh.keys()]);
      const hit = hits[0];
      return hit ? nodeIdByMesh.get(hit.object as THREE.Mesh) ?? "" : "";
    };

    const pickId = () => {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects([...nodeIdByMesh.keys()]);
      if (!hits.length) return "";
      const state = layoutStateRef.current;
      const typeOf = (id: string) => state?.nodes.find((n) => n.nodeId === id)?.nodeType ?? "";
      for (const h of hits) {
        const id = nodeIdByMesh.get(h.object as THREE.Mesh) ?? "";
        if (id && isBoxLikeNodeType(typeOf(id))) return id;
      }
      return nodeIdByMesh.get(hits[0].object as THREE.Mesh) ?? "";
    };

    const rebuild = () => {
      const current = threeRef.current;
      const state = layoutStateRef.current;
      if (!current) return;
      if (!state) {
        current.dirty = false;
        return;
      }

      nodeIdByMesh.clear();
      for (let i = scene.children.length - 1; i >= 0; i -= 1) {
        const child = scene.children[i];
        if ((child.userData as { persistent?: boolean } | undefined)?.persistent) continue;
        disposeObject3D(child);
        scene.remove(child);
      }

      const selectedId = selectedNodeIdRef.current;
      const nodeGroups = new Map<string, THREE.Object3D>();

      const q = searchTextRef.current;
      const searchActive = Boolean(q.trim());
      const searchUi = computeSearchMatchUi(state, q);
      const { boxHitIds, rackBannerIds } = searchUi;

      const prefs = state.scenePrefs;
      const planUrl = prefs && typeof prefs.floorPlanDataUrl === "string" ? prefs.floorPlanDataUrl.trim() : "";
      if (planUrl) {
        const cachedTex = viewerFloorPlanTextureCache.get(planUrl);
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
              viewerFloorPlanTextureCache.set(planUrl, tex);
              const tr = threeRef.current;
              if (tr) tr.dirty = true;
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
        const contents = collectNodeContents(node.nodeId, state.contents);
        const first = contents[0];
        const isBoxLike =
          node.nodeType === "box" ||
          node.nodeType === "bin" ||
          node.nodeType === "container" ||
          node.nodeType === "pallet_slot";
        const isEmptyBox = isBoxLike && contents.length === 0;
        const rackSearchHit = searchActive && rackBannerIds.has(node.nodeId);
        const boxSearchHit = searchActive && boxHitIds.has(node.nodeId);
        if (node.nodeType === "rack") {
          const emphasized = node.nodeId === selectedId || rackSearchHit;
          const rackGroup = buildRackGroup(node, emphasized);
          scene.add(rackGroup);
          nodeGroups.set(node.nodeId, rackGroup);
          registerPickHulls(rackGroup, node.nodeId, nodeIdByMesh);
        } else if (node.nodeType === "shelf" && !node.parentNodeId) {
          // Осиротевшие полки без стеллажа не рисуем — иначе «лежат поперёк».
          continue;
        } else if (isBoxLike) {
          const emphasized = node.nodeId === selectedId || boxSearchHit;
          const boxGroup = buildBoxGroup(node, emphasized);
          scene.add(boxGroup);
          nodeGroups.set(node.nodeId, boxGroup);
          registerPickHulls(boxGroup, node.nodeId, nodeIdByMesh);
        } else {
          const geometry = new THREE.BoxGeometry(Math.max(node.sizeX, 0.15), Math.max(node.sizeY, 0.03), Math.max(node.sizeZ, 0.15));
          const isShelf = node.nodeType === "shelf";
          const material = new THREE.MeshStandardMaterial({
            color: nodeColor(node, node.nodeId === selectedId, Boolean(first)),
            transparent: false,
            opacity: 0.96,
          });
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(node.posX, node.posY + node.sizeY / 2, node.posZ);
          mesh.rotation.set(node.rotX, node.rotY, node.rotZ);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          scene.add(mesh);
          nodeGroups.set(node.nodeId, mesh);
          const pickGeo = new THREE.BoxGeometry(
            Math.max(node.sizeX, 0.15) * (isShelf ? 1.55 : 1.25),
            Math.max(node.sizeY, 0.06) * (isShelf ? 2.4 : 2.2),
            Math.max(node.sizeZ, 0.15) * (isShelf ? 1.55 : 1.25)
          );
          const pick = new THREE.Mesh(pickGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
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
        if (filterEmptyBoxesRef.current && isEmptyBox) {
          const marker = makeTextSprite(`ПУСТО · ${node.label}`);
          if (marker) {
            marker.position.set(node.posX, node.posY + node.sizeY + 0.55, node.posZ);
            scene.add(marker);
          }
        }

        if (searchActive && node.nodeType === "rack" && rackBannerIds.has(node.nodeId)) {
          const marker = makeTextSprite("НАЙДЕНО");
          if (marker) {
            marker.position.set(node.posX, node.posY + node.sizeY + 0.75, node.posZ);
            scene.add(marker);
          }
        }
      }

      current.lastHoverId = "";
      current.nodeGroups = nodeGroups;
      current.dirty = false;
      applyHoverHighlight();
    };

    let pointerMoveRaf = 0;
    const flushPointerHover = () => {
      pointerMoveRaf = 0;
      const current = threeRef.current;
      if (!current) return;
      const id = pickId();
      if (id !== hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = id;
        applyHoverHighlight();
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      const current = threeRef.current;
      if (!current) return;
      setPointer(event);

      if (current.draggedBoxId) {
        const draggedBoxId = current.draggedBoxId;
        current.dirty = true;
        setLayoutState((state) => {
          if (!state) return state;
          const box = state.nodes.find((entry) => entry.nodeId === draggedBoxId);
          if (!box) return state;
          const support = state.nodes.find((entry) => entry.nodeId === box.parentNodeId) ?? null;
          if (!support) return state;
          raycaster.setFromCamera(pointer, camera);
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
            nodes: normalizeVirtualLayout(
              state.nodes.map((entry) => (entry.nodeId === draggedBoxId ? { ...entry, props: nextProps } : entry))
            ),
          };
        });
        return;
      }

      if (!pointerMoveRaf) pointerMoveRaf = requestAnimationFrame(flushPointerHover);
    };

    const onPointerDown = (event: PointerEvent) => {
      const current = threeRef.current;
      const state = layoutStateRef.current;
      if (!current || !state) return;
      const shiftDrag = event.shiftKey;
      if (!shiftDrag && !dragBoxModeRef.current) return;
      if (event.button !== 0) return;

      setPointer(event);
      const selectedId = selectedNodeIdRef.current;
      const selectedBox = state.nodes.find((entry) => entry.nodeId === selectedId && isBoxLikeNodeType(entry.nodeType));
      const hitId = pickNodeIdAny();
      const nodeId = shiftDrag ? hitId : dragBoxModeRef.current ? selectedBox?.nodeId ?? hitId : hitId;
      const node = state.nodes.find((entry) => entry.nodeId === nodeId) ?? null;
      const shouldBoxDrag = (dragBoxModeRef.current || shiftDrag) && node && isBoxLikeNodeType(node.nodeType);

      if (shouldBoxDrag && node && isBoxLikeNodeType(node.nodeType)) {
        const support = state.nodes.find((entry) => entry.nodeId === node.parentNodeId) ?? null;
        if (support) {
          raycaster.setFromCamera(pointer, camera);
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
        }
        current.draggedBoxId = node.nodeId;
        controls.enabled = false;
        renderer.domElement.style.cursor = "grabbing";
      }
    };

    const onPointerUp = () => {
      const current = threeRef.current;
      const state = layoutStateRef.current;
      if (!current || !state) return;

      if (current.draggedBoxId) {
        const nodeId = current.draggedBoxId;
        current.draggedBoxId = "";
        controls.enabled = true;
        renderer.domElement.style.cursor = dragBoxModeRef.current ? "crosshair" : "default";
        const box = state.nodes.find((entry) => entry.nodeId === nodeId);
        if (!box) return;
        suppressClickRef.current = true;
        suppressDblClickRef.current = true;
        void updateWmsVirtualNode({
          siteCode: siteCodeRef.current,
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
      }
    };

    const onPointerLeave = () => {
      if (pointerMoveRaf) {
        cancelAnimationFrame(pointerMoveRaf);
        pointerMoveRaf = 0;
      }
      const current = threeRef.current;
      if (!current) return;
      if (hoveredNodeIdRef.current) {
        hoveredNodeIdRef.current = "";
        applyHoverHighlight();
      }
    };

    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      setPointer(event);
      const pickedNodeId = pickId();
      const menuW = 300;
      const menuH = 360;
      const pad = 8;
      const x = Math.max(pad, Math.min(event.clientX, window.innerWidth - menuW - pad));
      const y = Math.max(pad, Math.min(event.clientY, window.innerHeight - menuH - pad));
      setScenePanel({ open: true, targetNodeId: pickedNodeId, x, y });
    };

    const onClick = (event: MouseEvent) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (event.detail >= 2) return;
      setPointer(event);
      const nodeId = pickId();
      if (nodeId) {
        setSelectedNodeId(nodeId);
        setQuickInfo((prev) =>
          prev?.nodeId === nodeId ? null : { x: event.clientX, y: event.clientY, nodeId }
        );
      } else {
        setQuickInfo(null);
      }
      setScenePanel((m) => (m.open ? { open: false, targetNodeId: "", x: 0, y: 0 } : m));
    };

    const onDblClick = (event: MouseEvent) => {
      if (suppressDblClickRef.current) {
        suppressDblClickRef.current = false;
        return;
      }
      setPointer(event);
      const nodeId = pickId();
      if (nodeId) {
        setSelectedNodeId(nodeId);
        setQuickInfo(null);
        setDetailModalOpen(true);
      }
    };

    const onResize = () => {
      camera.aspect = host.clientWidth / Math.max(host.clientHeight, 1);
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(host.clientWidth, host.clientHeight);
    };

    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            onResize();
            if (threeRef.current) threeRef.current.dirty = true;
          })
        : null;
    resizeObserver?.observe(host);
    const wrap = canvasWrapRef.current;
    if (wrap && resizeObserver) resizeObserver.observe(wrap);

    const rafResize = () => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          onResize();
          if (threeRef.current) threeRef.current.dirty = true;
        });
      });
    };
    rafResize();

    const animate = () => {
      if (threeRef.current?.dirty) rebuild();
      const jumpId = cameraJumpToNodeIdRef.current;
      if (jumpId && layoutStateRef.current) {
        const n = layoutStateRef.current.nodes.find((x) => x.nodeId === jumpId);
        if (n) {
          const cx = n.posX;
          const cy = n.posY + Math.max(n.sizeY, 0.15) / 2;
          const cz = n.posZ;
          controls.target.set(cx, cy, cz);
          const span = Math.max(n.sizeX, n.sizeY, n.sizeZ, 0.5);
          const dist = Math.min(12, Math.max(2.8, span * 2.4));
          camera.position.set(cx + dist * 0.72, cy + dist * 0.38, cz + dist * 0.72);
          camera.updateProjectionMatrix();
        }
        cameraJumpToNodeIdRef.current = null;
      }
      controls.update();
      renderer.render(scene, camera);
      const current = threeRef.current;
      if (current) current.frame = requestAnimationFrame(animate);
    };
    threeRef.current.frame = requestAnimationFrame(animate);

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("click", onClick);
    renderer.domElement.addEventListener("dblclick", onDblClick);
    renderer.domElement.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("resize", onResize);
    onResize();

    return () => {
      if (pointerMoveRaf) cancelAnimationFrame(pointerMoveRaf);
      const current = threeRef.current;
      if (current) cancelAnimationFrame(current.frame);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("dblclick", onDblClick);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);
      resizeObserver?.disconnect();
      renderer.dispose();
      host.innerHTML = "";
      threeRef.current = null;
    };
  }, []);

  const selectedNode = layoutState?.nodes.find((node) => node.nodeId === selectedNodeId) ?? null;
  const quickInfoNode = layoutState?.nodes.find((node) => node.nodeId === quickInfo?.nodeId) ?? null;
  const quickInfoContents = React.useMemo(
    () =>
      quickInfoNode && layoutState
        ? collectNodeContents(quickInfoNode.nodeId, layoutState.contents ?? [])
        : [],
    [layoutState?.contents, quickInfoNode]
  );

  React.useEffect(() => {
    if (!quickInfo) return;
    if (!layoutState?.nodes.some((n) => n.nodeId === quickInfo.nodeId)) setQuickInfo(null);
  }, [layoutState, quickInfo]);

  React.useEffect(() => {
    if (detailModalOpen) setQuickInfo(null);
  }, [detailModalOpen]);
  const selectedContents = React.useMemo(
    () => (selectedNode ? collectNodeContents(selectedNode.nodeId, layoutState?.contents ?? []) : []),
    [layoutState?.contents, selectedNode]
  );
  const qtyInSelectedNodeByCode = React.useMemo(() => {
    const m = new Map<string, { qty: number; uom: string }>();
    for (const r of selectedContents) {
      const prev = m.get(r.itemCode);
      const qty = (prev?.qty ?? 0) + r.qty;
      m.set(r.itemCode, { qty, uom: r.uomCode });
    }
    return m;
  }, [selectedContents]);
  const selectedShelf = selectedNode?.nodeType === "shelf" ? selectedNode : null;
  const selectedBox =
    selectedNode &&
    (selectedNode.nodeType === "box" ||
      selectedNode.nodeType === "bin" ||
      selectedNode.nodeType === "container" ||
      selectedNode.nodeType === "pallet_slot")
      ? selectedNode
      : null;

  const quickInfoFetchKey = React.useMemo(() => {
    if (!quickInfo?.nodeId || quickInfoContents.length === 0) return "";
    return `${quickInfo.nodeId}|${quickInfoContents.map((r) => `${r.itemCode}:${r.virtualContentId}`).join(";")}`;
  }, [quickInfo?.nodeId, quickInfoContents]);

  const detailOverviewKey = React.useMemo(() => {
    if (!detailModalOpen || selectedContents.length === 0) return "";
    return selectedContents.map((r) => `${r.itemCode}:${r.virtualContentId}`).join("|");
  }, [detailModalOpen, selectedContents]);

  React.useEffect(() => {
    if (!quickInfo) setQuickItemMeta({});
  }, [quickInfo]);

  React.useEffect(() => {
    if (!quickInfoFetchKey || !siteCode.trim()) {
      setQuickItemMeta({});
      return;
    }
    const codes = [...new Set(quickInfoContents.map((r) => r.itemCode))];
    let cancelled = false;
    void (async () => {
      const next: Record<string, { imageUrl: string | null }> = {};
      await Promise.all(
        codes.map(async (code) => {
          try {
            const o = await getWmsItemOverview({ siteCode: siteCode.trim(), itemCode: code });
            next[code] = { imageUrl: extractItemImageUrl(o.item.itemAttrs) };
          } catch {
            next[code] = { imageUrl: null };
          }
        })
      );
      if (!cancelled) setQuickItemMeta(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [quickInfoFetchKey, siteCode, quickInfoContents]);

  React.useEffect(() => {
    if (!detailModalOpen || !siteCode.trim()) {
      setDetailItemOverview({});
      return;
    }
    const codes = [...new Set(selectedContents.map((r) => r.itemCode))];
    if (codes.length === 0) {
      setDetailItemOverview({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Record<
        string,
        { imageUrl: string | null; name: string; totals: { availableQty: number; reservedQty: number } }
      > = {};
      await Promise.all(
        codes.map(async (code) => {
          try {
            const o = await getWmsItemOverview({ siteCode: siteCode.trim(), itemCode: code });
            next[code] = {
              imageUrl: extractItemImageUrl(o.item.itemAttrs),
              name: o.item.name,
              totals: { availableQty: o.totals.availableQty, reservedQty: o.totals.reservedQty },
            };
          } catch {
            next[code] = {
              imageUrl: null,
              name: code,
              totals: { availableQty: 0, reservedQty: 0 },
            };
          }
        })
      );
      if (!cancelled) setDetailItemOverview(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [detailModalOpen, detailOverviewKey, siteCode]);

  React.useEffect(() => {
    if (selectedShelf) {
      setShowAddBox(false);
      setBoxLabel(`Короб ${selectedShelf.label}`);
      setBoxItemCode("");
      setBoxQty("1");
      setBoxUomCode("pcs");
      setBoxLotCode("");
      return;
    }
    if (selectedBox) {
      setShowAddBox(false);
      const first = selectedContents[0];
      setBoxLabel(selectedBox.label);
      setBoxItemCode(first?.itemCode ?? "");
      setBoxQty(first ? String(first.qty) : "1");
      setBoxUomCode(first?.uomCode ?? "pcs");
      setBoxLotCode(first?.lotCode ?? "");
    }
  }, [selectedBox, selectedContents, selectedShelf]);

  async function handleAddBoxToShelf() {
    if (!layoutState || !selectedShelf) return;
    setBusyAction(true);
    try {
      const siblings = layoutState.nodes.filter((node) => node.parentNodeId === selectedShelf.nodeId);
      const result = await createWmsVirtualNode({
        siteCode,
        layoutId: layoutState.layoutId,
        parentNodeId: selectedShelf.nodeId,
        nodeType: "box",
        label: boxLabel.trim() || `Короб ${siblings.length + 1}`,
        code: `${selectedShelf.code ?? "BOX"}-${siblings.length + 1}`,
        posX: selectedShelf.posX,
        posY: selectedShelf.posY + selectedShelf.sizeY / 2 + 0.18,
        posZ: selectedShelf.posZ,
        sizeX: Math.max(selectedShelf.sizeX * 0.38, 0.24),
        sizeY: 0.26,
        sizeZ: Math.max(selectedShelf.sizeZ * 0.4, 0.24),
        sortOrder: (siblings.length + 1) * 10,
        props: { capacityQty: 1, offsetX: 0, offsetZ: 0, stackLevel: 0 },
      });
      await reloadLayout();
      setSelectedNodeId(result.nodeId);
      toast.success("Короб добавлен на полку");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить короб");
    } finally {
      setBusyAction(false);
    }
  }

  async function handleRotateBoxOnShelf() {
    if (!layoutState || !selectedBox) return;
    setBusyAction(true);
    try {
      const props = asRecord(selectedBox.props) ?? {};
      const cur = Math.trunc(getNumericProp(props, "onShelfFaceTurns") ?? 0);
      const next = ((cur + 1) % 4 + 4) % 4;
      await updateWmsVirtualNode({
        siteCode,
        nodeId: selectedBox.nodeId,
        props: { ...props, onShelfFaceTurns: next },
      });
      await reloadLayout();
      toast.success("Короб развёрнут на 90°");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось повернуть короб");
    } finally {
      setBusyAction(false);
    }
  }

  async function handleSaveBoxContents() {
    if (!selectedBox) return;
    setBusyAction(true);
    try {
      await saveWmsVirtualNodeContents({
        siteCode,
        nodeId: selectedBox.nodeId,
        contents: boxItemCode.trim()
          ? [
              {
                itemCode: boxItemCode.trim(),
                qty: Number(boxQty || "0"),
                uomCode: boxUomCode.trim() || "pcs",
                lotCode: boxLotCode.trim() || undefined,
                sortOrder: 10,
              },
            ]
          : [],
      });
      await reloadLayout();
      toast.success("Содержимое короба сохранено");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить содержимое");
    } finally {
      setBusyAction(false);
    }
  }

  React.useEffect(() => {
    if (!scenePanel.open) return;
    const close = () => setScenePanel({ open: false, targetNodeId: "", x: 0, y: 0 });
    const onDown = (e: PointerEvent) => {
      if (scenePanelRef.current?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [scenePanel.open]);

  const hierarchyMap = React.useMemo(
    () => (layoutState ? buildNodeTree(layoutState.nodes) : new Map<string, WmsVirtualNodeRow[]>()),
    [layoutState]
  );

  return (
    <>
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <Card className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0">
          <div className="border-border flex min-h-0 flex-1 flex-col">
            <div className="bg-muted/30 flex shrink-0 flex-wrap items-center gap-1.5 border-b px-2 py-1.5">
              <WmsSiteCodeField value={siteCode} onChange={setSiteCode} id="virtual-view-site-code" />
              <select
                value={selectedLayoutId}
                onChange={(e) => setSelectedLayoutId(e.target.value)}
                className="h-8 min-w-[160px] max-w-[min(100%,280px)] rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">Layout…</option>
                {layouts.map((layout) => (
                  <option key={layout.layoutId} value={layout.layoutId}>
                    {layout.layoutCode} · {layout.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => void reloadLayout()} disabled={loading} title="Обновить">
                <RefreshCcw className="size-4" />
              </Button>
              <Link href={virtualEditorHref} className="inline-flex">
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs">
                  Редактор
                </Button>
              </Link>
              <Button
                type="button"
                variant={dragBoxMode ? "secondary" : "outline"}
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                title="Перетаскивание короба по полке (или Shift + ЛКМ без режима)"
                onClick={() => setDragBoxMode((v) => !v)}
              >
                <Move className="size-3.5" aria-hidden />
                Короб
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2 text-xs"
                onClick={() => setHierarchyModalOpen(true)}
              >
                <Layers className="size-3.5" aria-hidden />
                Дерево
              </Button>
              <div className="flex min-w-[120px] max-w-md flex-1 items-center gap-1.5">
                <Search className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
                <Input
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Поиск…"
                  className="h-8 min-w-0 flex-1 text-xs"
                  aria-label="Поиск по виртуальному складу"
                />
                {searchText.trim() ? (
                  <span className="text-muted-foreground hidden shrink-0 text-[10px] whitespace-nowrap tabular-nums sm:inline">
                    {searchMatchUi.boxHitIds.size || searchMatchUi.rackBannerIds.size
                      ? `${searchMatchUi.boxHitIds.size ? `${searchMatchUi.boxHitIds.size} кор.` : ""}${
                          searchMatchUi.boxHitIds.size && searchMatchUi.rackBannerIds.size ? " · " : ""
                        }${searchMatchUi.rackBannerIds.size ? `${searchMatchUi.rackBannerIds.size} стелл.` : ""}`
                      : "—"}
                  </span>
                ) : null}
              </div>
              <Button
                type="button"
                variant={filterEmptyBoxes ? "secondary" : "outline"}
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => setFilterEmptyBoxes((v) => !v)}
              >
                Пустые
              </Button>
            </div>
            {errorText ? (
              <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{errorText}</div>
            ) : null}
            <div
              ref={canvasWrapRef}
              className="relative min-h-0 w-full flex-1 overflow-hidden bg-zinc-950"
              onClick={(e) => {
                setScenePanel((m) => (m.open ? { open: false, targetNodeId: "", x: 0, y: 0 } : m));
                const t = e.target as Node | null;
                if (!t || !(canvasHostRef.current?.contains(t) ?? false)) setQuickInfo(null);
              }}
            >
              <div ref={canvasHostRef} className="absolute inset-0 h-full w-full" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>

    {quickInfo && quickInfoNode ? (
      <div
        className="bg-popover text-popover-foreground border-primary/35 fixed z-[185] w-[min(320px,calc(100vw-24px))] rounded-lg border-2 border-l-4 border-l-primary shadow-xl"
        style={{
          left: Math.min(
            Math.max(12, quickInfo.x + 4),
            typeof window !== "undefined" ? window.innerWidth - 328 : 12
          ),
          top: Math.min(
            Math.max(12, quickInfo.y + 4),
            typeof window !== "undefined" ? window.innerHeight - 240 : 12
          ),
        }}
        role="dialog"
        aria-label="Кратко о содержимом"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 border-b px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-muted-foreground text-[10px] font-semibold uppercase">Узел</div>
            <div className="truncate font-medium">{quickInfoNode.label}</div>
            <div className="text-muted-foreground mt-0.5 truncate font-mono text-[11px]">
              {quickInfoNode.nodeType}
              {quickInfoNode.locationCode ? ` · ${quickInfoNode.locationCode}` : ""}
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2"
            onClick={() => setQuickInfo(null)}
            aria-label="Закрыть"
          >
            <X className="size-4" />
          </Button>
        </div>
        <div className="max-h-[min(40dvh,260px)] overflow-y-auto px-3 py-2 text-xs">
          {quickInfoContents.length === 0 ? (
            <div className="text-muted-foreground leading-snug">Нет строк содержимого.</div>
          ) : (
            <ul className="space-y-2">
              {quickInfoContents.map((row) => {
                const img = quickItemMeta[row.itemCode]?.imageUrl;
                return (
                  <li key={row.virtualContentId} className="flex gap-2 rounded-md bg-muted/50 px-2 py-2">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt=""
                        className="border-border h-14 w-14 shrink-0 rounded-md border object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="font-mono font-medium">{row.itemCode}</div>
                      {row.itemName ? (
                        <div className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px]">{row.itemName}</div>
                      ) : null}
                      <div className="mt-1 text-sm font-semibold tabular-nums">
                        В коробе: {fmtQty(row.qty)} {row.uomCode}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-[11px]">
                        {row.lotCode ? `Партия ${row.lotCode}` : ""}
                        {row.lotCode && (row.expiryAt || row.bestBeforeAt) ? " · " : ""}
                        {row.expiryAt || row.bestBeforeAt
                          ? `срок ${new Date(row.expiryAt ?? row.bestBeforeAt ?? 0).toLocaleDateString("ru-RU")}`
                          : ""}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    ) : null}

    <FocusModal
      open={hierarchyModalOpen}
      onOpenChange={setHierarchyModalOpen}
      title="Дерево объектов"
      widthClassName="max-w-md"
    >
      <ScrollArea className="max-h-[min(70dvh,520px)] pr-3">
        {!layoutState ? (
          <div className="text-muted-foreground text-xs">Загрузите layout…</div>
        ) : (
          <VirtualHierarchyBranch
            byParent={hierarchyMap}
            parentKey="root"
            depth={0}
            selectedId={selectedNodeId}
            onSelect={setSelectedNodeId}
            onNodeDoubleClick={(id) => {
              setSelectedNodeId(id);
              setQuickInfo(null);
              setHierarchyModalOpen(false);
              setDetailModalOpen(true);
            }}
          />
        )}
      </ScrollArea>
    </FocusModal>

    <FocusModal
      open={detailModalOpen}
      onOpenChange={setDetailModalOpen}
      title="Настройки узла"
      description={
        selectedNode ? `${selectedNode.label} · ${selectedNode.nodeType}${selectedNode.locationCode ? ` · ${selectedNode.locationCode}` : ""}` : undefined
      }
      widthClassName="max-w-lg"
    >
      <div className="space-y-3">
        {selectedNode ? (
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
            <div className="text-muted-foreground text-[10px] uppercase">Выбрано</div>
            <div className="font-medium">{selectedNode.label}</div>
            <div className="text-muted-foreground mt-0.5 text-xs">
              {selectedNode.nodeType}
              {selectedNode.locationCode ? ` · ${selectedNode.locationCode}` : ""}
            </div>
          </div>
        ) : null}

        {selectedContents.length > 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-sm">
            <div className="text-muted-foreground text-[10px] font-semibold uppercase">Остаток по площадке</div>
            <ul className="mt-2 space-y-2 text-xs">
              {[...new Set(selectedContents.map((r) => r.itemCode))].map((code) => {
                const o = detailItemOverview[code];
                const inNode = qtyInSelectedNodeByCode.get(code);
                return (
                  <li key={code} className="border-border flex gap-2 rounded-md border bg-background px-2 py-2">
                    {o?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={o.imageUrl}
                        alt=""
                        className="border-border h-14 w-14 shrink-0 rounded-md border object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-[11px] font-medium">{code}</div>
                      <div className="text-muted-foreground line-clamp-2 text-[11px]">{o?.name ?? "—"}</div>
                      <div className="mt-1 font-medium tabular-nums">
                        На складе доступно: {fmtQty(o?.totals.availableQty ?? 0)}
                        {o && o.totals.reservedQty > 0 ? ` · в резерве ${fmtQty(o.totals.reservedQty)}` : ""}
                      </div>
                      {inNode ? (
                        <div className="text-muted-foreground mt-0.5 tabular-nums">
                          В этом узле: {fmtQty(inNode.qty)} {inNode.uom}
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {selectedShelf ? (
          <div className="space-y-2">
            <Button type="button" size="sm" className="w-full" onClick={() => setShowAddBox((current) => !current)}>
              {showAddBox ? "Скрыть форму" : "Добавить короб на полку"}
            </Button>
            {showAddBox ? (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px] uppercase">Короб на полку</Label>
                  <Input
                    value={boxLabel}
                    onChange={(e) => setBoxLabel(e.target.value)}
                    placeholder="Короб 40x40"
                    className="w-full"
                  />
                </div>
                <Button type="button" size="sm" className="w-full" onClick={() => void handleAddBoxToShelf()} disabled={busyAction}>
                  Создать
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedBox ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={busyAction}
                onClick={() => void handleRotateBoxOnShelf()}
                title="Поворот короба на 90° в плоскости полки"
              >
                <RotateCw className="size-4" aria-hidden />
                Развернуть на 90°
              </Button>
            </div>
            {selectedContents.length > 0 ? (
              <div className="rounded-lg border bg-muted/25 p-3">
                <div className="text-muted-foreground mb-2 text-[10px] font-semibold uppercase">Содержимое короба</div>
                <ul className="space-y-2 text-sm">
                  {selectedContents.map((row) => (
                    <li key={row.virtualContentId} className="border-border rounded-md border bg-background px-2 py-1.5">
                      <div className="font-medium">
                        {row.itemCode}
                        {row.itemName ? <span className="text-muted-foreground font-normal"> · {row.itemName}</span> : null}
                      </div>
                      <div className="text-muted-foreground mt-0.5 text-xs">
                        {fmtQty(row.qty)} {row.uomCode}
                        {row.lotCode ? ` · ${row.lotCode}` : ""}
                        {row.expiryAt || row.bestBeforeAt
                          ? ` · срок ${new Date(row.expiryAt ?? row.bestBeforeAt ?? 0).toLocaleDateString("ru-RU")}`
                          : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="text-muted-foreground rounded-lg border border-dashed p-3 text-xs">
                В коробе пока нет позиций — укажите номенклатуру ниже.
              </div>
            )}
            <div className="space-y-2 rounded-lg border p-3">
              <WmsItemPicker siteCode={siteCode} value={boxItemCode} onChange={setBoxItemCode} label="Номенклатура" />
              {boxItemCode ? (
                <Link
                  href={itemHref(boxItemCode)}
                  className="text-muted-foreground text-xs underline underline-offset-2"
                >
                  Карточка товара
                </Link>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px] uppercase">Кол-во</Label>
                  <Input value={boxQty} onChange={(e) => setBoxQty(e.target.value)} inputMode="decimal" />
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px] uppercase">Ед. изм.</Label>
                  <Input value={boxUomCode} onChange={(e) => setBoxUomCode(e.target.value)} />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground text-[10px] uppercase">Партия</Label>
                <Input value={boxLotCode} onChange={(e) => setBoxLotCode(e.target.value)} placeholder="LOT-001" />
              </div>
              <Button type="button" size="sm" className="w-full" onClick={() => void handleSaveBoxContents()} disabled={busyAction}>
                Сохранить
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </FocusModal>

    {scenePanel.open ? (
      <div
        ref={scenePanelRef}
        role="menu"
        aria-label="Действия сцены"
        className="bg-popover text-popover-foreground border-border fixed z-[200] flex max-h-[min(420px,calc(100dvh-16px))] w-[min(300px,calc(100vw-16px))] flex-col gap-2 overflow-y-auto rounded-lg border p-3 shadow-lg"
        style={{ left: scenePanel.x, top: scenePanel.y }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-[10px] font-medium uppercase">Действия сцены</span>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => setScenePanel({ open: false, targetNodeId: "", x: 0, y: 0 })}>
            Закрыть
          </Button>
        </div>
        <ContextMenuWarehouseActions
          layoutState={layoutState}
          targetNodeId={scenePanel.targetNodeId}
          onSelectBox={(nodeId) => {
            setSelectedNodeId(nodeId);
            setShowAddBox(false);
            setQuickInfo(null);
            setScenePanel({ open: false, targetNodeId: "", x: 0, y: 0 });
            setDetailModalOpen(true);
          }}
          onAddBoxToShelf={(nodeId) => {
            setSelectedNodeId(nodeId);
            setShowAddBox(true);
            setQuickInfo(null);
            setScenePanel({ open: false, targetNodeId: "", x: 0, y: 0 });
            setDetailModalOpen(true);
          }}
        />
        <div className="h-px bg-border" />
        <div className="text-muted-foreground text-[10px] font-medium uppercase">Фильтры</div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={filterEmptyBoxes ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => {
              setFilterEmptyBoxes((v) => !v);
              setScenePanel({ open: false, targetNodeId: "", x: 0, y: 0 });
            }}
          >
            Пустые короба
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              setFilterEmptyBoxes(false);
              setScenePanel({ open: false, targetNodeId: "", x: 0, y: 0 });
            }}
          >
            Сбросить фильтры
          </Button>
        </div>
      </div>
    ) : null}
    </>
  );
}
