import { publicApi } from "@/lib/server/http.ts"
import { withSystem } from "@/lib/server/db.ts"
import { gatewayFrom } from "@/lib/server/gateway-auth.ts"
import { rotateGatewaySecret } from "@/lib/services/gateways.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const POST = publicApi({ rate: 10, rateKey: "gw-rotate" }, async ({ req }) => {
  const gw = await gatewayFrom(req)
  const secret = await withSystem((c) => rotateGatewaySecret(c, gw))
  return { gatewayId: gw.gatewayId, secret }
})
