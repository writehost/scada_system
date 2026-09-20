import type { WmsTaskRow, WmsWarehouseOccupancyZoneRow } from "@/lib/wms-api"

export type AttentionItemKind = "zone_full" | "task_exception" | "expiry_warning" | "expiry_critical"

export type AttentionItem = {
  id: string
  kind: AttentionItemKind
  title: string
  description: string
  href: string
}

export type ExpiryStickerAlertBrief = {
  itemCode: string
  itemName: string
  lotCode: string
  tier: "warning" | "critical" | "expired"
  daysSinceEmission: number
  shelfLifeDays: number
  qty: number
  emissionLabel: string
  locationCode?: string | null
}

function pluralRu(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}

function normalizeExpiryAlert(raw: ExpiryStickerAlertBrief | Record<string, unknown>): ExpiryStickerAlertBrief | null {
  const itemCode = String((raw as ExpiryStickerAlertBrief).itemCode || "").trim()
  if (!itemCode) return null
  const lotCode = String((raw as ExpiryStickerAlertBrief).lotCode || "").trim() || "NO-LOT"
  const rawTier = String((raw as ExpiryStickerAlertBrief).tier || (raw as { severity?: string }).severity || "")
    .toLowerCase()
  let tier: ExpiryStickerAlertBrief["tier"] = "warning"
  if (rawTier.includes("expired") || rawTier === "expired") tier = "expired"
  else if (rawTier.includes("critical")) tier = "critical"
  else if (rawTier.includes("warning")) tier = "warning"
  else return null

  return {
    itemCode,
    itemName: String((raw as ExpiryStickerAlertBrief).itemName || itemCode),
    lotCode,
    tier,
    daysSinceEmission: Number((raw as ExpiryStickerAlertBrief).daysSinceEmission) || 0,
    shelfLifeDays: Number((raw as ExpiryStickerAlertBrief).shelfLifeDays) || 365,
    qty: Number((raw as ExpiryStickerAlertBrief).qty) || 0,
    emissionLabel: String((raw as ExpiryStickerAlertBrief).emissionLabel || "—"),
    locationCode: ((raw as ExpiryStickerAlertBrief).locationCode as string | null | undefined) || null,
  }
}

export function buildAttentionItems(input: {
  tasks: WmsTaskRow[]
  zones: WmsWarehouseOccupancyZoneRow[]
  expiryAlerts: Array<ExpiryStickerAlertBrief | Record<string, unknown>>
}): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const task of input.tasks) {
    const status = (task.taskStatus || "").toLowerCase()
    if (!task.exceptionCode && !status.includes("exception")) continue
    items.push({
      id: `task:${task.taskId}`,
      kind: "task_exception",
      title: `Задание ${task.taskCode}`,
      description: task.exceptionCode
        ? `Проблема: ${task.exceptionCode}`
        : "Задание в статусе «исключение» — нужна проверка оператором",
      href: `/tasks/${encodeURIComponent(task.taskId)}`,
    })
  }

  for (const zone of input.zones) {
    if (zone.locationCount <= 0) continue
    const ratio = zone.nonEmptyCount / zone.locationCount
    if (ratio < 0.9) continue
    const pct = Math.round(ratio * 100)
    items.push({
      id: `zone:${zone.warehouseCode}:${zone.zoneCode}`,
      kind: "zone_full",
      title: `Зона ${zone.zoneCode} заполнена на ${pct}%`,
      description: `Склад ${zone.warehouseCode}: занято ${zone.nonEmptyCount} из ${zone.locationCount} ячеек`,
      href: "/occupancy",
    })
  }

  for (const raw of input.expiryAlerts) {
    const alert = normalizeExpiryAlert(raw)
    if (!alert) continue
    const daysLeft = Math.max(0, alert.shelfLifeDays - alert.daysSinceEmission)
    const loc = (alert.locationCode || "").trim()
    const expired = alert.tier === "expired"
    const kind: AttentionItemKind = alert.tier === "warning" ? "expiry_warning" : "expiry_critical"
    const title = loc
      ? expired
        ? `Ячейка ${loc} просрочена`
        : `Ячейка ${loc} · срок стикера`
      : alert.itemName || alert.itemCode
    const description = expired
      ? `${alert.itemName || alert.itemCode}: эмиссия ${alert.emissionLabel}, прошло ${alert.daysSinceEmission} дн. Остаток ${alert.qty} шт. — нужно списание.`
      : alert.tier === "critical"
        ? `Эмиссия ${alert.emissionLabel}: прошло ${alert.daysSinceEmission} дн. (~${daysLeft} дн. до конца срока). На складе ${alert.qty} шт. — нужно списание.`
        : `Эмиссия ${alert.emissionLabel}: прошло ${alert.daysSinceEmission} дн. (~${daysLeft} дн. до конца срока). Проверьте партию (${alert.qty} шт.).`
    const href = loc
      ? `/cells?locationCode=${encodeURIComponent(loc)}`
      : `/nomenclature/${encodeURIComponent(alert.itemCode)}?lotCode=${encodeURIComponent(alert.lotCode)}`

    items.push({
      id: `expiry:${alert.itemCode}:${alert.lotCode}:${loc || "_"}:${alert.tier}`,
      kind,
      title,
      description,
      href,
    })
  }

  return items
}

export function summarizeAttentionItems(items: AttentionItem[]): string {
  if (items.length === 0) return "Всё в порядке"
  const zones = items.filter((i) => i.kind === "zone_full").length
  const tasks = items.filter((i) => i.kind === "task_exception").length
  const expiryItems = items.filter((i) => i.kind === "expiry_warning" || i.kind === "expiry_critical")
  const parts: string[] = []
  if (zones > 0) {
    parts.push(`${zones} ${pluralRu(zones, "переполненная зона", "переполненные зоны", "переполненных зон")}`)
  }
  if (expiryItems.length === 1) {
    parts.push(expiryItems[0].title)
  } else if (expiryItems.length > 1) {
    const expired = expiryItems.filter((i) => /просрочен/i.test(i.title)).length
    if (expired === expiryItems.length) {
      parts.push(
        `${expired} ${pluralRu(expired, "просроченная ячейка", "просроченные ячейки", "просроченных ячеек")}`
      )
    } else {
      parts.push(
        `${expiryItems.length} ${pluralRu(expiryItems.length, "срок стикера", "срока стикера", "сроков стикера")}`
      )
    }
  }
  if (tasks > 0) {
    parts.push(`${tasks} ${pluralRu(tasks, "проблемное задание", "проблемных задания", "проблемных заданий")}`)
  }
  return parts.join(" · ")
}

export function attentionKindLabel(kind: AttentionItemKind): string {
  if (kind === "zone_full") return "Заполненность"
  if (kind === "task_exception") return "Задание"
  if (kind === "expiry_critical") return "Просрочка"
  return "Срок стикера"
}
