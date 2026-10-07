import type { PoolClient } from "pg"
import { getDocumentDetail, listDocuments } from "@/lib/wms/documents"
import { WmsHttpError } from "@/lib/wms/errors"
import { getDocumentKind } from "./schema.ts"

/**
 * Данные реального документа WMS для шаблона. Берутся существующим getDocumentDetail —
 * в шаблон уходит только явный набор полей, без строк БД целиком.
 */

const TYPE_LABELS: Record<string, string> = {
  receiving: "Приёмка",
  putaway: "Размещение",
  replenishment: "Пополнение",
  transfer: "Перемещение",
  interwarehouse_transfer: "Межскладское перемещение",
  issue: "Выдача",
  return: "Возврат",
  revision: "Ревизия",
  picking: "Отбор",
  shipment: "Отгрузка",
  writeoff: "Списание",
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  released: "Выпущен",
  in_progress: "В работе",
  completed: "Выполнен",
  done: "Выполнен",
  cancelled: "Отменён",
  applied: "Проведён",
}

function str(v: unknown): string {
  return v == null ? "" : String(v)
}

function isoDate(v: unknown): string {
  if (!v) return ""
  const d = v instanceof Date ? v : new Date(String(v))
  return Number.isNaN(d.getTime()) ? str(v) : d.toISOString()
}

export async function wmsDocumentContext(client: PoolClient, siteId: number, documentId: string, origin: string) {
  if (!/^\d+$/.test(documentId)) throw new WmsHttpError(400, "Некорректный номер документа")
  const detail = await getDocumentDetail(client, siteId, documentId)
  if (!detail) throw new WmsHttpError(404, "Документ WMS не найден", "document_not_found")
  const d = detail.document as Record<string, unknown>
  const lines = detail.lines as Record<string, unknown>[]
  return {
    document: {
      number: str(d.documentNo) || str(d.documentId),
      date: isoDate(d.receiptAt ?? d.appliedAt ?? d.createdAt),
      type: TYPE_LABELS[str(d.documentType)] ?? str(d.documentType),
      status: STATUS_LABELS[str(d.documentStatus)] ?? str(d.documentStatus),
      comment: str(d.comment),
      source_warehouse: str(d.sourceWarehouseName) || str(d.sourceWarehouseCode),
      target_warehouse: str(d.targetWarehouseName) || str(d.targetWarehouseCode),
      source_location: str(d.sourceLocationCode),
      target_location: str(d.targetLocationCode),
      line_name: str(d.lineName),
      operator: str(d.operatorName),
      external_ref: str(d.externalRef),
      url: `${origin}/documents/${str(d.documentId)}`,
      items: lines.map((l) => ({
        line_no: Number(l.lineNo) || 0,
        name: str(l.itemName),
        code: str(l.itemCode),
        quantity: Number(l.requestedQty) || 0,
        confirmed_quantity: l.confirmedQty == null ? null : Number(l.confirmedQty),
        unit: str(l.requestedUomCode),
        lot: str(l.lotCode) || str(l.batchLabel),
        source_location: str(l.sourceLocationCode),
        target_location: str(l.targetLocationCode),
        load_unit: str(l.loadUnitCode),
        comment: str(l.comment),
        // Поля торговых шаблонов, которые есть в строке WMS.
        gtin: "",
        price: null,
        amount: null,
      })),
    },
  }
}

export async function listWmsDocumentsForPreview(client: PoolClient, siteId: number) {
  const { documents } = await listDocuments(client, siteId, { limit: 30 })
  return (documents as Record<string, unknown>[]).map((d) => ({
    id: str(d.documentId),
    label: `${TYPE_LABELS[str(d.documentType)] ?? str(d.documentType)} № ${str(d.documentNo) || str(d.documentId)} · ${new Date(String(d.createdAt)).toLocaleDateString("ru-RU")}`,
  }))
}

/** Данные предпросмотра: тестовый набор схемы или реальный документ WMS. */
export async function resolvePreviewData(
  client: PoolClient,
  siteId: number,
  kindId: string,
  source: { sampleId?: string | null; documentId?: string | null },
  origin: string
): Promise<Record<string, unknown>> {
  const kind = getDocumentKind(kindId)
  const sample = kind.samples.find((s) => s.id === source.sampleId) ?? kind.samples[0]
  if (source.documentId) {
    const ctx = await wmsDocumentContext(client, siteId, source.documentId, origin)
    // Организация и прочие разделы, которых нет в WMS-документе, — из тестового набора.
    return { ...(sample?.data ?? {}), ...ctx }
  }
  return structuredClone(sample?.data ?? {})
}
