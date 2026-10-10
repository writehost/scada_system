// Проверка правил мониторинга, потери связи и напоминаний. Запускается фоновым
// обработчиком по каждой организации в её собственном контексте RLS.

import type { Db } from "../server/db.ts"
import { addDays, addMonths, dayStartUtc, diffDays, floorHour, HOUR_MS, localDateKey, localParts, monthStartKey } from "../domain/time.ts"
import { continuousFlow, growth, nightUsage } from "../domain/anomalies.ts"
import { reminderDue } from "../domain/obligations.ts"
import { resolveStatus } from "../domain/plans.ts"
import { RESOURCE_LABELS, unitLabel, type Resource } from "../domain/units.ts"
import { billingChannels, dailySum, hourlySum, powerChannels } from "./analytics.ts"
import { monthCosts } from "./billing.ts"
import { raiseEvent, resolveEvent } from "./events.ts"
import { obligationAmount } from "./finance.ts"
import { enqueueNotification } from "./notify.ts"

const fmt = (v: number, digits = 2) => v.toLocaleString("ru-RU", { maximumFractionDigits: digits })
const rub = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₽`
const HEAVY = new Set(["night_usage", "consumption_growth", "budget_over", "monthly_limit", "continuous_flow", "flow_over"])

export type MonitorStats = { rules: number; raised: number; resolved: number }

/** Потеря связи с автоматическими приборами и шлюзами. */
export async function checkTelemetry(c: Db, orgId: string, stats: MonitorStats): Promise<void> {
  const meters = await c.query(
    `SELECT m.meter_id, m.name, m.site_id, m.telemetry_timeout_min, max(ch.last_at) AS last_at, m.installed_at,
            (SELECT (r.params->>'minutes')::int FROM ems_alert_rules r WHERE r.org_id = m.org_id AND r.kind = 'telemetry_lost' AND r.enabled
               AND (r.meter_id = m.meter_id OR (r.meter_id IS NULL AND r.site_id = m.site_id)) ORDER BY r.meter_id NULLS LAST LIMIT 1) AS rule_minutes
       FROM ems_meters m LEFT JOIN ems_channels ch ON ch.meter_id = m.meter_id AND ch.archived_at IS NULL
      WHERE m.org_id = $1 AND m.status = 'active' AND m.connection <> 'manual'
      GROUP BY m.meter_id`,
    [orgId],
  )
  const now = Date.now()
  for (const m of meters.rows) {
    const minutes = m.rule_minutes ?? m.telemetry_timeout_min
    const ref = m.last_at ? new Date(m.last_at).getTime() : new Date(m.installed_at).getTime()
    const key = `telemetry:${m.meter_id}`
    if (now - ref > minutes * 60_000) {
      const hours = (now - ref) / HOUR_MS
      const r = await raiseEvent(c, {
        orgId, kind: "telemetry_lost", category: "telemetry_lost", severity: "warning",
        title: `Нет данных: ${m.name}`,
        message: m.last_at ? `Отсутствуют данные с прибора «${m.name}» более ${hours >= 2 ? `${Math.floor(hours)} ч` : `${Math.round(hours * 60)} мин`}. Проверьте питание и связь.` : `Прибор «${m.name}» ещё не передал ни одного показания.`,
        dedupKey: key, siteId: m.site_id, meterId: m.meter_id, details: { lastAt: m.last_at, thresholdMin: minutes },
      })
      if (r.created) stats.raised += 1
    } else if (await resolveEvent(c, orgId, key, "данные снова поступают")) stats.resolved += 1
  }
  const gws = await c.query(
    `UPDATE ems_gateways SET status = 'offline' WHERE org_id = $1 AND status = 'online' AND archived_at IS NULL AND last_seen_at < now() - interval '10 minutes'
     RETURNING gateway_id, name, site_id, last_seen_at`,
    [orgId],
  )
  for (const g of gws.rows) {
    await raiseEvent(c, {
      orgId, kind: "gateway_offline", category: "equipment", severity: "critical",
      title: `Шлюз не на связи: ${g.name}`,
      message: `Шлюз «${g.name}» не выходит на связь с ${new Date(g.last_seen_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" })} (МСК). Данные сохраняются в его локальном буфере и будут переданы после восстановления связи.`,
      dedupKey: `gateway:${g.gateway_id}:offline`, siteId: g.site_id, gatewayId: g.gateway_id,
    })
    stats.raised += 1
  }
}

