// SCADA EMS Gateway: регистрация одноразовым кодом, секреты, конфигурация,
// задания удалённой диагностики. Шлюз всегда сам ходит в облако (только исходящие
// соединения), облако никогда не подключается к приборам на площадке.

import { createHash, randomInt } from "node:crypto"
import type { Db } from "../server/db.ts"
import { badRequest, conflict, HttpError, notFound } from "../server/errors.ts"
import { hashSecret, newSecret } from "../server/session.ts"
import { parseRegisterSpec } from "../domain/protocols.ts"
import { assertLimit, assertWritable } from "./subscription.ts"
import { audit, type Actor } from "./audit.ts"
import { raiseEvent, resolveEvent } from "./events.ts"

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const ENROLL_TTL_HOURS = 24

export function newEnrollmentCode(): string {
  const part = () => Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("")
  return `EMS-${part()}-${part()}-${part()}`
}

export function enrollmentHash(code: string): string {
  return createHash("sha256").update(`enroll:${code.trim().toUpperCase()}`).digest("hex")
}

export async function createGateway(c: Db, orgId: string, actor: Actor, input: { siteId: string; name: string }): Promise<{ gatewayId: string; code: string; expiresAt: string }> {
  await assertLimit(c, orgId, "gateways")
  const s = await c.query("SELECT 1 FROM ems_sites WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL", [input.siteId, orgId])
  if (!s.rows[0]) throw notFound("Объект")
  const r = await c.query<{ gateway_id: string }>("INSERT INTO ems_gateways (org_id, site_id, name) VALUES ($1, $2, $3) RETURNING gateway_id", [orgId, input.siteId, input.name])
  const gatewayId = r.rows[0].gateway_id
  const e = await issueEnrollment(c, orgId, actor, gatewayId)
  await audit(c, orgId, actor, "gateway.create", { type: "gateway", id: gatewayId }, { name: input.name })
  return { gatewayId, ...e }
}

/** Новый одноразовый код. Прежние неиспользованные коды шлюза аннулируются. */
export async function issueEnrollment(c: Db, orgId: string, actor: Actor, gatewayId: string): Promise<{ code: string; expiresAt: string }> {
  const g = await c.query("SELECT 1 FROM ems_gateways WHERE gateway_id = $1 AND org_id = $2 AND archived_at IS NULL", [gatewayId, orgId])
  if (!g.rows[0]) throw notFound("Шлюз")
  await c.query("DELETE FROM ems_gateway_enrollments WHERE gateway_id = $1 AND used_at IS NULL", [gatewayId])
  const code = newEnrollmentCode()
  const r = await c.query<{ expires_at: Date }>(
    `INSERT INTO ems_gateway_enrollments (code_hash, gateway_id, org_id, created_by, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5)) RETURNING expires_at`,
    [enrollmentHash(code), gatewayId, orgId, actor.id, ENROLL_TTL_HOURS],
  )
  await audit(c, orgId, actor, "gateway.enrollment_issued", { type: "gateway", id: gatewayId })
  return { code, expiresAt: r.rows[0].expires_at.toISOString() }
}

/**
 * Обмен кода на секрет шлюза. Код одноразовый: повторное использование
 * отклоняется и фиксируется событием безопасности. Выполняется в системной области.
 */
export type EnrollResult = { ok: true; gatewayId: string; orgId: string; secret: string } | { ok: false }

/**
 * Не бросает исключение при отказе: попытка повторного использования кода
 * должна сохраниться в журнале и событиях, а не откатиться вместе с транзакцией.
 */
export async function enrollGateway(c: Db, code: string, meta: { agentVersion?: string | null; ip: string }): Promise<EnrollResult> {
  const hash = enrollmentHash(code)
  const r = await c.query<{ gateway_id: string; org_id: string }>(
    `UPDATE ems_gateway_enrollments SET used_at = now() WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING gateway_id, org_id`,
    [hash],
  )
  if (!r.rows[0]) {
    const used = await c.query<{ gateway_id: string; org_id: string; used_at: Date | null }>("SELECT gateway_id, org_id, used_at FROM ems_gateway_enrollments WHERE code_hash = $1", [hash])
    if (used.rows[0]?.used_at) {
      await audit(c, used.rows[0].org_id, { kind: "system", id: null, ip: meta.ip }, "gateway.enrollment_reuse", { type: "gateway", id: used.rows[0].gateway_id })
      await raiseEvent(c, {
        orgId: used.rows[0].org_id,
        kind: "gateway_enrollment_reuse",
        category: "equipment",
        severity: "warning",
        title: "Повторная попытка регистрации шлюза",
        message: `Код регистрации уже был использован. Попытка с адреса ${meta.ip} отклонена. Если это не вы — выпустите новый код и смените секрет шлюза.`,
        dedupKey: `gateway:${used.rows[0].gateway_id}:enroll_reuse`,
        gatewayId: used.rows[0].gateway_id,
      })
    }
    return { ok: false }
  }
  const { gateway_id: gatewayId, org_id: orgId } = r.rows[0]
  const secret = newSecret("emsg", 32)
  await c.query(
    `UPDATE ems_gateways SET secret_hash = $2, secret_rotated_at = now(), enrolled_at = COALESCE(enrolled_at, now()), status = 'online', last_seen_at = now(), last_ip = $3, agent_version = $4 WHERE gateway_id = $1`,
    [gatewayId, hashSecret(secret), meta.ip, meta.agentVersion ?? null],
  )
  await audit(c, orgId, { kind: "gateway", id: gatewayId, ip: meta.ip }, "gateway.enrolled", { type: "gateway", id: gatewayId }, { agentVersion: meta.agentVersion ?? null })
  return { ok: true, gatewayId, orgId, secret }
}

