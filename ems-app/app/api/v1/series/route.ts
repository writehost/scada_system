import { api } from "@/lib/server/http.ts"
import { buildSeries } from "@/lib/server/series-query.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx) => ctx.tx((c) => buildSeries(c, ctx.orgId, ctx.url)))
