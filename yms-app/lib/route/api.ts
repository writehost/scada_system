import { driverState } from "@/lib/route/driver-state"
import { num, requestId, str, type RouteCtx } from "@/lib/route/http"

export const dynamicConfig = { runtime: "nodejs", dynamic: "force-dynamic" } as const

export function cmdOf(ctx: RouteCtx, taskId: string, requireRequestId = true) {
  return {
    siteId: ctx.siteId,
    siteCode: ctx.siteCode,
    actor: ctx.actor,
    taskId,
    expectedVersion: num(ctx.body, "expectedVersion"),
    clientRequestId: requestId(ctx.body, requireRequestId),
  }
}

/** Ответ команды водителя: результат + свежее состояние экрана (одна транзакция). */
export async function withDriverState(ctx: RouteCtx, result: Record<string, unknown>) {
  const state = await driverState(ctx.client, ctx.siteId, ctx.actor, { allowOffer: false })
  const { task: _t, ...rest } = result as { task?: unknown }
  void _t
  return { ok: true, ...rest, state }
}

export function scanInput(ctx: RouteCtx) {
  return {
    code: str(ctx.body, "code", 512),
    method: str(ctx.body, "method", 20) || "scanner",
    manualReason: str(ctx.body, "manualReason", 240),
    deviceId: str(ctx.body, "deviceId", 80) || null,
  }
}
