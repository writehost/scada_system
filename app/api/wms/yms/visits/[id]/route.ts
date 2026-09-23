import { getVisitDetail } from "@/lib/wms/yms/service"
import { withYms } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withYms(req, "yms.read", (yms) => getVisitDetail(yms, id))
}
