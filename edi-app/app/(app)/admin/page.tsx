"use client"

import { ProviderConnections } from "@/components/provider-connections"

import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useRef, useState } from "react"
import { api, fmtDate, fmtDateTime, relTime, useApi } from "@/components/api"
import { useMe } from "@/components/shell"
import { Badge, Button, ErrorLine, Field, Input, Select, Spinner, Tabs, toast } from "@/components/ui"
import { ACTION_LABEL } from "@/lib/edi/audit.ts"
import { NOTIFY_EVENTS } from "@/lib/edi/notify.ts"

type Tab = "operators" | "org" | "users" | "integrations" | "plan" | "formats" | "retention" | "webhooks" | "audit"

function Admin() {
  const sp = useSearchParams()
  const router = useRouter()
  const tab = (sp.get("tab") as Tab) || "org"
  return (
    <div className="mx-auto max-w-6xl p-3 sm:p-4">
      <h1 className="mb-2 text-lg font-bold">Администрирование</h1>
      <Tabs<Tab>
        value={tab}
        onChange={(t) => router.replace(`/admin?tab=${t}`)}
        items={[
          { value: "org", label: "Организация" },
          { value: "users", label: "Пользователи и роли" },
          { value: "integrations", label: "Интеграции" },
          { value: "operators", label: "Операторы ЭДО" },
          { value: "plan", label: "Тариф и лимиты" },
          { value: "formats", label: "Форматы" },
          { value: "retention", label: "Хранение" },
          { value: "webhooks", label: "Вебхуки" },
          { value: "audit", label: "Аудит" },
        ]}
      />
      <div className="pt-4">
        {tab === "org" && <OrgTab />}
        {tab === "users" && <UsersTab />}
        {tab === "integrations" && <IntegrationsTab />}
        {tab === "operators" && <ProviderConnections />}
        {tab === "plan" && <PlanTab />}
        {tab === "formats" && <FormatsTab />}
        {tab === "retention" && <RetentionTab />}
        {tab === "webhooks" && <WebhooksTab />}
        {tab === "audit" && <AuditTab />}
      </div>
    </div>
  )
}

const ORG_FIELDS: Array<[string, string, number?]> = [
  ["legalName", "Полное наименование", 3],
  ["inn", "ИНН"],
  ["kpp", "КПП"],
  ["ogrn", "ОГРН"],
  ["address", "Адрес", 3],
  ["bankName", "Банк", 2],
  ["bankBik", "БИК"],
  ["bankAccount", "Расчётный счёт"],
  ["corrAccount", "Корр. счёт"],
  ["phone", "Телефон"],
  ["email", "Email"],
  ["director", "Руководитель"],
  ["accountant", "Главный бухгалтер"],
]

function OrgTab() {
  const { data, reload } = useApi<Record<string, string | null>>("/api/edi/admin/org")
  const [v, setV] = useState<Record<string, string | null> | null>(null)
  const [err, setErr] = useState("")
  const logo = useRef<HTMLInputElement>(null)
  if (!data) return <Spinner />
  const cur = v ?? data
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Реквизиты используются в печатных формах и для проверки, что входящий УПД адресован вашей организации.</p>
      <div className="grid gap-3 rounded-xl border border-border bg-card p-3 sm:grid-cols-3">
        {ORG_FIELDS.map(([k, l, span]) => (
          <Field key={k} label={l} className={span === 3 ? "sm:col-span-3" : span === 2 ? "sm:col-span-2" : undefined}>
            <Input value={cur[k] ?? ""} onChange={(e) => setV({ ...cur, [k]: e.target.value })} />
          </Field>
        ))}
        <div className="flex items-center gap-3 sm:col-span-3">
          {data.logoFileId && <img src={`/api/edi/files/${data.logoFileId}?inline=1`} alt="Логотип" className="h-10 rounded border border-border" />}
          <input ref={logo} type="file" accept=".png,.jpg,.jpeg" hidden onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const fd = new FormData()
            fd.append("file", f)
            try {
              await api("/api/edi/admin-logo", { method: "POST", body: fd })
              toast("Логотип загружен")
              reload()
            } catch (er) {
              toast((er as Error).message, "error")
            }
          }} />
          <Button size="sm" onClick={() => logo.current?.click()}>Загрузить логотип</Button>
        </div>
      </div>
      <ErrorLine error={err} />
      <Button variant="primary" disabled={!v} onClick={async () => { try { await api("/api/edi/admin/org", { method: "POST", json: cur }); toast("Сохранено"); setV(null); setErr(""); reload() } catch (e) { setErr((e as Error).message) } }}>Сохранить</Button>
    </div>
  )
}

