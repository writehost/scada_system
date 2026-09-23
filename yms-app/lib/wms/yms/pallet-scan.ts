export const LOADABLE_PALLET_STATUSES = new Set([
  "planned",
  "ready",
  "staged",
  "picked",
  "allocated",
  "open",
  "created",
])

export type PalletOnOrder = {
  code: string
  loadUnitId: string | null
  status: string
  qty: number
}

export function normalizeScanCode(raw: string): string {
  return raw.toUpperCase().replace(/\s+/g, "").trim()
}

export function decidePalletScan(input: {
  code: string
  pallets: PalletOnOrder[]
  acceptedCodes: string[]
  acceptedElsewhere: boolean
}):
  | { ok: true; qty: number; loadUnitId: string | null; status: string }
  | { ok: false; code: string; message: string } {
  const code = normalizeScanCode(input.code)
  if (!code) return { ok: false, code: "empty_scan", message: "Пустой код палеты" }
  if (input.pallets.length === 0) {
    return {
      ok: false,
      code: "wms_pallets_missing",
      message: "В заказе WMS нет кодов палет. Скан не создаёт отгрузку.",
    }
  }
  const hit = input.pallets.find((row) => normalizeScanCode(row.code) === code)
  if (!hit) {
    return { ok: false, code: "wrong_pallet", message: "Этой палеты нет в связанном заказе WMS" }
  }
  const status = (hit.status || "").toLowerCase()
  if (status === "cancelled") {
    return { ok: false, code: "pallet_cancelled", message: "Палета отменена в WMS" }
  }
  if (status === "shipped" || status === "consumed" || status === "closed") {
    return { ok: false, code: "pallet_shipped", message: "Палета уже закрыта в WMS" }
  }
  if (status === "damaged") {
    return { ok: false, code: "pallet_damaged", message: "Палета помечена повреждённой в WMS" }
  }
  if (status && !LOADABLE_PALLET_STATUSES.has(status)) {
    return {
      ok: false,
      code: "pallet_status",
      message: `Статус палеты в WMS «${hit.status}» не допускает погрузку`,
    }
  }
  if (input.acceptedCodes.some((row) => normalizeScanCode(row) === code)) {
    return { ok: false, code: "duplicate_scan", message: "Этот код уже подтверждён по визиту" }
  }
  if (input.acceptedElsewhere) {
    return { ok: false, code: "double_ship", message: "Этот код уже погружен в другой визит" }
  }
  const qty = Number(hit.qty)
  return {
    ok: true,
    qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
    loadUnitId: hit.loadUnitId,
    status,
  }
}
