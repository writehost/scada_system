"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle2, Copy, Loader2, Plus, Trash2, XCircle } from "lucide-react"
import { api, useApi } from "@/lib/client/api"
import { num, RESOURCE_LABEL, unit } from "@/lib/client/format"
import { cn } from "@/lib/client/cn"
import { Badge, Button, ErrorBox, Field, Input, Notice, Panel, Select } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { Stepper } from "@/components/ems/stepper"

type Model = { model_id: string; manufacturer: string; model: string; device_kind: string; resource: string | null; protocols: string[]; requires: string | null; instruction: string; compatibility: string; channel_template: Channel[]; connection_defaults: Record<string, number> }
type Channel = { code: string; name: string; quantity: string; measure_kind: string; unit: string; tariff_zone?: string | null; is_billing?: boolean; register?: { fn: number; address: number; dataType: string; wordOrder: string; scale?: number } | null; multiplier?: number; value_offset?: number; rollover_at?: number | null; decimals?: number }
type ProbeResult = { results: Array<{ key: string; ok: boolean; value?: number; hex?: string; code?: string; error?: string; ms: number }>; checkedAt: string }

export const COMPAT: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "danger" }> = {
  verified: { label: "Проверено", tone: "success" },
  profile_untested: { label: "Профиль не испытан на приборе", tone: "warning" },
  manual_only: { label: "Только ручной ввод", tone: "neutral" },
  planned: { label: "Не поддерживается (в планах)", tone: "danger" },
}

const CONN_LABEL: Record<string, string> = { manual: "Ручной ввод", modbus_tcp: "Modbus TCP через шлюз", http_push: "HTTP push (прибор отправляет сам)" }
const QUANTITY: Record<string, string> = { energy_active: "Активная энергия", energy_reactive: "Реактивная энергия", power_active: "Активная мощность", volume: "Объём", flow_rate: "Расход", heat_energy: "Тепловая энергия", pulse: "Импульсы", temperature: "Температура", leak: "Протечка" }

const ERROR_HELP: Record<string, string> = {
  connection_refused: "Нет соединения: проверьте IP-адрес и порт (обычно 502), включён ли Modbus TCP на устройстве или преобразователе.",
  host_unreachable: "Адрес недоступен из сети шлюза: шлюз и прибор должны быть в одной сети или маршрутизируемы.",
  timeout: "Устройство не отвечает: проверьте Unit ID (адрес на шине RS-485), скорость и чётность преобразователя, питание прибора.",
  illegal_address: "Неправильный адрес регистра: сверьтесь с картой регистров в паспорте (адреса 3xxxx/4xxxx указываются без префикса, с нуля).",
  illegal_function: "Функция не поддерживается: попробуйте 04 (input) вместо 03 (holding) или наоборот.",
  bad_data_type: "Неверный тип данных: значение не число — проверьте тип (float32/uint32) и порядок байт.",
}

