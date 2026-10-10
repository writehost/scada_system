"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, PencilLine, XCircle } from "lucide-react"
import { api, qs, useApi } from "@/lib/client/api"
import { dateTimeRu, localInputValue, num, relative, RESOURCE_LABEL, unit } from "@/lib/client/format"
import { Button, Empty, ErrorBox, Field, Input, Notice, Panel, Skeleton, useToast } from "@/components/ui"
import { NeedSite, PageHeader, useApp } from "@/components/ems/shell"

type MeterRow = { meter_id: string; name: string; resource: string; connection: string; channels: Array<{ channelId: number; name: string; unit: string; lastValue: number | null; lastAt: string | null; measureKind: string; decimals: number; tariffZone: string | null }> }
type Result = { channelId: number; status: string; quality?: string; delta?: number | null; reason?: string; flagLabels: string[] }

export default function ReadingsPage() {
  return <NeedSite>{(siteId) => <Readings siteId={siteId} />}</NeedSite>
}

function Readings({ siteId }: { siteId: string }) {
  const { can } = useApp()
  const toast = useToast()
  const meters = useApi<{ meters: MeterRow[] }>(`/api/v1/meters${qs({ siteId })}`)
  const attention = useApi<{ items: Array<{ channel_id: number; measured_at: string; value: number; quality: string; flags: string[]; channel_name: string; meter_id: string; meter_name: string; unit: string }>; flagLabels: Record<string, string> }>("/api/v1/readings/attention")
  const [at, setAt] = useState(localInputValue())
  const [values, setValues] = useState<Record<number, string>>({})
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string } | null>(null)

  const list = (meters.data?.meters ?? []).filter((m) => m.channels.some((c) => c.measureKind === "cumulative"))
  const manualFirst = [...list].sort((a, b) => (a.connection === "manual" ? 0 : 1) - (b.connection === "manual" ? 0 : 1))
  const warnings = useMemo(() => {
    const w: Record<number, string> = {}
    for (const m of list)
      for (const c of m.channels) {
        const raw = values[c.channelId]
        if (raw == null || raw === "") continue
        const v = Number(raw.replace(/\s/g, "").replace(",", "."))
        if (!Number.isFinite(v)) w[c.channelId] = "Введите число"
        else if (v < 0) w[c.channelId] = "Показание не может быть отрицательным"
        else if (c.lastValue != null && v < c.lastValue) w[c.channelId] = `Меньше предыдущего (${num(c.lastValue, c.decimals)}). Если счётчик заменён — используйте «Замена прибора».`
      }
    return w
  }, [values, list])

  const submit = async () => {
    const items = Object.entries(values)
      .filter(([, v]) => v !== "")
      .map(([channelId, value]) => ({ channelId: Number(channelId), value: value.replace(/\s/g, "").replace(",", "."), at: new Date(at).toISOString() }))
    if (!items.length) return
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ results: Result[] }>("/api/v1/readings", { body: { items } })
      setResults(r.results)
      const ok = r.results.filter((x) => x.status === "accepted" && x.quality !== "bad").length
      toast(`Принято показаний: ${ok} из ${items.length}`, ok === items.length ? "success" : "error")
      setValues({})
      meters.reload()
      attention.reload()
    } catch (e) {
      setError(e as Error)
    } finally {
      setBusy(false)
    }
  }

  const chName = (id: number) => {
    for (const m of list) for (const c of m.channels) if (c.channelId === id) return `${m.name} · ${c.name}`
    return String(id)
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Показания" subtitle="Ручной ввод с проверкой и журналом изменений" />
      {meters.loading && !meters.data ? (
        <Skeleton className="h-48" />
      ) : !list.length ? (
        <Panel>
          <Empty icon={PencilLine} title="Нет счётчиков" text="Сначала добавьте счётчик — затем здесь можно вносить его показания." action={<Link href="/meters/new" className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Добавить счётчик</Link>} />
        </Panel>
      ) : (
        <Panel title="Внести показания" subtitle="Заполните только нужные поля. Время — когда сняты показания.">
          <div className="mb-4 max-w-xs">
            <Field label="Дата и время снятия" htmlFor="at">
              <Input id="at" type="datetime-local" value={at} max={localInputValue(new Date(Date.now() + 60000))} onChange={(e) => setAt(e.target.value)} />
            </Field>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {manualFirst.map((m) => (
              <fieldset key={m.meter_id} className="rounded-xl border border-border/70 p-3">
                <legend className="px-1 text-sm font-semibold">
                  {m.name} <span className="font-normal text-muted-foreground">· {RESOURCE_LABEL[m.resource]}</span>
                </legend>
                {m.connection !== "manual" ? <p className="mb-2 text-xs text-muted-foreground">Прибор передаёт данные автоматически — ручное показание пригодится для сверки.</p> : null}
                <div className="space-y-2">
                  {m.channels
                    .filter((c) => c.measureKind === "cumulative")
                    .map((c) => (
                      <Field
                        key={c.channelId}
                        label={`${c.name}, ${unit(c.unit)}`}
                        htmlFor={`ch${c.channelId}`}
                        hint={c.lastValue != null ? `Предыдущее: ${num(c.lastValue, c.decimals)} · ${relative(c.lastAt)}` : "Первое показание станет точкой отсчёта"}
                        error={warnings[c.channelId]}
                      >
                        <Input id={`ch${c.channelId}`} inputMode="decimal" autoComplete="off" value={values[c.channelId] ?? ""} aria-invalid={Boolean(warnings[c.channelId])} onChange={(e) => setValues({ ...values, [c.channelId]: e.target.value })} placeholder={c.lastValue != null ? num(c.lastValue, c.decimals) : "0"} />
                      </Field>
                    ))}
                </div>
              </fieldset>
            ))}
          </div>
          <ErrorBox error={error} />
          <div className="mt-4 flex justify-end">
            <Button onClick={submit} loading={busy} disabled={!can("readings.write") || !Object.values(values).some((v) => v !== "")}>
              Сохранить показания
            </Button>
          </div>
          {results ? (
            <ul className="mt-4 space-y-1.5 border-t border-border/60 pt-3 text-[13px]">
              {results.map((r) => (
                <li key={r.channelId} className="flex gap-2">
                  {r.status === "accepted" && r.quality === "good" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : r.status === "accepted" && r.quality === "suspect" ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                  <span>
                    <span className="font-medium">{chName(r.channelId)}</span>:{" "}
                    {r.status === "duplicate"
                      ? "такое показание уже сохранено"
                      : r.status === "conflict"
                        ? "на это время уже есть другое показание — исправьте его в журнале прибора"
                        : r.status === "rejected"
                          ? `не принято (${r.reason === "before_install" ? "раньше даты установки прибора" : r.reason})`
                          : r.quality === "bad"
                            ? `сохранено, но не учтено: ${r.flagLabels.join("; ")}`
                            : r.delta != null
                              ? `расход ${num(r.delta, 3)} с прошлого показания${r.quality === "suspect" ? ` — ${r.flagLabels.join("; ")}` : ""}`
                              : "принято как точка отсчёта"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      )}

      <Panel title="Требуют внимания" subtitle="Сомнительные и отклонённые показания за 60 дней" bodyClassName="p-0">
        {attention.data?.items.length ? (
          <ul className="divide-y divide-border/60">
            {attention.data.items.map((a) => (
              <li key={`${a.channel_id}-${a.measured_at}`} className="flex flex-wrap items-center gap-2 px-4 py-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  <Link href={`/meters/${a.meter_id}`} className="font-medium hover:underline">
                    {a.meter_name}
                  </Link>{" "}
                  · {a.channel_name} · {dateTimeRu(a.measured_at)} · <span className="ems-num">{num(a.value, 3)} {unit(a.unit)}</span>
                  <span className="block text-xs text-muted-foreground">{a.flags.map((f) => attention.data!.flagLabels[f] ?? f).join("; ")}</span>
                </span>
                <Link href={`/meters/${a.meter_id}`} className="text-xs underline">
                  Проверить
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Notice className="m-4" tone="success">
            Все показания в порядке.
          </Notice>
        )}
      </Panel>
    </div>
  )
}
