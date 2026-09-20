import type { InboxItem } from "@/components/wms/dashboard-action-inbox"
import { MIN_ZONE_FOR_ALERT } from "@/components/wms/dashboard-occupancy-panel"
import type { ExpiryStickerAlertBrief } from "@/lib/wms/attention-items"
import {
  isClosedUnposted,
  isStaleSession,
  plural,
  relativeTime,
  type DashboardReceiving,
  type DashboardSummary,
  type DashboardTsdSession,
} from "@/lib/wms/dashboard-data"

const MAX_PER_GROUP = 4

function sessionTitle(s: DashboardTsdSession): string {
  const name = (s.itemName || "").trim()
  if (name) return name.length > 60 ? `${name.slice(0, 60)}…` : name
  return s.itemCode || "Позиция не определена"
}

/**
 * Что на складе реально ждёт человека. Раньше дашборд показывал только счётчик
 * «требует внимания», и было непонятно, куда идти и что нажимать.
 */
export function buildDashboardInbox(input: {
  summary: DashboardSummary | null
  receiving: DashboardReceiving | null
  expiryAlerts: Array<ExpiryStickerAlertBrief | Record<string, unknown>>
}): InboxItem[] {
  const items: InboxItem[] = []
  const sessions = input.receiving?.sessions ?? []

  const unposted = sessions.filter(isClosedUnposted)
  for (const s of unposted.slice(0, MAX_PER_GROUP)) {
    const pending = s.stockPendingLineCount ?? s.lineCount ?? 0
    items.push({
      id: `unposted:${s.documentId}`,
      severity: "critical",
      group: "receiving",
      title: `Приёмка ${s.documentId} не встала на остаток`,
      description: `${sessionTitle(s)} · ${pending} ${plural(pending, "позиция", "позиции", "позиций")} ждут ячейку · закрыта ${relativeTime(s.updatedAtIso)}`,
      href: `/receiving/session/${encodeURIComponent(s.documentId)}`,
      actionLabel: "Провести",
    })
  }
  if (unposted.length > MAX_PER_GROUP) {
    const rest = unposted.length - MAX_PER_GROUP
    items.push({
      id: "unposted:more",
      severity: "critical",
      group: "receiving",
      title: `Ещё ${rest} ${plural(rest, "закрытая приёмка", "закрытые приёмки", "закрытых приёмок")} без проведения`,
      description: "Товар отсканирован, но на остатках его нет — до проведения он не виден ни в одной ячейке.",
      href: "/receiving",
      actionLabel: "Открыть список",
    })
  }

  const stale = sessions.filter(isStaleSession)
  if (stale.length > 0) {
    items.push({
      id: "stale-sessions",
      severity: "warning",
      group: "receiving",
      title: `${stale.length} ${plural(stale.length, "зависшая сессия", "зависшие сессии", "зависших сессий")} ТСД`,
      description: "Сессии открыты, но сканов в них нет уже больше шести часов — их стоит закрыть.",
      href: "/receiving",
      actionLabel: "Разобрать",
    })
  }

  const missing = input.receiving?.missingNomenclature ?? []
  if (missing.length > 0) {
    items.push({
      id: "missing-nomenclature",
      severity: "warning",
      group: "nomenclature",
      title: `${missing.length} ${plural(missing.length, "код", "кода", "кодов")} без номенклатуры`,
      description: `Оператор отсканировал товар, которого нет в справочнике. Последний: ${missing[0]?.code ?? "—"}.`,
      href: "/receiving",
      actionLabel: "Добавить",
    })
  }

  const expired: string[] = []
  const critical: string[] = []
  for (const raw of input.expiryAlerts) {
    const alert = raw as ExpiryStickerAlertBrief
    const tier = String(alert.tier ?? "").toLowerCase()
    const where = (alert.locationCode || "").trim()
    const label = where || alert.itemCode || ""
    if (!label) continue
    if (tier === "expired") expired.push(label)
    else if (tier === "critical") critical.push(label)
  }
  if (expired.length > 0) {
    items.push({
      id: "expiry-expired",
      severity: "critical",
      group: "expiry",
      title: `${expired.length} ${plural(expired.length, "просроченная партия", "просроченные партии", "просроченных партий")}`,
      description: `Срок стикера вышел: ${expired.slice(0, 3).join(", ")}${expired.length > 3 ? "…" : ""}. Нужно списание.`,
      href: "/attention",
      actionLabel: "Списать",
    })
  }
  if (critical.length > 0) {
    items.push({
      id: "expiry-critical",
      severity: "warning",
      group: "expiry",
      title: `${critical.length} ${plural(critical.length, "партия на исходе", "партии на исходе", "партий на исходе")} срока`,
      description: `Проверьте: ${critical.slice(0, 3).join(", ")}${critical.length > 3 ? "…" : ""}.`,
      href: "/attention",
      actionLabel: "Проверить",
    })
  }

  const zones = (input.summary?.stock.zones ?? []).filter(
    (z) => z.locationCount >= MIN_ZONE_FOR_ALERT && z.nonEmptyCount / z.locationCount >= 0.9
  )
  for (const zone of zones.slice(0, MAX_PER_GROUP)) {
    const pct = Math.round((zone.nonEmptyCount / zone.locationCount) * 100)
    items.push({
      id: `zone:${zone.warehouseCode}:${zone.zoneCode}`,
      severity: pct >= 100 ? "warning" : "info",
      group: "zones",
      title: `Зона ${zone.zoneCode} заполнена на ${pct}%`,
      description: `Склад ${zone.warehouseCode}: занято ${zone.nonEmptyCount} из ${zone.locationCount} ${plural(zone.locationCount, "ячейки", "ячеек", "ячеек")} — новый товар складывать некуда.`,
      href: "/occupancy",
      actionLabel: "Открыть карту",
    })
  }

  const tasks = input.summary?.tasks
  if (tasks && tasks.exceptions > 0) {
    items.push({
      id: "task-exceptions",
      severity: "critical",
      group: "tasks",
      title: `${tasks.exceptions} ${plural(tasks.exceptions, "задание с ошибкой", "задания с ошибкой", "заданий с ошибкой")}`,
      description: "Оператор не смог выполнить задание — нужно разобраться и перевыдать.",
      href: "/tasks",
      actionLabel: "Открыть",
    })
  }
  if (tasks && tasks.overdue > 0) {
    items.push({
      id: "task-overdue",
      severity: "warning",
      group: "tasks",
      title: `${tasks.overdue} ${plural(tasks.overdue, "просроченное задание", "просроченных задания", "просроченных заданий")}`,
      description: "Срок выполнения прошёл, задание всё ещё в очереди ТСД.",
      href: "/tasks",
      actionLabel: "Открыть",
    })
  }

  const weight = { critical: 0, warning: 1, info: 2 }
  return items.sort((a, b) => weight[a.severity] - weight[b.severity])
}
