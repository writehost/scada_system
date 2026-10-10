"use client"

import { use, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, KeyRound, RefreshCw, Trash2 } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { dateTimeRu, relative } from "@/lib/client/format"
import { Badge, Button, ConfirmDialog, Dialog, ErrorBox, Panel, Skeleton } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { GatewayInstall, GatewayStatus } from "@/components/ems/gateway-install"

type Detail = {
  gateway: { gateway_id: string; name: string; status: string; site_name: string; last_seen_at: string | null; last_ip: string | null; agent_version: string | null; enrolled_at: string | null; secret_rotated_at: string | null; diagnostics: Record<string, unknown> & { meters?: Array<{ meterId: string; lastOkAt?: string; lastError?: string; lastErrorAt?: string }> } }
  log: Array<{ log_id: number; level: string; code: string; message: string; created_at: string; meter_name: string | null }>
  meters: Array<{ meter_id: string; name: string; connection_params: Record<string, unknown>; poll_interval_sec: number; status: string }>
  jobs: Array<{ job_id: string; kind: string; status: string; error: string | null; created_at: string }>
}

export default function GatewayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { can } = useApp()
  const q = useApi<Detail>(`/api/v1/gateways/${id}`)
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null)
  const [confirm, setConfirm] = useState<null | "revoke" | "archive">(null)
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  if (!q.data) return <Skeleton className="h-64" />
  const g = q.data.gateway
  const d = g.diagnostics as Record<string, number | string | null | undefined>
  return (
    <div className="space-y-4">
      <Link href="/gateways" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Шлюзы
      </Link>
      <PageHeader
        title={g.name}
        subtitle={<span className="flex items-center gap-2">{g.site_name} <GatewayStatus status={g.status} /></span>}
        actions={
          can("devices.write") ? (
            <>
              <Button variant="outline" size="sm" onClick={q.reload}>
                <RefreshCw /> Обновить
              </Button>
              {g.status === "pending" ? (
                <Button size="sm" onClick={async () => setCode(await api(`/api/v1/gateways/${id}/enrollment`, { body: {} }))}>
                  Новый код регистрации
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirm("revoke")}>
                  <KeyRound /> Отозвать секрет
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirm("archive")}>
                <Trash2 /> Удалить
              </Button>
            </>
          ) : null
        }
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Состояние">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Последняя связь</dt>
            <dd>{g.last_seen_at ? `${relative(g.last_seen_at)} (${dateTimeRu(g.last_seen_at)})` : "—"}</dd>
            <dt className="text-muted-foreground">IP</dt>
            <dd className="font-mono text-xs">{g.last_ip ?? "—"}</dd>
            <dt className="text-muted-foreground">Агент</dt>
            <dd>{g.agent_version ?? "—"} {d.os ? <span className="text-xs text-muted-foreground">· {String(d.os)}</span> : null}</dd>
            <dt className="text-muted-foreground">Буфер</dt>
            <dd>
              {String(d.bufferItems ?? 0)} показаний, {Math.round(Number(d.bufferBytes ?? 0) / 1024)} КБ из {Math.round(Number(d.bufferLimitBytes ?? 0) / 1048576)} МБ
              {Number(d.droppedItems ?? 0) > 0 ? <span className="block text-xs text-destructive">потеряно при переполнении: {String(d.droppedItems)}</span> : null}
            </dd>
            <dt className="text-muted-foreground">Отправка</dt>
            <dd>{d.lastUploadAt ? relative(String(d.lastUploadAt)) : "—"}</dd>
            <dt className="text-muted-foreground">Секрет выдан</dt>
            <dd>{dateTimeRu(g.secret_rotated_at)}</dd>
          </dl>
        </Panel>
        <Panel title="Приборы шлюза" className="lg:col-span-2" bodyClassName="p-0">
          <ul className="divide-y divide-border/60">
            {q.data.meters.map((m) => {
              const st = g.diagnostics.meters?.find((x) => x.meterId === m.meter_id)
              return (
                <li key={m.meter_id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
                  <Link href={`/meters/${m.meter_id}`} className="font-medium hover:underline">
                    {m.name}
                  </Link>
                  <span className="font-mono text-xs text-muted-foreground">
                    {String(m.connection_params.host)}:{String(m.connection_params.port)}/{String(m.connection_params.unitId)} · {m.poll_interval_sec} с
                  </span>
                  {st?.lastError ? <Badge tone="danger">{st.lastError}</Badge> : st?.lastOkAt ? <Badge tone="success">опрос {relative(st.lastOkAt)}</Badge> : null}
                </li>
              )
            })}
            {!q.data.meters.length ? <li className="px-4 py-3 text-[13px] text-muted-foreground">Приборы не подключены.</li> : null}
          </ul>
        </Panel>
      </div>
      <Panel title="Журнал диагностики" bodyClassName="p-0">
        <ul className="max-h-96 divide-y divide-border/60 overflow-auto">
          {q.data.log.map((l) => (
            <li key={l.log_id} className="px-4 py-2 text-[13px]">
              <Badge tone={l.level === "error" ? "danger" : l.level === "warning" ? "warning" : "neutral"}>{l.code}</Badge> {l.message}
              <span className="block text-[11px] text-muted-foreground">
                {dateTimeRu(l.created_at)}
                {l.meter_name ? ` · ${l.meter_name}` : ""}
              </span>
            </li>
          ))}
          {!q.data.log.length ? <li className="px-4 py-3 text-[13px] text-muted-foreground">Записей нет.</li> : null}
        </ul>
      </Panel>
      <Dialog open={Boolean(code)} onClose={() => setCode(null)} size="lg" title="Регистрация шлюза">
        {code ? <GatewayInstall code={code.code} expiresAt={code.expiresAt} /> : null}
      </Dialog>
      <ConfirmDialog
        open={confirm === "revoke"}
        onClose={() => setConfirm(null)}
        title="Отозвать секрет шлюза?"
        text="Шлюз сразу потеряет доступ к облаку (данные будут копиться в его буфере). Для повторного подключения понадобится новый одноразовый код — используйте при утечке или замене компьютера."
        confirmLabel="Отозвать"
        onConfirm={async () => {
          setCode(await api(`/api/v1/gateways/${id}/revoke`, { body: {} }))
          q.reload()
        }}
      />
      <ConfirmDialog
        open={confirm === "archive"}
        onClose={() => setConfirm(null)}
        title="Удалить шлюз?"
        text="Возможно только без действующих приборов. История показаний приборов сохраняется."
        confirmText={g.name}
        confirmLabel="Удалить"
        onConfirm={async () => {
          await api(`/api/v1/gateways/${id}?confirm=${encodeURIComponent(g.name)}`, { method: "DELETE" })
          router.replace("/gateways")
        }}
      />
    </div>
  )
}
