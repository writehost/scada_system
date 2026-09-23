import { listFleetForSite } from "@/lib/wms/yms/ops"
import { withYms } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withYms(req, "yms.read", (yms) => listFleetForSite(yms))
}
