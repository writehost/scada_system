import { changeTractor, setTrailer } from "@/lib/wms/yms/ops"
import { withYmsTx } from "@/lib/wms/yms/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return withYmsTx(req, "yms.read", async (yms) => {
    if (yms.body.trailerPlate !== undefined && yms.body.plate === undefined) return setTrailer(yms, id)
    if (typeof yms.body.trailerPlate === "string" && typeof yms.body.plate === "string") {
      await changeTractor(yms, id)
      return setTrailer(yms, id)
    }
    return changeTractor(yms, id)
  })
}
