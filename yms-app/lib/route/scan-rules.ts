/**
 * Решение по скану палеты и адреса. Чистые функции: вход — задание и ответ WMS.
 * Смена содержимого задания по факту скана запрещена: другая палета = отказ.
 */
import { palletKey } from "@/lib/route/codes"
import { normalizeLocation } from "@/lib/route/graph"
import type { AddressCheck, PalletCheck } from "@/lib/route/wms-gateway"

export type ScanDecision =
  | { ok: true; message: string; details: Record<string, unknown> }
  | { ok: false; code: string; message: string; expected?: string | null; actual?: string | null; details?: Record<string, unknown> }

export type TaskForScan = {
  huCode: string
  sourceCode: string
  sourceIsStorage: boolean
  destCode: string
  taskRef: string
}

export function decidePalletScan(task: TaskForScan, scanned: string, wms: PalletCheck): ScanDecision {
  const code = palletKey(scanned)
  if (!code) return { ok: false, code: "empty_scan", message: "Пустой код палеты" }
  const expected = palletKey(task.huCode)
  if (code !== expected) {
    return {
      ok: false,
      code: "wrong_pallet",
      message: "Неверная палета",
      expected: task.huCode,
      actual: scanned,
      details: wms.pallet ? { actualItem: wms.pallet.itemName, actualLot: wms.pallet.lotCode } : {},
    }
  }
  if (!wms.found || !wms.pallet) {
    return { ok: false, code: "pallet_not_found", message: "Палета не найдена в WMS", expected: task.huCode, actual: scanned }
  }
  const p = wms.pallet
  const blocking = wms.problems.find((pr) =>
    ["pallet_other_site", "pallet_quarantine", "pallet_locked", "pallet_resort", "pallet_shipped", "pallet_unlinked"].includes(pr.code)
  )
  if (blocking) return { ok: false, code: blocking.code, message: blocking.message, expected: task.huCode, actual: scanned }
  if (p.locationStatus === "quarantine") {
    return { ok: false, code: "pallet_quarantine", message: "Палета в карантине — перемещение запрещено" }
  }
  if (p.reservedTaskRef && p.reservedTaskRef !== task.taskRef) {
    return { ok: false, code: "pallet_locked", message: `Палета занята другой операцией (${p.reservedTaskRef})` }
  }
  if (task.sourceIsStorage) {
    const at = normalizeLocation(p.locationCode)
    const src = normalizeLocation(task.sourceCode)
    if (at !== src) {
      return {
        ok: false,
        code: "pallet_location_mismatch",
        message: at ? `Палета по WMS стоит в ${p.locationCode}, а не в ${task.sourceCode}` : `По WMS палета не числится в ${task.sourceCode}`,
        expected: task.sourceCode,
        actual: p.locationCode,
      }
    }
  }
  return {
    ok: true,
    message: "Палета соответствует заданию",
    details: {
      sscc: p.sscc || p.code,
      itemCode: p.itemCode,
      itemName: p.itemName,
      lotCode: p.lotCode,
      qty: p.qty,
      locationCode: p.locationCode,
    },
  }
}

export function decideAddressScan(task: TaskForScan, scannedAddress: string, wms: AddressCheck): ScanDecision {
  const got = normalizeLocation(scannedAddress)
  const want = normalizeLocation(task.destCode)
  if (!got) return { ok: false, code: "empty_scan", message: "Пустой код адреса" }
  if (got !== want) {
    return { ok: false, code: "wrong_address", message: "Неверный адрес", expected: task.destCode, actual: scannedAddress }
  }
  if (!wms.found || !wms.address) {
    return { ok: false, code: "address_not_found", message: "Адрес не найден в WMS" }
  }
  const a = wms.address
  if (!a.active) return { ok: false, code: "address_inactive", message: "Адрес отключён в WMS" }
  if (a.quarantine) return { ok: false, code: "address_quarantine", message: "Адрес в карантине" }
  if (a.free != null && a.free <= 0) {
    return { ok: false, code: "address_full", message: `В ${a.locationCode} нет свободного места` }
  }
  const conflict = a.reservedBy.filter((ref) => ref && ref !== task.taskRef)
  if (conflict.length && a.free != null && a.free <= conflict.length) {
    return { ok: false, code: "address_reserved", message: `Место зарезервировано другой операцией: ${conflict.join(", ")}` }
  }
  const blocking = wms.problems.find((p) => p.code !== "info")
  if (blocking) return { ok: false, code: blocking.code, message: blocking.message }
  if (wms.placement && !wms.placement.ok) {
    return { ok: false, code: "placement_rule", message: wms.placement.reason || "Правила размещения WMS запрещают этот адрес" }
  }
  return { ok: true, message: "Адрес подтверждён", details: { locationCode: a.locationCode, free: a.free, capacity: a.capacity } }
}
