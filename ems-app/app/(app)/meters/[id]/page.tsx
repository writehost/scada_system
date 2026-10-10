"use client"

import { use, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, KeyRound, Pencil, Repeat, Trash2, X } from "lucide-react"
import { api, qs, useApi } from "@/lib/client/api"
import { dateRu, dateTimeRu, localInputValue, num, relative, RESOURCE_LABEL, unit } from "@/lib/client/format"
import { Badge, Button, ConfirmDialog, Dialog, ErrorBox, Field, Input, Panel, Segmented, Skeleton, useToast } from "@/components/ui"
import { ChartFrame, ConsumptionChart, type Series } from "@/components/ems/charts"
import { PeriodPicker, usePeriod } from "@/components/ems/period"
import { PageHeader, useApp } from "@/components/ems/shell"

type Detail = {
  meter: { meter_id: string; name: string; resource: string; status: string; connection: string; serial_number: string | null; manufacturer: string | null; model: string | null; site_name: string; timezone: string; gateway_name: string | null; gateway_status: string | null; gateway_seen: string | null; connection_params: Record<string, unknown>; poll_interval_sec: number | null; installed_at: string; removed_at: string | null; telemetry_timeout_min: number; verification_due: string | null }
  channels: Array<{ channel_id: number; code: string; name: string; quantity: string; measure_kind: string; unit: string; tariff_zone: string | null; is_billing: boolean; register: Record<string, unknown> | null; multiplier: number; value_offset: number; rollover_at: number | null; max_rate_per_hour: number | null; decimals: number; last_value: number | null; last_at: string | null; coefficients: Array<{ effectiveFrom: string; multiplier: number; boundaryRaw: number | null; reason: string | null }> }>
  tokens: Array<{ prefix: string; created_at: string; last_used_at: string | null }>
  replaced: { meter_id: string; name: string } | null
  replacedBy: { meter_id: string; name: string } | null
}

type Reading = { measuredAt: string; receivedAt: string; raw: number; value: number; delta: number | null; deltaKind: string | null; quality: string; flags: string[]; source: string; note: string | null }

const SOURCE: Record<string, string> = { manual: "вручную", gateway: "шлюз", http_push: "HTTP", modbus_tcp: "Modbus", import: "импорт", demo: "демо" }

