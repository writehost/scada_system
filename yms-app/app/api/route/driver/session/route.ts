import { driverState } from "@/lib/route/driver-state"
import { listForklifts } from "@/lib/route/fleet"
import { fail, str, withRoute, withRouteTx } from "@/lib/route/http"
import { requireUser } from "@/lib/route/auth"
import { endSession, sessionsList, startSession } from "@/lib/route/tasks"
import { seedDraftIfEmpty } from "@/lib/route/maps"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Текущая сессия водителя и список погрузчиков флота WMS для выбора. */
export async function GET(req: Request) {
  return withRoute(req, "route.read", async (ctx) => {
    const fleet = await listForklifts(ctx.client, ctx.siteId)
    const busy = await sessionsList(ctx.client, ctx.siteId)
    const state = await driverState(ctx.client, ctx.siteId, ctx.actor, { allowOffer: false })
    return {
      ...state,
      fleet: {
        available: fleet.available,
        reason: fleet.reason,
        units: fleet.units.map((u) => ({
          id: u.id,
          name: u.name,
          boardNumber: u.boardNumber,
          enabled: u.enabled && u.profileStatus === "active",
          driverName: u.driverName,
          busyBy: (busy as Array<{ karaId: string; fio: string }>).find((s) => s.karaId === u.id)?.fio ?? null,
        })),
      },
    }
  })
}

/** Начать смену на погрузчике. Смена погрузчика закрывает прежнюю сессию и перепроверяет задания. */
export async function POST(req: Request) {
  return withRouteTx(req, "route.drive", async (ctx) => {
    const user = requireUser(ctx.actor)
    const karaId = str(ctx.body, "karaId", 64)
    if (!karaId) fail(400, "Выберите погрузчик", "kara_required")
    await seedDraftIfEmpty(ctx.client, ctx.siteId)
    await startSession(ctx.client, ctx.siteId, user, {
      karaId,
      shiftCode: str(ctx.body, "shiftCode", 40) || null,
      deviceId: str(ctx.body, "deviceId", 80) || null,
      force: ctx.body.force === true,
    })
    return driverState(ctx.client, ctx.siteId, ctx.actor, { allowOffer: true })
  })
}

export async function DELETE(req: Request) {
  return withRouteTx(req, "route.drive", async (ctx) => {
    const user = requireUser(ctx.actor)
    const res = await endSession(ctx.client, ctx.siteId, user, str(ctx.body, "reason", 200) || "конец смены")
    return { ok: true, ...res }
  })
}
