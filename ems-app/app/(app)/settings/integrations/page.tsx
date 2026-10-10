"use client"

import { useEffect, useState } from "react"
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { dateTimeRu, relative } from "@/lib/client/format"
import { Badge, Button, Checkbox, ConfirmDialog, Dialog, ErrorBox, Field, Input, Notice, Panel, Skeleton } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"

const SCOPES: Record<string, string> = { read: "Чтение данных", "readings:write": "Запись показаний", "production:write": "Выпуск продукции (MES/APS/WMS)" }

export default function IntegrationsPage() {
  const { can, siteId } = useApp()
  const q = useApi<{ tokens: Array<{ token_id: string; name: string; prefix: string; scopes: string[]; created_at: string; last_used_at: string | null }> }>(can("integrations.manage") ? "/api/v1/api-tokens" : null)
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [revoke, setRevoke] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])
  return (
    <div className="space-y-4">
      <PageHeader title="Интеграции" subtitle="Открытые API для модулей SCADA System. Интеграции необязательны: EMS работает и без WMS/APS/MES." actions={can("integrations.manage") ? <Button onClick={() => setOpen(true)}><Plus /> API-токен</Button> : null} />
      <Panel title="API-токены" subtitle="Bearer-токен организации с ограниченными правами. Показывается один раз." bodyClassName="p-0">
        {!q.data ? (
          <Skeleton className="m-4 h-16" />
        ) : !q.data.tokens.length ? (
          <p className="p-4 text-[13px] text-muted-foreground">Токенов нет.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {q.data.tokens.map((t) => (
              <li key={t.token_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <KeyRound className="size-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name} <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span></p>
                  <p className="text-xs text-muted-foreground">{t.scopes.map((s) => SCOPES[s] ?? s).join(", ")} · создан {dateTimeRu(t.created_at)} · {t.last_used_at ? `использован ${relative(t.last_used_at)}` : "не использовался"}</p>
                </div>
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevoke(t.token_id)}><Trash2 /> Отозвать</Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Выпуск продукции → удельное потребление" subtitle="Например, кВт·ч на 1000 бутылок по линиям">
        <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">{`POST ${origin}/api/v1/production
Authorization: Bearer emsk_…   (разрешение «Выпуск продукции»)
Content-Type: application/json

{"items": [{
  "siteId": "${siteId ?? "<id площадки>"}",
  "nodeId": "<id линии из раздела «Объекты», необязательно>",
  "periodStart": "2026-10-10T08:00:00+03:00",
  "periodEnd":   "2026-10-10T20:00:00+03:00",
  "quantity": 9500, "unit": "бут.", "source": "mes", "externalRef": "смена-123"
}]}`}</pre>
        <p className="mt-2 text-xs text-muted-foreground">Повторная отправка того же периода и источника обновляет запись. Отсутствие интеграции не влияет на остальной функционал.</p>
      </Panel>
      <Panel title="SCADA Mobile" subtitle="Подключение существующего мобильного приложения">
        <div className="space-y-2 text-[13px]">
          <p>Мобильный клиент входит в SCADA ID сам и обменивает access token SCADA ID на токен EMS:</p>
          <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px]">{`POST ${origin}/api/mobile/v1/auth/exchange   {"accessToken": "<токен SCADA ID>"}
→ {"token": "ems1.…", "expiresAt": "…"}            (30 дней, отзывается в «Настройки → Сессии»)

GET  /api/mobile/v1/summary?siteId=…               сводка: расход, стоимость, платежи, аварии
GET  /api/mobile/v1/feed?after=<seq>&wait=25       лента уведомлений (long-poll, как подписка ТСД WMS)
GET  /api/v1/series?siteId=…&resources=electricity  графики; POST /api/v1/readings — ручной ввод
GET  /api/v1/obligations, /api/v1/events, /api/v1/meters, POST /api/v1/meters …`}</pre>
          <Notice>Отдельной системы push-уведомлений EMS не вводит: в репозитории SCADA System мобильный клиент получает события через long-poll и периодическую синхронизацию — лента EMS работает так же.</Notice>
        </div>
      </Panel>
      <Panel title="Приборы с собственной прошивкой (HTTP push)">
        <pre className="max-w-full overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px]">{`POST ${origin}/api/ingest/v1/readings
X-Device-Token: emsd_…   (выдаётся в карточке прибора)
{"readings": [{"channel": "volume", "at": "2026-10-10T12:00:00Z", "value": 123.456}]}`}</pre>
      </Panel>
      <TokenDialog open={open} onClose={() => setOpen(false)} onCreated={(t) => { setCreated(t); q.reload() }} />
      <Dialog open={Boolean(created)} onClose={() => setCreated(null)} title="Новый API-токен" description="Скопируйте сейчас — повторно он не показывается.">
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{created}</pre>
        <Button className="mt-3" variant="outline" onClick={() => navigator.clipboard?.writeText(created ?? "")}><Copy /> Скопировать</Button>
      </Dialog>
      <ConfirmDialog open={Boolean(revoke)} onClose={() => setRevoke(null)} title="Отозвать токен?" text="Интеграции с этим токеном сразу потеряют доступ." confirmLabel="Отозвать" onConfirm={async () => { await api(`/api/v1/api-tokens/${revoke}`, { method: "DELETE" }); q.reload() }} />
    </div>
  )
}

function TokenDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (t: string) => void }) {
  const [name, setName] = useState("MES завода")
  const [scopes, setScopes] = useState<string[]>(["production:write"])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog open={open} onClose={onClose} title="API-токен" footer={<><Button variant="outline" onClick={onClose}>Отмена</Button><Button loading={busy} disabled={!scopes.length} onClick={async () => { setBusy(true); setError(null); try { const r = await api<{ token: string }>("/api/v1/api-tokens", { body: { name, scopes } }); onCreated(r.token); onClose() } catch (e) { setError(e as Error) } finally { setBusy(false) } }}>Создать</Button></>}>
      <div className="space-y-3">
        <Field label="Название"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Разрешения">{Object.entries(SCOPES).map(([k, v]) => <Checkbox key={k} checked={scopes.includes(k)} onChange={(c) => setScopes(c ? [...scopes, k] : scopes.filter((x) => x !== k))} label={v} />)}</Field>
        <Badge tone="warning">Храните токен как пароль</Badge>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  )
}
