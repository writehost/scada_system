// Объекты, иерархия и приборы учёта.

import type { Db } from "../server/db.ts"
import { badRequest, conflict, notFound } from "../server/errors.ts"
import { isValidTimeZone } from "../domain/time.ts"
import { parseRegisterSpec } from "../domain/protocols.ts"
import { billingUnitOf, type Resource } from "../domain/units.ts"
import { assertLimit, assertWritable } from "./subscription.ts"
import { audit, type Actor } from "./audit.ts"
import { ingestReadings, type IngestResult } from "./ingest.ts"

export const SITE_KINDS = ["apartment", "house", "garage", "office", "workshop", "plant", "warehouse", "commercial", "utility", "other"] as const
export const NODE_KINDS = ["building", "zone", "line", "cabinet", "point", "other"] as const
export const RESOURCES: Resource[] = ["electricity", "cold_water", "hot_water", "heat", "gas", "leak", "other"]
export const QUANTITIES = ["energy_active", "energy_reactive", "power_active", "volume", "flow_rate", "heat_energy", "pulse", "temperature", "leak"] as const
export const UNITS = ["kWh", "kW", "W", "m3", "m3/h", "L", "Gcal", "°C", "pulse", "bool"] as const

export type SiteInput = { name: string; kind: (typeof SITE_KINDS)[number]; address?: string | null; timezone?: string; shifts?: Array<{ name: string; from: string; to: string }> }

export function validateShifts(raw: unknown): Array<{ name: string; from: string; to: string }> {
  if (raw == null) return []
  if (!Array.isArray(raw) || raw.length > 4) throw badRequest("Смены: не больше четырёх")
  return raw.map((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>
    const from = String(o.from ?? "")
    const to = String(o.to ?? "")
    if (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to)) throw badRequest(`Смена ${i + 1}: время в формате ЧЧ:ММ`)
    return { name: String(o.name ?? `Смена ${i + 1}`).slice(0, 40), from, to }
  })
}

export async function createSite(c: Db, orgId: string, actor: Actor, input: SiteInput): Promise<string> {
  await assertLimit(c, orgId, "sites")
  const tz = input.timezone || "Europe/Moscow"
  if (!isValidTimeZone(tz)) throw badRequest("Неизвестный часовой пояс")
  const r = await c.query<{ site_id: string }>(
    `INSERT INTO ems_sites (org_id, name, kind, address, timezone, shifts) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING site_id`,
    [orgId, input.name, input.kind, input.address ?? null, tz, JSON.stringify(validateShifts(input.shifts))],
  )
  await audit(c, orgId, actor, "site.create", { type: "site", id: r.rows[0].site_id }, { name: input.name })
  return r.rows[0].site_id
}

export async function requireSite(c: Db, orgId: string, siteId: string): Promise<{ site_id: string; timezone: string; name: string; kind: string }> {
  const r = await c.query("SELECT site_id, timezone, name, kind FROM ems_sites WHERE site_id = $1 AND org_id = $2 AND archived_at IS NULL", [siteId, orgId])
  if (!r.rows[0]) throw notFound("Объект")
  return r.rows[0]
}

export async function createNode(c: Db, orgId: string, actor: Actor, input: { siteId: string; parentId?: string | null; kind: string; name: string; code?: string | null }): Promise<string> {
  await assertWritable(c, orgId)
  await requireSite(c, orgId, input.siteId)
  if (input.parentId) {
    const p = await c.query("SELECT site_id FROM ems_nodes WHERE node_id = $1 AND org_id = $2", [input.parentId, orgId])
    if (!p.rows[0] || p.rows[0].site_id !== input.siteId) throw badRequest("Родительский узел не найден на этом объекте")
  }
  const r = await c.query<{ node_id: string }>(
    `INSERT INTO ems_nodes (org_id, site_id, parent_id, kind, name, code) VALUES ($1, $2, $3, $4, $5, $6) RETURNING node_id`,
    [orgId, input.siteId, input.parentId ?? null, input.kind, input.name, input.code ?? null],
  )
  await audit(c, orgId, actor, "node.create", { type: "node", id: r.rows[0].node_id }, { name: input.name, kind: input.kind })
  return r.rows[0].node_id
}

