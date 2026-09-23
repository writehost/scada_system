import { readFile } from "node:fs/promises"
import path from "node:path"

export type FleetUnitView = {
  id: string
  name: string
  boardNumber: string | null
  enabled: boolean
  driverId: string | null
  driverName: string | null
  shiftCode: string | null
  missionStatus: string | null
  hasPosition: false
}

export type FleetRead =
  | { available: true; source: string; units: FleetUnitView[] }
  | { available: false; reason: string }

function candidates(siteId: number): string[] {
  const list: string[] = []
  const explicit = (process.env.YMS_FLEET_FILE || "").trim()
  if (explicit) list.push(explicit)
  const shared = (process.env.WMS_SHARED_DIR || "").trim()
  if (shared) list.push(path.join(shared, "uploads", "fg-kara-fleet", `site-${siteId}.json`))
  list.push(`/opt/scadatable-wms/shared/uploads/fg-kara-fleet/site-${siteId}.json`)
  list.push(`/opt/scadatable-wms/current/shared/uploads/fg-kara-fleet/site-${siteId}.json`)
  return list
}

/** Только чтение флота карщиков WMS. Пустой файл не создаём и погрузчики не выдумываем. */
export async function readFleetUnits(siteId: number): Promise<FleetRead> {
  let last = "файл флота WMS не найден"
  for (const file of candidates(siteId)) {
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as {
        version?: number
        karas?: Array<{ id?: string; name?: string; boardNumber?: string | null; enabled?: boolean }>
        drivers?: Array<{ id?: string; fullName?: string; karaId?: string | null; shiftCode?: string | null; enabled?: boolean }>
        missions?: Array<{ karaId?: string; status?: string; driverId?: string | null }>
      }
      if (parsed?.version !== 1 || !Array.isArray(parsed.karas)) {
        last = "файл флота WMS есть, но формат не version 1"
        continue
      }
      const drivers = Array.isArray(parsed.drivers) ? parsed.drivers : []
      const missions = Array.isArray(parsed.missions) ? parsed.missions : []
      const units: FleetUnitView[] = parsed.karas
        .filter((row) => row && typeof row.id === "string" && row.id)
        .map((row) => {
          const driver = drivers.find((item) => item.karaId === row.id && item.enabled !== false)
          const mission = missions.find((item) => item.karaId === row.id && item.status && item.status !== "done" && item.status !== "cancelled")
          return {
            id: String(row.id),
            name: String(row.name || row.boardNumber || row.id),
            boardNumber: row.boardNumber ?? null,
            enabled: row.enabled !== false,
            driverId: driver?.id ?? mission?.driverId ?? null,
            driverName: driver?.fullName ?? null,
            shiftCode: driver?.shiftCode ?? null,
            missionStatus: mission?.status ?? null,
            hasPosition: false,
          }
        })
      return { available: true, source: file, units }
    } catch (error) {
      const code = (error as { code?: string }).code
      if (code !== "ENOENT") last = "файл флота WMS не читается"
    }
  }
  return { available: false, reason: last }
}
