import type { ProductionPlanRow } from "@/lib/wms-api"

/**
 * Партии из Векас — это отчёт с линии, а не план: пока партия в работе, в
 * `planned_qty` лежит заглушка 1, а при закрытии туда дописывается факт.
 * Поэтому «план» у таких записей показывать нельзя — только факт.
 */
const VEKAS_PLACEHOLDER_QTY = 1

export type ApsFactState =
  /** Партия на линии, факт Векас ещё не отдал. */
  | "running"
  /** Факт пришёл с линии (Векас). */
  | "reported"
  /** Факт введён вручную через API прогресса. */
  | "manual"
  /** Есть плановое задание, факта пока нет. */
  | "planned"
  /** Партия закрыта, но количество получить не удалось. */
  | "unknown"

export type ApsPlanFact = {
  /** Сколько выпущено, шт. null — ещё неизвестно. */
  factQty: number | null
  /** Плановое задание, шт. null — у записи нет собственного плана (отчёт с линии). */
  planQty: number | null
  /** Выполнение плана, %. null — считать не от чего. */
  percent: number | null
  /** Заполнение полоски в календаре, 0..100. */
  barPercent: number
  state: ApsFactState
  /** Человекочитаемый источник факта. */
  factSource: string | null
}

function numOrNull(value: number | null | undefined): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function clampApsPercent(value: number | null | undefined): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function factSourceLabel(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim()
  if (!s) return null
  if (s.startsWith("vekas:slavda")) return "линия (Славда)"
  if (s.startsWith("vekas:skit")) return "линия (Скит)"
  if (s.startsWith("vekas")) return "линия"
  if (s === "manual" || s.startsWith("manual")) return "вручную"
  return s
}

export function resolveApsPlanFact(plan: ProductionPlanRow): ApsPlanFact {
  const actual = numOrNull(plan.actualQty)
  const vekas = numOrNull(plan.vekasProducedQty)
  const planned = numOrNull(plan.plannedQty)
  const source = factSourceLabel(plan.actualSource)

  if (plan.externalSource === "vekas") {
    if (plan.status === "in_progress") {
      // Векас отдаёт количество только после закрытия партии, поэтому здесь
      // может быть только то, что внесли руками.
      const manual = actual != null && actual > 0 ? actual : null
      const declared = clampApsPercent(plan.actualPercent)
      return {
        factQty: manual,
        planQty: null,
        // Плана у партии нет, поэтому процент показываем только если его
        // проставили вручную.
        percent: manual != null && declared > 0 ? declared : null,
        barPercent: declared,
        state: manual != null ? "manual" : "running",
        factSource: manual != null ? source ?? "вручную" : null,
      }
    }

    const fact =
      vekas ??
      (actual != null && actual > 0 ? actual : null) ??
      (planned != null && planned > VEKAS_PLACEHOLDER_QTY ? planned : null)
    return {
      factQty: fact,
      planQty: null,
      percent: null,
      barPercent: fact != null ? 100 : clampApsPercent(plan.actualPercent),
      state: fact != null ? "reported" : "unknown",
      factSource: fact != null ? source ?? "линия" : null,
    }
  }

  // Ручные заказы и импорт СКИТ: planned_qty — настоящее задание.
  const fact = vekas ?? actual
  const planQty = planned != null && planned > 0 ? planned : null
  const percent =
    fact != null && planQty != null
      ? clampApsPercent((fact / planQty) * 100)
      : fact != null
        ? clampApsPercent(plan.actualPercent)
        : null

  let state: ApsFactState = "planned"
  if (fact != null) state = plan.actualSource?.startsWith("vekas") ? "reported" : "manual"

  return {
    factQty: fact,
    planQty,
    percent,
    barPercent: percent ?? clampApsPercent(plan.actualPercent),
    state,
    factSource: fact != null ? source : null,
  }
}

export function formatApsQty(qty: number): string {
  if (!Number.isFinite(qty)) return "—"
  return qty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })
}

/** Короткая форма для узких мест вроде полосок календаря: 37 907 → «37,9 тыс». */
export function formatApsQtyShort(qty: number): string {
  if (!Number.isFinite(qty)) return "—"
  const abs = Math.abs(qty)
  if (abs >= 1_000_000) {
    return `${(qty / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн`
  }
  if (abs >= 10_000) {
    return `${(qty / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} тыс`
  }
  return formatApsQty(qty)
}

