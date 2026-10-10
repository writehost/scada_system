"use client"

import { useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { qs, useApi } from "@/lib/client/api"
import { num, pct, qty } from "@/lib/client/format"
import { Checkbox, ErrorBox, Field, Input, Panel, Segmented, Skeleton } from "@/components/ui"
import { NeedSite, PageHeader, useApp } from "@/components/ems/shell"
import { ChartFrame } from "@/components/ems/charts"

type P = { t: string; v: number | null }

export default function ComparePage() {
  return <NeedSite>{(siteId) => <Compare siteId={siteId} />}</NeedSite>
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const ms = (s: string, end = false) => new Date(`${s}T00:00:00`).getTime() + (end ? 86400000 : 0)

function Compare({ siteId }: { siteId: string }) {
  const { sites } = useApp()
  const [mode, setMode] = useState<"periods" | "sites">("periods")
  const [resource, setResource] = useState("electricity")
  const now = new Date()
  const [a, setA] = useState({ from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) })
  const [b, setB] = useState({ from: iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: iso(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())) })
  const [siteIds, setSiteIds] = useState<string[]>(sites.slice(0, 3).map((s) => s.site_id))
  const unit = resource === "electricity" ? "kWh" : "m3"
  const q = useApi<{ a?: { points: P[]; total: number }; b?: { points: P[]; total: number }; items?: Array<{ siteId: string; name: string; total: number; days: number }> }>(
    mode === "periods" ? `/api/v1/series/compare${qs({ mode, siteId, resource, aFrom: ms(a.from), aTo: ms(a.to, true), bFrom: ms(b.from), bTo: ms(b.to, true) })}` : siteIds.length ? `/api/v1/series/compare${qs({ mode, siteIds: siteIds.join(","), resource, from: ms(a.from), to: ms(a.to, true) })}` : null,
  )
  const rows = useMemo(() => {
    if (!q.data?.a || !q.data?.b) return []
    const n = Math.max(q.data.a.points.length, q.data.b.points.length)
    return Array.from({ length: n }, (_, i) => ({ day: i + 1, A: q.data!.a!.points[i]?.v ?? null, B: q.data!.b!.points[i]?.v ?? null }))
  }, [q.data])
  return (
    <div className="space-y-4">
      <PageHeader title="Сравнения" subtitle="Сравнение периодов одного объекта или нескольких объектов за период" />
      <Panel>
        <div className="flex flex-wrap items-end gap-3">
          <Segmented value={mode} onChange={setMode} options={[{ value: "periods", label: "Периоды" }, { value: "sites", label: "Объекты", disabled: sites.length < 2 }]} />
          <Segmented value={resource} onChange={setResource} options={[{ value: "electricity", label: "Электричество" }, { value: "cold_water", label: "ХВС" }, { value: "hot_water", label: "ГВС" }]} />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={mode === "periods" ? "Период A" : "Период"}>
            <div className="flex gap-1">
              <Input type="date" value={a.from} onChange={(e) => setA({ ...a, from: e.target.value })} />
              <Input type="date" value={a.to} onChange={(e) => setA({ ...a, to: e.target.value })} />
            </div>
          </Field>
          {mode === "periods" ? (
            <Field label="Период B">
              <div className="flex gap-1">
                <Input type="date" value={b.from} onChange={(e) => setB({ ...b, from: e.target.value })} />
                <Input type="date" value={b.to} onChange={(e) => setB({ ...b, to: e.target.value })} />
              </div>
            </Field>
          ) : (
            <Field label="Объекты">
              <div className="flex flex-wrap gap-3">
                {sites.map((s) => (
                  <Checkbox key={s.site_id} checked={siteIds.includes(s.site_id)} onChange={(v) => setSiteIds(v ? [...siteIds, s.site_id] : siteIds.filter((x) => x !== s.site_id))} label={s.name} />
                ))}
              </div>
            </Field>
          )}
        </div>
      </Panel>
      <ErrorBox error={q.error} onRetry={q.reload} />
      {mode === "periods" ? (
        <Panel title="Посуточно" subtitle={q.data?.a && q.data.b ? `A: ${qty(q.data.a.total, unit)} · B: ${qty(q.data.b.total, unit)} · разница ${q.data.b.total > 0 ? pct(((q.data.a.total - q.data.b.total) / q.data.b.total) * 100) : "—"}` : undefined}>
          <ChartFrame name="сравнение-периодов">
            {() =>
              !q.data ? (
                <Skeleton className="h-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="oklch(0.88 0.02 90)" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} label={{ value: "день периода", position: "insideBottomRight", fontSize: 11, offset: -2 }} />
                    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => num(v, 1)} />
                    <Tooltip formatter={(v: number) => (v == null ? "нет данных" : qty(v, unit))} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="A" name="Период A" fill="oklch(0.68 0.16 118)" isAnimationActive={false} />
                    <Bar dataKey="B" name="Период B" fill="oklch(0.55 0.12 250)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )
            }
          </ChartFrame>
        </Panel>
      ) : (
        <Panel title="Объекты за период" bodyClassName="p-0">
          {!q.data?.items ? (
            <Skeleton className="m-4 h-24" />
          ) : (
            <table className="ems-table">
              <thead>
                <tr>
                  <th>Объект</th>
                  <th className="text-right">Итого</th>
                  <th className="text-right">В сутки</th>
                  <th className="text-right">Дней с данными</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((it) => (
                  <tr key={it.siteId}>
                    <td className="font-medium">{it.name}</td>
                    <td className="ems-num text-right">{qty(it.total, unit)}</td>
                    <td className="ems-num text-right">{it.days ? qty(it.total / it.days, unit) : "—"}</td>
                    <td className="ems-num text-right">{it.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}
    </div>
  )
}