export type ChannelInput = {
  code: string
  name: string
  quantity: (typeof QUANTITIES)[number]
  measure_kind: "cumulative" | "instant"
  unit: string
  tariff_zone?: string | null
  is_billing?: boolean
  register?: unknown
  multiplier?: number
  value_offset?: number
  rollover_at?: number | null
  max_rate_per_hour?: number | null
  decimals?: number
}

export function validateChannels(raw: unknown, connection: string): ChannelInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw badRequest("Добавьте хотя бы один канал измерения")
  if (raw.length > 32) throw badRequest("Не больше 32 каналов на прибор")
  const codes = new Set<string>()
  return raw.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>
    const code = String(o.code ?? "").trim()
    if (!/^[a-z0-9_]{1,32}$/.test(code)) throw badRequest(`Канал ${i + 1}: код — латиница, цифры, подчёркивание`)
    if (codes.has(code)) throw badRequest(`Код канала ${code} повторяется`)
    codes.add(code)
    const quantity = String(o.quantity ?? "") as ChannelInput["quantity"]
    if (!QUANTITIES.includes(quantity)) throw badRequest(`Канал ${code}: неизвестная величина`)
    const measure_kind = o.measure_kind === "instant" ? "instant" : "cumulative"
    if ((quantity === "power_active" || quantity === "flow_rate" || quantity === "temperature" || quantity === "leak") && measure_kind !== "instant") {
      throw badRequest(`Канал ${code}: мощность, расход, температура и протечка — мгновенные величины`)
    }
    if ((quantity === "energy_active" || quantity === "energy_reactive" || quantity === "volume" || quantity === "heat_energy" || quantity === "pulse") && measure_kind !== "cumulative") {
      throw badRequest(`Канал ${code}: энергия и объём — накопительные величины`)
    }
    const unit = String(o.unit ?? "")
    if (!(UNITS as readonly string[]).includes(unit)) throw badRequest(`Канал ${code}: неизвестная единица измерения`)
    const multiplier = o.multiplier == null || o.multiplier === "" ? 1 : Number(o.multiplier)
    if (!Number.isFinite(multiplier) || multiplier <= 0) throw badRequest(`Канал ${code}: коэффициент — положительное число`)
    const value_offset = o.value_offset == null || o.value_offset === "" ? 0 : Number(o.value_offset)
    if (!Number.isFinite(value_offset)) throw badRequest(`Канал ${code}: смещение — число`)
    const rollover_at = o.rollover_at == null || o.rollover_at === "" ? null : Number(o.rollover_at)
    if (rollover_at != null && !(rollover_at > 0)) throw badRequest(`Канал ${code}: модуль переполнения — положительное число`)
    const max_rate_per_hour = o.max_rate_per_hour == null || o.max_rate_per_hour === "" ? null : Number(o.max_rate_per_hour)
    if (max_rate_per_hour != null && !(max_rate_per_hour > 0)) throw badRequest(`Канал ${code}: предел расхода — положительное число`)
    const tariff_zone = o.tariff_zone ? String(o.tariff_zone).toUpperCase() : null
    if (tariff_zone && !/^T[1-4]$/.test(tariff_zone)) throw badRequest(`Канал ${code}: зона T1…T4`)
    let register: unknown = null
    if (connection === "modbus_tcp") {
      try {
        register = parseRegisterSpec(o.register)
      } catch (e) {
        throw badRequest(`Канал ${code}: ${(e as Error).message}`)
      }
    }
    return {
      code,
      name: String(o.name ?? code).trim().slice(0, 80) || code,
      quantity,
      measure_kind,
      unit,
      tariff_zone,
      is_billing: o.is_billing == null ? measure_kind === "cumulative" : o.is_billing !== false,
      register,
      multiplier,
      value_offset,
      rollover_at,
      max_rate_per_hour,
      decimals: Math.min(6, Math.max(0, Number(o.decimals ?? 3) || 0)),
    }
  })
}