/** Подпись факта: то, что пользователь ищет ответом на «сколько сделали». */
export function apsFactLabel(fact: ApsPlanFact, opts?: { short?: boolean }): string {
  const fmt = opts?.short ? formatApsQtyShort : formatApsQty
  if (fact.factQty != null) return `${fmt(fact.factQty)} шт`
  if (fact.state === "running") return "идёт"
  if (fact.state === "planned") return "—"
  return "нет данных"
}

export function apsPlanLabel(fact: ApsPlanFact, opts?: { short?: boolean }): string {
  const fmt = opts?.short ? formatApsQtyShort : formatApsQty
  if (fact.planQty == null) return "—"
  return `${fmt(fact.planQty)} шт`
}

/**
 * Метки времени приходят в трёх видах: Postgres отдаёт
 * `2026-09-04 16:52:35.774+00`, Векас — `2026-09-05T15:03:18.7947769+10:00`,
 * а иногда время без зоны. `Date` не разбирает форму с `T` и двузначным
 * смещением (`...T16:52:35+00`), поэтому смещение нормализуется до `+00:00`,
 * а при его отсутствии подставляется заводская зона.
 */
function parseApsTs(value: string | null | undefined): Date | null {
  if (!value) return null
  let raw = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) return null

  raw = raw.replace(" ", "T").replace(/\.(\d{3})\d+/, ".$1")
  if (!/([zZ]|[+-]\d{2}:\d{2})$/.test(raw)) {
    const fourDigit = /[+-]\d{4}$/.test(raw)
    const twoDigit = /[+-]\d{2}$/.test(raw)
    if (fourDigit) raw = `${raw.slice(0, -2)}:${raw.slice(-2)}`
    else if (twoDigit) raw = `${raw}:00`
    else raw = `${raw}+10:00`
  }

  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export function formatApsDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—"
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes} мин`
  if (minutes <= 0) return `${hours} ч`
  return `${hours} ч ${minutes} мин`
}

export type ApsPlanTiming = {
  startedAt: Date | null
  finishedAt: Date | null
  /** Сколько партия уже идёт (для незакрытых) или сколько шла (для закрытых). */
  durationMs: number | null
  running: boolean
  /** Темп выпуска, шт/ч. Считается только когда есть и факт, и длительность. */
  ratePerHour: number | null
}

export function resolveApsPlanTiming(plan: ProductionPlanRow, fact: ApsPlanFact, now = Date.now()): ApsPlanTiming {
  const startedAt = parseApsTs(plan.startedAt)
  const finishedAt = parseApsTs(plan.finishedAt)
  const running = plan.status === "in_progress" && finishedAt == null
  const endMs = finishedAt ? finishedAt.getTime() : running ? now : null
  const durationMs = startedAt && endMs != null && endMs > startedAt.getTime() ? endMs - startedAt.getTime() : null
  const hours = durationMs != null ? durationMs / 3_600_000 : null
  const ratePerHour =
    fact.factQty != null && hours != null && hours >= 0.05 ? Math.round(fact.factQty / hours) : null
  return { startedAt, finishedAt, durationMs, running, ratePerHour }
}

const FACTORY_TZ = "Asia/Vladivostok"

export function formatApsClock(date: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: FACTORY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

/** Итоги по выборке планов — для KPI и подвала списка. */
export function summarizeApsFacts(plans: ProductionPlanRow[]): {
  producedQty: number
  plannedQty: number
  running: number
  done: number
  awaitingFact: number
} {
  let producedQty = 0
  let plannedQty = 0
  let running = 0
  let done = 0
  let awaitingFact = 0

  for (const plan of plans) {
    if (plan.status === "cancelled") continue
    const fact = resolveApsPlanFact(plan)
    if (fact.factQty != null) producedQty += fact.factQty
    if (fact.planQty != null) plannedQty += fact.planQty
    if (plan.status === "in_progress") running += 1
    if (plan.status === "done") done += 1
    if (fact.state === "running" || fact.state === "unknown") awaitingFact += 1
  }

  return { producedQty, plannedQty, running, done, awaitingFact }
}

/** Строка для поиска: номенклатура, код плана, номер партии, артикул, цех, смена. */
export function apsPlanSearchHaystack(plan: ProductionPlanRow): string {
  return [
    plan.itemName,
    plan.itemNomenclature,
    plan.code,
    plan.itemCode,
    plan.itemSku,
    plan.externalId,
    plan.workshopCode,
    plan.lineCode,
    plan.packagingFormat,
    plan.note,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function apsPlanMatchesQuery(plan: ProductionPlanRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = apsPlanSearchHaystack(plan)
  // Все слова запроса должны найтись — так «монастыр 0,5» отбирает точнее.
  return q.split(/\s+/).every((term) => haystack.includes(term))
}