type Rule = { rule_id: string; site_id: string; meter_id: string | null; channel_id: number | null; kind: string; name: string; params: Record<string, any>; severity: "info" | "warning" | "critical"; notify: boolean; repeat_minutes: number | null; window_from: number | null; window_to: number | null; last_evaluated_at: Date | null; timezone: string }

function inWindow(rule: Rule, hour: number): boolean {
  if (rule.window_from == null || rule.window_to == null) return true
  return rule.window_from <= rule.window_to ? hour >= rule.window_from && hour < rule.window_to : hour >= rule.window_from || hour < rule.window_to
}

async function resourceChannels(c: Db, orgId: string, rule: Rule, resource: Resource): Promise<number[]> {
  if (rule.channel_id) return [rule.channel_id]
  if (rule.meter_id) {
    const r = await c.query("SELECT channel_id FROM ems_channels WHERE meter_id = $1 AND is_billing AND measure_kind = 'cumulative' AND archived_at IS NULL", [rule.meter_id])
    return r.rows.map((x) => x.channel_id)
  }
  return (await billingChannels(c, orgId, rule.site_id, resource)).map((x) => x.channel_id)
}

export async function evaluateRules(c: Db, orgId: string, stats: MonitorStats, now = Date.now()): Promise<void> {
  const rules = await c.query<Rule>(
    `SELECT r.*, s.timezone FROM ems_alert_rules r JOIN ems_sites s ON s.site_id = r.site_id WHERE r.org_id = $1 AND r.enabled AND r.kind <> 'telemetry_lost' AND s.archived_at IS NULL`,
    [orgId],
  )
  for (const rule of rules.rows) {
    if (HEAVY.has(rule.kind) && rule.last_evaluated_at && now - new Date(rule.last_evaluated_at).getTime() < 55 * 60_000) continue
    const tz = rule.timezone
    const hour = localParts(now, tz).hour
    if (!inWindow(rule, hour)) continue
    stats.rules += 1
    const key = `rule:${rule.rule_id}`
    const p = rule.params
    let hit: { title: string; message: string; details: Record<string, unknown>; category: "anomaly" | "leak" | "limit" } | null = null
    const today = localDateKey(now, tz)
    const month = monthStartKey(today)

    switch (rule.kind) {
      case "power_over": {
        const ids = rule.channel_id ? [rule.channel_id] : await powerChannels(c, orgId, rule.site_id)
        if (!ids.length) break
        const r = await c.query(
          `SELECT channel_id, avg(value) AS avg, count(*)::int AS n FROM ems_readings WHERE channel_id = ANY($1::bigint[]) AND quality <> 'bad' AND measured_at > now() - make_interval(mins => $2) GROUP BY channel_id`,
          [ids, p.minutes],
        )
        if (!r.rows.length) break
        const sum = r.rows.reduce((s, x) => s + Number(x.avg), 0)
        if (sum > p.limitKw) hit = { category: "limit", title: `Превышение мощности: ${fmt(sum, 1)} кВт`, message: `Средняя мощность за ${p.minutes} мин — ${fmt(sum, 1)} кВт при пределе ${fmt(p.limitKw, 1)} кВт.`, details: { avgKw: sum, limitKw: p.limitKw, channels: r.rows.length } }
        break
      }
      case "flow_over": {
        const ids = await resourceChannels(c, orgId, rule, p.resource)
        const h = floorHour(now) - HOUR_MS
        const v = (await hourlySum(c, ids, h, h + HOUR_MS)).get(h)
        if (v && v.allocated === 0 && v.qty > p.limitPerHour) hit = { category: "limit", title: `Превышение расхода: ${RESOURCE_LABELS[p.resource as Resource]}`, message: `За последний час израсходовано ${fmt(v.qty, 3)} м³ при пределе ${fmt(p.limitPerHour, 3)} м³/ч.`, details: { qty: v.qty, limit: p.limitPerHour } }
        break
      }
      case "continuous_flow": {
        const ids = await resourceChannels(c, orgId, rule, p.resource)
        const to = floorHour(now)
        const sums = await hourlySum(c, ids, to - 48 * HOUR_MS, to)
        const hours = [...sums.entries()].map(([ts, v]) => ({ ts, qty: v.qty, allocated: v.allocated, localHour: localParts(ts, tz).hour }))
        const last = hours.length ? Math.max(...hours.map((x) => x.ts)) : 0
        if (to - last > 2 * HOUR_MS) break // нет свежих почасовых данных — вывод не делаем
        const res = continuousFlow(hours, p.minPerHour, p.hours)
        if (res.triggered) hit = { category: "leak", title: `Подозрение на утечку: ${RESOURCE_LABELS[p.resource as Resource].toLowerCase()}`, message: `Обнаружен непрерывный расход воды в течение ${res.hours} ч (не меньше ${fmt((res.minObserved ?? 0) * 1000, 0)} л/ч). Проверьте оборудование.`, details: { hours: res.hours, minPerHour: res.minObserved } }
        break
      }
      case "night_usage": {
        const ids = await resourceChannels(c, orgId, rule, p.resource)
        const sums = await hourlySum(c, ids, dayStartUtc(addDays(today, -16), tz), floorHour(now))
        const nights = new Map<string, number[]>()
        for (const [ts, v] of sums) {
          if (v.allocated > 0) continue
          const lp = localParts(ts, tz)
          const inNight = p.fromHour <= p.toHour ? lp.hour >= p.fromHour && lp.hour < p.toHour : lp.hour >= p.fromHour || lp.hour < p.toHour
          if (!inNight) continue
          const day = localDateKey(ts, tz)
          nights.set(day, [...(nights.get(day) ?? []), v.qty])
        }
        const list = [...nights.entries()].filter(([, v]) => v.length >= 2).map(([day, v]) => ({ day, avgPerHour: v.reduce((s, x) => s + x, 0) / v.length }))
        const res = nightUsage(list, { thresholdPct: p.thresholdPct, minAbsPerHour: p.minAbsPerHour })
        if (res.triggered) {
          const unit = unitLabel(p.resource === "electricity" ? "kWh" : "m3")
          hit = { category: "anomaly", title: `Высокое ночное потребление: ${RESOURCE_LABELS[p.resource as Resource].toLowerCase()}`, message: `Ночью расход составил ${fmt(res.last!, 3)} ${unit}/ч — на ${Math.round(res.increasePct ?? 0)}% выше обычного (${fmt(res.baseline!, 3)} ${unit}/ч). Проверьте постоянно работающие устройства.`, details: res }
        }
        break
      }
      case "consumption_growth": {
        const ids = await resourceChannels(c, orgId, rule, p.resource)
        const cur = await dailySum(c, ids, month, addDays(today, -1))
        const prevStart = addMonths(month, -1, 1)
        const prev = await dailySum(c, ids, prevStart, addDays(prevStart, Math.max(0, diffDays(month, today) - 1)))
        if (cur.size < p.minDays || prev.size < p.minDays) break
        const avg = (m: Map<string, { qty: number }>) => [...m.values()].reduce((s, x) => s + x.qty, 0) / m.size
        const res = growth(avg(cur), avg(prev), p.thresholdPct)
        if (res.triggered) hit = { category: "anomaly", title: `Рост расхода: ${RESOURCE_LABELS[p.resource as Resource].toLowerCase()}`, message: `Расход ${RESOURCE_LABELS[p.resource as Resource].toLowerCase()} увеличился на ${Math.round(res.pct!)}% относительно сопоставимого периода прошлого месяца.`, details: { pct: res.pct, currentAvg: avg(cur), previousAvg: avg(prev) } }
        break
      }
      case "budget_over": {
        const costs = await monthCosts(c, orgId, rule.site_id, tz, month, today)
        if (costs.totals.forecast != null && costs.totals.forecast > p.budget) hit = { category: "limit", title: "Прогноз превышает бюджет", message: `Прогноз коммунальных расходов за месяц — ${rub(costs.totals.forecast)} при бюджете ${rub(p.budget)}.`, details: { forecast: costs.totals.forecast, budget: p.budget } }
        break
      }
      case "monthly_limit": {
        const ids = await resourceChannels(c, orgId, rule, p.resource)
        const qty = [...(await dailySum(c, ids, month, today)).values()].reduce((s, x) => s + x.qty, 0)
        const unit = unitLabel(p.resource === "electricity" ? "kWh" : "m3")
        if (qty > p.limit) hit = { category: "limit", title: `Превышен месячный лимит: ${RESOURCE_LABELS[p.resource as Resource].toLowerCase()}`, message: `С начала месяца израсходовано ${fmt(qty)} ${unit} при лимите ${fmt(p.limit)} ${unit}.`, details: { qty, limit: p.limit } }
        break
      }
    }
    await c.query("UPDATE ems_alert_rules SET last_evaluated_at = now() WHERE rule_id = $1", [rule.rule_id])
    if (hit) {
      const r = await raiseEvent(c, { orgId, kind: rule.kind, category: hit.category, severity: rule.severity, title: hit.title, message: hit.message, dedupKey: key, siteId: rule.site_id, meterId: rule.meter_id, channelId: rule.channel_id, ruleId: rule.rule_id, details: hit.details, notify: rule.notify, repeatMinutes: rule.repeat_minutes })
      if (r.created) stats.raised += 1
    } else if (await resolveEvent(c, orgId, key)) stats.resolved += 1
  }
}