export type GatewayAuth = { gatewayId: string; orgId: string; siteId: string; status: string }

/** Заголовок: Authorization: Gateway <gatewayId>:<secret>. Системная область. */
export async function authenticateGateway(c: Db, header: string | null, ip: string): Promise<GatewayAuth> {
  const m = /^Gateway\s+([0-9a-f-]{36}):(emsg_[A-Za-z0-9_-]+)$/i.exec(header?.trim() ?? "")
  if (!m) throw new HttpError(401, "gateway_auth_required", "Нужны учётные данные шлюза")
  const r = await c.query("SELECT gateway_id, org_id, site_id, status, secret_hash, archived_at FROM ems_gateways WHERE gateway_id = $1", [m[1]])
  const g = r.rows[0]
  if (!g || !g.secret_hash || g.archived_at || g.status === "disabled" || g.secret_hash !== hashSecret(m[2])) {
    throw new HttpError(401, "gateway_auth_failed", "Неверные учётные данные шлюза")
  }
  await c.query(
    "UPDATE ems_gateways SET last_seen_at = now(), last_ip = $2, status = 'online' WHERE gateway_id = $1 AND (status <> 'online' OR last_seen_at < now() - interval '30 seconds' OR last_ip IS DISTINCT FROM $2)",
    [g.gateway_id, ip],
  )
  if (g.status === "offline") await resolveEvent(c, g.org_id, `gateway:${g.gateway_id}:offline`, "шлюз снова на связи")
  return { gatewayId: g.gateway_id, orgId: g.org_id, siteId: g.site_id, status: g.status }
}

/** Ротация по инициативе шлюза: старый секрет перестаёт действовать сразу. */
export async function rotateGatewaySecret(c: Db, gw: GatewayAuth): Promise<string> {
  const secret = newSecret("emsg", 32)
  await c.query("UPDATE ems_gateways SET secret_hash = $2, secret_rotated_at = now() WHERE gateway_id = $1", [gw.gatewayId, hashSecret(secret)])
  await audit(c, gw.orgId, { kind: "gateway", id: gw.gatewayId }, "gateway.secret_rotated", { type: "gateway", id: gw.gatewayId })
  return secret
}

/** Отзыв секрета администратором (утечка, замена компьютера): шлюз отключается до новой регистрации. */
export async function revokeGatewaySecret(c: Db, orgId: string, actor: Actor, gatewayId: string): Promise<{ code: string; expiresAt: string }> {
  await assertWritable(c, orgId)
  const r = await c.query("UPDATE ems_gateways SET secret_hash = NULL, status = 'pending' WHERE gateway_id = $1 AND org_id = $2 RETURNING gateway_id", [gatewayId, orgId])
  if (!r.rows[0]) throw notFound("Шлюз")
  await audit(c, orgId, actor, "gateway.secret_revoked", { type: "gateway", id: gatewayId })
  return issueEnrollment(c, orgId, actor, gatewayId)
}

export async function gatewayConfig(c: Db, gw: GatewayAuth, minPollSec: number | null) {
  const meters = await c.query(
    `SELECT m.meter_id, m.name, m.connection_params, m.poll_interval_sec,
            json_agg(json_build_object('channelId', ch.channel_id, 'code', ch.code, 'register', ch.register, 'measureKind', ch.measure_kind, 'unit', ch.unit) ORDER BY ch.channel_id) AS channels
       FROM ems_meters m JOIN ems_channels ch ON ch.meter_id = m.meter_id AND ch.archived_at IS NULL AND ch.register IS NOT NULL
      WHERE m.gateway_id = $1 AND m.org_id = $2 AND m.status = 'active' AND m.connection = 'modbus_tcp'
      GROUP BY m.meter_id ORDER BY m.name`,
    [gw.gatewayId, gw.orgId],
  )
  const list = meters.rows.map((m) => ({
    meterId: m.meter_id,
    name: m.name,
    protocol: "modbus_tcp" as const,
    host: m.connection_params.host,
    port: m.connection_params.port ?? 502,
    unitId: m.connection_params.unitId ?? 1,
    timeoutMs: m.connection_params.timeoutMs ?? 2000,
    pollIntervalSec: Math.max(m.poll_interval_sec ?? 900, minPollSec ?? 1),
    channels: m.channels,
  }))
  const version = createHash("sha256").update(JSON.stringify(list)).digest("hex").slice(0, 16)
  return { gatewayId: gw.gatewayId, version, meters: list, serverTime: new Date().toISOString() }
}

