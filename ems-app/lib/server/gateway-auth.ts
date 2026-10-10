import { withSystem } from "./db.ts"
import { authenticateGateway, type GatewayAuth } from "../services/gateways.ts"
import { clientIp } from "./http.ts"
import { rateLimit } from "./ratelimit.ts"
import { HttpError } from "./errors.ts"

export async function gatewayFrom(req: Request, limitPerMin = 240): Promise<GatewayAuth> {
  const ip = clientIp(req)
  const gw = await withSystem((c) => authenticateGateway(c, req.headers.get("authorization"), ip))
  const rl = rateLimit(`gw:${gw.gatewayId}`, limitPerMin)
  if (!rl.ok) throw new HttpError(429, "rate_limited", "Слишком часто", { retryAfterSec: rl.retryAfterSec })
  return gw
}
