import { cmdOf, scanInput, withDriverState } from "@/lib/route/api"
import { str, withRouteTx } from "@/lib/route/http"
import * as T from "@/lib/route/tasks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Запросить новый адрес через WMS (адрес занят). Водитель — своё задание, диспетчер — любое. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.read", async (ctx) => {
    void str
    void scanInput
    const res = await T.requestNewAddress(ctx.client, cmdOf(ctx, id), str(ctx.body, "reason", 240))
    return withDriverState(ctx, res as Record<string, unknown>)
  })
}
