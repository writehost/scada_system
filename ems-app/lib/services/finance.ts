// Лицевые счета, тарифы, начисления и календарь платежей.
// Отметка «оплачено» ставится только пользователем; подписка SCADA EMS сюда не относится.

import type { Db } from "../server/db.ts"
import { badRequest, conflict, notFound } from "../server/errors.ts"
import { parseTariffConfig, SERVICES, type Service, TariffValidationError } from "../domain/tariffs.ts"
import { nextDueDate, obligationStatus, parseRecurrence, shiftWithDue, type Recurrence } from "../domain/obligations.ts"
import { addDays, addMonths, localDateKey, monthStartKey } from "../domain/time.ts"
import { assertWritable } from "./subscription.ts"
import { audit, type Actor } from "./audit.ts"
import { monthCosts } from "./billing.ts"
import { requireSite } from "./assets.ts"

export async function findOrCreateProvider(c: Db, orgId: string, name: string | null): Promise<string | null> {
  if (!name) return null
  const f = await c.query("SELECT provider_id FROM ems_providers WHERE org_id = $1 AND lower(name) = lower($2)", [orgId, name])
  if (f.rows[0]) return f.rows[0].provider_id
  const r = await c.query("INSERT INTO ems_providers (org_id, name) VALUES ($1, $2) RETURNING provider_id", [orgId, name])
  return r.rows[0].provider_id
}

export async function createAccount(
  c: Db,
  orgId: string,
  actor: Actor,
  input: { siteId: string; service: Service; title?: string | null; providerName?: string | null; accountNumber?: string | null; calcMethod: "meter" | "fixed" | "manual"; budgetMonth?: number | null },
): Promise<string> {
  await assertWritable(c, orgId)
  await requireSite(c, orgId, input.siteId)
  if (!SERVICES.includes(input.service)) throw badRequest("Неизвестная услуга")
  if (input.calcMethod === "meter" && (input.service === "internet" || input.service === "other")) throw badRequest("Для этой услуги нет приборов учёта: выберите фиксированную сумму или ручной ввод")
  const providerId = await findOrCreateProvider(c, orgId, input.providerName ?? null)
  const titles: Record<Service, string> = { electricity: "Электроэнергия", cold_water: "Холодная вода", hot_water: "Горячая вода", wastewater: "Водоотведение", heating: "Отопление", gas: "Газ", internet: "Интернет", other: "Услуга" }
  const r = await c.query(
    `INSERT INTO ems_accounts (org_id, site_id, service, title, provider_id, account_number, calc_method, budget_month) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING account_id`,
    [orgId, input.siteId, input.service, input.title || titles[input.service], providerId, input.accountNumber ?? null, input.calcMethod, input.budgetMonth ?? null],
  )
  await audit(c, orgId, actor, "account.create", { type: "account", id: r.rows[0].account_id }, { service: input.service })
  return r.rows[0].account_id
}

export async function createTariff(
  c: Db,
  orgId: string,
  actor: Actor,
  input: { accountId: string; name: string; kind: string; validFrom: string; validTo?: string | null; config: unknown; sourceNote?: string | null },
): Promise<string> {
  await assertWritable(c, orgId)
  const acc = await c.query("SELECT service FROM ems_accounts WHERE account_id = $1 AND org_id = $2", [input.accountId, orgId])
  if (!acc.rows[0]) throw notFound("Лицевой счёт")
  const service = acc.rows[0].service as Service
  let config
  try {
    config = parseTariffConfig(input.kind, input.config)
  } catch (e) {
    if (e instanceof TariffValidationError) throw badRequest(e.message)
    throw e
  }
  const allowed: Record<string, Service[]> = {
    zones: ["electricity"],
    hot_water: ["hot_water"],
    wastewater: ["wastewater"],
    single: ["electricity", "cold_water", "hot_water", "gas", "heating", "wastewater"],
    fixed: SERVICES,
  }
  if (!allowed[input.kind]?.includes(service)) throw badRequest("Этот вид тарифа не подходит для услуги")
  if (input.validTo && input.validTo < input.validFrom) throw badRequest("Дата окончания раньше даты начала")
  // Действующий бессрочный тариф закрывается накануне начала нового.
  const overlap = await c.query(
    `SELECT tariff_id, valid_from, valid_to FROM ems_tariffs WHERE account_id = $1
      AND valid_from <= COALESCE($3::date, 'infinity'::date) AND COALESCE(valid_to, 'infinity'::date) >= $2::date`,
    [input.accountId, input.validFrom, input.validTo ?? null],
  )
  for (const t of overlap.rows) {
    if (t.valid_to == null && t.valid_from < input.validFrom) {
      await c.query("UPDATE ems_tariffs SET valid_to = $2 WHERE tariff_id = $1", [t.tariff_id, addDays(input.validFrom, -1)])
    } else {
      throw conflict(`Период пересекается с тарифом, действующим с ${t.valid_from}${t.valid_to ? ` по ${t.valid_to}` : ""}. Измените даты или удалите старый тариф.`, "tariff_overlap")
    }
  }
  const r = await c.query(
    `INSERT INTO ems_tariffs (org_id, account_id, name, kind, valid_from, valid_to, config, source_note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9) RETURNING tariff_id`,
    [orgId, input.accountId, input.name, input.kind, input.validFrom, input.validTo ?? null, JSON.stringify(config), input.sourceNote ?? null, actor.id],
  )
  await audit(c, orgId, actor, "tariff.create", { type: "tariff", id: r.rows[0].tariff_id }, { accountId: input.accountId, kind: input.kind, validFrom: input.validFrom })
  return r.rows[0].tariff_id
}

