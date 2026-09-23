import { addDiscrepancy } from "@/lib/wms/yms/service"
import { withYmsTx } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withYmsTx(req, "yms.read", (yms) => addDiscrepancy(yms, id))
}
