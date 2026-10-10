"use client"

import { useState } from "react"
import { Building2, Pencil, Plus, Trash2 } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { SITE_KIND_LABEL } from "@/lib/client/format"
import { Badge, Button, ConfirmDialog, Dialog, Empty, ErrorBox, Field, Input, Panel, Select, Skeleton, useToast } from "@/components/ui"
import { PageHeader, useApp, type SiteRow } from "@/components/ems/shell"

type NodeRow = { node_id: string; parent_id: string | null; kind: string; name: string; code: string | null }
const NODE_KIND: Record<string, string> = { building: "Здание / цех", zone: "Зона", line: "Линия", cabinet: "Шкаф / щит", point: "Узел учёта", other: "Другое" }

export default function SitesPage() {
  const { sites, reloadSites, can, industrial } = useApp()
  const toast = useToast()
  const [edit, setEdit] = useState<SiteRow | null | undefined>(undefined)
  const [archive, setArchive] = useState<SiteRow | null>(null)
  const [selected, setSelected] = useState<string | null>(sites[0]?.site_id ?? null)
  return (
    <div className="space-y-4">
      <PageHeader title="Объекты" subtitle={industrial ? "Иерархия: площадка → здание → зона → линия → шкаф → прибор" : "Квартиры, дома, гаражи и мастерские"} actions={can("sites.write") ? <Button onClick={() => setEdit(null)}><Plus /> Объект</Button> : null} />
      {!sites.length ? (
        <Panel><Empty icon={Building2} title="Объектов нет" text="Добавьте первый объект." /></Panel>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[340px_1fr]">
          <Panel bodyClassName="p-0">
            <ul className="divide-y divide-border/60">
              {sites.map((s) => (
                <li key={s.site_id}>
                  <button type="button" onClick={() => setSelected(s.site_id)} className={`flex w-full items-start gap-2 px-4 py-2.5 text-left text-[13px] hover:bg-muted/40 ${selected === s.site_id ? "bg-muted/60" : ""}`}>
                    <Building2 className="mt-0.5 size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{SITE_KIND_LABEL[s.kind]} · {s.meters} приб.{s.open_events ? ` · ${s.open_events} соб.` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          {selected ? <SiteDetail key={selected} site={sites.find((s) => s.site_id === selected)!} onEdit={setEdit} onArchive={setArchive} /> : null}
        </div>
      )}
      {edit !== undefined ? <SiteDialog site={edit} onClose={() => setEdit(undefined)} onDone={() => { reloadSites(); toast("Сохранено") }} /> : null}
      <ConfirmDialog
        open={Boolean(archive)}
        onClose={() => setArchive(null)}
        title="Архивировать объект?"
        text="Объект и его приборы перестанут собирать данные. История измерений и платежей сохранится."
        confirmText={archive?.name}
        confirmLabel="Архивировать"
        onConfirm={async () => {
          await api(`/api/v1/sites/${archive!.site_id}?confirm=${encodeURIComponent(archive!.name)}`, { method: "DELETE" })
          reloadSites()
          setSelected(null)
        }}
      />
    </div>
  )
}

function SiteDetail({ site, onEdit, onArchive }: { site: SiteRow; onEdit: (s: SiteRow) => void; onArchive: (s: SiteRow) => void }) {
  const { can, industrial } = useApp()
  const q = useApi<{ nodes: NodeRow[] }>(`/api/v1/sites/${site.site_id}`)
  const [form, setForm] = useState({ name: "", kind: "building", parentId: "" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  const [del, setDel] = useState<NodeRow | null>(null)
  const nodes = q.data?.nodes ?? []
  const render = (parent: string | null, depth: number): React.ReactNode =>
    nodes
      .filter((n) => n.parent_id === parent)
      .map((n) => (
        <div key={n.node_id}>
          <div className="flex items-center gap-2 py-1 text-[13px]" style={{ paddingLeft: depth * 18 }}>
            <Badge>{NODE_KIND[n.kind]}</Badge>
            <span className="font-medium">{n.name}</span>
            {can("sites.write") ? (
              <Button variant="ghost" size="icon-sm" aria-label="Удалить узел" onClick={() => setDel(n)}>
                <Trash2 />
              </Button>
            ) : null}
          </div>
          {render(n.node_id, depth + 1)}
        </div>
      ))
  return (
    <Panel
      title={site.name}
      subtitle={`${SITE_KIND_LABEL[site.kind]} · ${site.timezone}${site.address ? ` · ${site.address}` : ""}`}
      actions={
        can("sites.write") ? (
          <>
            <Button variant="outline" size="sm" onClick={() => onEdit(site)}><Pencil /> Изменить</Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => onArchive(site)}><Trash2 /> Архивировать</Button>
          </>
        ) : null
      }
    >
      {site.shifts?.length ? <p className="mb-3 text-[13px] text-muted-foreground">Смены: {site.shifts.map((s) => `${s.name} ${s.from}–${s.to}`).join(", ")}</p> : null}
      <p className="mb-2 text-sm font-semibold">Структура</p>
      {!q.data ? <Skeleton className="h-16" /> : nodes.length ? render(null, 0) : <p className="text-[13px] text-muted-foreground">{industrial ? "Добавьте цеха, линии и шкафы, чтобы видеть потребление по участкам." : "Для дома структура не нужна: приборы относятся к объекту целиком."}</p>}
      {can("sites.write") ? (
        <div className="mt-4 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[1fr_150px_1fr_auto] sm:items-end">
          <Field label="Новый узел"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Линия № 2" /></Field>
          <Field label="Тип">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(NODE_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Входит в">
            <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— объект —</option>
              {nodes.map((n) => <option key={n.node_id} value={n.node_id}>{n.name}</option>)}
            </Select>
          </Field>
          <Button variant="outline" loading={busy} disabled={!form.name.trim()} onClick={async () => {
            setBusy(true); setError(null)
            try { await api(`/api/v1/sites/${site.site_id}/nodes`, { body: { name: form.name, kind: form.kind, parentId: form.parentId || null } }); setForm({ ...form, name: "" }); q.reload() } catch (e) { setError(e as Error) } finally { setBusy(false) }
          }}><Plus /> Добавить</Button>
        </div>
      ) : null}
      <ErrorBox error={error} />
      <ConfirmDialog open={Boolean(del)} onClose={() => setDel(null)} title="Удалить узел?" text="Вложенные узлы тоже будут удалены. Удаление невозможно, пока к узлу привязаны действующие приборы." confirmLabel="Удалить" onConfirm={async () => { await api(`/api/v1/nodes/${del!.node_id}`, { method: "DELETE" }); q.reload() }} />
    </Panel>
  )
}

function SiteDialog({ site, onClose, onDone }: { site: SiteRow | null; onClose: () => void; onDone: () => void }) {
  const { industrial } = useApp()
  const [f, setF] = useState({ name: site?.name ?? "", kind: site?.kind ?? (industrial ? "plant" : "apartment"), address: site?.address ?? "", timezone: site?.timezone ?? "Europe/Moscow", shifts: site?.shifts ?? [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open onClose={onClose} title={site ? "Объект" : "Новый объект"}
      footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!f.name.trim()} onClick={async () => {
        setBusy(true); setError(null)
        try {
          if (site) await api(`/api/v1/sites/${site.site_id}`, { method: "PATCH", body: { name: f.name, address: f.address, timezone: f.timezone, shifts: f.shifts } })
          else await api("/api/v1/sites", { body: f })
          onDone(); onClose()
        } catch (e) { setError(e as Error) } finally { setBusy(false) }
      }}>Сохранить</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Тип">
          <Select value={f.kind} disabled={Boolean(site)} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(SITE_KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Адрес" className="sm:col-span-2"><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="Часовой пояс"><Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></Field>
        {industrial ? (
          <Field label="Смены" hint="Через запятую: Дневная 08:00-20:00, Ночная 20:00-08:00" className="sm:col-span-2">
            <Input
              defaultValue={f.shifts.map((s) => `${s.name} ${s.from}-${s.to}`).join(", ")}
              onBlur={(e) => setF({ ...f, shifts: e.target.value.split(",").map((x) => x.trim()).filter(Boolean).map((x) => { const m = /^(.*?)\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/.exec(x); return m ? { name: m[1], from: m[2], to: m[3] } : { name: x, from: "00:00", to: "00:00" } }) })}
            />
          </Field>
        ) : null}
        <div className="sm:col-span-2"><ErrorBox error={error} /></div>
      </div>
    </Dialog>
  )
}
