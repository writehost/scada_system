import type { PoolClient } from "pg"
import { readFleetUnits, type FleetUnitView } from "@/lib/wms/yms/fleet-read"

/**
 * Погрузчики — из флота карщиков WMS (только чтение). Route хранит лишь дополнительный профиль:
 * тип, габариты, авто-назначение. Погрузчиков, которых нет во флоте, Route не создаёт.
 */
export type RouteForklift = FleetUnitView & {
  forkliftType: string
  widthM: number | null
  heightM: number | null
  capacityKg: number | null
  profileStatus: string
  autoAssign: boolean
  /** REAL — реальная эксплуатация; SIMULATION — учебный режим без складских транзакций */
  opMode: ForkliftMode
  /** Последнее состояние сервиса позиционирования (камера, метки, калибровка) или null */
  localizer: LocalizerStatus | null
}

export type ForkliftMode = "REAL" | "SIMULATION"

export type LocalizerStatus = {
  deviceId: string
  camera: string
  cameraError: string | null
  captureFps: number | null
  lastFrameAt: string | null
  visibleTags: string[]
  calibration: { version: string | null; rmsPx: number | null; accuracyChecked: boolean; note: string | null } | null
  reportedAt: string
  stale: boolean
}

const LOCALIZER_STALE_S = Number(process.env.ROUTE_LOCALIZER_STALE_S || 20)

function localizerView(row: { device_id: string; status: Record<string, unknown> | null; status_at: string | null } | undefined, now = Date.now()): LocalizerStatus | null {
  if (!row || !row.status || !row.status_at) return null
  const s = row.status
  const cal = (s.calibration as Record<string, unknown> | null) ?? null
  const lastFrame = typeof s.lastFrameAt === "number" ? new Date(s.lastFrameAt * 1000).toISOString() : null
  return {
    deviceId: row.device_id,
    camera: String(s.camera ?? "unknown"),
    cameraError: s.cameraError ? String(s.cameraError) : null,
    captureFps: typeof s.captureFps === "number" ? s.captureFps : null,
    lastFrameAt: lastFrame,
    visibleTags: Array.isArray(s.visibleTags) ? (s.visibleTags as unknown[]).map(String) : [],
    calibration: cal
      ? {
          version: cal.version ? String(cal.version) : null,
          rmsPx: typeof cal.rmsPx === "number" ? cal.rmsPx : null,
          accuracyChecked: cal.accuracyChecked === true,
          note: cal.note ? String(cal.note) : null,
        }
      : null,
    reportedAt: row.status_at,
    stale: now - Date.parse(row.status_at) > LOCALIZER_STALE_S * 1000,
  }
}

export async function listForklifts(
  client: PoolClient,
  siteId: number
): Promise<{ available: boolean; reason: string | null; units: RouteForklift[] }> {
  const fleet = await readFleetUnits(siteId)
  if (!fleet.available) return { available: false, reason: fleet.reason, units: [] }
  const r = await client.query<{
    kara_id: string
    forklift_type: string
    width_m: string | null
    height_m: string | null
    capacity_kg: string | null
    status: string
    auto_assign: boolean
    op_mode: string
  }>(`SELECT kara_id, forklift_type, width_m, height_m, capacity_kg, status, auto_assign, op_mode FROM route_forklift_profiles WHERE site_id = $1`, [
    siteId,
  ])
  const prof = new Map(r.rows.map((p) => [p.kara_id, p]))
  const dev = await client.query<{ kara_id: string; device_id: string; status: Record<string, unknown> | null; status_at: string | null }>(
    `SELECT DISTINCT ON (kara_id) kara_id, device_id, status, status_at::text AS status_at FROM route_devices
      WHERE site_id = $1 AND kind = 'localizer' AND revoked_at IS NULL AND kara_id IS NOT NULL
      ORDER BY kara_id, status_at DESC NULLS LAST`,
    [siteId]
  )
  const loc = new Map(dev.rows.map((d) => [d.kara_id, d]))
  return {
    available: true,
    reason: null,
    units: fleet.units.map((u) => {
      const p = prof.get(u.id)
      return {
        ...u,
        forkliftType: p?.forklift_type ?? "counterbalance",
        widthM: p?.width_m != null ? Number(p.width_m) : null,
        heightM: p?.height_m != null ? Number(p.height_m) : null,
        capacityKg: p?.capacity_kg != null ? Number(p.capacity_kg) : null,
        profileStatus: p?.status ?? "active",
        autoAssign: p?.auto_assign ?? true,
        opMode: p?.op_mode === "SIMULATION" ? "SIMULATION" : "REAL",
        localizer: localizerView(loc.get(u.id)),
      }
    }),
  }
}

export async function getForklift(client: PoolClient, siteId: number, karaId: string): Promise<RouteForklift | null> {
  const list = await listForklifts(client, siteId)
  return list.units.find((u) => u.id === karaId) ?? null
}

export async function upsertForkliftProfile(
  client: PoolClient,
  siteId: number,
  karaId: string,
  patch: { forkliftType?: string; widthM?: number | null; heightM?: number | null; capacityKg?: number | null; status?: string; autoAssign?: boolean },
  actor: string
) {
  await client.query(
    `INSERT INTO route_forklift_profiles (site_id, kara_id, forklift_type, width_m, height_m, capacity_kg, status, auto_assign, updated_by)
     VALUES ($1, $2, COALESCE($3, 'counterbalance'), $4, $5, $6, COALESCE($7, 'active'), COALESCE($8, TRUE), $9)
     ON CONFLICT (site_id, kara_id) DO UPDATE SET
       forklift_type = COALESCE($3, route_forklift_profiles.forklift_type),
       width_m = CASE WHEN $10 THEN $4 ELSE route_forklift_profiles.width_m END,
       height_m = CASE WHEN $11 THEN $5 ELSE route_forklift_profiles.height_m END,
       capacity_kg = CASE WHEN $12 THEN $6 ELSE route_forklift_profiles.capacity_kg END,
       status = COALESCE($7, route_forklift_profiles.status),
       auto_assign = COALESCE($8, route_forklift_profiles.auto_assign),
       updated_by = $9, updated_at = now()`,
    [
      siteId,
      karaId,
      patch.forkliftType ?? null,
      patch.widthM ?? null,
      patch.heightM ?? null,
      patch.capacityKg ?? null,
      patch.status ?? null,
      patch.autoAssign ?? null,
      actor,
      "widthM" in patch,
      "heightM" in patch,
      "capacityKg" in patch,
    ]
  )
}

/**
 * Смена режима кары. Только без активного задания (нельзя «незаметно» перевести кару в симуляцию посреди
 * реальной операции), с причиной и записью в журнал событий.
 */
export async function setForkliftMode(client: PoolClient, siteId: number, karaId: string, mode: ForkliftMode, actor: string) {
  await client.query(
    `INSERT INTO route_forklift_profiles (site_id, kara_id, op_mode, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (site_id, kara_id) DO UPDATE SET op_mode = $3, updated_by = $4, updated_at = now()`,
    [siteId, karaId, mode, actor]
  )
}

export async function forkliftMode(client: PoolClient, siteId: number, karaId: string): Promise<ForkliftMode> {
  const r = await client.query<{ op_mode: string }>(`SELECT op_mode FROM route_forklift_profiles WHERE site_id = $1 AND kara_id = $2`, [siteId, karaId])
  return r.rows[0]?.op_mode === "SIMULATION" ? "SIMULATION" : "REAL"
}