/** Значения по умолчанию для защиты от неправдоподобных скачков в домашних приборах. */
export function defaultMaxRate(resource: Resource, segment: "home" | "industrial", unit: string): number | null {
  if (segment !== "home") return null
  if (resource === "electricity" && unit === "kWh") return 30
  if ((resource === "cold_water" || resource === "hot_water") && unit === "m3") return 3
  return null
}

export type MeterInput = {
  siteId: string
  nodeId?: string | null
  resource: Resource
  name: string
  serialNumber?: string | null
  manufacturer?: string | null
  model?: string | null
  catalogModelId?: string | null
  connection: "manual" | "modbus_tcp" | "http_push"
  gatewayId?: string | null
  connectionParams?: Record<string, unknown>
  pollIntervalSec?: number | null
  telemetryTimeoutMin?: number | null
  installedAt?: number | null
  verificationDue?: string | null
  channels: ChannelInput[]
  initialReadings?: Record<string, number>
  status?: "draft" | "active"
}

export function validateConnectionParams(connection: string, raw: unknown): Record<string, unknown> {
  if (connection !== "modbus_tcp") return {}
  const o = (raw ?? {}) as Record<string, unknown>
  const host = String(o.host ?? "").trim()
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(host)) throw badRequest("Адрес устройства: IP или имя хоста в локальной сети", "invalid_input", { field: "host" })
  const port = Number(o.port ?? 502)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest("Порт: 1–65535", "invalid_input", { field: "port" })
  const unitId = Number(o.unitId ?? 1)
  if (!Number.isInteger(unitId) || unitId < 0 || unitId > 255) throw badRequest("Unit ID: 0–255", "invalid_input", { field: "unitId" })
  const timeoutMs = Number(o.timeoutMs ?? 2000)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 200 || timeoutMs > 15000) throw badRequest("Таймаут: 200–15000 мс", "invalid_input", { field: "timeoutMs" })
  return { host, port, unitId, timeoutMs }
}

