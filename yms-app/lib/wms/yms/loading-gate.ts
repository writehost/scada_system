import type { YmsOperation } from "./state-machine"

export type LoadingReadiness = {
  hasDocument: boolean
  plannedQty: number
  confirmedQty: number
  palletCount: number
  openTaskCount: number
  acknowledgedDiscrepancy: boolean
}

/**
 * Исходящую погрузку нельзя закрыть кнопкой диспетчера, пока склад
 * не подтвердил количество. Расхождение допускается только явно.
 * Входящая разгрузка на складские остатки из YMS не пишется.
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
  if (readiness.plannedQty <= 0) {
    return {
      ok: false,
      code: "wms_order_empty",
      message: "В заказе WMS нет строк к погрузке",
    }
  }
  const gap = readiness.plannedQty - readiness.confirmedQty
  if (gap > 0.0001) {
    if (!readiness.acknowledgedDiscrepancy) {
      return {
        ok: false,
        code: "wms_shortfall",
        message: `Склад подтвердил ${readiness.confirmedQty} из ${readiness.plannedQty}. Зафиксируйте расхождение или дождитесь погрузки.`,
      }
    }
  }
  return { ok: true }
}
