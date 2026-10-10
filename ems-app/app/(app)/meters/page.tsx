"use client"

import { useState } from "react"
import Link from "next/link"
import { Gauge, Plus } from "lucide-react"
import { useApi, qs } from "@/lib/client/api"
import { num, relative, RESOURCE_LABEL, unit } from "@/lib/client/format"
import { Badge, Empty, ErrorBox, Panel, Segmented, Skeleton } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

type MeterRow = { meter_id: string; site_name: string; node_name: string | null; resource: string; name: string; serial_number: string | null; connection: string; gateway_name: string | null; status: string; open_events: number; channels: Array<{ channelId: number; name: string; unit: string; lastValue: number | null; lastAt: string | null; measureKind: string; decimals: number }> }

const CONN: Record<string, string> = { manual: "Ручной ввод", modbus_tcp: "Modbus TCP", http_push: "HTTP push" }

export default function MetersPage() {
  const { siteId, can, sites } = useApp()
  const [scope, setScope] = useState<"site" | "all">("site")
  const [status, setStatus] = useState<"active" | "all">("active")
  const q = useApi<{ meters: MeterRow[] }>(`/api/v1/meters${qs({ siteId: scope === "site" ? siteId : null, status })}`)
  return (
    <div>
      <PageHeader
        title="Счётчики"
        subtitle="Приборы учёта, каналы измерений и последние показания"
        actions={
          can("devices.write") ? (
            <Link href="/meters/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              <Plus className="size-4" /> Подключить прибор
            </Link>
          ) : null
        }
      />
      <div className="mb-3 flex flex-wrap gap-2">
        {sites.length > 1 ? <Segmented value={scope} onChange={setScope} options={[{ value: "site", label: "Текущий объект" }, { value: "all", label: "Все объекты" }]} /> : null}
        <Segmented value={status} onChange={setStatus} options={[{ value: "active", label: "Действующие" }, { value: "all", label: "Включая заменённые" }]} />
      </div>
      <ErrorBox error={q.error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {q.loading && !q.data ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : !q.data?.meters.length ? (
          <Empty icon={Gauge} title="Приборов нет" text="Добавьте счётчик: ручной ввод показаний, умный прибор с HTTP или Modbus через шлюз." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ems-table">
              <thead>
                <tr>
                  <th>Прибор</th>
                  <th className="hidden md:table-cell">Объект</th>
                  <th>Подключение</th>
                  <th>Последние показания</th>
                  <th className="hidden sm:table-cell">Обновлено</th>
                </tr>
              </thead>
              <tbody>
                {q.data.meters.map((m) => {
                  const last = m.channels.map((c) => c.lastAt).filter(Boolean).sort().at(-1) ?? null
                  return (
                    <tr key={m.meter_id} className="hover:bg-muted/30">
                      <td>
                        <Link href={`/meters/${m.meter_id}`} className="font-medium hover:underline">
                          {m.name}
                        </Link>
                        <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                          {RESOURCE_LABEL[m.resource]}
                          {m.serial_number ? ` · № ${m.serial_number}` : ""}
                          {m.status !== "active" ? <Badge tone="warning">{m.status === "replaced" ? "заменён" : m.status === "archived" ? "выведен" : "черновик"}</Badge> : null}
                          {m.open_events ? <Badge tone="danger">{m.open_events} соб.</Badge> : null}
                        </div>
                      </td>
                      <td className="hidden md:table-cell text-[13px]">
                        {m.site_name}
                        {m.node_name ? <span className="text-muted-foreground"> · {m.node_name}</span> : null}
                      </td>
                      <td className="text-[13px]">
                        {CONN[m.connection]}
                        {m.gateway_name ? <span className="block text-xs text-muted-foreground">{m.gateway_name}</span> : null}
                      </td>
                      <td className="ems-num text-[13px]">
                        {m.channels.map((c) => (
                          <div key={c.channelId}>
                            <span className="text-muted-foreground">{c.name}:</span> {c.lastValue == null ? "—" : `${num(c.lastValue, c.decimals)} ${unit(c.unit)}`}
                          </div>
                        ))}
                      </td>
                      <td className="hidden sm:table-cell text-xs text-muted-foreground">{relative(last)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
