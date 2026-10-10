"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { relative } from "@/lib/client/format"
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Notice, Panel, Select, useToast } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { Stepper } from "@/components/ems/stepper"
import { GatewayInstall } from "@/components/ems/gateway-install"

type NodeRow = { node_id: string; parent_id: string | null; name: string; kind: string }

export function IndustrialOnboarding() {
  const router = useRouter()
  const toast = useToast()
  const { me, sites, siteId, setSiteId, reloadSites, reloadMe } = useApp()
  const steps = ["Организация", "Площадка", "Структура", "Шлюз", "Приборы", "Проверка показаний", "Мониторинг", "Готово"]
  const [step, setStep] = useState(me.org?.kind === "corporate" ? 1 : 0)
  const [error, setError] = useState<{ message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [site, setSite] = useState({ name: "", address: "", timezone: "Europe/Moscow", kind: "plant", shift1: "08:00", shift2: "20:00", twoShifts: true })
  const detail = useApi<{ nodes: NodeRow[] }>(siteId && step >= 2 ? `/api/v1/sites/${siteId}` : null)
  const gateways = useApi<{ gateways: Array<{ gateway_id: string; name: string; status: string; site_id: string; last_seen_at: string | null }> }>(step >= 3 ? "/api/v1/gateways" : null)
  const meters = useApi<{ meters: Array<{ meter_id: string; name: string; connection: string; channels: Array<{ name: string; lastValue: number | null; lastAt: string | null; unit: string }> }> }>(siteId && step >= 4 ? `/api/v1/meters?siteId=${siteId}` : null)
  const [node, setNode] = useState({ name: "", kind: "building", parentId: "" })
  const [gwName, setGwName] = useState("Шлюз ЩУ-1")
  const [enroll, setEnroll] = useState<{ code: string; expiresAt: string } | null>(null)
  const [rules, setRules] = useState({ telemetry: true, power: false, powerKw: "500", night: true })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  const corporate = me.orgs.filter((o) => o.kind === "corporate" && !o.isDemo)
  const siteGateways = (gateways.data?.gateways ?? []).filter((g) => g.site_id === siteId)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Настройка площадки" subtitle="Структура объекта, шлюз, приборы и правила мониторинга." />
      <Stepper steps={steps} current={step} />
      <Panel>
        {step === 0 ? (
          <div className="space-y-3 text-[13px]">
            <p>
              Сейчас выбрана организация <span className="font-semibold">{me.org?.name}</span> ({me.org?.kind === "personal" ? "личное пространство" : "компания"}).
            </p>
            {corporate.length ? (
              <div className="space-y-1">
                <p className="text-muted-foreground">Организации из SCADA ID:</p>
                {corporate.map((o) => (
                  <Button
                    key={o.orgId}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      run(async () => {
                        await api("/api/auth/switch-org", { body: { orgId: o.orgId } })
                        window.location.href = "/onboarding?mode=industrial"
                      })
                    }
                  >
                    {o.name}
                  </Button>
                ))}
              </div>
            ) : (
              <Notice>Корпоративная организация появляется после того, как администратор SCADA ID выдаст вам доступ к приложению scada-ems в своей организации. Можно продолжить в личном пространстве — режим переключится на промышленный.</Notice>
            )}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-3">
            {sites.length ? (
              <Field label="Существующая площадка">
                <Select value={siteId ?? ""} onChange={(e) => setSiteId(e.target.value)}>
                  {sites.map((s) => (
                    <option key={s.site_id} value={s.site_id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <p className="text-[13px] font-medium">{sites.length ? "или новая площадка" : "Новая площадка"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Название" required>
                <Input value={site.name} onChange={(e) => setSite({ ...site, name: e.target.value })} placeholder="Завод, Цех 3, Склад «Север»" />
              </Field>
              <Field label="Тип">
                <Select value={site.kind} onChange={(e) => setSite({ ...site, kind: e.target.value })}>
                  <option value="plant">Завод / производство</option>
                  <option value="warehouse">Склад</option>
                  <option value="commercial">Коммерческое здание</option>
                  <option value="utility">Инженерный объект</option>
                </Select>
              </Field>
              <Field label="Адрес">
                <Input value={site.address} onChange={(e) => setSite({ ...site, address: e.target.value })} />
              </Field>
              <Field label="Часовой пояс">
                <Input value={site.timezone} onChange={(e) => setSite({ ...site, timezone: e.target.value })} />
              </Field>
              <div className="sm:col-span-2">
                <Checkbox checked={site.twoShifts} onChange={(v) => setSite({ ...site, twoShifts: v })} label="Две смены" hint={`Дневная ${site.shift1}–${site.shift2}, ночная ${site.shift2}–${site.shift1}. Изменить можно в разделе «Объекты».`} />
              </div>
            </div>
            <Button
              variant="outline"
              disabled={!site.name.trim()}
              loading={busy}
              onClick={() =>
                run(async () => {
                  const r = await api<{ siteId: string }>("/api/v1/sites", {
                    body: { name: site.name, kind: site.kind, address: site.address || null, timezone: site.timezone, shifts: site.twoShifts ? [{ name: "Дневная", from: site.shift1, to: site.shift2 }, { name: "Ночная", from: site.shift2, to: site.shift1 }] : [] },
                  })
                  if (me.org?.segment !== "industrial") await api("/api/v1/org", { method: "PATCH", body: { segment: "industrial" } })
                  reloadSites()
                  setSiteId(r.siteId)
                  toast("Площадка создана")
                  setSite({ ...site, name: "" })
                })
              }
            >
              <Plus /> Создать площадку
            </Button>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">Пример: Завод → Цех розлива → Линия № 2 → Силовой шкаф. Приборы привязываются к узлам — так строится аналитика по участкам.</p>
            <ul className="space-y-1 text-[13px]">
              {(detail.data?.nodes ?? []).map((n) => (
                <li key={n.node_id} className="flex items-center gap-2" style={{ paddingLeft: depth(detail.data?.nodes ?? [], n) * 16 }}>
                  <Badge>{KIND[n.kind]}</Badge> {n.name}
                </li>
              ))}
              {!detail.data?.nodes.length ? <li className="text-muted-foreground">Пока без структуры — приборы будут относиться ко всей площадке.</li> : null}
            </ul>
            <div className="grid gap-2 sm:grid-cols-[1fr_160px_1fr_auto] sm:items-end">
              <Field label="Название узла">
                <Input value={node.name} onChange={(e) => setNode({ ...node, name: e.target.value })} placeholder="Цех розлива" />
              </Field>
              <Field label="Тип">
                <Select value={node.kind} onChange={(e) => setNode({ ...node, kind: e.target.value })}>
                  {Object.entries(KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Входит в">
                <Select value={node.parentId} onChange={(e) => setNode({ ...node, parentId: e.target.value })}>
                  <option value="">— площадка —</option>
                  {(detail.data?.nodes ?? []).map((n) => (
                    <option key={n.node_id} value={n.node_id}>
                      {n.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button
                variant="outline"
                disabled={!node.name.trim() || !siteId}
                loading={busy}
                onClick={() =>
                  run(async () => {
                    await api(`/api/v1/sites/${siteId}/nodes`, { body: { name: node.name, kind: node.kind, parentId: node.parentId || null } })
                    setNode({ ...node, name: "" })
                    detail.reload()
                  })
                }
              >
                <Plus /> Добавить
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="space-y-3">
            <Notice>Приборы в локальной сети опрашивает SCADA EMS Gateway — программный агент на компьютере внутри сети предприятия. Он сам подключается к облаку по HTTPS; открывать контроллеры и счётчики в интернет не нужно и нельзя.</Notice>
            {siteGateways.map((g) => (
              <p key={g.gateway_id} className="flex items-center gap-2 text-[13px]">
                <span className={`size-2 rounded-full ${g.status === "online" ? "bg-emerald-500" : g.status === "pending" ? "bg-amber-500" : "bg-destructive"}`} />
                {g.name} — {g.status === "pending" ? "ожидает регистрации" : g.status === "online" ? `на связи (${relative(g.last_seen_at)})` : "не на связи"}
              </p>
            ))}
            {enroll ? (
              <GatewayInstall code={enroll.code} expiresAt={enroll.expiresAt} />
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="Название шлюза">
                  <Input value={gwName} onChange={(e) => setGwName(e.target.value)} />
                </Field>
                <Button
                  loading={busy}
                  disabled={!siteId || !gwName.trim()}
                  onClick={() =>
                    run(async () => {
                      const r = await api<{ code: string; expiresAt: string }>("/api/v1/gateways", { body: { siteId, name: gwName } })
                      setEnroll(r)
                      gateways.reload()
                    })
                  }
                >
                  Создать шлюз и получить код
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Шаг можно пропустить: приборы с ручным вводом и HTTP push работают без шлюза.</p>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="space-y-3">
            <p className="text-[13px]">Приборов на площадке: {meters.data?.meters.length ?? 0}</p>
            <Link href="/meters/new" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
              <Plus className="size-4" /> Подключить прибор (мастер)
            </Link>
            <p className="text-xs text-muted-foreground">Мастер откроется отдельно; вернитесь сюда, чтобы проверить показания.</p>
            <Button variant="ghost" size="sm" onClick={meters.reload}>
              Обновить список
            </Button>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="space-y-2">
            {(meters.data?.meters ?? []).map((m) => (
              <div key={m.meter_id} className="rounded-lg border border-border/70 p-2 text-[13px]">
                <p className="font-medium">{m.name}</p>
                {m.channels.map((c) => (
                  <p key={c.name} className="text-xs text-muted-foreground">
                    {c.name}: {c.lastValue ?? "нет данных"} {c.lastAt ? `· ${relative(c.lastAt)}` : ""}
                  </p>
                ))}
              </div>
            ))}
            {!meters.data?.meters.length ? <p className="text-[13px] text-muted-foreground">Приборов пока нет.</p> : null}
            <Button variant="ghost" size="sm" onClick={meters.reload}>
              Обновить
            </Button>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="space-y-3">
            <Checkbox checked={rules.telemetry} onChange={(v) => setRules({ ...rules, telemetry: v })} label="Потеря связи с приборами дольше 2 часов" />
            <Checkbox checked={rules.night} onChange={(v) => setRules({ ...rules, night: v })} label="Аномально высокое ночное потребление электроэнергии (+50% к обычному)" />
            <div className="flex flex-wrap items-end gap-2">
              <Checkbox checked={rules.power} onChange={(v) => setRules({ ...rules, power: v })} label="Превышение мощности площадки" />
              <Input className="w-28" inputMode="decimal" value={rules.powerKw} onChange={(e) => setRules({ ...rules, powerKw: e.target.value })} aria-label="Предел мощности, кВт" />
              <span className="text-[13px] text-muted-foreground">кВт, в среднем за 10 мин</span>
            </div>
            <Button
              variant="outline"
              loading={busy}
              onClick={() =>
                run(async () => {
                  if (rules.telemetry) await api("/api/v1/rules", { body: { kind: "telemetry_lost", siteId, params: { minutes: 120 } } })
                  if (rules.night) await api("/api/v1/rules", { body: { kind: "night_usage", siteId, params: { resource: "electricity", thresholdPct: 50, minAbsPerHour: 1 } } })
                  if (rules.power) await api("/api/v1/rules", { body: { kind: "power_over", siteId, params: { limitKw: rules.powerKw, minutes: 10 }, severity: "critical" } })
                  toast("Правила созданы")
                })
              }
            >
              Создать правила
            </Button>
          </div>
        ) : null}

        {step === 7 ? <p className="text-[13px]">Площадка настроена. Правила и адреса для уведомлений можно уточнить в разделах «Мониторинг» и «Настройки».</p> : null}

        <ErrorBox error={error} />
        <div className="mt-5 flex justify-between gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
            Назад
          </Button>
          {step < 7 ? (
            <Button disabled={step === 1 && !siteId} onClick={() => setStep(step + 1)}>
              {step === 3 || step === 6 ? "Далее (можно пропустить)" : "Далее"}
            </Button>
          ) : (
            <Button
              loading={busy}
              onClick={() =>
                run(async () => {
                  await api("/api/v1/org", { method: "PATCH", body: { onboardingDone: true, segment: "industrial" } })
                  reloadMe()
                  router.replace("/")
                })
              }
            >
              Перейти на промышленную панель
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}

const KIND: Record<string, string> = { building: "Здание / цех", zone: "Зона", line: "Линия", cabinet: "Шкаф / щит", point: "Узел учёта", other: "Другое" }

function depth(nodes: NodeRow[], n: NodeRow): number {
  let d = 0
  let p = n.parent_id
  while (p && d < 10) {
    d += 1
    p = nodes.find((x) => x.node_id === p)?.parent_id ?? null
  }
  return d
}

