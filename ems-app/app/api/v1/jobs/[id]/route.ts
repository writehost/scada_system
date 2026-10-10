import { api } from "@/lib/server/http.ts"
import { idParam } from "@/lib/server/params.ts"
import { notFound } from "@/lib/server/errors.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read" }, async (ctx, p) =>
  ctx.tx(async (c) => {
    const r = await c.query("SELECT job_id, gateway_id, kind, status, result, error, created_at, picked_at, finished_at FROM ems_gateway_jobs WHERE job_id = $1 AND org_id = $2", [idParam(p.id), ctx.orgId])
    if (!r.rows[0]) throw notFound("Задание")
    return { job: r.rows[0] }
  }),
)