const SERVICE_GENITIVE: Record<string, string> = { electricity: "электричество", cold_water: "холодную воду", hot_water: "горячую воду", wastewater: "водоотведение", heating: "отопление", gas: "газ", internet: "интернет", other: "услугу" }

/** Напоминания об оплате и передаче показаний. Каждое — один раз на срок. */
export async function sendReminders(c: Db, orgId: string, now = Date.now()): Promise<number> {
  const tz = (await c.query("SELECT timezone FROM ems_organizations WHERE org_id = $1", [orgId])).rows[0]?.timezone ?? "Europe/Moscow"
  const today = localDateKey(now, tz)
  const list = await c.query(
    `SELECT o.*, COALESCE(s.timezone, $2) AS tz FROM ems_obligations o LEFT JOIN ems_sites s ON s.site_id = o.site_id
      WHERE o.org_id = $1 AND o.status = 'pending' AND o.due_date <= $3::date + 60`,
    [orgId, tz, today],
  )
  let sent = 0
  const once = async (o: Record<string, any>, kind: "payment_due" | "payment_overdue" | "readings_due", due: string) => {
    const r = await c.query("INSERT INTO ems_reminders_sent (obligation_id, org_id, kind, due_date) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING obligation_id", [o.obligation_id, orgId, kind, due])
    return (r.rowCount ?? 0) > 0
  }
  for (const o of list.rows) {
    const localToday = localDateKey(now, o.tz)
    const recipients = o.recipient_ids?.length ? o.recipient_ids : undefined
    const what = SERVICE_GENITIVE[o.service] ?? o.title.toLowerCase()
    if (o.readings_due_date && reminderDue(o.readings_due_date, o.readings_remind_days, localToday) && (await once(o, "readings_due", o.readings_due_date))) {
      const days = diffDays(localToday, o.readings_due_date)
      await enqueueNotification(c, {
        orgId, kind: "readings_due", siteId: o.site_id,
        subject: days === 0 ? `Сегодня последний день передачи показаний: ${o.title}` : `Через ${days} дн. нужно передать показания: ${o.title}`,
        lead: `Передайте показания поставщику${o.provider_name ? ` «${o.provider_name}»` : ""} до ${fmtDate(o.readings_due_date)}. Внести их в SCADA EMS можно в разделе «Показания».`,
        facts: [["Услуга", o.title], ["Срок", fmtDate(o.readings_due_date)], ...(o.account_number ? [["Лицевой счёт", o.account_number] as [string, string]] : [])],
        reason: "напоминание о передаче показаний", refType: "obligation", refId: o.obligation_id, link: "/readings", dedupKey: `readings_due:${o.obligation_id}:${o.readings_due_date}`,
        recipientIds: recipients, sendHourTz: o.tz,
      })
      sent += 1
    }
    if (reminderDue(o.due_date, o.remind_days, localToday) && (await once(o, "payment_due", o.due_date))) {
      const amount = await obligationAmount(c, orgId, o, now)
      const days = diffDays(localToday, o.due_date)
      const amountText = amount.amount != null ? ` ${amount.basis === "forecast" ? "Ожидаемая сумма" : "Сумма"} — ${rub(amount.amount)}.` : ""
      await enqueueNotification(c, {
        orgId, kind: "payment_due", siteId: o.site_id,
        subject: days === 0 ? `Сегодня срок оплаты: ${o.title}` : `Через ${days} дн. оплата: ${o.title}`,
        lead: `${days === 0 ? "Сегодня" : `Через ${days} ${days === 1 ? "день" : days < 5 ? "дня" : "дней"}`} необходимо оплатить ${what}.${amountText}`,
        facts: [["Срок оплаты", fmtDate(o.due_date)], ...(amount.amount != null ? [["Сумма", `${rub(amount.amount)} (${BASIS[amount.basis ?? "manual"]})`] as [string, string]] : []), ...(o.provider_name ? [["Поставщик", o.provider_name] as [string, string]] : [])],
        reason: "напоминание о сроке оплаты", refType: "obligation", refId: o.obligation_id, link: "/finance/payments", dedupKey: `payment_due:${o.obligation_id}:${o.due_date}`,
        recipientIds: recipients, sendHourTz: o.tz,
      })
      sent += 1
    }
    if (localToday > o.due_date && (await once(o, "payment_overdue", o.due_date))) {
      await enqueueNotification(c, {
        orgId, kind: "payment_due", siteId: o.site_id, severity: "warning",
        subject: `Просрочена оплата: ${o.title}`,
        lead: `Срок оплаты «${o.title}» был ${fmtDate(o.due_date)}. Если вы уже оплатили — отметьте оплату в SCADA EMS, и напоминания прекратятся.`,
        reason: "просроченный платёж", refType: "obligation", refId: o.obligation_id, link: "/finance/payments", dedupKey: `payment_overdue:${o.obligation_id}:${o.due_date}`,
        recipientIds: recipients, sendHourTz: o.tz,
      })
      sent += 1
    }
  }
  return sent
}

