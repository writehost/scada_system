"use client"

import { useEffect, useState } from "react"
import { Checkbox, Field, Input, Segmented, Select } from "@/components/ui"

export type TariffDraft = { name: string; kind: string; validFrom: string; sourceNote: string; config: Record<string, unknown> }

type ZoneRow = { code: string; name: string; price: string; ranges: string }

const PRESETS: Record<string, ZoneRow[]> = {
  two: [
    { code: "T1", name: "День", price: "", ranges: "07:00-23:00" },
    { code: "T2", name: "Ночь", price: "", ranges: "23:00-07:00" },
  ],
  three: [
    { code: "T1", name: "Пик", price: "", ranges: "07:00-10:00, 17:00-21:00" },
    { code: "T2", name: "Ночь", price: "", ranges: "23:00-07:00" },
    { code: "T3", name: "Полупик", price: "", ranges: "10:00-17:00, 21:00-23:00" },
  ],
}

function parseRanges(s: string) {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((r) => {
      const [from, to] = r.split("-").map((x) => x.trim())
      return { from, to }
    })
}

/** Форма тарифа: вид зависит от услуги, формулы задаёт пользователь — встроенных «актуальных» цен нет. */
export function TariffForm({ service, industrial, onChange }: { service: string; industrial: boolean; onChange: (d: TariffDraft) => void }) {
  const kinds: Array<{ value: string; label: string }> =
    service === "electricity"
      ? [{ value: "single", label: "Одноставочный" }, { value: "zones", label: "Зонный (2–3 зоны)" }]
      : service === "hot_water"
        ? [{ value: "hot_water", label: "ГВС" }, { value: "fixed", label: "Фиксированная сумма" }]
        : service === "wastewater"
          ? [{ value: "wastewater", label: "Водоотведение" }]
          : service === "internet" || service === "other"
            ? [{ value: "fixed", label: "Фиксированная сумма" }]
            : [{ value: "single", label: "Цена за единицу" }, { value: "fixed", label: "Фиксированная сумма" }]
  const [kind, setKind] = useState(kinds[0].value)
  const [name, setName] = useState("")
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 8) + "01")
  const [note, setNote] = useState("")
  const [price, setPrice] = useState("")
  const [amount, setAmount] = useState("")
  const [preset, setPreset] = useState<"two" | "three">("two")
  const [zones, setZones] = useState<ZoneRow[]>(PRESETS.two)
  const [hw, setHw] = useState({ mode: "one_component", price: "", coldPrice: "", heatPerM3: "", heatPrice: "" })
  const [basis, setBasis] = useState("cold_plus_hot")
  const [extras, setExtras] = useState("")
  const [cap, setCap] = useState({ on: false, basis: "declared", declaredKw: "", pricePerKw: "", ranges: "08:00-11:00, 16:00-21:00" })

  const emit = (patch: Partial<{ kind: string; name: string; validFrom: string; note: string; price: string; amount: string; zones: ZoneRow[]; hw: typeof hw; basis: string; extras: string; cap: typeof cap }> = {}) => {
    const s = { kind, name, validFrom, note, price, amount, zones, hw, basis, extras, cap, ...patch }
    const extrasList = s.extras
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(.*?)[:;]\s*([\d\s.,]+)$/.exec(l)
        return m ? { label: m[1].trim(), amount: m[2].replace(/\s/g, "").replace(",", ".") } : { label: l, amount: "" }
      })
    const capacity = s.cap.on ? (s.cap.basis === "declared" ? { basis: "declared", declaredKw: s.cap.declaredKw, pricePerKw: s.cap.pricePerKw } : { basis: "peak_hours", pricePerKw: s.cap.pricePerKw, ranges: parseRanges(s.cap.ranges), workdaysOnly: true }) : undefined
    let config: Record<string, unknown> = {}
    if (s.kind === "single") config = { price: s.price, extras: extrasList.length ? extrasList : undefined, capacity }
    if (s.kind === "zones") config = { zones: s.zones.map((z) => ({ code: z.code, name: z.name, price: z.price, ranges: parseRanges(z.ranges) })), extras: extrasList.length ? extrasList : undefined, capacity }
    if (s.kind === "hot_water") config = s.hw.mode === "two_component" ? { mode: "two_component", coldPrice: s.hw.coldPrice, heatPerM3: s.hw.heatPerM3, heatPrice: s.hw.heatPrice } : { mode: "one_component", price: s.hw.price }
    if (s.kind === "wastewater") config = { price: s.price, basis: s.basis }
    if (s.kind === "fixed") config = { amount: s.amount }
    onChange({ kind: s.kind, name: s.name || defaultName(s.kind, service), validFrom: s.validFrom, sourceNote: s.note, config })
  }

  // Начальное состояние формы сразу передаётся родителю.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => emit(), [])

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Вид тарифа" className="sm:col-span-2">
        <Segmented value={kind} onChange={(k) => { setKind(k); emit({ kind: k }) }} options={kinds} />
      </Field>
      <Field label="Название" hint="Например, «Тариф с 1 июля 2026»">
        <Input value={name} onChange={(e) => { setName(e.target.value); emit({ name: e.target.value }) }} />
      </Field>
      <Field label="Действует с">
        <Input type="date" value={validFrom} onChange={(e) => { setValidFrom(e.target.value); emit({ validFrom: e.target.value }) }} />
      </Field>
      {kind === "single" ? (
        <Field label={`Цена, ₽ за ${service === "electricity" ? "кВт·ч" : service === "heating" ? "Гкал" : "м³"}`}>
          <Input inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); emit({ price: e.target.value }) }} />
        </Field>
      ) : null}
      {kind === "wastewater" ? (
        <>
          <Field label="Цена, ₽/м³">
            <Input inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); emit({ price: e.target.value }) }} />
          </Field>
          <Field label="Объём">
            <Select value={basis} onChange={(e) => { setBasis(e.target.value); emit({ basis: e.target.value }) }}>
              <option value="cold_plus_hot">Сумма ХВС и ГВС</option>
              <option value="own_meter">Собственный прибор</option>
            </Select>
          </Field>
        </>
      ) : null}
      {kind === "fixed" ? (
        <Field label="Сумма в месяц, ₽">
          <Input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); emit({ amount: e.target.value }) }} />
        </Field>
      ) : null}
      {kind === "hot_water" ? (
        <>
          <Field label="Схема" className="sm:col-span-2">
            <Segmented value={hw.mode} onChange={(m) => { const n = { ...hw, mode: m }; setHw(n); emit({ hw: n }) }} options={[{ value: "one_component", label: "Однокомпонентная (₽/м³)" }, { value: "two_component", label: "Двухкомпонентная" }]} />
          </Field>
          {hw.mode === "one_component" ? (
            <Field label="Цена, ₽/м³">
              <Input inputMode="decimal" value={hw.price} onChange={(e) => { const n = { ...hw, price: e.target.value }; setHw(n); emit({ hw: n }) }} />
            </Field>
          ) : (
            <>
              <Field label="Компонент на холодную воду, ₽/м³">
                <Input inputMode="decimal" value={hw.coldPrice} onChange={(e) => { const n = { ...hw, coldPrice: e.target.value }; setHw(n); emit({ hw: n }) }} />
              </Field>
              <Field label="Норматив тепла на подогрев, Гкал/м³">
                <Input inputMode="decimal" value={hw.heatPerM3} onChange={(e) => { const n = { ...hw, heatPerM3: e.target.value }; setHw(n); emit({ hw: n }) }} />
              </Field>
              <Field label="Компонент на тепловую энергию, ₽/Гкал">
                <Input inputMode="decimal" value={hw.heatPrice} onChange={(e) => { const n = { ...hw, heatPrice: e.target.value }; setHw(n); emit({ hw: n }) }} />
              </Field>
            </>
          )}
        </>
      ) : null}
      {kind === "zones" ? (
        <div className="space-y-2 sm:col-span-2">
          <Segmented value={preset} onChange={(p) => { setPreset(p); setZones(PRESETS[p]); emit({ zones: PRESETS[p] }) }} options={[{ value: "two", label: "День / ночь" }, { value: "three", label: "Пик / полупик / ночь" }]} />
          {zones.map((z, i) => (
            <div key={z.code} className="grid gap-2 sm:grid-cols-[60px_1fr_120px_1.4fr]">
              <Input value={z.code} readOnly aria-label="Код зоны" />
              <Input value={z.name} aria-label="Название зоны" onChange={(e) => { const n = zones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)); setZones(n); emit({ zones: n }) }} />
              <Input inputMode="decimal" placeholder="₽/кВт·ч" aria-label="Цена зоны" value={z.price} onChange={(e) => { const n = zones.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)); setZones(n); emit({ zones: n }) }} />
              <Input value={z.ranges} aria-label="Интервалы" placeholder="07:00-23:00" onChange={(e) => { const n = zones.map((x, j) => (j === i ? { ...x, ranges: e.target.value } : x)); setZones(n); emit({ zones: n }) }} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Интервалы — по местному времени объекта, через запятую. Зоны должны покрывать сутки без пересечений. Если у счётчика отдельные регистры Т1/Т2 — расход берётся с них, иначе делится по почасовым данным.</p>
        </div>
      ) : null}
      {(kind === "single" || kind === "zones") && service === "electricity" ? (
        <>
          <Field label="Дополнительные начисления в месяц" hint="По строке: «Название: сумма». Например, условия договора." className="sm:col-span-2">
            <textarea className="ems-input h-16 py-2" value={extras} onChange={(e) => { setExtras(e.target.value); emit({ extras: e.target.value }) }} />
          </Field>
          {industrial ? (
            <div className="space-y-2 rounded-lg border border-border/70 p-3 sm:col-span-2">
              <Checkbox checked={cap.on} onChange={(v) => { const n = { ...cap, on: v }; setCap(n); emit({ cap: n }) }} label="Ставка за мощность (по условиям договора)" hint="Формула задаётся явно: заявленная мощность или среднее по рабочим дням максимумов в часы пиковой нагрузки." />
              {cap.on ? (
                <div className="grid gap-2 sm:grid-cols-3">
                  <Select value={cap.basis} onChange={(e) => { const n = { ...cap, basis: e.target.value }; setCap(n); emit({ cap: n }) }}>
                    <option value="declared">Заявленная мощность</option>
                    <option value="peak_hours">По часам пиковой нагрузки</option>
                  </Select>
                  {cap.basis === "declared" ? <Input placeholder="кВт" value={cap.declaredKw} onChange={(e) => { const n = { ...cap, declaredKw: e.target.value }; setCap(n); emit({ cap: n }) }} /> : <Input placeholder="08:00-11:00, 16:00-21:00" value={cap.ranges} onChange={(e) => { const n = { ...cap, ranges: e.target.value }; setCap(n); emit({ cap: n }) }} />}
                  <Input placeholder="₽ за кВт в месяц" value={cap.pricePerKw} onChange={(e) => { const n = { ...cap, pricePerKw: e.target.value }; setCap(n); emit({ cap: n }) }} />
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
      <Field label="Источник" hint="Квитанция, договор, постановление" className="sm:col-span-2">
        <Input value={note} onChange={(e) => { setNote(e.target.value); emit({ note: e.target.value }) }} />
      </Field>
    </div>
  )
}

function defaultName(kind: string, service: string) {
  const s: Record<string, string> = { electricity: "Электроэнергия", cold_water: "ХВС", hot_water: "ГВС", wastewater: "Водоотведение", heating: "Отопление", gas: "Газ", internet: "Интернет", other: "Услуга" }
  return `${s[service] ?? "Тариф"}${kind === "zones" ? ", зонный" : kind === "fixed" ? ", фиксированный" : ""}`
}
