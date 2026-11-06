import type { PoolClient } from "pg"
import { dist, nodeForAddress } from "@/lib/route/graph"
import type { PublishedMap } from "@/lib/route/maps"
import type { ForkliftPosition } from "@/lib/route/positions"
import { activeTaskForKara, transition } from "@/lib/route/tasks"

export const AUTO_ARRIVE_M = Number(process.env.ROUTE_AUTO_ARRIVE_M || 3)

/**
 * Автоматическая отметка «прибыл» по позиции рядом с точкой задания.
 * Только достоверная позиция AprilTag (или учебная позиция SIMULATION — её принимают лишь для кары в симуляции,
 * у которой бывают только учебные задания). Ручная позиция, прогноз и потерянная метка прибытие не подтверждают.
 * Прибытие не подтверждает погрузку и постановку: для них нужен скан палеты и адреса.
 */
export async function autoArrive(
  client: PoolClient,
  siteId: number,
  karaId: string,
  p: ForkliftPosition,
  map: PublishedMap | null,
  mpu: number
): Promise<string | null> {
  if (p.state !== "ok" || (p.source !== "apriltag" && p.source !== "simulation") || !map) return null
  const t = await activeTaskForKara(client, siteId, karaId)
  if (!t || (t.status !== "EN_ROUTE_PICKUP" && t.status !== "EN_ROUTE_DROPOFF")) return null
  if (p.source === "simulation" && !t.simulation) return null
  const code = t.status === "EN_ROUTE_PICKUP" ? t.sourceCode : t.destCode
  const nodeId = (t.status === "EN_ROUTE_PICKUP" ? t.sourceNodeId : t.destNodeId) || nodeForAddress(map.geometry, code)
  const node = map.geometry.nodes.find((n) => n.id === nodeId)
  if (!node || dist(node, p) * mpu > AUTO_ARRIVE_M) return null
  await client.query(`SELECT 1 FROM route_tasks WHERE task_id = $1::bigint FOR UPDATE`, [t.taskId])
  await transition(client, t, t.status === "EN_ROUTE_PICKUP" ? "arrive_pickup" : "arrive_dropoff", {
    actor: p.source === "simulation" ? "system:simulation" : "system:position",
    reason: `${p.source === "simulation" ? "учебная позиция" : "позиция AprilTag"} в ${AUTO_ARRIVE_M} м от ${code}`,
  })
  return code
}
