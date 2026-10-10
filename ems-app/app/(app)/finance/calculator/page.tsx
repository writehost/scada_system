"use client"

import { useState } from "react"
import Link from "next/link"
import { api } from "@/lib/client/api"
import { num, rub, unit } from "@/lib/client/format"
import { Button, ErrorBox, Field, Input, Notice, Panel, Segmented } from "@/components/ui"
import { PageHeader, useApp } from "@/components/ems/shell"
import { TariffForm, type TariffDraft } from "@/components/ems/tariff-form"

type Result = { amount: number | null; lines: Array<{ label: string; qty: number | null; unit: string | null; price: number | null; amount: number }>; warnings: string[] }

export default function CalculatorPage() {
  const { industrial } = useApp()
  const [tab, setTab] = useState<"electricity" | "water" | "utilities">("electricity")
  return (
    <div className="space-y-4">
      <PageHeader title="Калькуляторы" subtitle="Расчёт стоимости по введённым количествам. Ничего не сохраняется." />
      <Segmented value={tab} onChange={setTab} size="default" options={[{ value: "electricity", label: "Электричество" }, { value: "water", label: "Вода" }, { value: "utilities", label: "Коммунальные расходы" }]} />
      {tab === "electricity" ? <ElectricityCalc industrial={industrial} /> : null}
      {tab === "water" ? <WaterCalc /> : null}
      {tab === "utilities" ? (
        <Panel title="Коммунальные расходы за месяц">
          <p className="text-[13px] text-muted-foreground">
            Сводный расчёт по вашим счётчикам и тарифам: стоимость за текущий период, прогноз до конца месяца, разница с прошлым месяцем и доля каждой услуги — в разделе{" "}
            <Link href="/costs" className="underline">
              «Сводка расходов»
            </Link>
            . Услуги без счётчика (интернет, домофон) учитываются как фиксированные или введённые вручную начисления.
          </p>
        </Panel>
      ) : null}
    </div>
  )
}

function ResultView({ r }: { r: Result | null }) {
  if (!r) return null
  return (
    <div className="mt-4 rounded-xl border border-border/70 p-3">
      <p className="text-[11px] text-muted-foreground">Итого</p>
      <p className="ems-num text-2xl font-semibold">{rub(r.amount, 2)}</p>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i} className="border-t border-border/50">
              <td className="py-1">{l.label}</td>
              <td className="ems-num py-1 text-right text-muted-foreground">{l.qty != null ? `${num(l.qty, 3)} ${unit(l.unit)} × ${num(l.price, 4)} ₽` : ""}</td>
              <td className="ems-num py-1 pl-2 text-right">{rub(l.amount, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-700">
          {w}
        </p>
      ))}
    </div>
  )
}

function ElectricityCalc({ industrial }: { industrial: boolean }) {
  const [draft, setDraft] = useState<TariffDraft | null>(null)
  const [qty, setQty] = useState("")
  const [zoneQty, setZoneQty] = useState<Record<string, string>>({ T1: "", T2: "", T3: "" })
  const [r, setR] = useState<Result | null>(null)
  const [error, setError] = useState<{ message: string } | null>(null)
  const zones = draft?.kind === "zones" ? ((draft.config.zones as Array<{ code: string; name: string }>) ?? []) : []
  return (
    <Panel title="Электроэнергия" subtitle="Одноставочный, двухтарифный или многозонный учёт">
      <TariffForm service="electricity" industrial={industrial} onChange={setDraft} />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {zones.length ? (
          zones.map((z) => (
            <Field key={z.code} label={`${z.name} (${z.code}), кВт·ч`}>
              <Input inputMode="decimal" value={zoneQty[z.code] ?? ""} onChange={(e) => setZoneQty({ ...zoneQty, [z.code]: e.target.value })} />
            </Field>
          ))
        ) : (
          <Field label="Расход, кВт·ч">
            <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
        )}
      </div>
      <Notice className="mt-3">Для промышленных договоров ставки за мощность и дополнительные составляющие задаются по условиям вашего договора — универсальных формул калькулятор не подставляет.</Notice>
      <Button
        className="mt-3"
        onClick={async () => {
          setError(null)
          try {
            setR(await api<Result>("/api/v1/calculator", { body: { service: "electricity", kind: draft?.kind, config: draft?.config, qty: qty.replace(",", "."), zoneQty } }))
          } catch (e) {
            setError(e as Error)
          }
        }}
      >
        Рассчитать
      </Button>
      <ErrorBox error={error} />
      <ResultView r={r} />
    </Panel>
  )
}

