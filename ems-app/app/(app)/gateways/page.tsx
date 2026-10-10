"use client"

import { useState } from "react"
import Link from "next/link"
import { Cpu, Plus } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { relative } from "@/lib/client/format"
import { Button, Dialog, Empty, ErrorBox, Field, Input, Panel, Select, Skeleton } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { GatewayInstall, GatewayStatus } from "@/components/ems/gateway-install"

type Gw = { gateway_id: string; name: string; status: string; site_name: string; last_seen_at: string | null; agent_version: string | null; meters: number; diagnostics: { bufferItems?: number; droppedItems?: number } }

export default function GatewaysPage() {
  const { can, sites, siteId } = useApp()
  const q = useApi<{ gateways: Gw[] }>("/api/v1/gateways")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: "Шлюз 1", siteId: siteId ?? "" })
  const [created, setCreated] = useState<{ code: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <div>
      <PageHeader title="Контроллеры и шлюзы" subtitle="SCADA EMS Gateway опрашивает приборы в локальной сети и отправляет данные в облако" actions={can("devices.write") ? <Button onClick={() => setOpen(true)}><Plus /> Добавить шлюз</Button> : null} />
      <ErrorBox error={q.error} onRetry={q.reload} />
      <Panel bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-24" />
        ) : !q.data.gateways.length ? (
          <Empty icon={Cpu} title="Шлюзов нет" text="Шлюз нужен для приборов Modbus (электросчётчики, импульсные модули, PLC). Для ручного ввода и HTTP push он не требуется." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ems-table">
              <thead>
                <tr>
                  <th>Шлюз</th>
                  <th>Состояние</th>
                  <th className="text-right">Приборы</th>
                  <th className="hidden md:table-cell">Буфер</th>
                  <th className="hidden md:table-cell">Версия</th>
                </tr>
              </thead>
              <tbody>
                {q.data.gateways.map((g) => (
                  <tr key={g.gateway_id}>
                    <td>
                      <Link href={`/gateways/${g.gateway_id}`} className="font-medium hover:underline">
                        {g.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{g.site_name}</p>
                    </td>
                    <td>
                      <GatewayStatus status={g.status} />
                      <p className="text-xs text-muted-foreground">{g.last_seen_at ? relative(g.last_seen_at) : "ещё не подключался"}</p>
                    </td>
                    <td className="ems-num text-right">{g.meters}</td>
                    <td className="hidden text-[13px] md:table-cell">
                      {g.diagnostics?.bufferItems ?? 0} показ.
                      {g.diagnostics?.droppedItems ? <span className="block text-xs text-destructive">потеряно при переполнении: {g.diagnostics.droppedItems}</span> : null}
                    </td>
                    <td className="hidden text-xs text-muted-foreground md:table-cell">{g.agent_version ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false)
          setCreated(null)
          q.reload()
        }}
        size="lg"
        title={created ? "Установите агент" : "Новый шлюз"}
        footer={
          created ? null : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Отмена
              </Button>
              <Button
                loading={busy}
                disabled={!form.name.trim() || !form.siteId}
                onClick={async () => {
                  setBusy(true)
                  setError(null)
                  try {
                    setCreated(await api<{ code: string; expiresAt: string }>("/api/v1/gateways", { body: form }))
                  } catch (e) {
                    setError(e as Error)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                Создать и получить код
              </Button>
            </>
          )
        }
      >
        {created ? (
          <GatewayInstall code={created.code} expiresAt={created.expiresAt} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Название">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Площадка">
              <Select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
                {sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <ErrorBox error={error} />
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
