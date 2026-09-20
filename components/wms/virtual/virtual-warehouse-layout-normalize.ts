import type { WmsVirtualNodeRow } from "@/lib/wms/types";

export type RackPlacementInput = Pick<
  WmsVirtualNodeRow,
  "posX" | "posY" | "posZ" | "sizeX" | "sizeY" | "sizeZ" | "props"
>;

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

function parseRackSlotFromCode(code: string): number | null {
  const match = /^RACK-(\d+)/i.exec(code.trim());
  if (!match) return null;
  const slot = Number.parseInt(match[1], 10);
  return Number.isFinite(slot) ? slot : null;
}

function parseShelfRackSlotFromCode(code: string): number | null {
  const match = /^SHELF-(\d+)-/i.exec(code.trim());
  if (!match) return null;
  const slot = Number.parseInt(match[1], 10);
  return Number.isFinite(slot) ? slot : null;
}

/** Полки без parent_node_id в БД — привязка к стеллажу по коду SHELF-02-x → RACK-02. */
export function linkOrphanShelvesToRacks(nodes: WmsVirtualNodeRow[]): WmsVirtualNodeRow[] {
  const next = nodes.map((node) => ({ ...node }));
  const racksBySlot = new Map<number, WmsVirtualNodeRow>();
  for (const node of next) {
    if (node.nodeType !== "rack") continue;
    const slot = parseRackSlotFromCode(node.code);
    if (slot != null) racksBySlot.set(slot, node);
  }

  return next.map((node) => {
    if (node.nodeType !== "shelf" || node.parentNodeId) return node;
    const slot = parseShelfRackSlotFromCode(node.code);
    if (slot == null) return node;
    const rack = racksBySlot.get(slot);
    if (!rack) return node;
    return { ...node, parentNodeId: rack.nodeId };
  });
}

function filterExtraRackShelves(nodes: WmsVirtualNodeRow[]): WmsVirtualNodeRow[] {
  const hideIds = new Set<string>();
  for (const rack of nodes) {
    if (rack.nodeType !== "rack") continue;
    const levels = Math.max(Math.trunc(getNumericProp(asRecord(rack.props), "shelfCount") ?? 4), 1);
    const shelves = nodes
      .filter((node) => node.parentNodeId === rack.nodeId && node.nodeType === "shelf")
      .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.nodeId) - Number(b.nodeId));
    shelves.forEach((shelf, index) => {
      if (index >= levels) hideIds.add(shelf.nodeId);
    });
  }
  if (hideIds.size === 0) return nodes;
  return nodes.filter((node) => !hideIds.has(node.nodeId));
}

export function getRackShelfPlacement(rack: RackPlacementInput, shelfIndex: number, shelfSizeY = 0.05) {
  const props = asRecord(rack.props);
  const levels = Math.max(Math.trunc(getNumericProp(props, "shelfCount") ?? 4), 1);
  const beamHeight = getNumericProp(props, "beamHeight") ?? Math.max(rack.sizeY * 0.03, 0.06);
  const levelGap = Math.max(rack.sizeY, 0.8) / (levels + 1);
  return {
    posX: Number(rack.posX.toFixed(3)),
    posY: Number((rack.posY + levelGap * (shelfIndex + 1) + beamHeight / 2).toFixed(3)),
    posZ: Number(rack.posZ.toFixed(3)),
    sizeX: Number(Math.max(rack.sizeX - 0.15, 0.6).toFixed(3)),
    sizeY: Number(Math.min(Math.max(shelfSizeY, 0.03), 0.08).toFixed(3)),
    sizeZ: Number(Math.max(rack.sizeZ - 0.08, 0.4).toFixed(3)),
  };
}