export async function upsertActualCharge(c: Db, orgId: string, actor: Actor, input: { accountId: string; period: string; amount: number; quantity?: number | null; note?: string | null }): Promise<void> {
  await assertWritable(c, orgId)
  const acc = await c.query("SELECT 1 FROM ems_accounts WHERE account_id = $1 AND org_id = $2", [input.accountId, orgId])
  if (!acc.rows[0]) throw notFound("Лицевой счёт")
  if (!(input.amount >= 0)) throw badRequest("Сумма начисления не может быть отрицательной")
  await c.query(
    `INSERT INTO ems_charges (org_id, account_id, period, amount, source, quantity, note, created_by) VALUES ($1, $2, $3, $4, 'actual', $5, $6, $7)
     ON CONFLICT (account_id, period, source) DO UPDATE SET amount = EXCLUDED.amount, quantity = EXCLUDED.quantity, note = EXCLUDED.note, created_by = EXCLUDED.created_by, created_at = now()`,
    [orgId, input.accountId, monthStartKey(input.period), input.amount, input.quantity ?? null, input.note ?? null, actor.id],
  )
  await audit(c, orgId, actor, "charge.actual", { type: "account", id: input.accountId }, { period: input.period, amount: input.amount })
}

export type ObligationInput = {
  siteId?: string | null
  accountId?: string | null
  title: string
  service: string
  providerName?: string | null
  accountNumber?: string | null
  amountMode: "fixed" | "calculated" | "manual"
  amount?: number | null
  dueDate: string
  readingsDueDate?: string | null
  recurrence?: unknown
  remindDays?: number
  readingsRemindDays?: number
  recipientIds?: string[]
  note?: string | null
}

async function validateRecipients(c: Db, orgId: string, ids: string[] | undefined): Promise<string[]> {
  if (!ids?.length) return []
  const r = await c.query("SELECT recipient_id, verified_at FROM ems_email_recipients WHERE org_id = $1 AND recipient_id = ANY($2::uuid[])", [orgId, ids])
  if (r.rows.length !== new Set(ids).size) throw badRequest("Получатель уведомлений не найден")
  return [...new Set(ids)]
}

function recurrenceOrThrow(raw: unknown): Recurrence {
  try {
    return parseRecurrence(raw)
  } catch (e) {
    throw badRequest((e as Error).message)
  }
}

export async function createObligation(c: Db, orgId: string, actor: Actor, input: ObligationInput): Promise<string> {
  await assertWritable(c, orgId)
  if (input.siteId) await requireSite(c, orgId, input.siteId)
  if (input.accountId) {
    const a = await c.query("SELECT site_id FROM ems_accounts WHERE account_id = $1 AND org_id = $2", [input.accountId, orgId])
    if (!a.rows[0]) throw notFound("Лицевой счёт")
    input.siteId = input.siteId ?? a.rows[0].site_id
  }
  if (input.amountMode === "fixed" && !(input.amount != null && input.amount >= 0)) throw badRequest("Укажите сумму платежа")
  if (input.amountMode === "calculated" && !input.accountId) throw badRequest("Для расчёта суммы выберите лицевой счёт с тарифом")
  if (input.readingsDueDate && input.readingsDueDate > input.dueDate) throw badRequest("Срок передачи показаний должен быть не позже срока оплаты")
  const rec = recurrenceOrThrow(input.recurrence)
  const recipients = await validateRecipients(c, orgId, input.recipientIds)
  const r = await c.query(
    `INSERT INTO ems_obligations (org_id, site_id, account_id, title, service, provider_name, account_number, amount_mode, amount, due_date, readings_due_date,
                                  recurrence, remind_days, readings_remind_days, recipient_ids, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17) RETURNING obligation_id`,
    [
      orgId, input.siteId ?? null, input.accountId ?? null, input.title, input.service, input.providerName ?? null, input.accountNumber ?? null,
      input.amountMode, input.amountMode === "calculated" ? null : input.amount ?? null, input.dueDate, input.readingsDueDate ?? null,
      JSON.stringify(rec), input.remindDays ?? 3, input.readingsRemindDays ?? 2, recipients, input.note ?? null, actor.id,
    ],
  )
  await audit(c, orgId, actor, "obligation.create", { type: "obligation", id: r.rows[0].obligation_id }, { title: input.title, dueDate: input.dueDate })
  return r.rows[0].obligation_id
}

