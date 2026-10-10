import { rub } from "./format"

/* eslint-disable @typescript-eslint/no-explicit-any */
export function describeTariff(c: Record<string, any>): string {
  if (!c) return ""
  if (c.kind === "single") return `${c.price} ₽ за единицу${c.capacity ? " + мощность" : ""}${c.extras?.length ? " + доп. начисления" : ""}`
  if (c.kind === "zones") return c.zones.map((z: any) => `${z.name} ${z.price} ₽ (${z.ranges.map((r: any) => `${r.from}–${r.to}`).join(", ")})`).join("; ")
  if (c.kind === "hot_water") return c.mode === "two_component" ? `ХВС ${c.coldPrice} ₽/м³ + ${c.heatPerM3} Гкал/м³ × ${c.heatPrice} ₽/Гкал` : `${c.price} ₽/м³`
  if (c.kind === "wastewater") return `${c.price} ₽/м³ (${c.basis === "own_meter" ? "свой прибор" : "ХВС + ГВС"})`
  if (c.kind === "fixed") return `${rub(c.amount)} в месяц`
  return ""
}

