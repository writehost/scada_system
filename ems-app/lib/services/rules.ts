// Правила мониторинга: проверка параметров при сохранении.
import type { Db } from "../server/db.ts"
import { badRequest, notFound } from "../server/errors.ts"
import { assertWritable } from "./subscription.ts"
import { audit, type Actor } from "./audit.ts"

export const RULE_KINDS = ["telemetry_lost", "power_over", "flow_over", "continuous_flow", "night_usage", "consumption_growth", "budget_over", "monthly_limit"] as const
export type RuleKind = (typeof RULE_KINDS)[number]

export const RULE_LABELS: Record<RuleKind, string> = {
  telemetry_lost: "Потеря связи / нет телеметрии",
  power_over: "Превышение мощности",
  flow_over: "Превышение расхода воды",
  continuous_flow: "Непрерывный расход (подозрение на утечку)",
  night_usage: "Аномально высокое ночное потребление",
  consumption_growth: "Рост потребления к сопоставимому периоду",
  budget_over: "Прогноз превышает бюджет",
  monthly_limit: "Превышение месячного лимита",
}

const RES = ["electricity", "cold_water", "hot_water", "gas", "heat"]

function n(o: Record<string, unknown>, k: string, label: string, min: number, max: number, fallback?: number): number {
  const v = o[k] ?? fallback
  const x = Number(v)
  if (!Number.isFinite(x) || x < min || x > max) throw badRequest(`${label}: число от ${min} до ${max}`)
  return x
}

function resource(o: Record<string, unknown>, allowed = RES): string {
  const r = String(o.resource ?? "")
  if (!allowed.includes(r)) throw badRequest("Выберите ресурс")
  return r
}

export function validateParams(kind: RuleKind, raw: unknown): Record<string, unknown> {
  const o = (raw ?? {}) as Record<string, unknown>
  switch (kind) {
    case "telemetry_lost":
      return { minutes: n(o, "minutes", "Время без данных, мин", 15, 60 * 24 * 7, 120) }
    case "power_over":
      return { limitKw: n(o, "limitKw", "Предел мощности, кВт", 0.1, 1e6), minutes: n(o, "minutes", "Длительность, мин", 1, 240, 5) }
    case "flow_over":
      return { resource: resource(o, ["cold_water", "hot_water"]), limitPerHour: n(o, "limitPerHour", "Предел, м³/ч", 0.001, 1e5) }
    case "continuous_flow":
      return { resource: resource(o, ["cold_water", "hot_water"]), minPerHour: n(o, "minPerHour", "Порог, м³/ч", 0.0005, 100, 0.005), hours: n(o, "hours", "Часов подряд", 2, 48, 6) }
    case "night_usage":
      return { resource: resource(o), thresholdPct: n(o, "thresholdPct", "Рост, %", 5, 1000, 50), minAbsPerHour: n(o, "minAbsPerHour", "Минимум в час", 0, 1e6, 0.1), fromHour: n(o, "fromHour", "Ночь с", 0, 23, 0), toHour: n(o, "toHour", "Ночь до", 1, 24, 5) }
    case "consumption_growth":
      return { resource: resource(o), thresholdPct: n(o, "thresholdPct", "Рост, %", 5, 1000, 35), minDays: n(o, "minDays", "Минимум дней данных", 3, 31, 5) }
    case "budget_over":
      return { budget: n(o, "budget", "Бюджет в месяц, ₽", 1, 1e10) }
    case "monthly_limit":
      return { resource: resource(o), limit: n(o, "limit", "Лимит в месяц", 0.001, 1e10) }
  }
}

export async function createRule(
  c: Db,
  orgId: string,
  actor: Actor,
  input: { kind: RuleKind; name?: string | null; siteId?: string | null; meterId?: string | null; channelId?: number | null; params: unknown; severity?: string; notify?: boolean; repeatMinutes?: number | null; windowFrom?: number | null; windowTo?: number | null },
): Promise<string> {
  await assertWritable(c, orgId)
  if (!RULE_KINDS.includes(input.kind)) throw badRequest("Неизвестный вид правила")
  if (input.siteId) {
    const s = await c.query("SELECT 1 FROM ems_sites WHERE site_id = $1 AND org_id = $2", [input.siteId, orgId])
    if (!s.rows[0]) throw notFound("Объект")
  }
  if (input.meterId) {
    const m = await c.query("SELECT site_id FROM ems_meters WHERE meter_id = $1 AND org_id = $2", [input.meterId, orgId])
    if (!m.rows[0]) throw notFound("Прибор")
    input.siteId = input.siteId ?? m.rows[0].site_id
  }
  if (input.channelId != null) {
    const ch = await c.query("SELECT m.site_id, ch.meter_id FROM ems_channels ch JOIN ems_meters m ON m.meter_id = ch.meter_id WHERE ch.channel_id = $1 AND ch.org_id = $2", [input.channelId, orgId])
    if (!ch.rows[0]) throw notFound("Канал")
    input.siteId = input.siteId ?? ch.rows[0].site_id
    input.meterId = input.meterId ?? ch.rows[0].meter_id
  }
  if (!input.siteId) throw badRequest("Выберите объект")
  const severity = ["info", "warning", "critical"].includes(String(input.severity)) ? String(input.severity) : input.kind === "continuous_flow" ? "critical" : "warning"
  const params = validateParams(input.kind, input.params)
  const r = await c.query<{ rule_id: string }>(
    `INSERT INTO ems_alert_rules (org_id, site_id, meter_id, channel_id, kind, name, params, severity, notify, repeat_minutes, window_from, window_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13) RETURNING rule_id`,
    [orgId, input.siteId, input.meterId ?? null, input.channelId ?? null, input.kind, input.name || RULE_LABELS[input.kind], JSON.stringify(params), severity, input.notify !== false, input.repeatMinutes ?? null, input.windowFrom ?? null, input.windowTo ?? null, actor.id],
  )
  await audit(c, orgId, actor, "rule.create", { type: "rule", id: r.rows[0].rule_id }, { kind: input.kind })
  return r.rows[0].rule_id
}
