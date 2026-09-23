import { createVisit } from "@/lib/wms/yms/service"
import { withYmsTx } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  return withYmsTx(req, "yms.read", (ctx) => createVisit(ctx))
}
