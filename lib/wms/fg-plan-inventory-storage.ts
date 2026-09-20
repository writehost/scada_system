import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export type FgPlanInventorySlot = {
  address: string
  status: "free" | "occupied" | "reserved" | "blocked"
  palletId?: string
  nomenclature?: string
  gtin?: string
  batch?: string
  productionDate?: string
  quantity?: number
  unit?: string
  /** Сколько бутылок уже провели в wms_stock_balances с этого слота. */
  stockPostedQty?: number
  stockPostedAt?: string
  stockPostedItemCode?: string
}

export type FgPlanInventorySnapshot = {
  version: 1
  updatedAt: string
  inventory: Record<string, FgPlanInventorySlot>
}

function sharedRoot(): string {
  const shared = (process.env.WMS_SHARED_DIR ?? "").trim()
  if (shared) return path.join(shared, "uploads", "fg-plan-inventory")

  const cwd = process.cwd()
  const currentMarker = `${path.sep}current${path.sep}`
  const markerIndex = cwd.toLowerCase().indexOf(currentMarker.toLowerCase())
  if (markerIndex >= 0) {
    const installRoot = cwd.slice(0, markerIndex)
    return path.join(installRoot, "shared", "uploads", "fg-plan-inventory")
  }

  return path.join(process.cwd(), "public", "fg-plan-inventory")
}

function inventoryPath(siteId: number): string {
  return path.join(sharedRoot(), `site-${siteId}.json`)
}

export async function readFgPlanInventory(siteId: number): Promise<FgPlanInventorySnapshot> {
  const filePath = inventoryPath(siteId)
  try {
    const raw = await readFile(filePath, "utf8")
    const parsed = JSON.parse(raw) as FgPlanInventorySnapshot
    if (parsed?.version === 1 && parsed.inventory && typeof parsed.inventory === "object") {
      const inventory: Record<string, FgPlanInventorySlot> = {}
      for (const [key, slot] of Object.entries(parsed.inventory)) {
        if (!slot || typeof slot !== "object") continue
        inventory[key] = { ...slot, address: key }
      }
      return { ...parsed, inventory }
    }
  } catch {
    /* empty */
  }
  return { version: 1, updatedAt: new Date(0).toISOString(), inventory: {} }
}

export async function writeFgPlanInventory(
  siteId: number,
  inventory: Record<string, FgPlanInventorySlot>
): Promise<FgPlanInventorySnapshot> {
  const dir = sharedRoot()
  await mkdir(dir, { recursive: true })
  const normalized: Record<string, FgPlanInventorySlot> = {}
  for (const [key, slot] of Object.entries(inventory)) {
    if (!slot || typeof slot !== "object") continue
    normalized[key] = { ...slot, address: key }
  }
  const snapshot: FgPlanInventorySnapshot = {
    version: 1,
    updatedAt: new Date().toISOString(),
    inventory: normalized,
  }
  await writeFile(inventoryPath(siteId), JSON.stringify(snapshot, null, 2), "utf8")
  return snapshot
}
