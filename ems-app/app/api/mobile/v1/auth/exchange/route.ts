// Мобильный клиент SCADA Mobile входит в SCADA ID сам и обменивает access token
// SCADA ID на токен EMS (Bearer ems1.…), действующий 30 дней и отзываемый.
import { completeLogin } from "@/lib/server/login.ts"
import { publicApi } from "@/lib/server/http.ts"
import { reqStr } from "@/lib/server/validate.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ rate: 20 }, async ({ req, body, ip }) => {
  const accessToken = reqStr(body, "accessToken", "Токен SCADA ID", 8000)
  const login = await completeLogin(accessToken, { kind: "mobile", userAgent: req.headers.get("user-agent"), ip })
  return { token: login.token, tokenType: "Bearer", expiresAt: login.expiresAt, orgId: login.activeOrgId }
})
