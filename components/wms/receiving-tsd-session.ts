export function normalizeReceivingDocId(id: string) {
  return id.trim().toUpperCase()
}

export function tsdSessionLabel(status: string, lineCount: number | null, scanCount = 0) {
  const key = status.trim().toLowerCase()
  if (key === "closed") return "Закрыт"
  if (key === "paused") return "На паузе"
  if (key === "unknown") return scanCount > 0 ? "Скан без статуса ТСД" : "Статус не передан"
  if ((lineCount ?? 0) === 0 && key === "active") return "Новый"
  if (key === "active") return "В работе"
  return status || "—"
}

export function tsdSessionTone(status: string, lineCount: number | null = null) {
  const key = status.trim().toLowerCase()
  if (key === "closed") return "bg-muted text-muted-foreground"
  if (key === "paused") return "bg-amber-500/15 text-amber-700"
  if (key === "unknown") return "bg-slate-500/10 text-slate-600"
  if ((lineCount ?? 0) === 0) return "bg-orange-500/15 text-orange-700"
  return "bg-emerald-500/15 text-emerald-700"
}

/** Сессия без сканов и без свежего статуса с ТСД — «зависла» на сервере. */
export function isTsdSessionStale(
  status: string,
  updatedAtIso: string | null | undefined,
  scanCount: number
) {
  const key = status.trim().toLowerCase()
  if (key === "closed") return false
  if (scanCount > 0) return false
  const ts = Date.parse(updatedAtIso || "")
  if (!Number.isFinite(ts)) return true
  return Date.now() - ts > 6 * 60 * 60 * 1000
}

export function isTsdSessionOpen(
  status: string,
  opts?: { updatedAtIso?: string | null; scanCount?: number }
) {
  if (status.trim().toLowerCase() === "closed") return false
  if (opts) {
    return !isTsdSessionStale(status, opts.updatedAtIso, opts.scanCount ?? 0)
  }
  return true
}

export function fmtReceivingTs(v: string | null | undefined) {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" })
}

/** Дата и время раздельно — для узких колонок таблицы. Год опускаем для текущего года. */
export function fmtReceivingTsParts(v: string | null | undefined) {
  if (!v) return null
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return {
    day: d.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      ...(sameYear ? {} : { year: "2-digit" }),
    }),
    time: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
  }
}

export function fmtReceivingQty(n: number) {
  return n % 1 === 0 ? String(Math.round(n)) : n.toFixed(2)
}

export function stockPostedLabel(
  posted: boolean | undefined,
  dismissedEmpty?: boolean,
  partiallyPosted?: boolean
) {
  if (dismissedEmpty) return "Снято"
  if (posted) return "На остатке"
  if (partiallyPosted) return "Частично на остатке"
  return "Не проведён"
}

export function stockPostedTone(
  posted: boolean | undefined,
  dismissedEmpty?: boolean,
  partiallyPosted?: boolean
) {
  if (dismissedEmpty) return "bg-slate-500/10 text-slate-600"
  if (posted) return "bg-emerald-500/15 text-emerald-800"
  if (partiallyPosted) return "bg-amber-500/15 text-amber-900"
  return "bg-orange-500/15 text-orange-800"
}
