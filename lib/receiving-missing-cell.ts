import type { StorageSlotProfile } from "@/lib/storage-slot-ui"

export type ReceivingMissingCellDetails = {
  itemCode: string
  itemName: string
  slotProfile: StorageSlotProfile
  slotTitle: string
  warehouseCode: string
  zoneCode: string
  locationCode: string
  displayName: string
}

export function parseReceivingMissingCellDetails(raw: unknown): ReceivingMissingCellDetails | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  const itemCode = String(d.itemCode ?? "").trim()
  const locationCode = String(d.locationCode ?? "").trim()
  if (!itemCode || !locationCode) return null
  const slotProfile = d.slotProfile
  if (!slotProfile || typeof slotProfile !== "object") return null
  return {
    itemCode,
    itemName: String(d.itemName ?? itemCode),
    slotProfile: slotProfile as StorageSlotProfile,
    slotTitle: String(d.slotTitle ?? d.displayName ?? locationCode),
    warehouseCode: String(d.warehouseCode ?? "OS"),
    zoneCode: String(d.zoneCode ?? "ST-BAGG"),
    locationCode,
    displayName: String(d.displayName ?? d.slotTitle ?? locationCode),
  }
}
