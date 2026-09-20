/**
 * Погрешность печати стикеров: печать идёт с первой этикетки, а потом рулон
 * проматывают и в конце остаётся хвост пустых этикеток. Эти этикетки со склада
 * ушли, но кодов на них нет — без учёта хвоста остаток материала всегда врёт.
 *
 * Модуль без серверных зависимостей: одни и те же формулы считает и API, и
 * диалоги на странице заказов.
 */

export type LabelOrderWasteSettings = {
  /** Плановый хвост, % от количества кодов в заказе. */
  wastePercent: number
  /** Минимальный хвост в штуках: короткий заказ всё равно требует прокрутки. */
  minWasteQty: number
  /** Добавлять запас прямо в количество заказываемых кодов. */
  addWasteToOrder: boolean
  /** Кратность округления итогового количества (рулон, блок). 0 — не округлять. */
  roundTo: number
  /** Расхождение факта с планом больше этого числа процентных пунктов — подсветить. */
  alertPercent: number
  /** После печати требовать корректировку с фактическими цифрами. */
  requireFactAfterPrint: boolean
  updatedAt?: string | null
  updatedBy?: string | null
}

export const DEFAULT_LABEL_ORDER_WASTE_SETTINGS: LabelOrderWasteSettings = {
  wastePercent: 3,
  minWasteQty: 0,
  addWasteToOrder: false,
  roundTo: 0,
  alertPercent: 5,
  requireFactAfterPrint: true,
  updatedAt: null,
  updatedBy: null,
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function parseLabelOrderWasteSettings(raw: unknown): LabelOrderWasteSettings {
  const src = (raw ?? {}) as Record<string, unknown>
  const d = DEFAULT_LABEL_ORDER_WASTE_SETTINGS
  return {
    wastePercent: clamp(num(src.wastePercent, d.wastePercent), 0, 100),
    minWasteQty: clamp(Math.round(num(src.minWasteQty, d.minWasteQty)), 0, 100_000),
    addWasteToOrder: Boolean(src.addWasteToOrder ?? d.addWasteToOrder),
    roundTo: clamp(Math.round(num(src.roundTo, d.roundTo)), 0, 10_000),
    alertPercent: clamp(num(src.alertPercent, d.alertPercent), 0, 100),
    requireFactAfterPrint: Boolean(src.requireFactAfterPrint ?? d.requireFactAfterPrint),
    updatedAt: typeof src.updatedAt === "string" ? src.updatedAt : null,
    updatedBy: typeof src.updatedBy === "string" ? src.updatedBy : null,
  }
}

export function roundUpTo(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 1) return Math.ceil(value)
  return Math.ceil(value / step) * step
}

/** Плановый хвост пустых этикеток для заказа на `quantity` кодов. */
export function plannedWasteQty(quantity: number, settings: LabelOrderWasteSettings): number {
  const qty = Math.max(0, Math.round(num(quantity, 0)))
  if (qty === 0) return 0
  const byPercent = Math.ceil((qty * settings.wastePercent) / 100)
  return Math.max(byPercent, settings.minWasteQty)
}

export type LabelOrderPlan = {
  /** Сколько кодов нужно оператору «в дело». */
  neededQty: number
  /** Плановый хвост прокрутки. */
  wasteQty: number
  /** Сколько кодов заказываем в СУЗ (с запасом или без — по настройке). */
  orderQty: number
  /** Сколько этикеток спишется с рулона по плану. */
  labelsQty: number
  wastePercent: number
}

