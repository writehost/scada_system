"use client"

import Link from "next/link"
import { qs, useApi } from "@/lib/client/api"
import { num, relative, RESOURCE_LABEL } from "@/lib/client/format"
import { Badge, ErrorBox, Panel, Skeleton } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { GatewayStatus } from "@/components/ems/gateway-install"

const STATE: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  ok: { label: "в порядке", tone: "success" },
  attention: { label: "есть события", tone: "warning" },
  stale: { label: "нет свежих данных", tone: "danger" },
  no_data: { label: "нет данных", tone: "neutral" },
}

export default function HealthPage() {
  const { siteId } = useApp()
  const q = useApi<{ meters: Array<{ meterId: string; name: string; resource: string; connection: string; lastAt: string | null; lastValue: number | null; state: string }>; gateways: Array<{ gateway_id: string; name: string; status: string; last_seen_at: string | null; agent_version: string | null; meters: number; site_name: string; diagnostics: { bufferItems?: number } }> }>(`/api/v1/health${qs({ siteId })}`)
  return (
    <div className="space-y-4">
      <PageHeader title="Состояние оборудования" subtitle="Шлюзы и приборы: связь, свежесть данных, открытые события" />
      <ErrorBox error={q.error} onRetry={q.reload} />
      {!q.data ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <Panel title="Шлюзы" bodyClassName="p-0">
            {q.data.gateways.length ? (
              <table className="ems-table">
                <tbody>
                  {q.data.gateways.map((g) => (
                    <tr key={g.gateway_id}>
                      <td><Link href={`/gateways/${g.gateway_id}`} className="font-medium hover:underline">{g.name}</Link><p className="text-xs text-muted-foreground">{g.site_name}</p></td>
                      <td><GatewayStatus status={g.status} /></td>
                      <td className="text-xs text-muted-foreground">{relative(g.last_seen_at)}</td>
                      <td className="ems-num text-right text-[13px]">{g.meters} приб. · буфер {g.diagnostics?.bufferItems ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="p-4 text-[13px] text-muted-foreground">Шлюзов нет.</p>
            )}
          </Panel>
          <Panel title="Приборы" bodyClassName="p-0">
            <table className="ems-table">
              <thead>
                <tr><th>Прибор</th><th>Состояние</th><th className="hidden sm:table-cell">Последние данные</th><th className="text-right">Показание</th></tr>
              </thead>
              <tbody>
                {q.data.meters.map((m) => (
                  <tr key={m.meterId}>
                    <td><Link href={`/meters/${m.meterId}`} className="font-medium hover:underline">{m.name}</Link><p className="text-xs text-muted-foreground">{RESOURCE_LABEL[m.resource]} · {m.connection === "manual" ? "ручной ввод" : m.connection === "http_push" ? "HTTP" : "Modbus"}</p></td>
                    <td><Badge tone={STATE[m.state].tone}>{STATE[m.state].label}</Badge></td>
                    <td className="hidden text-xs text-muted-foreground sm:table-cell">{relative(m.lastAt)}</td>
                    <td className="ems-num text-right">{num(m.lastValue, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </>
      )}
    </div>
  )
}
