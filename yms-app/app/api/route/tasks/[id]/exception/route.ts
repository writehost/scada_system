import { cmdOf, scanInput, withDriverState } from "@/lib/route/api"
import { str, withRouteTx } from "@/lib/route/http"
import * as T from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Кнопка «Проблема»: фиксирует случай в журнале и применяет действие по типу. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.drive", async (ctx) => {
    void str
    void scanInput
    const res = await T.reportProblem(ctx.client, cmdOf(ctx, id), { kind: str(ctx.body, "kind", 40), note: str(ctx.body, "note", 500) })
    return withDriverState(ctx, res as Record<string, unknown>)
  })
}
