import { assignDockJob } from "@/lib/wms/yms/ops"
import { withYmsTx } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withYmsTx(req, "yms.read", (yms) => assignDockJob(yms, id))
}
