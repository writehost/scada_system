import { cmdOf, scanInput, withDriverState } from "@/lib/route/api"
import { str, withRouteTx } from "@/lib/route/http"
import * as T from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Проверить SSCC/HU палеты в WMS. Неверная палета не принимается, задание не меняется. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.drive", async (ctx) => {
    void str
    void scanInput
    const res = await T.scanPallet(ctx.client, cmdOf(ctx, id), scanInput(ctx))
    return withDriverState(ctx, res as Record<string, unknown>)
  })
}