function WaterCalc() {
  const [cold, setCold] = useState({ qty: "", price: "" })
  const [hot, setHot] = useState({ qty: "", mode: "one_component", price: "", coldPrice: "", heatPerM3: "", heatPrice: "" })
  const [ww, setWw] = useState({ price: "" })
  const [rs, setRs] = useState<Array<{ title: string; r: Result }>>([])
  const [error, setError] = useState<{ message: string } | null>(null)
  return (
    <Panel title="Водоснабжение" subtitle="ХВС, ГВС (одно- и двухкомпонентная схема), водоотведение">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ХВС, м³">
          <Input inputMode="decimal" value={cold.qty} onChange={(e) => setCold({ ...cold, qty: e.target.value })} />
        </Field>
        <Field label="Тариф ХВС, ₽/м³">
          <Input inputMode="decimal" value={cold.price} onChange={(e) => setCold({ ...cold, price: e.target.value })} />
        </Field>
        <Field label="ГВС, м³">
          <Input inputMode="decimal" value={hot.qty} onChange={(e) => setHot({ ...hot, qty: e.target.value })} />
        </Field>
        <Field label="Схема ГВС">
          <Segmented value={hot.mode} onChange={(m) => setHot({ ...hot, mode: m })} options={[{ value: "one_component", label: "₽/м³" }, { value: "two_component", label: "Двухкомпонентная" }]} />
        </Field>
        {hot.mode === "one_component" ? (
          <Field label="Тариф ГВС, ₽/м³">
            <Input inputMode="decimal" value={hot.price} onChange={(e) => setHot({ ...hot, price: e.target.value })} />
          </Field>
        ) : (
          <>
            <Field label="Компонент ХВС, ₽/м³">
              <Input inputMode="decimal" value={hot.coldPrice} onChange={(e) => setHot({ ...hot, coldPrice: e.target.value })} />
            </Field>
            <Field label="Норматив тепла, Гкал/м³">
              <Input inputMode="decimal" value={hot.heatPerM3} onChange={(e) => setHot({ ...hot, heatPerM3: e.target.value })} />
            </Field>
            <Field label="Тепловая энергия, ₽/Гкал">
              <Input inputMode="decimal" value={hot.heatPrice} onChange={(e) => setHot({ ...hot, heatPrice: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Водоотведение, ₽/м³" hint="Объём = ХВС + ГВС">
          <Input inputMode="decimal" value={ww.price} onChange={(e) => setWw({ price: e.target.value })} />
        </Field>
      </div>
      <Button
        className="mt-3"
        onClick={async () => {
          setError(null)
          const n = (s: string) => Number(s.replace(",", ".") || 0)
          try {
            const out: Array<{ title: string; r: Result }> = []
            if (cold.qty && cold.price) out.push({ title: "ХВС", r: await api<Result>("/api/v1/calculator", { body: { service: "cold_water", kind: "single", config: { price: cold.price }, qty: n(cold.qty) } }) })
            if (hot.qty) out.push({ title: "ГВС", r: await api<Result>("/api/v1/calculator", { body: { service: "hot_water", kind: "hot_water", config: hot.mode === "two_component" ? { mode: "two_component", coldPrice: hot.coldPrice, heatPerM3: hot.heatPerM3, heatPrice: hot.heatPrice } : { mode: "one_component", price: hot.price }, qty: n(hot.qty) } }) })
            if (ww.price) out.push({ title: "Водоотведение", r: await api<Result>("/api/v1/calculator", { body: { service: "wastewater", kind: "wastewater", config: { price: ww.price, basis: "cold_plus_hot" }, qty: n(cold.qty) + n(hot.qty) } }) })
            setRs(out)
          } catch (e) {
            setError(e as Error)
          }
        }}
      >
        Рассчитать
      </Button>
      <ErrorBox error={error} />
      {rs.length ? (
        <>
          {rs.map((x) => (
            <div key={x.title}>
              <p className="mt-3 text-sm font-semibold">{x.title}</p>
              <ResultView r={x.r} />
            </div>
          ))}
          <p className="mt-3 text-sm">
            Всего за воду: <span className="ems-num font-semibold">{rub(rs.reduce((s, x) => s + (x.r.amount ?? 0), 0), 2)}</span>
          </p>
        </>
      ) : null}
    </Panel>
  )
}