export async function updateObligation(c: Db, orgId: string, actor: Actor, id: string, patch: Partial<ObligationInput>): Promise<void> {
  await assertWritable(c, orgId)
  const cur = (await c.query("SELECT * FROM ems_obligations WHERE obligation_id = $1 AND org_id = $2", [id, orgId])).rows[0]
  if (!cur) throw notFound("Платёж")
  if (cur.status !== "pending") throw conflict("Изменять можно только неоплаченный платёж")
  const dueDate = patch.dueDate ?? cur.due_date
  let readingsDue = patch.readingsDueDate !== undefined ? patch.readingsDueDate : cur.readings_due_date
  if (patch.dueDate && patch.readingsDueDate === undefined) readingsDue = shiftWithDue(cur.due_date, patch.dueDate, cur.readings_due_date)
  if (readingsDue && readingsDue > dueDate) throw badRequest("Срок передачи показаний должен быть не позже срока оплаты")
  const recipients = patch.recipientIds ? await validateRecipients(c, orgId, patch.recipientIds) : cur.recipient_ids
  const amountMode = patch.amountMode ?? cur.amount_mode
  const amount = patch.amount !== undefined ? patch.amount : cur.amount
  if (amountMode === "fixed" && !(amount != null && amount >= 0)) throw badRequest("Укажите сумму платежа")
  await c.query(
    `UPDATE ems_obligations SET title = $3, provider_name = $4, account_number = $5, amount_mode = $6, amount = $7, due_date = $8, readings_due_date = $9,
            recurrence = $10::jsonb, remind_days = $11, readings_remind_days = $12, recipient_ids = $13, note = $14, updated_at = now()
      WHERE obligation_id = $1 AND org_id = $2`,
    [
      id, orgId, patch.title ?? cur.title, patch.providerName !== undefined ? patch.providerName : cur.provider_name,
      patch.accountNumber !== undefined ? patch.accountNumber : cur.account_number, amountMode, amountMode === "calculated" ? null : amount, dueDate, readingsDue,
      JSON.stringify(patch.recurrence !== undefined ? recurrenceOrThrow(patch.recurrence) : cur.recurrence), patch.remindDays ?? cur.remind_days,
      patch.readingsRemindDays ?? cur.readings_remind_days, recipients, patch.note !== undefined ? patch.note : cur.note,
    ],
  )
  await audit(c, orgId, actor, "obligation.update", { type: "obligation", id }, { dueDate })
}

/** Отметка оплаты пользователем + автоматическое создание следующего обязательства. */
export async function markPaid(c: Db, orgId: string, actor: Actor, id: string, input: { amount: number; paidOn: string; note?: string | null }): Promise<{ nextId: string | null }> {
  await assertWritable(c, orgId)
  const cur = (await c.query("SELECT * FROM ems_obligations WHERE obligation_id = $1 AND org_id = $2 FOR UPDATE", [id, orgId])).rows[0]
  if (!cur) throw notFound("Платёж")
  if (cur.status !== "pending") throw conflict("Платёж уже закрыт")
  if (!(input.amount >= 0)) throw badRequest("Сумма оплаты не может быть отрицательной")
  await c.query(`UPDATE ems_obligations SET status = 'paid', paid_at = now(), paid_amount = $3, paid_by = $4, updated_at = now() WHERE obligation_id = $1 AND org_id = $2`, [id, orgId, input.amount, actor.id])
  await c.query(`INSERT INTO ems_payments (org_id, obligation_id, amount, paid_on, method, confirmed_by, note) VALUES ($1, $2, $3, $4, 'manual', $5, $6)`, [orgId, id, input.amount, input.paidOn, actor.id, input.note ?? null])
  const nextId = await ensureNext(c, cur)
  await audit(c, orgId, actor, "obligation.paid", { type: "obligation", id }, { amount: input.amount, paidOn: input.paidOn, nextId })
  return { nextId }
}

