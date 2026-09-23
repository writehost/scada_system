import { loadBoard } from "@/lib/wms/yms/service"
import { withYms } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withYms(req, "yms.read", (ctx) => loadBoard(ctx))
}
