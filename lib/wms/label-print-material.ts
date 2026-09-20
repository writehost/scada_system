import { listItems, type WmsItemListRow } from "@/lib/wms-api"

/** Нормализация stickerType с терминала → single | block12 | other */
export function normalizeStickerPrintKind(
  raw: string | null | undefined,
): "single" | "block12" | "" {
  const t = String(raw || "")
    .trim()
    .toLowerCase()
  if (!t) return ""
  if (t === "single" || t === "unit" || t === "единичный" || t === "единичный код") return "single"
  if (
    t === "block12" ||
    t === "block" ||
    t === "group" ||
    t === "блочный" ||
    t === "блочный код" ||
    t.startsWith("block")
  ) {
    return "block12"
  }
  return ""
}

export function stickerTypeRu(raw: string | null | undefined): string {
  const kind = normalizeStickerPrintKind(raw)
  if (kind === "single") return "Единичный"
  if (kind === "block12") return "Блочный"
  const t = String(raw || "").trim()
  return t || "—"
}

export type LabelPrintMaterial = {
  itemCode: string
  name: string
  availableQty: number
  stickerPrintKind: "single" | "block12" | ""
  sizeLabel: string
}

function nomFromItem(item: WmsItemListRow): Record<string, unknown> {
  const attrs = (item.itemAttrs ?? {}) as Record<string, unknown>
  return (attrs.nomenclature ?? {}) as Record<string, unknown>
}

function sizeLabelFromNom(nom: Record<string, unknown>): string {
  const w = nom.labelWidthMm
  const h = nom.labelHeightMm
  if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
    return `${w}×${h} мм`
  }
  return ""
}

function toMaterial(item: WmsItemListRow, nom: Record<string, unknown>): LabelPrintMaterial {
  return {
    itemCode: item.itemCode,
    name: item.name || item.sku || item.itemCode,
    availableQty: Number(item.availableQty) || 0,
    stickerPrintKind: normalizeStickerPrintKind(String(nom.stickerPrintKind || "")),
    sizeLabel: sizeLabelFromNom(nom),
  }
}

/** Номенклатура с флагом «Расходник для печати стикеров». */
export async function loadLabelPrintMaterials(): Promise<LabelPrintMaterial[]> {
  const tryTypes = ["STICKER,stickers,LABEL,CONSUMABLE,LABELS", ""]
  const out: LabelPrintMaterial[] = []
  const seen = new Set<string>()

  for (const itemTypeCode of tryTypes) {
    const res = await listItems({
      ...(itemTypeCode ? { itemTypeCode } : {}),
      isActive: true,
      limit: itemTypeCode ? 300 : 500,
    })
    for (const item of res.items ?? []) {
      const nom = nomFromItem(item)
      if (!Boolean(nom.printLabelConsumable)) continue
      if (seen.has(item.itemCode)) continue
      seen.add(item.itemCode)
      out.push(toMaterial(item, nom))
    }
    if (out.length > 0) break
  }

  return out
}

export function findMaterialForStickerType(
  materials: LabelPrintMaterial[],
  stickerType: string | null | undefined,
): LabelPrintMaterial | null {
  const kind = normalizeStickerPrintKind(stickerType)
  if (!materials.length) return null
  if (!kind) {
    return materials.length === 1 ? materials[0] : null
  }
  const exact = materials.filter((m) => m.stickerPrintKind === kind)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    return exact.reduce((a, b) => (b.availableQty > a.availableQty ? b : a))
  }
  const unbound = materials.filter((m) => !m.stickerPrintKind)
  if (unbound.length === 1) return unbound[0]
  return null
}

export function formatMaterialStockLine(mat: LabelPrintMaterial | null): string | null {
  if (!mat) return null
  const size = mat.sizeLabel ? ` (${mat.sizeLabel})` : ""
  return `материал: ${mat.name}${size} · остаток этикетки на складе: ${Math.round(mat.availableQty)}`
}