export function MeterWizard() {
  const router = useRouter()
  const { siteId, sites, me } = useApp()
  const catalog = useApi<{ models: Model[] }>("/api/v1/catalog")
  const gateways = useApi<{ gateways: Array<{ gateway_id: string; name: string; status: string; site_id: string }> }>("/api/v1/gateways")
  const steps = ["Ресурс", "Профиль прибора", "Подключение", "Параметры", "Доступность", "Каналы", "Показания", "Объект и запуск"]
  const [step, setStep] = useState(0)
  const [resource, setResource] = useState<string>("electricity")
  const [model, setModel] = useState<Model | null>(null)
  const [connection, setConnection] = useState<string>("manual")
  const [params, setParams] = useState({ gatewayId: "", host: "", port: "502", unitId: "1", timeoutMs: "2000", pollIntervalSec: "900" })
  const [channels, setChannels] = useState<Channel[]>([])
  const [probe, setProbe] = useState<{ state: "idle" | "running" | "done" | "error"; result?: ProbeResult; error?: string }>({ state: "idle" })
  const [initial, setInitial] = useState<Record<string, string>>({})
  const [meta, setMeta] = useState({ siteId: siteId ?? "", nodeId: "", name: "", serialNumber: "", installedAt: "" })
  const [error, setError] = useState<{ message: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<{ token: string; meterId: string } | null>(null)
  const site = useApi<{ nodes: Array<{ node_id: string; name: string }> }>(meta.siteId ? `/api/v1/sites/${meta.siteId}` : null)

  const models = useMemo(() => (catalog.data?.models ?? []).filter((m) => m.device_kind !== "gateway" && (m.resource == null || m.resource === resource)), [catalog.data, resource])
  const protocols = model?.protocols.filter((p) => ["manual", "modbus_tcp", "http_push"].includes(p)) ?? []

  useEffect(() => {
    if (!model) return
    setConnection(protocols[0] ?? "manual")
    // Универсальные профили (импульсы, HTTP push) подходят к любому ресурсу: подставляем величину и единицу.
    setChannels(
      model.channel_template.map((c) =>
        resource === "electricity" && c.quantity === "volume"
          ? { ...c, quantity: "energy_active", unit: "kWh", name: c.name.replace("Объём", "Энергия") }
          : resource !== "electricity" && c.quantity === "energy_active" && model.resource == null
            ? { ...c, quantity: "volume", unit: "m3" }
            : c,
      ),
    )
    setParams((p) => ({ ...p, port: String(model.connection_defaults.port ?? 502), unitId: String(model.connection_defaults.unitId ?? 1), timeoutMs: String(model.connection_defaults.timeoutMs ?? 2000) }))
    setMeta((m) => ({ ...m, name: m.name || `${RESOURCE_LABEL[resource]}: ${model.manufacturer === "Любой" || model.manufacturer.startsWith("Универсальный") ? model.model.toLowerCase() : `${model.manufacturer} ${model.model}`}` }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  const siteGateways = (gateways.data?.gateways ?? []).filter((g) => !meta.siteId || g.site_id === meta.siteId)

  const runProbe = async (all: boolean) => {
    setProbe({ state: "running" })
    try {
      const regs = (all ? channels : channels.slice(0, 1)).filter((c) => c.register).map((c) => ({ key: c.code, ...c.register }))
      const { jobId } = await api<{ jobId: string }>(`/api/v1/gateways/${params.gatewayId}/probe`, {
        body: { connectionParams: { host: params.host, port: Number(params.port), unitId: Number(params.unitId), timeoutMs: Number(params.timeoutMs) }, registers: regs },
      })
      const started = Date.now()
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500))
        const { job } = await api<{ job: { status: string; result: ProbeResult | null; error: string | null } }>(`/api/v1/jobs/${jobId}`)
        if (job.status === "done") return setProbe({ state: "done", result: job.result! })
        if (job.status === "failed") return setProbe({ state: "error", result: job.result ?? undefined, error: job.error ?? "Проверка не удалась" })
        if (job.status === "expired" || Date.now() - started > 90_000) return setProbe({ state: "error", error: "Шлюз не взял задание: проверьте, что агент запущен и на связи" })
      }
    } catch (e) {
      setProbe({ state: "error", error: (e as Error).message })
    }
  }

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ meterId: string }>("/api/v1/meters", {
        body: {
          siteId: meta.siteId,
          nodeId: meta.nodeId || null,
          resource,
          name: meta.name,
          serialNumber: meta.serialNumber || null,
          manufacturer: model?.manufacturer,
          model: model?.model,
          catalogModelId: model?.model_id,
          connection,
          gatewayId: connection === "modbus_tcp" ? params.gatewayId : null,
          connectionParams: connection === "modbus_tcp" ? { host: params.host, port: Number(params.port), unitId: Number(params.unitId), timeoutMs: Number(params.timeoutMs) } : {},
          pollIntervalSec: connection === "modbus_tcp" ? Number(params.pollIntervalSec) : null,
          installedAt: meta.installedAt ? new Date(meta.installedAt).toISOString() : null,
          channels,
          initialReadings: connection === "manual" ? initial : {},
        },
      })
      if (connection === "http_push") {
        const t = await api<{ token: string }>(`/api/v1/meters/${r.meterId}/token`, { body: {} })
        setToken({ token: t.token, meterId: r.meterId })
      } else router.replace(`/meters/${r.meterId}`)
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  const canNext = (() => {
    if (step === 1) return Boolean(model && model.compatibility !== "planned")
    if (step === 3 && connection === "modbus_tcp") return Boolean(params.gatewayId && params.host)
    if (step === 5) return channels.length > 0
    return true
  })()

  if (token) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Прибор добавлен" />
        <Panel title="Токен прибора для HTTP push" subtitle="Показывается один раз. При утере выпустите новый — старый перестанет работать.">
          <div className="space-y-3">
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{token.token}</pre>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px]">{`POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/ingest/v1/readings
X-Device-Token: ${token.token}
Content-Type: application/json

{"readings":[{"channel":"${channels[0]?.code}","at":"${new Date().toISOString().slice(0, 19)}Z","value":123.456}]}`}</pre>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigator.clipboard?.writeText(token.token)}>
                <Copy /> Скопировать токен
              </Button>
              <Link href={`/meters/${token.meterId}`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                К прибору
              </Link>
            </div>
          </div>
        </Panel>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Подключение прибора" subtitle={`Организация: ${me.org?.name}`} />
      <Stepper steps={steps} current={step} />
      <Panel>
        {step === 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {["electricity", "cold_water", "hot_water", "heat", "gas", "other"].map((r) => (
              <button key={r} type="button" onClick={() => setResource(r)} className={cn("rounded-xl border p-3 text-left text-sm font-medium", r === resource ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}>
                {RESOURCE_LABEL[r]}
              </button>
            ))}
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-2">
            {catalog.loading ? <Loader2 className="animate-spin" /> : null}
            {models.map((m) => (
              <button
                key={m.model_id}
                type="button"
                disabled={m.compatibility === "planned"}
                onClick={() => setModel(m)}
                className={cn("flex w-full flex-col gap-1 rounded-xl border p-3 text-left disabled:opacity-50", model?.model_id === m.model_id ? "border-primary bg-primary/10" : "border-border hover:bg-muted")}
              >
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {m.manufacturer} · {m.model} <Badge tone={COMPAT[m.compatibility].tone}>{COMPAT[m.compatibility].label}</Badge>
                </span>
                <span className="text-xs text-muted-foreground">{m.instruction}</span>
                {m.requires ? <span className="text-xs">Требуется: {m.requires}</span> : null}
              </button>
            ))}
            <p className="text-xs text-muted-foreground">
              Нет вашего прибора? Обычный счётчик без интерфейса подключается только через импульсный модуль или шлюз. Подберём совместимый вариант — <Link href="/catalog" className="underline">каталог</Link>.
            </p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-2">
            {protocols.map((p) => (
              <label key={p} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm", connection === p ? "border-primary bg-primary/10" : "border-border")}>
                <input type="radio" name="conn" checked={connection === p} onChange={() => setConnection(p)} className="accent-[oklch(0.65_0.17_115)]" />
                {CONN_LABEL[p]}
              </label>
            ))}
            {connection === "modbus_tcp" ? <Notice>Опрос выполняет шлюз SCADA EMS Gateway в вашей локальной сети. Облако не подключается к прибору напрямую — не пробрасывайте порт 502 в интернет.</Notice> : null}
          </div>
        ) : null}

        {step === 3 ? (
          connection === "modbus_tcp" ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Шлюз" className="sm:col-span-3" hint={siteGateways.length ? undefined : "Шлюзов нет — создайте его в разделе «Контроллеры»."}>
                <Select value={params.gatewayId} onChange={(e) => setParams({ ...params, gatewayId: e.target.value })}>
                  <option value="">Выберите шлюз</option>
                  {siteGateways.map((g) => (
                    <option key={g.gateway_id} value={g.gateway_id} disabled={g.status === "pending"}>
                      {g.name} {g.status === "pending" ? "(не зарегистрирован)" : g.status === "offline" ? "(не на связи)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="IP-адрес / хост в локальной сети" required>
                <Input value={params.host} onChange={(e) => setParams({ ...params, host: e.target.value.trim() })} placeholder="192.168.1.50" />
              </Field>
              <Field label="Порт">
                <Input inputMode="numeric" value={params.port} onChange={(e) => setParams({ ...params, port: e.target.value })} />
              </Field>
              <Field label="Unit ID (адрес на шине)">
                <Input inputMode="numeric" value={params.unitId} onChange={(e) => setParams({ ...params, unitId: e.target.value })} />
              </Field>
              <Field label="Таймаут, мс">
                <Input inputMode="numeric" value={params.timeoutMs} onChange={(e) => setParams({ ...params, timeoutMs: e.target.value })} />
              </Field>
              <Field label="Интервал опроса, с" hint={`Минимум по тарифу: ${me.subscription?.limits.min_poll_sec ?? "—"} с`}>
                <Input inputMode="numeric" value={params.pollIntervalSec} onChange={(e) => setParams({ ...params, pollIntervalSec: e.target.value })} />
              </Field>
            </div>
          ) : connection === "http_push" ? (
            <p className="text-[13px] text-muted-foreground">Параметры не нужны: после создания прибор получит персональный токен и будет отправлять показания сам.</p>
          ) : (
            <p className="text-[13px] text-muted-foreground">Ручной ввод: показания вносятся в разделе «Показания» с веба или телефона.</p>
          )
        ) : null}

        {step === 4 ? (
          connection === "modbus_tcp" ? (
            <ProbeView probe={probe} onRun={() => runProbe(false)} channels={channels.slice(0, 1)} />
          ) : (
            <p className="text-[13px] text-muted-foreground">{connection === "http_push" ? "Доступность проверится по первому полученному показанию — оно появится в карточке прибора." : "Для ручного ввода проверка связи не нужна."}</p>
          )
        ) : null}

        {step === 5 ? <ChannelEditor channels={channels} setChannels={setChannels} modbus={connection === "modbus_tcp"} /> : null}

        {step === 6 ? (
          connection === "modbus_tcp" ? (
            <div className="space-y-3">
              <ProbeView probe={probe} onRun={() => runProbe(true)} channels={channels} />
              <p className="text-xs text-muted-foreground">Сверьте значения с табло прибора: показание = значение регистра × масштаб × коэффициент + смещение.</p>
            </div>
          ) : connection === "manual" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {channels.filter((c) => c.measure_kind === "cumulative").map((c) => (
                <Field key={c.code} label={`${c.name}, ${unit(c.unit)}`} hint="Начальное показание с табло — точка отсчёта">
                  <Input inputMode="decimal" value={initial[c.code] ?? ""} onChange={(e) => setInitial({ ...initial, [c.code]: e.target.value })} />
                </Field>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">Показания придут от прибора после настройки токена.</p>
          )
        ) : null}

        {step === 7 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Объект" required>
              <Select value={meta.siteId} onChange={(e) => setMeta({ ...meta, siteId: e.target.value, nodeId: "" })}>
                {sites.map((s) => (
                  <option key={s.site_id} value={s.site_id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Узел (цех, линия, шкаф)" hint="Необязательно">
              <Select value={meta.nodeId} onChange={(e) => setMeta({ ...meta, nodeId: e.target.value })}>
                <option value="">— весь объект —</option>
                {(site.data?.nodes ?? []).map((n) => (
                  <option key={n.node_id} value={n.node_id}>
                    {n.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Название прибора" required>
              <Input value={meta.name} onChange={(e) => setMeta({ ...meta, name: e.target.value })} maxLength={120} />
            </Field>
            <Field label="Заводской номер">
              <Input value={meta.serialNumber} onChange={(e) => setMeta({ ...meta, serialNumber: e.target.value })} maxLength={60} />
            </Field>
            <Field label="Дата установки" hint="Пусто — сейчас">
              <Input type="datetime-local" value={meta.installedAt} onChange={(e) => setMeta({ ...meta, installedAt: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <ErrorBox error={error} />
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex justify-between gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" disabled={step === 0 || busy} onClick={() => setStep(step - 1)}>
            Назад
          </Button>
          {step < 7 ? (
            <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
              Далее
            </Button>
          ) : (
            <Button loading={busy} disabled={!meta.siteId || !meta.name.trim()} onClick={create}>
              Начать сбор данных
            </Button>
          )}
        </div>
      </Panel>
    </div>
  )
}

function ProbeView({ probe, onRun, channels }: { probe: { state: string; result?: ProbeResult; error?: string }; onRun: () => void; channels: Channel[] }) {
  return (
    <div className="space-y-3">
      <Button variant="outline" onClick={onRun} loading={probe.state === "running"}>
        {probe.state === "running" ? "Шлюз опрашивает прибор…" : "Проверить через шлюз"}
      </Button>
      {probe.result?.results?.map((r) => {
        const ch = channels.find((c) => c.code === r.key)
        const normalized = r.ok && r.value != null ? r.value * (ch?.multiplier ?? 1) + (ch?.value_offset ?? 0) : null
        return (
          <div key={r.key} className={cn("flex gap-2 rounded-lg border p-2 text-[13px]", r.ok ? "border-emerald-500/30" : "border-destructive/30")}>
            {r.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-destructive" />}
            <div>
              <p className="font-medium">{ch?.name ?? r.key}</p>
              {r.ok ? (
                <p className="ems-num text-xs text-muted-foreground">
                  регистр: {num(r.value!, 4)} (0x{r.hex}) → показание <span className="font-semibold text-foreground">{num(normalized!, 4)} {unit(ch?.unit)}</span> · {r.ms} мс
                </p>
              ) : (
                <p className="text-xs text-destructive">
                  {r.error}
                  {r.code && ERROR_HELP[r.code] ? <span className="block text-muted-foreground">{ERROR_HELP[r.code]}</span> : null}
                </p>
              )}
            </div>
          </div>
        )
      })}
      {probe.state === "error" && !probe.result ? <p className="text-[13px] text-destructive">{probe.error}</p> : null}
    </div>
  )
}

function ChannelEditor({ channels, setChannels, modbus }: { channels: Channel[]; setChannels: (c: Channel[]) => void; modbus: boolean }) {
  const upd = (i: number, patch: Partial<Channel>) => setChannels(channels.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const updReg = (i: number, patch: Partial<NonNullable<Channel["register"]>>) => upd(i, { register: { fn: 3, address: 0, dataType: "uint16", wordOrder: "ABCD", ...(channels[i].register ?? {}), ...patch } })
  return (
    <div className="space-y-3">
      {channels.map((c, i) => (
        <fieldset key={i} className="rounded-xl border border-border/70 p-3">
          <legend className="px-1 text-sm font-semibold">{c.name || `Канал ${i + 1}`}</legend>
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Код">
              <Input value={c.code} onChange={(e) => upd(i, { code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") })} />
            </Field>
            <Field label="Название">
              <Input value={c.name} onChange={(e) => upd(i, { name: e.target.value })} />
            </Field>
            <Field label="Величина">
              <Select value={c.quantity} onChange={(e) => upd(i, { quantity: e.target.value, measure_kind: ["power_active", "flow_rate", "temperature", "leak"].includes(e.target.value) ? "instant" : "cumulative" })}>
                {Object.entries(QUANTITY).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Единица">
              <Select value={c.unit} onChange={(e) => upd(i, { unit: e.target.value })}>
                {["kWh", "kW", "W", "m3", "m3/h", "L", "Gcal", "pulse"].map((u) => (
                  <option key={u} value={u}>
                    {unit(u)}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground sm:col-span-4">{c.measure_kind === "cumulative" ? "Накопительное показание: расход = разность показаний." : "Мгновенное значение: среднее, минимум и максимум за интервал."}</p>
            {modbus ? (
              <>
                <Field label="Функция">
                  <Select value={String(c.register?.fn ?? 3)} onChange={(e) => updReg(i, { fn: Number(e.target.value) })}>
                    <option value="3">03 — holding</option>
                    <option value="4">04 — input</option>
                  </Select>
                </Field>
                <Field label="Адрес регистра">
                  <Input inputMode="numeric" value={String(c.register?.address ?? 0)} onChange={(e) => updReg(i, { address: Number(e.target.value.replace(/\D/g, "")) })} />
                </Field>
                <Field label="Тип данных">
                  <Select value={c.register?.dataType ?? "uint16"} onChange={(e) => updReg(i, { dataType: e.target.value })}>
                    {["uint16", "int16", "uint32", "int32", "float32", "uint64"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Порядок байт">
                  <Select value={c.register?.wordOrder ?? "ABCD"} onChange={(e) => updReg(i, { wordOrder: e.target.value })}>
                    {["ABCD", "CDAB", "BADC", "DCBA"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Масштаб регистра" hint="Например 0,001 для Вт → кВт">
                  <Input inputMode="decimal" value={c.register?.scale == null ? "" : String(c.register.scale)} onChange={(e) => updReg(i, { scale: e.target.value === "" ? undefined : Number(e.target.value.replace(",", ".")) })} />
                </Field>
              </>
            ) : null}
            <Field label="Коэффициент" hint="Трансформации или вес импульса">
              <Input inputMode="decimal" value={String(c.multiplier ?? 1)} onChange={(e) => upd(i, { multiplier: Number(e.target.value.replace(",", ".")) || 1 })} />
            </Field>
            {c.measure_kind === "cumulative" ? (
              <>
                <Field label="Смещение" hint="Начальное показание для импульсов">
                  <Input inputMode="decimal" value={String(c.value_offset ?? 0)} onChange={(e) => upd(i, { value_offset: Number(e.target.value.replace(",", ".")) || 0 })} />
                </Field>
                <Field label="Зона тарифа">
                  <Select value={c.tariff_zone ?? ""} onChange={(e) => upd(i, { tariff_zone: e.target.value || null })}>
                    <option value="">— общий учёт —</option>
                    <option value="T1">T1</option>
                    <option value="T2">T2</option>
                    <option value="T3">T3</option>
                  </Select>
                </Field>
              </>
            ) : null}
          </div>
          {channels.length > 1 ? (
            <Button variant="ghost" size="sm" className="mt-2 text-destructive" onClick={() => setChannels(channels.filter((_, j) => j !== i))}>
              <Trash2 /> Удалить канал
            </Button>
          ) : null}
        </fieldset>
      ))}
      <Button variant="outline" size="sm" onClick={() => setChannels([...channels, { code: `ch${channels.length + 1}`, name: "Канал", quantity: "energy_active", measure_kind: "cumulative", unit: "kWh", register: modbus ? { fn: 3, address: 0, dataType: "uint32", wordOrder: "ABCD" } : null }])}>
        <Plus /> Добавить канал
      </Button>
    </div>
  )
}
