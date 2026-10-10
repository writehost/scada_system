import { publicApi } from "@/lib/server/http.ts"
import { withSystem } from "@/lib/server/db.ts"
import { reqStr, str } from "@/lib/server/validate.ts"
import { HttpError } from "@/lib/server/errors.ts"
import { enrollGateway } from "@/lib/services/gateways.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ rate: 10, rateKey: "gw-enroll" }, async ({ body, ip }) => {
  const code = reqStr(body, "code", "Код регистрации", 40)
  const r = await withSystem((c) => enrollGateway(c, code, { agentVersion: str(body, "agentVersion", "Версия", { max: 40 }), ip }))
  if (!r.ok) throw new HttpError(401, "enrollment_invalid", "Код регистрации неверен, истёк или уже использован")
  return { gatewayId: r.gatewayId, secret: r.secret }
})