export type ProbeRequest = { host: string; port: number; unitId: number; timeoutMs: number; registers: Array<{ key: string; fn: 3 | 4; address: number; dataType: string; wordOrder: string; scale?: number }> }

export async function createProbeJob(c: Db, orgId: string, actor: Actor, gatewayId: string, payload: ProbeRequest): Promise<string> {
  await assertWritable(c, orgId)
  const g = await c.query("SELECT status, last_seen_at FROM ems_gateways WHERE gateway_id = $1 AND org_id = $2 AND archived_at IS NULL", [gatewayId, orgId])
  if (!g.rows[0]) throw notFound("Шлюз")
  if (g.rows[0].status === "pending") throw conflict("Шлюз ещё не зарегистрирован: установите агент и введите код регистрации", "gateway_not_enrolled")
  if (!payload.registers.length || payload.registers.length > 32) throw badRequest("Проверка: от 1 до 32 регистров")
  const registers = payload.registers.map((r) => {
    try {
      return { key: r.key, ...parseRegisterSpec(r) }
    } catch (e) {
      throw badRequest(`Регистр ${r.key}: ${(e as Error).message}`)
    }
  })
  const pending = await c.query("SELECT count(*)::int AS n FROM ems_gateway_jobs WHERE gateway_id = $1 AND status IN ('queued','running')", [gatewayId])
  if (pending.rows[0].n >= 10) throw conflict("У шлюза уже много невыполненных проверок, подождите", "too_many_jobs")
  const r = await c.query<{ job_id: string }>(
    "INSERT INTO ems_gateway_jobs (org_id, gateway_id, kind, payload, created_by) VALUES ($1, $2, 'probe', $3::jsonb, $4) RETURNING job_id",
    [orgId, gatewayId, JSON.stringify({ ...payload, registers }), actor.id],
  )
  await audit(c, orgId, actor, "gateway.probe", { type: "gateway", id: gatewayId }, { host: payload.host, port: payload.port })
  return r.rows[0].job_id
}

export async function claimJob(c: Db, gw: GatewayAuth) {
  await c.query("UPDATE ems_gateway_jobs SET status = 'expired', finished_at = now(), error = 'шлюз не забрал задание за 5 минут' WHERE gateway_id = $1 AND status = 'queued' AND created_at < now() - interval '5 minutes'", [gw.gatewayId])
  const r = await c.query(
    `UPDATE ems_gateway_jobs SET status = 'running', picked_at = now()
      WHERE job_id = (SELECT job_id FROM ems_gateway_jobs WHERE gateway_id = $1 AND status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING job_id, kind, payload`,
    [gw.gatewayId],
  )
  return r.rows[0] ? { jobId: r.rows[0].job_id, kind: r.rows[0].kind, payload: r.rows[0].payload } : null
}

export async function completeJob(c: Db, gw: GatewayAuth, jobId: string, input: { ok: boolean; result?: unknown; error?: string | null }): Promise<void> {
  const r = await c.query(
    `UPDATE ems_gateway_jobs SET status = $3, result = $4::jsonb, error = $5, finished_at = now() WHERE job_id = $1 AND gateway_id = $2 AND status = 'running' RETURNING job_id`,
    [jobId, gw.gatewayId, input.ok ? "done" : "failed", JSON.stringify(input.result ?? null), input.error?.slice(0, 500) ?? null],
  )
  if (!r.rows[0]) throw notFound("Задание")
}

export const DIAG_CODES: Record<string, string> = {
  connection_refused: "Нет соединения: устройство отклонило подключение (проверьте IP и порт)",
  timeout: "Устройство не отвечает (таймаут)",
  host_unreachable: "Адрес недоступен из сети шлюза",
  illegal_address: "Неправильный адрес регистра (исключение Modbus 02)",
  illegal_function: "Функция не поддерживается устройством (исключение Modbus 01)",
  illegal_value: "Неверное значение запроса (исключение Modbus 03)",
  device_failure: "Ошибка устройства (исключение Modbus 04)",
  bad_data_type: "Неверный тип данных: значение не число",
  auth_failed: "Ошибка авторизации",
  no_new_readings: "Отсутствуют новые показания",
  ok: "Показание получено",
}

export async function writeConnectionLog(c: Db, orgId: string, entries: Array<{ gatewayId?: string | null; meterId?: string | null; level: string; code: string; message?: string | null; details?: unknown }>): Promise<void> {
  for (const e of entries.slice(0, 200)) {
    const level = e.level === "error" || e.level === "warning" ? e.level : "info"
    await c.query(
      `INSERT INTO ems_connection_log (org_id, gateway_id, meter_id, level, code, message, details)
       SELECT $1, $2, m.meter_id, $4, $5, $6, $7::jsonb FROM (SELECT $3::uuid AS meter_id) x
       LEFT JOIN ems_meters m ON m.meter_id = x.meter_id AND m.org_id = $1`,
      [orgId, e.gatewayId ?? null, e.meterId ?? null, level, e.code.slice(0, 60), (e.message || DIAG_CODES[e.code] || e.code).slice(0, 500), JSON.stringify(e.details ?? {})],
    )
  }
}
