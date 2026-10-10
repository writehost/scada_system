"use client"

import { useState } from "react"
import { api, useApi } from "@/lib/client/api"
import { RESOURCE_LABEL } from "@/lib/client/format"
import { Badge, Button, Dialog, ErrorBox, Field, Input, Notice, Panel, Segmented, Skeleton, Textarea, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { COMPAT } from "@/components/ems/meter-wizard"

type Model = { model_id: string; manufacturer: string; model: string; device_kind: string; resource: string | null; protocols: string[]; requires: string | null; power: string | null; transport: string | null; instruction: string; compatibility: string }
const KIND: Record<string, string> = { meter: "Счётчик", gateway: "Шлюз", pulse_module: "Импульсный модуль", sensor: "Датчик", converter: "Преобразователь" }
const PROTO: Record<string, string> = { manual: "ручной ввод", modbus_tcp: "Modbus TCP", http_push: "HTTP", mqtt: "MQTT", opc_ua: "OPC UA", mbus: "M-Bus" }

export default function CatalogPage() {
  const { me, can } = useApp()
  const toast = useToast()
  const q = useApi<{ models: Model[]; protocols: Array<{ code: string; name: string; status: string; via: string; note: string }> }>("/api/v1/catalog")
  const reqs = useApi<{ requests: Array<{ request_id: string; manufacturer: string; model: string; quantity: number; status: string; created_at: string }> }>("/api/v1/catalog/requests")
  const [filter, setFilter] = useState<"all" | "auto" | "manual">("all")
  const [order, setOrder] = useState<Model | null>(null)
  const list = (q.data?.models ?? []).filter((m) => (filter === "all" ? true : filter === "auto" ? !m.protocols.includes("manual") : m.protocols.includes("manual")))
  return (
    <div className="space-y-4">
      <PageHeader title="Каталог совместимых приборов" subtitle="Что можно подключить к SCADA EMS и что для этого нужно" />
      <Notice>Обычный счётчик без сетевого интерфейса нельзя подключить к облаку напрямую: нужен импульсный модуль, преобразователь или шлюз. Если прибора нет в списке — данные можно вносить вручную.</Notice>
      <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "Все" }, { value: "auto", label: "Автоматический сбор" }, { value: "manual", label: "Ручной ввод" }]} />
      {!q.data ? (
        <Skeleton className="h-48" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => (
            <Panel key={m.model_id} title={`${m.manufacturer} · ${m.model}`} subtitle={`${KIND[m.device_kind]}${m.resource ? ` · ${RESOURCE_LABEL[m.resource]}` : ""}`} actions={<Badge tone={COMPAT[m.compatibility].tone}>{COMPAT[m.compatibility].label}</Badge>}>
              <p className="text-[13px] text-muted-foreground">{m.instruction}</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                <dt className="text-muted-foreground">Протоколы</dt>
                <dd>{m.protocols.map((p) => PROTO[p] ?? p).join(", ")}</dd>
                {m.requires ? (<><dt className="text-muted-foreground">Требуется</dt><dd>{m.requires}</dd></>) : null}
                {m.transport ? (<><dt className="text-muted-foreground">Передача</dt><dd>{m.transport}</dd></>) : null}
              </dl>
              {m.compatibility !== "planned" && m.compatibility !== "manual_only" && can("sites.write") ? (
                <Button className="mt-3" size="sm" variant="outline" onClick={() => setOrder(m)}>Заявка на подбор и покупку</Button>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
      <Panel title="Поддержка протоколов" bodyClassName="p-0">
        <table className="ems-table">
          <tbody>
            {(q.data?.protocols ?? []).map((p) => (
              <tr key={p.code}>
                <td className="font-medium">{p.name}</td>
                <td><Badge tone={p.status === "supported" ? "success" : "neutral"}>{p.status === "supported" ? "реализовано" : "в планах"}</Badge></td>
                <td className="hidden text-xs text-muted-foreground md:table-cell">{p.via}. {p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {reqs.data?.requests.length ? (
        <Panel title="Мои заявки" bodyClassName="p-0">
          <ul className="divide-y divide-border/60">{reqs.data.requests.map((r) => <li key={r.request_id} className="px-4 py-2 text-[13px]">{r.manufacturer} {r.model} × {r.quantity} · <Badge>{r.status === "new" ? "новая" : r.status === "processing" ? "в работе" : "закрыта"}</Badge></li>)}</ul>
        </Panel>
      ) : null}
      {order ? <OrderDialog model={order} defaultName={me.user.name} defaultEmail={me.user.email ?? ""} onClose={() => setOrder(null)} onDone={() => { reqs.reload(); toast("Заявка отправлена") }} /> : null}
    </div>
  )
}

function OrderDialog({ model, defaultName, defaultEmail, onClose, onDone }: { model: Model; defaultName: string; defaultEmail: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ quantity: "1", contactName: defaultName, contactPhone: "", contactEmail: defaultEmail, comment: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title={`${model.manufacturer} ${model.model}`} description="Онлайн-оформление покупки пока не подключено: менеджер свяжется для подбора и счёта. Оборудование оплачивается отдельно от подписки."
      footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} onClick={async () => { setBusy(true); setError(null); try { await api("/api/v1/catalog/requests", { body: { ...f, modelId: model.model_id } }); onDone(); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) } }}>Отправить заявку</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Количество"><Input inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
        <Field label="Контактное лицо"><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></Field>
        <Field label="Телефон"><Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></Field>
        <Field label="Email"><Input value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></Field>
        <Field label="Комментарий" className="sm:col-span-2"><Textarea value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} placeholder="Какие счётчики уже стоят, есть ли RS-485, сколько точек учёта" /></Field>
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
