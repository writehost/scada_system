// Журнал диагностики подключения от шлюза: ошибки связи, адресов регистров, типов данных.
import { publicApi } from "@/lib/server/http.ts"
import { withOrg } from "@/lib/server/db.ts"
import { badRequest } from "@/lib/server/errors.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { writeConnectionLog } from "@/lib/services/gateways.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ maxBody: 500_000 }, async ({ req, body }) => {
  const gw = await gatewayFrom(req)
  if (!Array.isArray(body.entries)) throw badRequest("entries: массив")
  const entries = body.entries.slice(0, 200).map((e) => {
    const o = (e ?? {}) as Record<string, unknown>
    return { gatewayId: gw.gatewayId, meterId: typeof o.meterId === "string" && /^[0-9a-f-]{36}$/.test(o.meterId) ? o.meterId : null, level: String(o.level ?? "info"), code: String(o.code ?? "info"), message: typeof o.message === "string" ? o.message : null, details: o.details ?? {} }
  })
  await withOrg(gw.orgId, (c) => writeConnectionLog(c, gw.orgId, entries))
  return { ok: true, written: entries.length }
})