export default function MeterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const toast = useToast()
  const { can } = useApp()
  const q = useApi<Detail>(`/api/v1/meters/${id}`)
  const [tab, setTab] = useState<"readings" | "chart" | "diagnostics">("readings")
  const [channel, setChannel] = useState<number | null>(null)
  const [dialog, setDialog] = useState<null | "edit" | "replace" | "archive" | "coef" | "token">(null)
  const [newToken, setNewToken] = useState<string | null>(null)
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  if (!q.data) return <Skeleton className="h-64" />
  const { meter, channels } = q.data
  const ch = channels.find((c) => c.channel_id === channel) ?? channels[0]
  const active = meter.status === "active"

  return (
    <div className="space-y-4">
      <Link href="/meters" className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Счётчики
      </Link>
      <PageHeader
        title={meter.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            {RESOURCE_LABEL[meter.resource]} · {meter.site_name}
            {meter.serial_number ? ` · № ${meter.serial_number}` : ""}
            {meter.manufacturer ? ` · ${meter.manufacturer} ${meter.model ?? ""}` : ""}
            {!active ? <Badge tone="warning">{meter.status === "replaced" ? `заменён ${dateRu(meter.removed_at)}` : "выведен из эксплуатации"}</Badge> : null}
          </span>
        }
        actions={
          can("devices.write") && active ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog("edit")}>
                <Pencil /> Изменить
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog("replace")}>
                <Repeat /> Замена прибора
              </Button>
              {meter.connection === "http_push" ? (
                <Button variant="outline" size="sm" onClick={() => setDialog("token")}>
                  <KeyRound /> Новый токен
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDialog("archive")}>
                <Trash2 /> Вывести
              </Button>
            </>
          ) : null
        }
      />
      {q.data.replaced ? <p className="text-[13px] text-muted-foreground">Заменил прибор <Link className="underline" href={`/meters/${q.data.replaced.meter_id}`}>{q.data.replaced.name}</Link>.</p> : null}
      {q.data.replacedBy ? <p className="text-[13px] text-muted-foreground">Заменён прибором <Link className="underline" href={`/meters/${q.data.replacedBy.meter_id}`}>{q.data.replacedBy.name}</Link>. История сохранена.</p> : null}

      <div className="grid gap-3 md:grid-cols-3">
        <Panel title="Подключение" className="md:col-span-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="text-muted-foreground">Способ</dt>
            <dd>{meter.connection === "manual" ? "Ручной ввод" : meter.connection === "http_push" ? "HTTP push" : "Modbus TCP"}</dd>
            {meter.connection === "modbus_tcp" ? (
              <>
                <dt className="text-muted-foreground">Шлюз</dt>
                <dd>
                  {meter.gateway_name} <Badge tone={meter.gateway_status === "online" ? "success" : "danger"}>{meter.gateway_status === "online" ? "на связи" : "не на связи"}</Badge>
                </dd>
                <dt className="text-muted-foreground">Адрес</dt>
                <dd className="font-mono text-xs">
                  {String(meter.connection_params.host)}:{String(meter.connection_params.port)} · unit {String(meter.connection_params.unitId)}
                </dd>
                <dt className="text-muted-foreground">Опрос</dt>
                <dd>каждые {meter.poll_interval_sec} с</dd>
              </>
            ) : null}
            {meter.connection === "http_push" ? (
              <>
                <dt className="text-muted-foreground">Токен</dt>
                <dd>{q.data.tokens[0] ? `${q.data.tokens[0].prefix}… · ${q.data.tokens[0].last_used_at ? `использован ${relative(q.data.tokens[0].last_used_at)}` : "ещё не использовался"}` : "не выпущен"}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Нет данных</dt>
            <dd>предупреждать через {meter.telemetry_timeout_min >= 1440 ? `${Math.round(meter.telemetry_timeout_min / 1440)} дн.` : `${meter.telemetry_timeout_min} мин`}</dd>
            <dt className="text-muted-foreground">Установлен</dt>
            <dd>{dateRu(meter.installed_at)}</dd>
            {meter.verification_due ? (
              <>
                <dt className="text-muted-foreground">Поверка</dt>
                <dd>до {dateRu(meter.verification_due)}</dd>
              </>
            ) : null}
          </dl>
        </Panel>
        <Panel title="Каналы измерения" className="md:col-span-2" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="ems-table">
              <thead>
                <tr>
                  <th>Канал</th>
                  <th>Показание</th>
                  <th className="hidden sm:table-cell">Коэффициент</th>
                  <th className="hidden md:table-cell">Регистр</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.channel_id}>
                    <td>
                      <p className="font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.measure_kind === "cumulative" ? "накопительный" : "мгновенный"}
                        {c.tariff_zone ? ` · зона ${c.tariff_zone}` : ""}
                        {!c.is_billing ? " · не для расчётов" : ""}
                      </p>
                    </td>
                    <td className="ems-num">
                      {c.last_value == null ? "—" : `${num(c.last_value, c.decimals)} ${unit(c.unit)}`}
                      <p className="text-xs text-muted-foreground">{relative(c.last_at)}</p>
                    </td>
                    <td className="ems-num hidden text-[13px] sm:table-cell">
                      ×{num(c.multiplier, 6)}
                      {c.coefficients?.length > 1 ? <p className="text-xs text-muted-foreground">менялся {c.coefficients.length - 1} раз</p> : null}
                    </td>
                    <td className="hidden font-mono text-xs md:table-cell">{c.register ? `fn${String(c.register.fn)} @${String(c.register.address)} ${String(c.register.dataType)} ${String(c.register.wordOrder)}` : "—"}</td>
                    <td className="text-right">
                      {can("devices.write") && active && c.measure_kind === "cumulative" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setChannel(c.channel_id)
                            setDialog("coef")
                          }}
                        >
                          Коэффициент
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={tab} onChange={setTab} size="default" options={[{ value: "readings", label: "Показания" }, { value: "chart", label: "График" }, { value: "diagnostics", label: "Диагностика" }]} />
        {tab !== "diagnostics" && channels.length > 1 ? (
          <select aria-label="Канал" className="ems-input h-8 w-auto text-[13px]" value={ch.channel_id} onChange={(e) => setChannel(Number(e.target.value))}>
            {channels.map((c) => (
              <option key={c.channel_id} value={c.channel_id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      {tab === "readings" ? <ReadingsJournal channelId={ch.channel_id} unitCode={ch.unit} decimals={ch.decimals} canCorrect={can("readings.correct")} /> : null}
      {tab === "chart" ? <MeterChart channelId={ch.channel_id} tz={meter.timezone} /> : null}
      {tab === "diagnostics" ? <Diagnostics meterId={id} /> : null}

      <EditMeterDialog open={dialog === "edit"} onClose={() => setDialog(null)} detail={q.data} onSaved={q.reload} />
      <ReplaceDialog open={dialog === "replace"} onClose={() => setDialog(null)} detail={q.data} onDone={(newId) => router.replace(`/meters/${newId}`)} />
      <CoefficientDialog open={dialog === "coef"} onClose={() => setDialog(null)} channel={ch} onDone={q.reload} />
      <ConfirmDialog
        open={dialog === "archive"}
        onClose={() => setDialog(null)}
        title="Вывести прибор из эксплуатации?"
        text="Сбор данных прекратится, история показаний сохранится. Если прибор меняется на новый — используйте «Замена прибора»."
        confirmText={meter.name}
        confirmLabel="Вывести"
        onConfirm={async () => {
          await api(`/api/v1/meters/${id}?confirm=${encodeURIComponent(meter.name)}`, { method: "DELETE" })
          toast("Прибор выведен из эксплуатации")
          router.replace("/meters")
        }}
      />
      <ConfirmDialog
        open={dialog === "token"}
        onClose={() => setDialog(null)}
        title="Выпустить новый токен?"
        text="Прежний токен перестанет работать сразу. Обновите его в прошивке устройства."
        confirmLabel="Выпустить"
        destructive={false}
        onConfirm={async () => {
          const r = await api<{ token: string }>(`/api/v1/meters/${id}/token`, { body: {} })
          setNewToken(r.token)
          q.reload()
        }}
      />
      <Dialog open={Boolean(newToken)} onClose={() => setNewToken(null)} title="Новый токен прибора" description="Показывается один раз.">
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{newToken}</pre>
      </Dialog>
    </div>
  )
}

function ReadingsJournal({ channelId, unitCode, decimals, canCorrect }: { channelId: number; unitCode: string; decimals: number; canCorrect: boolean }) {
  const q = useApi<{ readings: Reading[]; flagLabels: Record<string, string> }>(`/api/v1/readings${qs({ channelId, limit: 300 })}`)
  const [fix, setFix] = useState<Reading | null>(null)
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />
  return (
    <Panel title="Журнал показаний" subtitle="Исходные значения хранятся всегда; исправления записываются в историю" bodyClassName="p-0">
      {!q.data ? (
        <Skeleton className="m-4 h-32" />
      ) : !q.data.readings.length ? (
        <p className="p-4 text-[13px] text-muted-foreground">Показаний ещё нет.</p>
      ) : (
        <div className="max-h-[520px] overflow-auto">
          <table className="ems-table">
            <thead className="sticky top-0">
              <tr>
                <th>Время измерения</th>
                <th className="text-right">Показание</th>
                <th className="text-right">Расход</th>
                <th>Качество</th>
                <th className="hidden md:table-cell">Источник</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.readings.map((r) => (
                <tr key={r.measuredAt} className={r.quality === "bad" ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}>
                  <td className="whitespace-nowrap text-[13px]">
                    {dateTimeRu(r.measuredAt)}
                    {Math.abs(new Date(r.receivedAt).getTime() - new Date(r.measuredAt).getTime()) > 3600000 ? <span className="block text-[11px] text-muted-foreground no-underline">получено {dateTimeRu(r.receivedAt)}</span> : null}
                  </td>
                  <td className="ems-num text-right">
                    {num(r.value, decimals)} {unit(unitCode)}
                    {r.raw !== r.value ? <span className="block text-[11px] text-muted-foreground">регистр {num(r.raw, 4)}</span> : null}
                  </td>
                  <td className="ems-num text-right">{r.delta == null ? (r.deltaKind === "baseline" ? <span className="text-xs text-muted-foreground">начало</span> : r.deltaKind === "reset" ? <span className="text-xs text-amber-700">неизвестен</span> : "—") : `+${num(r.delta, decimals)}`}</td>
                  <td className="no-underline">
                    <Badge tone={r.quality === "good" ? "success" : r.quality === "suspect" ? "warning" : "danger"}>{r.quality === "good" ? "норма" : r.quality === "suspect" ? "сомнительно" : "отклонено"}</Badge>
                    {r.flags.length ? <p className="mt-0.5 max-w-xs text-[11px] text-muted-foreground">{r.flags.map((f) => q.data!.flagLabels[f] ?? f).join("; ")}</p> : null}
                  </td>
                  <td className="hidden text-xs text-muted-foreground md:table-cell">
                    {SOURCE[r.source] ?? r.source}
                    {r.note ? <span className="block">{r.note}</span> : null}
                  </td>
                  <td className="text-right">
                    {canCorrect ? (
                      <Button variant="ghost" size="sm" onClick={() => setFix(r)}>
                        Исправить
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CorrectionDialog reading={fix} channelId={channelId} onClose={() => setFix(null)} onDone={q.reload} />
    </Panel>
  )
}

function CorrectionDialog({ reading, channelId, onClose, onDone }: { reading: Reading | null; channelId: number; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [action, setAction] = useState<"edit" | "reject" | "confirm">("edit")
  const [value, setValue] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  if (!reading) return null
  return (
    <Dialog
      open
      onClose={onClose}
      title="Исправление показания"
      description={`${dateTimeRu(reading.measuredAt)} · ${num(reading.raw, 4)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            disabled={!reason.trim() || (action === "edit" && value === "")}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await api("/api/v1/readings/correct", { body: { channelId, measuredAt: reading.measuredAt, action, value: value.replace(",", "."), reason } })
                toast("Исправление сохранено, расход пересчитан")
                onDone()
                onClose()
              } catch (e) {
                setError(e as Error)
              } finally {
                setBusy(false)
              }
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Segmented value={action} onChange={setAction} options={[{ value: "edit", label: "Исправить значение" }, { value: "reject", label: "Отклонить" }, { value: "confirm", label: "Подтвердить", disabled: reading.quality !== "suspect" }]} />
        {action === "edit" ? (
          <Field label="Верное значение регистра / табло">
            <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
          </Field>
        ) : null}
        <Field label="Причина" hint="Попадёт в журнал изменений">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Опечатка при вводе" />
        </Field>
        <ErrorBox error={error} />
      </div>
    </Dialog>
  )
}

function MeterChart({ channelId, tz }: { channelId: number; tz: string }) {
  const p = usePeriod("week")
  const q = useApi<{ series: Series[] }>(`/api/v1/series${qs({ channelIds: channelId, from: p.period.from, to: p.period.to, resolution: p.period.resolution })}`)
  return (
    <Panel title="График канала">
      <ChartFrame name={`канал-${channelId}`} toolbar={<PeriodPicker state={p} />}>
        {() => (q.loading && !q.data ? <Skeleton className="h-full" /> : <ConsumptionChart series={q.data?.series ?? []} tz={tz} />)}
      </ChartFrame>
    </Panel>
  )
}

function Diagnostics({ meterId }: { meterId: string }) {
  const q = useApi<{ log: Array<{ log_id: number; level: string; code: string; message: string; created_at: string }>; corrections: Array<{ correction_id: number; channel_name: string; measured_at: string; action: string; old_value: number | null; new_value: number | null; reason: string | null; actor: string | null; created_at: string }>; conflicts: Array<{ channel_name: string; measured_at: string; existing_value: number; incoming_value: number; source: string; received_at: string }> }>(`/api/v1/meters/${meterId}/diagnostics`)
  if (!q.data) return <Skeleton className="h-40" />
  const ACTION: Record<string, string> = { create: "ввод", reject: "отклонено", restore: "подтверждено", edit: "исправлено" }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel title="Журнал подключения" subtitle="Ошибки связи и регистров от шлюза" bodyClassName="p-0">
        {q.data.log.length ? (
          <ul className="max-h-96 divide-y divide-border/60 overflow-auto">
            {q.data.log.map((l) => (
              <li key={l.log_id} className="flex gap-2 px-4 py-2 text-[13px]">
                {l.level === "error" ? <X className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
                <div>
                  <p>{l.message}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {dateTimeRu(l.created_at)} · {l.code}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-[13px] text-muted-foreground">Записей нет.</p>
        )}
      </Panel>
      <Panel title="История изменений показаний" bodyClassName="p-0">
        {q.data.corrections.length ? (
          <ul className="max-h-96 divide-y divide-border/60 overflow-auto">
            {q.data.corrections.map((k) => (
              <li key={k.correction_id} className="px-4 py-2 text-[13px]">
                <p>
                  <span className="font-medium">{ACTION[k.action] ?? k.action}</span> · {k.channel_name} · {dateTimeRu(k.measured_at)}
                  {k.old_value != null || k.new_value != null ? <span className="ems-num text-muted-foreground"> · {k.old_value != null ? num(k.old_value, 4) : "—"} → {k.new_value != null ? num(k.new_value, 4) : "—"}</span> : null}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {k.reason ?? "без причины"} · {k.actor ?? "система"} · {dateTimeRu(k.created_at)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-[13px] text-muted-foreground">Изменений нет.</p>
        )}
        {q.data.conflicts.length ? (
          <div className="border-t border-border/60 p-4 text-[13px]">
            <p className="font-medium">Конфликты повторной доставки</p>
            {q.data.conflicts.map((c, i) => (
              <p key={i} className="text-xs text-muted-foreground">
                {c.channel_name}, {dateTimeRu(c.measured_at)}: сохранено {num(c.existing_value, 4)}, пришло {num(c.incoming_value, 4)} ({c.source})
              </p>
            ))}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}

function EditMeterDialog({ open, onClose, detail, onSaved }: { open: boolean; onClose: () => void; detail: Detail; onSaved: () => void }) {
  const m = detail.meter
  const [form, setForm] = useState({ name: m.name, serialNumber: m.serial_number ?? "", pollIntervalSec: String(m.poll_interval_sec ?? ""), telemetryTimeoutMin: String(m.telemetry_timeout_min), verificationDue: m.verification_due ?? "", host: String(m.connection_params.host ?? ""), port: String(m.connection_params.port ?? 502), unitId: String(m.connection_params.unitId ?? 1) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Параметры прибора"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await api(`/api/v1/meters/${m.meter_id}`, {
                  method: "PATCH",
                  body: {
                    name: form.name,
                    serialNumber: form.serialNumber || null,
                    pollIntervalSec: m.connection === "modbus_tcp" ? form.pollIntervalSec : undefined,
                    telemetryTimeoutMin: form.telemetryTimeoutMin,
                    verificationDue: form.verificationDue || null,
                    connectionParams: m.connection === "modbus_tcp" ? { host: form.host, port: Number(form.port), unitId: Number(form.unitId), timeoutMs: m.connection_params.timeoutMs ?? 2000 } : undefined,
                  },
                })
                onSaved()
                onClose()
              } catch (e) {
                setError(e as Error)
              } finally {
                setBusy(false)
              }
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Название" className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Заводской номер">
          <Input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} />
        </Field>
        <Field label="Дата следующей поверки">
          <Input type="date" value={form.verificationDue} onChange={(e) => setForm({ ...form, verificationDue: e.target.value })} />
        </Field>
        <Field label="Сообщать об отсутствии данных через, мин">
          <Input inputMode="numeric" value={form.telemetryTimeoutMin} onChange={(e) => setForm({ ...form, telemetryTimeoutMin: e.target.value })} />
        </Field>
        {m.connection === "modbus_tcp" ? (
          <>
            <Field label="Интервал опроса, с">
              <Input inputMode="numeric" value={form.pollIntervalSec} onChange={(e) => setForm({ ...form, pollIntervalSec: e.target.value })} />
            </Field>
            <Field label="IP-адрес">
              <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </Field>
            <Field label="Порт / Unit ID">
              <div className="flex gap-2">
                <Input value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                <Input value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })} />
              </div>
            </Field>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <ErrorBox error={error} />
        </div>
      </div>
    </Dialog>
  )
}

function ReplaceDialog({ open, onClose, detail, onDone }: { open: boolean; onClose: () => void; detail: Detail; onDone: (id: string) => void }) {
  const cum = detail.channels.filter((c) => c.measure_kind === "cumulative")
  const [at, setAt] = useState(localInputValue())
  const [name, setName] = useState(`${detail.meter.name} (новый)`)
  const [serial, setSerial] = useState("")
  const [finals, setFinals] = useState<Record<string, string>>({})
  const [initials, setInitials] = useState<Record<string, string>>(() => Object.fromEntries(cum.map((c) => [c.code, "0"])))
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Замена прибора"
      description="Старый прибор закрывается финальным показанием, новый начинает с начального. Расход объекта не теряется и не задваивается."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            disabled={!name.trim() || cum.some((c) => finals[c.code] == null || finals[c.code] === "")}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                const r = await api<{ newMeterId: string }>(`/api/v1/meters/${detail.meter.meter_id}/replace`, { body: { at: new Date(at).toISOString(), name, serialNumber: serial || null, finalReadings: finals, initialReadings: initials, reason: reason || null } })
                onDone(r.newMeterId)
              } catch (e) {
                setError(e as Error)
              } finally {
                setBusy(false)
              }
            }}
          >
            Заменить
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Дата и время замены">
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Причина">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Истёк срок поверки" />
        </Field>
        {cum.map((c) => (
          <Field key={c.code} label={`Финальное показание старого: ${c.name}`} hint={c.last_value != null ? `последнее в системе ${num(c.last_value, c.decimals)}` : undefined}>
            <Input inputMode="decimal" value={finals[c.code] ?? ""} onChange={(e) => setFinals({ ...finals, [c.code]: e.target.value })} />
          </Field>
        ))}
        <Field label="Новый прибор: название">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Заводской номер">
          <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
        </Field>
        {cum.map((c) => (
          <Field key={`n${c.code}`} label={`Начальное показание нового: ${c.name}`}>
            <Input inputMode="decimal" value={initials[c.code] ?? ""} onChange={(e) => setInitials({ ...initials, [c.code]: e.target.value })} />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <ErrorBox error={error} />
        </div>
      </div>
    </Dialog>
  )
}

function CoefficientDialog({ open, onClose, channel, onDone }: { open: boolean; onClose: () => void; channel: Detail["channels"][number]; onDone: () => void }) {
  const [at, setAt] = useState(localInputValue())
  const [mult, setMult] = useState(String(channel.multiplier))
  const [boundary, setBoundary] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Смена коэффициента: ${channel.name}`}
      description="Например, замена трансформаторов тока или другой вес импульса. Показания до момента смены пересчитываться не будут."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={busy}
            disabled={!reason.trim() || !mult}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await api(`/api/v1/channels/${channel.channel_id}/coefficient`, { body: { effectiveFrom: new Date(at).toISOString(), multiplier: mult.replace(",", "."), boundaryRaw: boundary === "" ? null : boundary.replace(",", "."), reason } })
                onDone()
                onClose()
              } catch (e) {
                setError(e as Error)
              } finally {
                setBusy(false)
              }
            }}
          >
            Сохранить
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Момент смены">
          <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </Field>
        <Field label="Новый коэффициент">
          <Input inputMode="decimal" value={mult} onChange={(e) => setMult(e.target.value)} />
        </Field>
        <Field label="Показание регистра в момент смены" hint="Без него расход за интервал через границу будет неизвестен" className="sm:col-span-2">
          <Input inputMode="decimal" value={boundary} onChange={(e) => setBoundary(e.target.value)} />
        </Field>
        <Field label="Причина" className="sm:col-span-2">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorBox error={error} />
        </div>
      </div>
    </Dialog>
  )
}
