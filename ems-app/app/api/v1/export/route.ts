import { api } from "@/lib/server/http.ts"
import { buildSeries } from "@/lib/server/series-query.ts"
import { toCsv } from "@/lib/services/analytics.ts"
import { unitLabel } from "@/lib/domain/units.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = api({ perm: "read", rate: 60 }, async (ctx) =>
  ctx.tx(async (c) => {
    const data = await buildSeries(c, ctx.orgId, ctx.url)
    const times = [...new Set(data.series.flatMap((s) => s.points.map((p) => p.t)))].sort()
    const cols = [{ key: "t", title: "Период" }]
    const rows: Array<Record<string, unknown>> = times.map((t) => ({ t }))
    data.series.forEach((s, i) => {
      cols.push({ key: `s${i}`, title: `${s.label}${s.unit && !s.label.includes(",") ? `, ${unitLabel(s.unit)}` : ""}` })
      cols.push({ key: `a${i}`, title: "в т.ч. распределено между показаниями" })
      const m = new Map(s.points.map((p) => [p.t, p]))
      rows.forEach((r) => {
        const p = m.get(r.t as string)
        r[`s${i}`] = p?.v == null ? "" : Math.round(p.v * 1e6) / 1e6
        r[`a${i}`] = p?.allocated ? Math.round(p.allocated * 1e6) / 1e6 : ""
      })
    })
    return new Response(toCsv(rows, cols), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="scada-ems-${new Date(data.from).toISOString().slice(0, 10)}_${new Date(data.to).toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  }),
)
