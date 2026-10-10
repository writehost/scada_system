"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { qs, useApi } from "@/lib/client/api"
import { monthName, num, unit } from "@/lib/client/format"
import { ErrorBox, Panel, Skeleton } from "@/components/ui"
import { NeedSite, PageHeader } from "@/components/ems/shell"
import type { Series } from "@/components/ems/charts"

export default function ReportsPage() {
  return <NeedSite>{(siteId, site) => <Reports siteId={siteId} name={site.name} />}</NeedSite>
}

function Reports({ siteId, name }: { siteId: string; name: string }) {
  // Период фиксируется при открытии страницы, иначе каждый рендер менял бы запрос.
  const [{ from, to }] = useState(() => {
    const now = new Date()
    return { from: new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime(), to: now.getTime() + 60000 }
  })
  const params = { siteId, from, to, resolution: "month", resources: "electricity,cold_water,hot_water,heat,gas" }
  const q = useApi<{ series: Series[] }>(`/api/v1/series${qs(params)}`)
  const cost = useApi<{ series: Series[] }>(`/api/v1/series${qs({ ...params, metric: "cost" })}`)
  const months = [...new Set((q.data?.series ?? []).flatMap((s) => s.points.map((p) => p.t)))].sort().reverse()
  const all = [...(q.data?.series ?? []), ...(cost.data?.series ?? [])]
  return (
    <div className="space-y-4">
      <PageHeader
        title="Отчёты"
        subtitle={`${name}: помесячный расход и стоимость за 12 месяцев`}
        actions={
          <>
            <a href={`/api/v1/export${qs(params)}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
              <Download className="size-4" /> Расход CSV
            </a>
            <a href={`/api/v1/export${qs({ ...params, metric: "cost" })}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted">
              <Download className="size-4" /> Стоимость CSV
            </a>
          </>
        }
      />
      <ErrorBox error={q.error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-40" />
        ) : !all.length ? (
          <p className="p-4 text-[13px] text-muted-foreground">Нет данных за период.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="ems-table">
              <thead>
                <tr>
                  <th>Месяц</th>
                  {all.map((s) => (
                    <th key={s.key} className="text-right">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => (
                  <tr key={m}>
                    <td className="whitespace-nowrap">{monthName(m)}</td>
                    {all.map((s) => {
                      const p = s.points.find((x) => x.t === m)
                      return (
                        <td key={s.key} className="ems-num text-right">
                          {p?.v == null ? "—" : `${num(p.v, s.unit === "RUB" ? 0 : s.unit === "m3" ? 2 : 0)}${s.unit === "RUB" ? " ₽" : ""}`}
                          {p?.allocated ? <span className="block text-[10px] text-muted-foreground">распр. {num(p.allocated, 1)}</span> : null}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs text-muted-foreground">Единицы: {[...new Set(all.map((s) => unit(s.unit)))].join(", ")}. «распр.» — часть, распределённая между редкими показаниями на границе месяцев.</p>
    </div>
  )
}
