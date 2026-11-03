import type { PoolClient } from "pg"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { WmsHttpError } from "@/lib/wms/errors"
import { createTask } from "@/lib/route/tasks"
import { isRouteTaskType, type RouteTaskType } from "@/lib/route/state-machine"
import { wmsGateway } from "@/lib/route/wms-gateway"

/**
 * Потребности в перемещении → транспортные задания YMS.
 *
 * Источники (включаются диспетчером отдельно, по умолчанию выключены, чтобы не перехватить
 * задания у работающих ТСД до согласования процесса):
 *  - wmsTasks: открытые задания WMS по палетам ГП. WMS сама помечает их как переданные в Route
 *    (POST /api/wms/route/demand) и закрывает при подтверждённом перемещении.
 *  - karaMissions: миссии флота карщиков WMS с реальной палетой (palletId) и линией — забор с линии.
 * Без кода реальной палеты задание не создаётся.
 */

export type DemandSettings = { wmsTasks: boolean; karaMissions: boolean; autoAssign: boolean }

const DEFAULTS: DemandSettings = { wmsTasks: false, karaMissions: false, autoAssign: true }

export async function getDemandSettings(client: PoolClient, siteId: number): Promise<DemandSettings> {
  const r = await client.query<{ value: Partial<DemandSettings> }>(`SELECT value FROM route_settings WHERE site_id = $1 AND key = 'demand'`, [
    siteId,
  ])
  return { ...DEFAULTS, ...(r.rows[0]?.value ?? {}) }
}

export async function saveDemandSettings(client: PoolClient, siteId: number, patch: Partial<DemandSettings>, actor: string) {
  const cur = await getDemandSettings(client, siteId)
  const next = { ...cur }
  for (const k of Object.keys(DEFAULTS) as Array<keyof DemandSettings>) {
    if (typeof patch[k] === "boolean") next[k] = patch[k] as boolean
  }
  await client.query(
    `INSERT INTO route_settings (site_id, key, value, updated_by) VALUES ($1, 'demand', $2::jsonb, $3)
     ON CONFLICT (site_id, key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [siteId, JSON.stringify(next), actor]
  )
  return next
}

const WMS_TYPE: Record<string, RouteTaskType> = {
  putaway: "PUTAWAY",
  replenishment: "STAGING",
  internal_transfer: "RELOCATION",
  return_from_line: "RETURN",
  pick: "SHIPPING_PICK",
  ship: "SHIPPING_PICK",
}

export function mapWmsType(code: string): RouteTaskType | null {
  const c = code.trim()
  if (isRouteTaskType(c)) return c
  return WMS_TYPE[c.toLowerCase()] ?? null
}

type Mission = {
  id: string
  karaId: string
  status: string
  lineCode: string | null
  palletId: string | null
  targetRowId: string | null
  priority?: number
  kind?: string
}

async function readMissions(siteId: number): Promise<Mission[]> {
  const list: string[] = []
  const explicit = (process.env.YMS_FLEET_FILE || "").trim()
  if (explicit) list.push(explicit)
  const shared = (process.env.WMS_SHARED_DIR || "").trim()
  if (shared) list.push(path.join(shared, "uploads", "fg-kara-fleet", `site-${siteId}.json`))
  list.push(`/opt/scadatable-wms/shared/uploads/fg-kara-fleet/site-${siteId}.json`)
  for (const f of list) {
    try {
      const parsed = JSON.parse(await readFile(f, "utf8")) as { missions?: Mission[] }
      return Array.isArray(parsed.missions) ? parsed.missions : []
    } catch {
      /* следующий */
    }
  }
  return []
}

export type SyncReport = {
  created: string[]
  skipped: Array<{ ref: string; reason: string }>
  released: string[]
  errors: string[]
}

export async function syncDemand(client: PoolClient, siteId: number, siteCode: string, actor: string): Promise<SyncReport> {
  const settings = await getDemandSettings(client, siteId)
  const report: SyncReport = { created: [], skipped: [], released: [], errors: [] }
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`route-demand:${siteId}`])

  if (settings.wmsTasks) {
    let items: Awaited<ReturnType<ReturnType<typeof wmsGateway>["pullDemand"]>> = []
    try {
      items = await wmsGateway().pullDemand({ siteCode, limit: 50 })
    } catch (error) {
      report.errors.push(`WMS: ${(error as Error).message}`)
    }
    for (const it of items) {
      const type = mapWmsType(it.type)
      const ref = `wms_task:${it.wmsTaskId}`
      if (!type || !it.targetLocationCode) {
        const reason = !type ? `тип ${it.type} не обслуживается Route` : "в задании WMS нет адреса назначения"
        report.skipped.push({ ref, reason })
        await wmsGateway().releaseDemand({ siteCode, wmsTaskId: it.wmsTaskId, reason }).catch(() => undefined)
        report.released.push(it.wmsTaskId)
        continue
      }
      await client.query("SAVEPOINT demand_item")
      try {
        const res = await createTask(
          client,
          siteId,
          siteCode,
          {
            type,
            sourceCode: it.sourceLocationCode,
            destCode: it.targetLocationCode,
            huCode: it.palletCode,
            priority: it.priority,
            wmsRefKind: "wms_task",
            wmsRefId: it.wmsTaskId,
            note: it.taskCode ? `WMS ${it.taskCode}` : null,
          },
          actor
        )
        await client.query("RELEASE SAVEPOINT demand_item")
        if (res.created) report.created.push(res.task.taskNo)
        else report.skipped.push({ ref, reason: `уже есть ${res.task.taskNo}` })
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT demand_item")
        const reason = error instanceof WmsHttpError ? error.message : (error as Error).message
        report.skipped.push({ ref, reason })
        await wmsGateway().releaseDemand({ siteCode, wmsTaskId: it.wmsTaskId, reason }).catch(() => undefined)
        report.released.push(it.wmsTaskId)
      }
    }
  }

  if (settings.karaMissions) {
    const missions = await readMissions(siteId)
    for (const m of missions) {
      if (!m || (m.status !== "queued" && m.status !== "active")) continue
      const ref = `kara_mission:${m.id}`
      if (!m.palletId || !m.lineCode || !m.targetRowId) {
        report.skipped.push({ ref, reason: "в миссии нет палеты, линии или ряда назначения" })
        continue
      }
      await client.query("SAVEPOINT demand_item")
      try {
        const res = await createTask(
          client,
          siteId,
          siteCode,
          {
            type: "PRODUCTION_PICKUP",
            sourceCode: `LINE-${m.lineCode.toUpperCase()}`,
            destCode: m.targetRowId,
            huCode: m.palletId,
            priority: typeof m.priority === "number" ? m.priority : m.kind === "urgent" ? 90 : 60,
            wmsRefKind: "kara_mission",
            wmsRefId: m.id,
            sourceIsStorage: false,
          },
          actor
        )
        await client.query("RELEASE SAVEPOINT demand_item")
        if (res.created) report.created.push(res.task.taskNo)
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT demand_item")
        report.skipped.push({ ref, reason: (error as Error).message })
      }
    }
  }
  return report
}
