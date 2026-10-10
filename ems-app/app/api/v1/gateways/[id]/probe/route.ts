// Проверка доступности прибора и чтение регистров через шлюз (мастер подключения, шаги 5 и 7).
import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { createProbeJob } from "@/lib/services/gateways.ts"
import { validateConnectionParams } from "@/lib/services/assets.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = api({ perm: "devices.write", rate: 60 }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const params = validateConnectionParams("modbus_tcp", ctx.body.connectionParams) as { host: string; port: number; unitId: number; timeoutMs: number }
    const regs = ctx.body.registers
    if (!Array.isArray(regs)) throw badRequest("Укажите регистры для проверки")
    const jobId = await createProbeJob(c, ctx.orgId, ctx.actor, idParam(p.id), {
      ...params,
      registers: regs.map((r, i) => ({ key: String((r as Record<string, unknown>).key ?? i), ...(r as Record<string, unknown>) })) as never,
    })
    return { jobId }
  }),
)