function UsersTab() {
  const me = useMe()
  const { data, reload } = useApi<{ users: Array<{ userId: string; name: string; login: string; isActive: boolean; wmsRoles: string[]; ediRoles: string[]; department: string | null }>; roles: Array<{ code: string; name: string; permissions: string[] }> }>("/api/edi/admin/users")
  if (!data) return <Spinner />
  const set = async (userId: string, roles: string[], department?: string) => {
    try {
      await api("/api/edi/admin/users", { method: "POST", json: { userId, roles, department } })
      reload()
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Пользователи заводятся в SCADA ID / WMS — здесь назначаются только роли EDI. Без явных ролей действуют роли по умолчанию от роли WMS.</p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-muted text-left text-[11px] text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Пользователь</th>
              <th className="px-2 py-1.5 font-medium">Роли WMS</th>
              <th className="px-2 py-1.5 font-medium">Подразделение</th>
              {data.roles.map((r) => <th key={r.code} className="px-1 py-1.5 text-center font-medium" title={r.permissions.join(", ")}>{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.users.map((u) => (
              <tr key={u.userId} className={u.isActive ? "border-t border-border" : "border-t border-border opacity-50"}>
                <td className="px-2 py-1.5"><div className="font-medium">{u.name}</div><div className="text-muted-foreground">{u.login}</div></td>
                <td className="px-2 py-1.5 text-muted-foreground">{u.wmsRoles.join(", ") || "—"}</td>
                <td className="px-2 py-1.5"><Input className="h-7" defaultValue={u.department ?? ""} onBlur={(e) => e.target.value !== (u.department ?? "") && void set(u.userId, u.ediRoles, e.target.value)} /></td>
                {data.roles.map((r) => (
                  <td key={r.code} className="text-center">
                    <input type="checkbox" aria-label={`${u.name}: ${r.name}`} disabled={u.userId === me.userId && r.code === "edi_admin"} checked={u.ediRoles.includes(r.code)} onChange={(e) => void set(u.userId, e.target.checked ? [...u.ediRoles, r.code] : u.ediRoles.filter((x) => x !== r.code))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type Catalog = { kind: string; provider: string; name: string; fields: Array<{ key: string; label: string }>; secretLabel: string; available: boolean; note: string }
type Configured = { integrationId: string; kind: string; provider: string; config: Record<string, string>; hasSecret: boolean; isEnabled: boolean; verifiedAt: string | null; lastCheckAt: string | null; lastCheck: { ok: boolean; message: string } | null }

function IntegrationsTab() {
  const { data, reload } = useApi<{ catalog: Catalog[]; configured: Configured[]; envWms: { baseUrl: string } | null; mail: boolean; edo: { available: boolean; reason: string } }>("/api/edi/admin/integrations")
  if (!data) return <Spinner />
  return (
    <div className="space-y-3">
      {data.envWms && <p className="rounded-lg bg-muted px-3 py-2 text-xs">WMS подключена через переменные окружения сервера: {data.envWms.baseUrl}. Настройка ниже имеет приоритет.</p>}
      <p className="text-xs text-muted-foreground">Каждая интеграция независима: её недоступность не останавливает EDI. Email: {data.mail ? "SMTP настроен" : "SMTP не настроен (EDI_SMTP_URL)"}.</p>
      {data.catalog.map((c) => <IntegrationCard key={c.kind} c={c} row={data.configured.find((x) => x.kind === c.kind)} reload={reload} />)}
    </div>
  )
}

function IntegrationCard({ c, row, reload }: { c: Catalog; row?: Configured; reload: () => void }) {
  const [cfg, setCfg] = useState<Record<string, string>>(row?.config ?? {})
  const [secret, setSecret] = useState("")
  const [enabled, setEnabled] = useState(row?.isEnabled ?? false)
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">{c.name}</span>
        {!c.available && <Badge>недоступно</Badge>}
        {row?.isEnabled && <Badge tone="success">включено</Badge>}
        {row?.verifiedAt && <Badge tone="info">проверено {relTime(row.verifiedAt)}</Badge>}
        {row?.lastCheck && !row.lastCheck.ok && <Badge tone="danger">последняя проверка: ошибка</Badge>}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{c.note}</p>
      {c.available && (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {c.fields.map((f) => <Field key={f.key} label={f.label}><Input value={cfg[f.key] ?? ""} onChange={(e) => setCfg({ ...cfg, [f.key]: e.target.value })} /></Field>)}
          {c.secretLabel && <Field label={c.secretLabel} hint={row?.hasSecret ? "сохранён; оставьте пустым, чтобы не менять" : undefined}><Input type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>}
          <div className="flex items-end gap-2 sm:col-span-3">
            <label className="mr-auto flex items-center gap-1.5 text-[13px]"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Включить</label>
            {row && (
              <Button size="sm" busy={busy === "check"} onClick={async () => {
                setBusy("check")
                try {
                  const r = await api<{ ok: boolean; message: string }>("/api/edi/admin/integrations", { method: "POST", json: { check: c.kind } })
                  toast(r.message, r.ok ? "ok" : "error")
                  reload()
                } catch (e) {
                  toast((e as Error).message, "error")
                } finally {
                  setBusy(null)
                }
              }}>Проверить подключение</Button>
            )}
            <Button size="sm" variant="primary" busy={busy === "save"} onClick={async () => {
              setBusy("save")
              try {
                await api("/api/edi/admin/integrations", { method: "POST", json: { kind: c.kind, config: cfg, secret: secret || undefined, isEnabled: enabled } })
                toast("Сохранено. Проверьте подключение.")
                setSecret("")
                reload()
              } catch (e) {
                toast((e as Error).message, "error")
              } finally {
                setBusy(null)
              }
            }}>Сохранить</Button>
          </div>
          {row?.lastCheck && <p className="text-xs text-muted-foreground sm:col-span-3">Проверка {fmtDateTime(row.lastCheckAt)}: {row.lastCheck.message}</p>}
        </div>
      )}
    </section>
  )
}

function PlanTab() {
  const { data, reload } = useApi<any>("/api/edi/admin/subscription")
  const [plan, setPlan] = useState("")
  if (!data) return <Spinner />
  const s = data.subscription
  const u = data.usage
  const lim = (v: number | null | undefined) => (v == null ? "без лимита" : v.toLocaleString("ru-RU"))
  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-semibold">{s.planName}</span>
          <Badge tone={s.status === "active" ? "success" : "danger"}>{s.status === "active" ? "активна" : s.status}</Badge>
          {s.validTo && <span className="text-xs text-muted-foreground">до {fmtDate(s.validTo)}</span>}
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {[
            ["Документов в этом месяце", u.documentsThisMonth, s.limits.documentsPerMonth],
            ["Активных пользователей (30 дней)", u.users, s.limits.users],
            ["Хранилище, МБ", u.storageMb, s.limits.storageMb],
          ].map(([l, val, max]) => (
            <div key={l as string}>
              <div className="text-[11px] text-muted-foreground">{l}</div>
              <div className="text-[13px] font-semibold tabular-nums">{Number(val).toLocaleString("ru-RU")} / {lim(max as number | null)}</div>
              {max != null && <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full" style={{ width: `${Math.min(100, (Number(val) / Number(max)) * 100)}%`, background: Number(val) / Number(max) > 0.9 ? "var(--destructive)" : "var(--viz-1)" }} /></div>}
            </div>
          ))}
        </div>
        {data.externalUsage.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Внешние операции за месяц (учитываются отдельно): {data.externalUsage.map((x: any) => `${x.kind}: ${x.qty}`).join(", ")}</p>}
      </section>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {data.plans.map((p: any) => (
          <section key={p.code} className={`rounded-xl border bg-card p-3 text-xs ${p.code === s.planCode ? "border-ring" : "border-border"}`}>
            <div className="text-[13px] font-semibold">{p.name}</div>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>Пользователи: {lim(p.limits.users)}</li>
              <li>Документов/мес: {lim(p.limits.documentsPerMonth)}</li>
              <li>Хранилище: {p.limits.storageMb == null ? "без лимита" : `${(p.limits.storageMb / 1024).toFixed(1)} ГБ`}</li>
              {Object.entries({ workflows: "Согласования", integrations: "Интеграции WMS/…", edo: "Операторы ЭДО", analytics: "Расширенная аналитика", webhooks: "Вебхуки", customRoutes: "Индивидуальные маршруты", templatesCustom: "Свои шаблоны" }).map(([k, l]) => (
                <li key={k}>{p.features[k] ? "✓" : "—"} {l}</li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-muted-foreground">{p.priceNote}</p>
          </section>
        ))}
      </div>
      {data.platformAdmin ? (
        <div className="flex items-end gap-2">
          <Field label="Назначить тариф (оператор платформы)">
            <Select value={plan || s.planCode} onChange={(e) => setPlan(e.target.value)}>{data.plans.map((p: any) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select>
          </Field>
          <Button onClick={async () => { await api("/api/edi/admin/subscription", { method: "POST", json: { planCode: plan || s.planCode } }); toast("Тариф назначен"); reload() }}>Применить</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Тариф и лимиты меняет оператор платформы SCADA EDI.</p>
      )}
    </div>
  )
}

function FormatsTab() {
  const me = useMe()
  const { data, reload } = useApi<{ formats: Array<{ code: string; name: string; docTypes: string[]; knd: string; version: string; validFrom: string | null; validTo: string | null; legalBasis: string; note: string }> }>("/api/edi/admin/formats")
  const { data: sub } = useApi<any>("/api/edi/admin/subscription")
  if (!data) return <Spinner />
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Реестр структурированных форматов. При загрузке проверяется применимость формата на дату документа. Сроки действия хранятся в базе и меняются без изменения кода.</p>
      {data.formats.map((f) => (
        <section key={f.code} className="rounded-xl border border-border bg-card p-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">{f.name}</span>
            <Badge>КНД {f.knd}</Badge>
            <Badge>v{f.version}</Badge>
          </div>
          <div className="mt-1 text-muted-foreground">{f.legalBasis}</div>
          <div className="mt-1 text-muted-foreground">{f.note}</div>
          {sub?.platformAdmin ? (
            <div className="mt-2 flex items-end gap-2">
              <Field label="Действует с"><Input type="date" defaultValue={f.validFrom ?? ""} id={`from-${f.code}`} /></Field>
              <Field label="по"><Input type="date" defaultValue={f.validTo ?? ""} id={`to-${f.code}`} /></Field>
              <Button size="sm" onClick={async () => {
                await api("/api/edi/admin/formats", { method: "POST", json: { code: f.code, validFrom: (document.getElementById(`from-${f.code}`) as HTMLInputElement).value || null, validTo: (document.getElementById(`to-${f.code}`) as HTMLInputElement).value || null } })
                toast("Сохранено")
                reload()
              }}>Сохранить</Button>
            </div>
          ) : (
            <div className="mt-1">Действует: {f.validFrom ? fmtDate(f.validFrom) : "—"} — {f.validTo ? fmtDate(f.validTo) : "по настоящее время"}</div>
          )}
        </section>
      ))}
      {!me.permissions.includes("edi.admin") && null}
    </div>
  )
}

function RetentionTab() {
  const { data, reload } = useApi<{ types: Array<{ docType: string; name: string; years: number; basis: string; custom: boolean }>; expired: Array<{ documentId: string; title: string; docDate: string; archivedAt: string }> }>("/api/edi/admin/retention")
  const [sel, setSel] = useState<Set<string>>(new Set())
  if (!data) return <Spinner />
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Срок хранения задаётся по типу документа и исчисляется после окончания года составления. Значения по умолчанию — стартовые; сверьте их с учётной политикой и актуальными требованиями законодательства.</p>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-xs">
          <tbody>
            {data.types.map((t) => (
              <tr key={t.docType} className="border-b border-border last:border-0">
                <td className="px-2 py-1.5 font-medium">{t.name}</td>
                <td className="w-24 px-2 py-1.5">
                  <Input className="h-7" type="number" min={1} max={100} defaultValue={t.years} onBlur={async (e) => { if (Number(e.target.value) !== t.years) { await api("/api/edi/admin/retention", { method: "POST", json: { docType: t.docType, years: Number(e.target.value), basis: t.basis } }); toast("Срок обновлён"); reload() } }} aria-label={`Срок хранения: ${t.name}`} />
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">лет · {t.basis}{t.custom && <Badge className="ml-1">изменён</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section>
        <h2 className="mb-1 text-sm font-semibold">Архивные документы с истёкшим сроком · {data.expired.length}</h2>
        {data.expired.length === 0 ? (
          <p className="text-xs text-muted-foreground">Нет документов к удалению.</p>
        ) : (
          <>
            {data.expired.map((d) => (
              <label key={d.documentId} className="flex items-center gap-2 border-b border-border py-1 text-xs">
                <input type="checkbox" checked={sel.has(d.documentId)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(d.documentId); else n.delete(d.documentId); return n })} />
                {d.title} · {fmtDate(d.docDate)}
              </label>
            ))}
            <Button size="sm" variant="danger" className="mt-2" disabled={!sel.size} onClick={async () => { if (!confirm(`Удалить ${sel.size} документов по истечении срока хранения?`)) return; const r = await api<{ deleted: number }>("/api/edi/admin/retention", { method: "POST", json: { purge: [...sel] } }); toast(`Удалено: ${r.deleted}`); setSel(new Set()); reload() }}>Удалить выбранные</Button>
          </>
        )}
      </section>
    </div>
  )
}

function WebhooksTab() {
  const { data, reload } = useApi<{ webhooks: Array<{ id: string; url: string; events: string[]; isActive: boolean; createdAt: string }>; deliveries: Array<{ channel: string; status: string; n: number }> }>("/api/edi/admin/webhooks")
  const [url, setUrl] = useState("")
  const [secret, setSecret] = useState<string | null>(null)
  if (!data) return <Spinner />
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Вебхуки получают события документооборота (POST JSON) с подписью X-EDI-Signature: v1=HMAC-SHA256(secret, timestamp + "." + body), заголовок X-EDI-Timestamp. Повторы — до 5 раз с нарастающим интервалом.</p>
      <div className="flex gap-2">
        <Input placeholder="https://erp.example.ru/edi-hook" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button variant="primary" disabled={!url} onClick={async () => { try { const r = await api<{ secret: string }>("/api/edi/admin/webhooks", { method: "POST", json: { url, events: [] } }); setSecret(r.secret); setUrl(""); reload() } catch (e) { toast((e as Error).message, "error") } }}>Добавить</Button>
      </div>
      {secret && <p className="rounded-lg bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-3 py-2 text-xs">Секрет (показывается один раз): <code className="select-all font-mono">{secret}</code></p>}
      {data.webhooks.map((w) => (
        <div key={w.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs">
          <span className="font-mono">{w.url}</span>
          <Badge tone={w.isActive ? "success" : "neutral"}>{w.isActive ? "активен" : "выключен"}</Badge>
          <span className="text-muted-foreground">{w.events.length ? w.events.map((e) => NOTIFY_EVENTS[e] ?? e).join(", ") : "все события"}</span>
          <Button size="sm" className="ml-auto" onClick={async () => { await api("/api/edi/admin/webhooks", { method: "POST", json: { id: w.id, isActive: !w.isActive, events: w.events } }); reload() }}>{w.isActive ? "Выключить" : "Включить"}</Button>
          <Button size="sm" variant="ghost" onClick={async () => { await api("/api/edi/admin/webhooks", { method: "POST", json: { id: w.id, delete: true } }); reload() }}>Удалить</Button>
        </div>
      ))}
      {data.deliveries.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Журнал доставки за 7 дней</h2>
          <div className="flex flex-wrap gap-2 text-xs">{data.deliveries.map((d) => <Badge key={`${d.channel}-${d.status}`} tone={d.status === "failed" ? "danger" : d.status === "delivered" ? "success" : "neutral"}>{d.channel} · {d.status}: {d.n}</Badge>)}</div>
        </section>
      )}
    </div>
  )
}

function AuditTab() {
  const [action, setAction] = useState("")
  const { data } = useApi<{ events: Array<{ id: string; action: string; actorName: string | null; documentId: string | null; title: string | null; details: Record<string, unknown>; ip: string | null; createdAt: string }> }>(`/api/edi/admin/audit?action=${encodeURIComponent(action)}`, [action])
  return (
    <div className="space-y-2">
      <Select className="w-64" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Действие">
        <option value="">Все действия</option>
        {["auth", "document", "workflow", "signature", "wms", "exchange", "counterparty", "admin"].map((p) => <option key={p} value={p}>{p}</option>)}
      </Select>
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[720px] text-xs">
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{fmtDateTime(e.createdAt)}</td>
                  <td className="px-2 py-1">{ACTION_LABEL[e.action] ?? e.action}</td>
                  <td className="px-2 py-1">{e.actorName}</td>
                  <td className="max-w-64 truncate px-2 py-1">{e.documentId ? <a className="underline" href={`/documents?id=${e.documentId}`}>{e.title ?? `#${e.documentId}`}</a> : "—"}</td>
                  <td className="max-w-80 truncate px-2 py-1 font-mono text-[10px] text-muted-foreground" title={JSON.stringify(e.details)}>{JSON.stringify(e.details)}</td>
                  <td className="px-2 py-1 text-muted-foreground">{e.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <Admin />
    </Suspense>
  )
}