const BASIS: Record<string, string> = { fixed: "фиксированная", manual: "введена вручную", actual: "по квитанции", calculated: "расчёт по показаниям", forecast: "прогноз" }

function fmtDate(key: string): string {
  const [y, m, d] = key.split("-")
  return `${d}.${m}.${y}`
}

/** Статусы подписок: окончание пробного периода фиксируется в истории. Данные не удаляются. */
export async function refreshSubscription(c: Db, orgId: string): Promise<void> {
  const s = (await c.query("SELECT plan_code, status, trial_ends_at, current_period_end FROM ems_subscriptions WHERE org_id = $1", [orgId])).rows[0]
  if (!s) return
  const eff = resolveStatus(s)
  if (eff !== s.status) {
    await c.query("UPDATE ems_subscriptions SET status = $2, updated_at = now() WHERE org_id = $1", [orgId, eff])
    await c.query("INSERT INTO ems_subscription_history (org_id, from_plan, to_plan, from_status, to_status, reason) VALUES ($1, $2, $2, $3, $4, 'автоматически по дате')", [orgId, s.plan_code, s.status, eff])
    await raiseEvent(c, {
      orgId, kind: "subscription_status", category: "billing", severity: eff === "expired" ? "warning" : "info",
      title: eff === "expired" ? "Подписка SCADA EMS истекла" : "Подписка SCADA EMS ожидает оплаты",
      message: eff === "expired" ? "История измерений сохранена и доступна для просмотра. Изменения и приём новых данных приостановлены до продления." : "Оплаченный период закончился. Данные продолжают приниматься в течение льготного периода.",
      dedupKey: `subscription:${eff}:${new Date().toISOString().slice(0, 10)}`,
    })
  }
}