function normalizeSupportChildren(nodes: WmsVirtualNodeRow[], byId: Map<string, WmsVirtualNodeRow>, support: WmsVirtualNodeRow) {
  nodes.forEach((child, childIndex) => {
    if (child.parentNodeId !== support.nodeId) return;
    if (
      child.nodeType !== "box" &&
      child.nodeType !== "bin" &&
      child.nodeType !== "container" &&
      child.nodeType !== "pallet" &&
      child.nodeType !== "pallet_slot"
    ) {
      return;
    }
    const childProps = asRecord(child.props);
    const legacyOffset = inverseRotateOffset(child.posX - support.posX, child.posZ - support.posZ, support.rotY);
    const supportHalfX = Math.max(support.sizeX / 2 - child.sizeX / 2, 0);
    const supportHalfZ = Math.max(support.sizeZ / 2 - child.sizeZ / 2, 0);
    const offsetX = clamp(getNumericProp(childProps, "offsetX") ?? Number(legacyOffset.x.toFixed(3)), -supportHalfX, supportHalfX);
    const offsetZ = clamp(getNumericProp(childProps, "offsetZ") ?? Number(legacyOffset.z.toFixed(3)), -supportHalfZ, supportHalfZ);
    const stackLevel = Math.max(Math.trunc(getNumericProp(childProps, "stackLevel") ?? 0), 0);
    const rotated = rotateOffset(offsetX, offsetZ, support.rotY);
    const normalizedChild: WmsVirtualNodeRow = {
      ...child,
      props: {
        ...(childProps ?? {}),
        offsetX,
        offsetZ,
        stackLevel,
      },
      posX: Number((support.posX + rotated.x).toFixed(3)),
      posY: Number((support.posY + support.sizeY + stackLevel * (child.sizeY + 0.04)).toFixed(3)),
      posZ: Number((support.posZ + rotated.z).toFixed(3)),
      rotX: support.rotX,
      rotY: support.rotY,
      rotZ: support.rotZ,
    };
    nodes[childIndex] = normalizedChild;
    byId.set(child.nodeId, normalizedChild);
    normalizeSupportChildren(nodes, byId, normalizedChild);
  });
}

export function normalizeSupportStacking(nodes: WmsVirtualNodeRow[]) {
  const next = [...nodes];
  const byId = new Map<string, WmsVirtualNodeRow>();
  for (const node of next) byId.set(node.nodeId, node);

  // Supports that may carry stacked children.
  const isSupport = (t: string) =>
    t === "shelf" || t === "box" || t === "bin" || t === "container" || t === "pallet" || t === "pallet_slot";

  for (const node of next) {
    if (!isSupport(node.nodeType)) continue;
    normalizeSupportChildren(next, byId, node);
  }

  return next.map((node) => byId.get(node.nodeId) ?? node);
}

export function normalizeRackChildren(nodes: WmsVirtualNodeRow[]) {
  const next = [...nodes];
  const byId = new Map<string, WmsVirtualNodeRow>();
  for (const node of next) byId.set(node.nodeId, node);

  for (let rackIndex = 0; rackIndex < next.length; rackIndex += 1) {
    const rack = next[rackIndex];
    if (rack.nodeType !== "rack") continue;
    const levels = Math.max(Math.trunc(getNumericProp(asRecord(rack.props), "shelfCount") ?? 4), 1);
    const shelves = next
      .filter((node) => node.parentNodeId === rack.nodeId && node.nodeType === "shelf")
      .sort((a, b) => a.sortOrder - b.sortOrder || Number(a.nodeId) - Number(b.nodeId));
    /** Лишние узлы полок (счётчик уменьшили, записи не удалили) не трогаем — иначе индекс ≥ levels даёт Y за пределами стеллажа. */
    const shelvesToPlace = shelves.slice(0, levels);

    shelvesToPlace.forEach((shelf, shelfIndex) => {
      const nextShelfY = Math.min(Math.max(shelf.sizeY, 0.03), 0.08);
      const placement = getRackShelfPlacement(rack, shelfIndex, nextShelfY);
      const normalizedShelf = {
        ...shelf,
        posX: placement.posX,
        posY: placement.posY,
        posZ: placement.posZ,
        rotX: rack.rotX,
        rotY: rack.rotY,
        rotZ: rack.rotZ,
        sizeX: placement.sizeX,
        sizeY: placement.sizeY,
        sizeZ: placement.sizeZ,
      };
      byId.set(shelf.nodeId, normalizedShelf);

      normalizeSupportChildren(next, byId, normalizedShelf);

      const shelfPos = next.findIndex((node) => node.nodeId === shelf.nodeId);
      if (shelfPos >= 0) next[shelfPos] = normalizedShelf;
    });
  }

  return next.map((node) => byId.get(node.nodeId) ?? node);
}

export function normalizeVirtualLayout(nodes: WmsVirtualNodeRow[]) {
  // 1) orphan shelf -> rack by code
  // 2) rack -> shelf placement + rotation
  // 3) support stacking for all supports (shelf/box/pallet/slots)
  // 4) drop shelves above shelfCount (legacy duplicates)
  const linked = linkOrphanShelvesToRacks(nodes);
  const withRacks = normalizeRackChildren(linked);
  const stacked = normalizeSupportStacking(withRacks);
  return filterExtraRackShelves(stacked);
}
