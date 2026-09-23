import { listYard, saveYardObject } from "@/lib/wms/yms/service"
import { withYms, withYmsTx } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withYms(req, "yms.read", (ctx) => listYard(ctx))
}

export async function POST(req: Request) {
  return withYmsTx(req, "yms.yard.write", (ctx) => saveYardObject(ctx))
}
