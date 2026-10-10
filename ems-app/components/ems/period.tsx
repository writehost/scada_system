"use client"

import { useMemo, useState } from "react"
import { Input, Segmented } from "@/components/ui"

export type PeriodKey = "day" | "week" | "month" | "year" | "custom"
export type Period = { key: PeriodKey; from: number; to: number; resolution: "hour" | "day" | "month" | "auto"; label: string }

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function computePeriod(key: PeriodKey, custom: { from: string; to: string }): Period {
  const now = new Date()
  const end = now.getTime() + 60_000
  switch (key) {
    case "day":
      return { key, from: startOfDay(now).getTime(), to: end, resolution: "hour", label: "Сегодня по часам" }
    case "week":
      return { key, from: startOfDay(new Date(now.getTime() - 6 * 86400000)).getTime(), to: end, resolution: "hour", label: "7 дней по часам" }
    case "month":
      return { key, from: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), to: end, resolution: "day", label: "Текущий месяц по дням" }
    case "year":
      return { key, from: new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime(), to: end, resolution: "month", label: "12 месяцев" }
    case "custom": {
      const f = custom.from ? new Date(`${custom.from}T00:00:00`).getTime() : startOfDay(new Date(now.getTime() - 29 * 86400000)).getTime()
      const t = custom.to ? new Date(`${custom.to}T00:00:00`).getTime() + 86400000 : end
      return { key, from: f, to: Math.max(t, f + 3600000), resolution: "auto", label: "Свой период" }
    }
  }
}

export function usePeriod(initial: PeriodKey = "month") {
  const [key, setKey] = useState<PeriodKey>(initial)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const [custom, setCustom] = useState({ from: iso(new Date(Date.now() - 29 * 86400000)), to: iso(new Date()) })
  const period = useMemo(() => computePeriod(key, custom), [key, custom])
  return { period, key, setKey, custom, setCustom }
}

export function PeriodPicker({ state }: { state: ReturnType<typeof usePeriod> }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        ariaLabel="Период"
        value={state.key}
        onChange={state.setKey}
        options={[
          { value: "day", label: "День" },
          { value: "week", label: "Неделя" },
          { value: "month", label: "Месяц" },
          { value: "year", label: "Год" },
          { value: "custom", label: "Период" },
        ]}
      />
      {state.key === "custom" ? (
        <div className="flex items-center gap-1">
          <Input type="date" aria-label="С" className="h-8 w-[140px]" value={state.custom.from} max={state.custom.to} onChange={(e) => state.setCustom({ ...state.custom, from: e.target.value })} />
          <span className="text-muted-foreground">—</span>
          <Input type="date" aria-label="По" className="h-8 w-[140px]" value={state.custom.to} min={state.custom.from} onChange={(e) => state.setCustom({ ...state.custom, to: e.target.value })} />
        </div>
      ) : null}
    </div>
  )
}
