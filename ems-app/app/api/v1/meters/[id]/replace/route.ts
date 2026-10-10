import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { reqStr, str, timestamp } from "@/lib/server/validate.ts"
import { replaceMeter } from "@/lib/services/assets.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function readings(raw: unknown, label: string): Record<string, number> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest(`${label}: укажите показания каналов`)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(String(v).replace(",", "."))
    if (!Number.isFinite(n) || n < 0) throw badRequest(`${label} ${k}: неотрицательное число`)
    out[k] = n
  }
  return out
}

export const POST = api({ perm: "devices.write" }, async (ctx, p) =>
  ctx.tx((c) =>
    replaceMeter(c, ctx.orgId, ctx.actor, idParam(p.id), {
      at: timestamp(ctx.body, "at", "Дата замены", true)!,
      finalReadings: readings(ctx.body.finalReadings, "Финальное показание"),
      initialReadings: readings(ctx.body.initialReadings, "Начальное показание"),
      newMeter: {
        name: reqStr(ctx.body, "name", "Название нового прибора", 120),
        serialNumber: str(ctx.body, "serialNumber", "Заводской номер", { max: 60 }),
      },
      reason: str(ctx.body, "reason", "Причина", { max: 300 }),
    }),
  ),
)
