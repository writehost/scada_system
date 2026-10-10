import { api } from "@/lib/server/http.ts"
import { PROTOCOLS } from "@/lib/domain/protocols.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) =>
  ctx.tx(async (c) => ({
    models: (await c.query("SELECT * FROM ems_catalog_models WHERE is_public ORDER BY sort, manufacturer, model")).rows,
    protocols: PROTOCOLS,
  })),
)