export async function createMeter(c: Db, orgId: string, actor: Actor, input: MeterInput): Promise<{ meterId: string; channels: Array<{ channelId: number; code: string }>; initial: IngestResult[] }> {
  const sub = await assertWritable(c, orgId)
  if (input.status !== "draft") await assertLimit(c, orgId, "meters")
  await requireSite(c, orgId, input.siteId)
  if (input.nodeId) {
    const n = await c.query("SELECT site_id FROM ems_nodes WHERE node_id = $1 AND org_id = $2", [input.nodeId, orgId])
    if (!n.rows[0] || n.rows[0].site_id !== input.siteId) throw badRequest("Узел не найден на этом объекте")
  }
  if (input.connection === "modbus_tcp") {
    if (!input.gatewayId) throw badRequest("Для Modbus TCP выберите шлюз SCADA EMS Gateway: облако не опрашивает приборы напрямую")
    const g = await c.query("SELECT site_id FROM ems_gateways WHERE gateway_id = $1 AND org_id = $2 AND archived_at IS NULL", [input.gatewayId, orgId])
    if (!g.rows[0]) throw badRequest("Шлюз не найден")
  }
  const poll = input.connection === "modbus_tcp" ? Math.max(input.pollIntervalSec ?? 900, sub.limits.min_poll_sec ?? 1) : null
  const params = validateConnectionParams(input.connection, input.connectionParams)
  const r = await c.query<{ meter_id: string }>(
    `INSERT INTO ems_meters (org_id, site_id, node_id, resource, name, serial_number, manufacturer, model, catalog_model_id, connection, gateway_id,
                             connection_params, poll_interval_sec, telemetry_timeout_min, installed_at, verification_due, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, COALESCE($15, now()), $16, $17) RETURNING meter_id`,
    [
      orgId, input.siteId, input.nodeId ?? null, input.resource, input.name, input.serialNumber ?? null, input.manufacturer ?? null, input.model ?? null,
      input.catalogModelId ?? null, input.connection, input.connection === "modbus_tcp" ? input.gatewayId : null, JSON.stringify(params), poll,
      input.telemetryTimeoutMin ?? (input.connection === "manual" ? 60 * 24 * 45 : 120),
      input.installedAt ? new Date(input.installedAt) : null, input.verificationDue ?? null, input.status ?? "active",
    ],
  )
  const meterId = r.rows[0].meter_id
  const segment = sub.segment
  const channels: Array<{ channelId: number; code: string }> = []
  for (const ch of input.channels) {
    const ins = await c.query<{ channel_id: number }>(
      `INSERT INTO ems_channels (org_id, meter_id, code, name, quantity, measure_kind, unit, tariff_zone, is_billing, register, multiplier, value_offset, rollover_at, max_rate_per_hour, decimals)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15) RETURNING channel_id`,
      [
        orgId, meterId, ch.code, ch.name, ch.quantity, ch.measure_kind, ch.unit, ch.tariff_zone ?? null, ch.is_billing ?? true,
        ch.register ? JSON.stringify(ch.register) : null, ch.multiplier ?? 1, ch.value_offset ?? 0, ch.rollover_at ?? null,
        ch.max_rate_per_hour ?? (ch.measure_kind === "cumulative" ? defaultMaxRate(input.resource, segment, ch.unit) : null), ch.decimals ?? 3,
      ],
    )
    const channelId = ins.rows[0].channel_id
    await c.query(
      `INSERT INTO ems_channel_coefficients (channel_id, org_id, effective_from, multiplier, value_offset, reason) VALUES ($1, $2, 'epoch', $3, $4, 'начальная настройка')`,
      [channelId, orgId, ch.multiplier ?? 1, ch.value_offset ?? 0],
    )
    channels.push({ channelId, code: ch.code })
  }
  await audit(c, orgId, actor, "meter.create", { type: "meter", id: meterId }, { name: input.name, connection: input.connection, channels: channels.length })
  let initial: IngestResult[] = []
  if (input.initialReadings && Object.keys(input.initialReadings).length) {
    const at = input.installedAt ?? Date.now()
    initial = await ingestReadings(
      c,
      orgId,
      channels.filter((x) => input.initialReadings![x.code] != null).map((x) => ({ channelId: x.channelId, at, raw: Number(input.initialReadings![x.code]), source: "manual" as const, enteredBy: actor.id, note: "начальное показание" })),
    )
  }
  return { meterId, channels, initial }
}

/**
 * Замена прибора: финальные показания старого, начальные нового. Расход
 * объекта не теряется: старый и новый приборы учитываются каждый в своём интервале.
 */