/** Создаёт следующее обязательство серии (если повторяющееся и ещё не создано). */
export async function ensureNext(c: Db, cur: Record<string, any>): Promise<string | null> {
  const rec = parseRecurrence(cur.recurrence)
  const next = nextDueDate(cur.due_date, rec)
  if (!next) return null
  const readings = shiftWithDue(cur.due_date, next, cur.readings_due_date)
  const r = await c.query(
    `INSERT INTO ems_obligations (org_id, site_id, account_id, series_id, title, service, provider_name, account_number, amount_mode, amount, due_date,
                                  readings_due_date, recurrence, remind_days, readings_remind_days, recipient_ids, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18)
     ON CONFLICT (series_id, due_date) DO NOTHING RETURNING obligation_id`,
    [
      cur.org_id, cur.site_id, cur.account_id, cur.series_id, cur.title, cur.service, cur.provider_name, cur.account_number, cur.amount_mode,
      cur.amount_mode === "fixed" ? cur.amount : null, next, readings, JSON.stringify(rec), cur.remind_days, cur.readings_remind_days, cur.recipient_ids, cur.note, cur.created_by,
    ],
  )
  return r.rows[0]?.obligation_id ?? null
}

export async function undoPaid(c: Db, orgId: string, actor: Actor, id: string): Promise<void> {
  await assertWritable(c, orgId)
  const cur = (await c.query("SELECT * FROM ems_obligations WHERE obligation_id = $1 AND org_id = $2", [id, orgId])).rows[0]
  if (!cur || cur.status !== "paid") throw conflict("Платёж не отмечен как оплаченный")
  await c.query("UPDATE ems_obligations SET status = 'pending', paid_at = NULL, paid_amount = NULL, paid_by = NULL, updated_at = now() WHERE obligation_id = $1", [id])
  await c.query("DELETE FROM ems_payments WHERE obligation_id = $1", [id])
  await audit(c, orgId, actor, "obligation.unpaid", { type: "obligation", id })
}

/** Сумма для обязательства «по расчёту»: стоимость за месяц, предшествующий сроку оплаты. */
export async function obligationAmount(c: Db, orgId: string, o: { amount_mode: string; amount: number | null; account_id: string | null; due_date: string; site_id: string | null }, now = Date.now()): Promise<{ amount: number | null; basis: "fixed" | "manual" | "actual" | "calculated" | "forecast" | null; period: string | null }> {
  if (o.amount_mode !== "calculated") return { amount: o.amount, basis: o.amount_mode as "fixed" | "manual", period: null }
  if (!o.account_id || !o.site_id) return { amount: null, basis: null, period: null }
  const site = (await c.query("SELECT timezone FROM ems_sites WHERE site_id = $1", [o.site_id])).rows[0]
  if (!site) return { amount: null, basis: null, period: null }
  const period = addMonths(monthStartKey(o.due_date), -1, 1)
  const today = localDateKey(now, site.timezone)
  const costs = await monthCosts(c, orgId, o.site_id, site.timezone, period, today)
  const s = costs.services.find((x) => x.accountId === o.account_id)
  if (!s) return { amount: null, basis: null, period }
  if (s.charged) return { amount: s.charged.amount, basis: "actual", period }
  const complete = today > addDays(addMonths(period, 1, 1), -1)
  return complete ? { amount: s.actualToDate.amount, basis: "calculated", period } : { amount: s.forecast.amount, basis: "forecast", period }
}

export async function listObligations(c: Db, orgId: string, opts: { from?: string | null; to?: string | null; siteId?: string | null; status?: string | null }, today: string) {
  const r = await c.query(
    `SELECT o.*, s.name AS site_name FROM ems_obligations o LEFT JOIN ems_sites s ON s.site_id = o.site_id
      WHERE o.org_id = $1 AND ($2::date IS NULL OR o.due_date >= $2) AND ($3::date IS NULL OR o.due_date <= $3) AND ($4::uuid IS NULL OR o.site_id = $4)
        AND o.status <> 'cancelled'
      ORDER BY o.due_date, o.title LIMIT 500`,
    [orgId, opts.from ?? null, opts.to ?? null, opts.siteId ?? null],
  )
  const out = []
  for (const o of r.rows) {
    const status = obligationStatus(o, today)
    if (opts.status && opts.status !== status) continue
    const amount = o.status === "paid" ? { amount: o.paid_amount, basis: "paid" as const, period: null } : await obligationAmount(c, orgId, o)
    out.push({
      obligationId: o.obligation_id,
      seriesId: o.series_id,
      siteId: o.site_id,
      siteName: o.site_name,
      accountId: o.account_id,
      title: o.title,
      service: o.service,
      providerName: o.provider_name,
      accountNumber: o.account_number,
      amountMode: o.amount_mode,
      amount: amount.amount,
      amountBasis: amount.basis,
      amountPeriod: amount.period,
      fixedAmount: o.amount,
      dueDate: o.due_date,
      readingsDueDate: o.readings_due_date,
      recurrence: o.recurrence,
      remindDays: o.remind_days,
      readingsRemindDays: o.readings_remind_days,
      recipientIds: o.recipient_ids,
      note: o.note,
      status,
      paidAt: o.paid_at ? new Date(o.paid_at).toISOString() : null,
      paidAmount: o.paid_amount,
    })
  }
  return out
}
