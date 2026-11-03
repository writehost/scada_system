import type { PoolClient } from "pg"
import type { RouteActor } from "@/lib/route/auth"
import { getForklift } from "@/lib/route/fleet"
import { getPublishedMap } from "@/lib/route/maps"
import { getPosition } from "@/lib/route/positions"
import {
  activeTaskForKara,
  bestCandidate,
  currentSession,
  offerNext,
  taskView,
} from "@/lib/route/tasks"
import { TYPE_LABEL } from "@/lib/route/state-machine"

/**
 * Всё, что нужно одному экрану водителя, одним ответом.
 * Если погрузчик свободен — YMS сразу предлагает подходящее задание (offerNext).
 */
export async function driverState(client: PoolClient, siteId: number, actor: RouteActor, opts: { allowOffer: boolean }) {
  if (actor.kind !== "user") return { session: null }
  const session = await currentSession(client, siteId, actor.login)
  const map = await getPublishedMap(client, siteId)
  const mapInfo = map ? { mapId: map.mapId, version: map.version, revision: map.revision } : null
  if (!session) return { user: { login: actor.login, fio: actor.fio }, session: null, map: mapInfo, serverTime: new Date().toISOString() }
  let task = await activeTaskForKara(client, siteId, session.karaId)
  if (!task && opts.allowOffer) task = await offerNext(client, siteId, session.karaId)
  const position = await getPosition(client, siteId, session.karaId)
  const forklift = await getForklift(client, siteId, session.karaId)
  const view = task ? await taskView(client, task, { position }) : null
  let next = null
  const peek = await bestCandidate(client, siteId, session.karaId, { lock: false, excludeTaskId: task?.taskId })
  if (peek && task) {
    next = {
      taskNo: peek.task.taskNo,
      typeLabel: TYPE_LABEL[peek.task.type],
      sourceCode: peek.task.sourceCode,
      destCode: peek.task.destCode,
      emptyRunM: peek.score.emptyRunM,
    }
  }
  const open = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM route_exceptions WHERE site_id = $1 AND kara_id = $2 AND status = 'open'`,
    [siteId, session.karaId]
  )
  return {
    user: { login: actor.login, fio: actor.fio },
    session,
    forklift: forklift
      ? { id: forklift.id, name: forklift.name, boardNumber: forklift.boardNumber, type: forklift.forkliftType, autoAssign: forklift.autoAssign }
      : { id: session.karaId, name: session.karaName || session.karaId, boardNumber: null, type: null, autoAssign: false },
    task: view,
    next,
    position,
    map: mapInfo,
    openExceptions: open.rows[0]?.n ?? 0,
    serverTime: new Date().toISOString(),
  }
}
