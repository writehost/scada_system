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
  }>(`SELECT kara_id, forklift_type, width_m, height_m, capacity_kg, status, auto_assign FROM route_forklift_profiles WHERE site_id = $1`, [
    siteId,
  ])
  const prof = new Map(r.rows.map((p) => [p.kara_id, p]))
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