/** План заказа: сколько кодов заказать и сколько этикеток на это уйдёт. */
export function buildLabelOrderPlan(
  neededQty: number,
  settings: LabelOrderWasteSettings,
  overrides?: { wastePercent?: number; addWasteToOrder?: boolean }
): LabelOrderPlan {
  const effective: LabelOrderWasteSettings = {
    ...settings,
    wastePercent:
      overrides?.wastePercent != null
        ? clamp(num(overrides.wastePercent, settings.wastePercent), 0, 100)
        : settings.wastePercent,
    addWasteToOrder: overrides?.addWasteToOrder ?? settings.addWasteToOrder,
  }
  const needed = Math.max(0, Math.round(num(neededQty, 0)))
  const waste = plannedWasteQty(needed, effective)
  const orderRaw = effective.addWasteToOrder ? needed + waste : needed
  const orderQty = effective.roundTo > 1 ? roundUpTo(orderRaw, effective.roundTo) : orderRaw
  const wasteForOrder = effective.addWasteToOrder ? orderQty - needed : waste
  return {
    neededQty: needed,
    wasteQty: Math.max(0, wasteForOrder),
    orderQty,
    labelsQty: effective.addWasteToOrder ? orderQty : orderQty + waste,
    wastePercent: effective.wastePercent,
  }
}

export type LabelOrderAdjustment = {
  adjustmentId: string
  createdAt: string
  authorFio: string
  authorLogin: string
  kind: string
  /** Годных этикеток с кодом. */
  printedQty: number
  /** Промотано вхолостую: пустой хвост. */
  spooledQty: number
  /** Брак: печать была, но этикетка ушла в мусор. */
  defectQty: number
  comment: string
  revertedAt: string | null
  revertedBy: string | null
}

export type LabelOrderFact = {
  printedQty: number
  spooledQty: number
  defectQty: number
  /** Всего этикеток с рулона. */
  labelsQty: number
  /** Потери: хвост + брак. */
  wasteQty: number
  /** Погрешность = потери / годные, %. */
  wastePercent: number
  adjustmentsCount: number
  lastAt: string | null
  lastAuthor: string | null
};

export function summarizeLabelOrderFact(adjustments: LabelOrderAdjustment[]): LabelOrderFact {
  const live = adjustments.filter((a) => !a.revertedAt)
  const printedQty = live.reduce((sum, a) => sum + a.printedQty, 0)
  const spooledQty = live.reduce((sum, a) => sum + a.spooledQty, 0)
  const defectQty = live.reduce((sum, a) => sum + a.defectQty, 0)
  const wasteQty = spooledQty + defectQty
  const last = live[0] ?? null
  return {
    printedQty,
    spooledQty,
    defectQty,
    labelsQty: printedQty + wasteQty,
    wasteQty,
    wastePercent: printedQty > 0 ? (wasteQty / printedQty) * 100 : 0,
    adjustmentsCount: live.length,
    lastAt: last?.createdAt ?? null,
    lastAuthor: last?.authorFio || last?.authorLogin || null,
  }
}

/** Насколько факт разошёлся с планом — для подсветки строки в списке. */
export function labelOrderFactVerdict(
  plan: { quantity: number; plannedWasteQty: number; wastePercent: number },
  fact: LabelOrderFact,
  settings: LabelOrderWasteSettings
): { tone: "empty" | "ok" | "warn" | "danger"; text: string } {
  if (fact.adjustmentsCount === 0) {
    return { tone: "empty", text: "факт не внесён" }
  }
  const deltaPercent = fact.wastePercent - plan.wastePercent
  const notPrinted = plan.quantity - fact.printedQty
  if (Math.abs(notPrinted) > Math.max(1, plan.quantity * 0.02)) {
    return {
      tone: notPrinted > 0 ? "warn" : "danger",
      text:
        notPrinted > 0
          ? `не напечатано ${fmtInt(notPrinted)} из заказа`
          : `напечатано на ${fmtInt(-notPrinted)} больше заказа`,
    }
  }
  if (deltaPercent > settings.alertPercent) {
    return { tone: "danger", text: `перерасход ${deltaPercent.toFixed(1)} п.п. к плану` }
  }
  if (deltaPercent > 0.5) {
    return { tone: "warn", text: `выше плана на ${deltaPercent.toFixed(1)} п.п.` }
  }
  return { tone: "ok", text: "в пределах плана" }
}

export function fmtInt(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value))
}

export function fmtPercent(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)} %`
}
