import type { YmsOperation } from "./state-machine"

export type LoadingReadiness = {
  hasDocument: boolean
  plannedQty: number
  confirmedQty: number
  plannedPallets: number
  loadedPallets: number
  acknowledgedDiscrepancy: boolean
}

/**
 * Исходящую погрузку нельзя закрыть кнопкой диспетчера.
 * Нужны коды палет из WMS (скан склада или shipScans WMS) либо уже подтверждённое количество строк WMS.
 * Расхождение закрывает хвост только если его явно зафиксировали.
 */
export function canFinishOperation(
  operation: YmsOperation,
  readiness: LoadingReadiness
): { ok: true } | { ok: false; code: string; message: string } {
  if (operation === "INBOUND" || operation === "RETURN") {
    return { ok: true }
  }
  if (!readiness.hasDocument) {
    return {
      ok: false,
      code: "wms_order_required",
      message: "Для отгрузки визит нужно связать с заказом WMS",
    }
  }
  if (readiness.plannedPallets <= 0 && readiness.plannedQty <= 0) {
    return {
      ok: false,
      code: "wms_order_empty",
      message: "В заказе WMS нет палет и нет количества к погрузке",
    }
  }
  if (readiness.plannedPallets > 0 && readiness.loadedPallets + 0.0001 < readiness.plannedPallets) {
    if (!readiness.acknowledgedDiscrepancy) {
      return {
        ok: false,
        code: "wms_shortfall",
        message: `Погружено ${readiness.loadedPallets} из ${readiness.plannedPallets} палет. Нужен скан склада или явное расхождение.`,
      }
    }
  }
  if (readiness.plannedPallets <= 0) {
    const gap = readiness.plannedQty - readiness.confirmedQty
    if (gap > 0.0001 && !readiness.acknowledgedDiscrepancy) {
      return {
        ok: false,
        code: "wms_shortfall",
        message: `WMS подтвердил ${readiness.confirmedQty} из ${readiness.plannedQty}. Кодов палет в заказе нет.`,
      }
    }
  }
  return { ok: true }
}

export function operationPhase(input: {
  status: string
  orderReady: boolean | null
  loadedPallets: number
  plannedPallets: number
  jobStatus: string | null
}): { code: string; label: string } {
  if (input.status === "departed") return { code: "departed", label: "Выехал" }
  if (input.status === "ready_exit") return { code: "ready_exit", label: "Готов к выезду" }
  if (input.status === "awaiting_docs") return { code: "awaiting_docs", label: "Ожидает документы" }
  if (input.status === "cancelled" || input.status === "entry_denied" || input.status === "no_show") {
    return { code: input.status, label: "Операция закрыта" }
  }
  if (input.jobStatus === "waiting" && (input.status === "loading" || input.status === "unloading")) {
    return { code: "paused", label: "Приостановлено" }
  }
  if (
    (input.status === "loading" || input.status === "unloading") &&
    input.plannedPallets > 0 &&
    input.loadedPallets >= input.plannedPallets
  ) {
    return { code: "loaded", label: "Погрузка завершена" }
  }
  if (input.status === "loading" || input.status === "unloading") {
    return { code: input.status, label: input.status === "unloading" ? "Разгрузка" : "Погрузка" }
  }
  if (input.status === "to_dock") return { code: "at_dock", label: "У дока" }
  if (input.status === "awaiting_dock") return { code: "awaiting_dock", label: "Ожидает док" }
  if (input.orderReady === false) return { code: "awaiting_cargo", label: "Ожидает груз" }
  return { code: input.status, label: "На территории" }
}