export async function replaceMeter(
  c: Db,
  orgId: string,
  actor: Actor,
  meterId: string,
  input: { at: number; finalReadings: Record<string, number>; newMeter: Partial<Omit<MeterInput, "siteId" | "resource" | "channels" | "installedAt">> & { name: string; channels?: ChannelInput[] }; initialReadings: Record<string, number>; reason?: string | null },
): Promise<{ newMeterId: string }> {
  await assertWritable(c, orgId)
  const old = await c.query("SELECT * FROM ems_meters WHERE meter_id = $1 AND org_id = $2", [meterId, orgId])
  const m = old.rows[0]
  if (!m) throw notFound("Прибор")
  if (m.status !== "active") throw conflict("Заменить можно только действующий прибор")
  const chs = await c.query("SELECT * FROM ems_channels WHERE meter_id = $1 AND archived_at IS NULL ORDER BY channel_id", [meterId])
  const finals = chs.rows.filter((ch) => input.finalReadings[ch.code] != null)
  if (finals.length) {
    const res = await ingestReadings(c, orgId, finals.map((ch) => ({ channelId: ch.channel_id, at: input.at, raw: Number(input.finalReadings[ch.code]), source: "manual" as const, enteredBy: actor.id, note: "финальное показание при замене" })))
    const bad = res.find((x) => x.status === "rejected" || x.quality === "bad")
    if (bad) throw badRequest(`Финальное показание не принято: ${bad.reason ?? "меньше предыдущего"}`)
  }
  await c.query("UPDATE ems_meters SET status = 'replaced', removed_at = $2, updated_at = now() WHERE meter_id = $1", [meterId, new Date(input.at)])
  const channels: ChannelInput[] =
    input.newMeter.channels ??
    chs.rows.map((ch) => ({
      code: ch.code, name: ch.name, quantity: ch.quantity, measure_kind: ch.measure_kind, unit: ch.unit, tariff_zone: ch.tariff_zone, is_billing: ch.is_billing,
      register: ch.register, multiplier: ch.multiplier, value_offset: 0, rollover_at: ch.rollover_at, max_rate_per_hour: ch.max_rate_per_hour, decimals: ch.decimals,
    }))
  const created = await createMeter(c, orgId, actor, {
    ...input.newMeter,
    connection: input.newMeter.connection ?? m.connection,
    gatewayId: input.newMeter.gatewayId ?? m.gateway_id,
    connectionParams: input.newMeter.connectionParams ?? m.connection_params,
    siteId: m.site_id,
    nodeId: m.node_id,
    resource: m.resource,
    channels,
    installedAt: input.at + 1000,
    initialReadings: input.initialReadings,
  })
  await c.query("UPDATE ems_meters SET replaces_meter_id = $2 WHERE meter_id = $1", [created.meterId, meterId])
  await audit(c, orgId, actor, "meter.replace", { type: "meter", id: meterId }, { newMeterId: created.meterId, reason: input.reason ?? null })
  return { newMeterId: created.meterId }
}

/**
 * Смена коэффициента (замена трансформаторов тока, другой вес импульса).
 * Граничное показание регистра делает расход через границу точным.
 */
export async function changeCoefficient(
  c: Db,
  orgId: string,
  actor: Actor,
  channelId: number,
  input: { effectiveFrom: number; multiplier: number; valueOffset?: number; boundaryRaw?: number | null; reason: string },
): Promise<void> {
  await assertWritable(c, orgId)
  const ch = await c.query("SELECT channel_id, multiplier, value_offset, last_at FROM ems_channels WHERE channel_id = $1 AND org_id = $2", [channelId, orgId])
  if (!ch.rows[0]) throw notFound("Канал")
  if (!(input.multiplier > 0)) throw badRequest("Коэффициент — положительное число")
  const prev = ch.rows[0]
  if (prev.last_at && new Date(prev.last_at).getTime() > input.effectiveFrom) {
    throw badRequest("Дата смены коэффициента раньше последнего показания. Укажите момент после последнего показания.")
  }
  if (input.boundaryRaw != null) {
    // Граничное показание по старому коэффициенту закрывает интервал.
    const res = await ingestReadings(c, orgId, [{ channelId, at: input.effectiveFrom, raw: input.boundaryRaw, source: "manual", enteredBy: actor.id, note: "граничное показание при смене коэффициента", flags: ["coef_boundary"] }])
    if (res[0].status !== "accepted" || res[0].quality === "bad") throw badRequest("Граничное показание не принято: проверьте значение")
  }
  await c.query(
    `INSERT INTO ems_channel_coefficients (channel_id, org_id, effective_from, multiplier, value_offset, boundary_raw, reason, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [channelId, orgId, new Date(input.effectiveFrom + (input.boundaryRaw != null ? 1 : 0)), input.multiplier, input.valueOffset ?? 0, input.boundaryRaw ?? null, input.reason, actor.id],
  )
  await c.query("UPDATE ems_channels SET multiplier = $2, value_offset = $3 WHERE channel_id = $1", [channelId, input.multiplier, input.valueOffset ?? 0])
  await audit(c, orgId, actor, "channel.coefficient", { type: "channel", id: channelId }, { from: prev.multiplier, to: input.multiplier, boundaryRaw: input.boundaryRaw ?? null, reason: input.reason })
}

export function billingChannelUnit(resource: Resource): string | null {
  return billingUnitOf(resource)
}
