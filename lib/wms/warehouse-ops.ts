/**
 * Операционные методы склада ГП и материалов.
 * Считается из остатка, партий, движений и min/max с карточки.
 * Полный каталог — что живо, что частично, что только в планах.
 */

export const STOCK_POLICY_STATES = ["below_min", "safety", "reorder", "ok", "above_max"] as const
export type StockPolicyState = (typeof STOCK_POLICY_STATES)[number]

export const AGING_BANDS = ["fresh", "aging", "old", "stale"] as const
export type AgingBand = (typeof AGING_BANDS)[number]

export const OBS_RISKS = ["low", "watch", "high"] as const
export type ObsolescenceRisk = (typeof OBS_RISKS)[number]

export type StockPolicy = {
  minStock: number | null
  targetStock: number | null
  maxStock: number | null
  safetyStock: number | null
  reorderPoint: number | null
  leadTimeDays: number | null
}

export type WarehouseOpsOverlay = {
  policy: StockPolicy
  policyState: StockPolicyState | null
  policyLabel: string | null
  policyInferred: boolean
  onHand: number
  lineSideQty: number
  deadStock: boolean
  daysSinceMove: number | null
  daysSinceOutbound: number | null
  agingDays: number | null
  agingBand: AgingBand | null
  obsolescence: ObsolescenceRisk
  kanban: boolean
  twoBin: boolean
  supermarket: boolean
  hint: string | null
}

export type WarehouseOpsStatus = "live" | "partial" | "planned"

export type WarehouseOpsCatalogRow = {
  id: string
  title: string
  applies: "both" | "fg" | "materials"
  status: WarehouseOpsStatus
  meaning: string
  inWms: string
}

function num(v: unknown): number | null {
  if (v == null || v === "") return null
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."))
  return Number.isFinite(n) ? n : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  return v as Record<string, unknown>
}

/** min / max / reorder / safety с карточки (`item_attrs.nomenclature` или корень attrs). */
export function parseStockPolicy(itemAttrs: unknown): StockPolicy {
  const root = asRecord(itemAttrs) ?? {}
  const nom = asRecord(root.nomenclature) ?? root
  const minStock = num(nom.minStock ?? nom.min_stock)
  const maxStock = num(nom.maxStock ?? nom.max_stock)
  const safetyStock = num(nom.safetyStock ?? nom.safety_stock)
  const reorderPoint = num(nom.reorderPoint ?? nom.reorder_point)
  const targetExplicit = num(nom.targetStock ?? nom.target_stock)
  const leadTimeDays = num(nom.leadTimeDays ?? nom.lead_time_days)
  const targetStock =
    targetExplicit ??
    (minStock != null && maxStock != null ? (minStock + maxStock) / 2 : maxStock)
  return { minStock, targetStock, maxStock, safetyStock, reorderPoint, leadTimeDays }
}

export function stockPolicyFromCard(policy: StockPolicy): boolean {
  return (
    policy.minStock != null ||
    policy.maxStock != null ||
    policy.reorderPoint != null ||
    policy.safetyStock != null ||
    policy.targetStock != null
  )
}

function roundNice(n: number): number {
  if (n < 1) return 1
  if (n < 10) return Math.ceil(n)
  if (n < 100) return Math.ceil(n / 5) * 5
  return Math.ceil(n / 10) * 10
}

/** Если на карточке пусто — min/max/reorder из среднего расхода за период. */
export function inferStockPolicy(
  outboundQty: number,
  periodDays: number,
  leadTimeDays: number | null
): StockPolicy | null {
  const period = periodDays > 0 ? periodDays : 90
  const daily = outboundQty / period
  if (!(daily > 0)) return null
  const lead = leadTimeDays != null && leadTimeDays > 0 ? leadTimeDays : 14
  const safetyStock = roundNice(daily * 3)
  const minStock = roundNice(daily * 7)
  const reorderPoint = roundNice(daily * lead + safetyStock)
  const targetStock = roundNice(daily * 21)
  const maxStock = roundNice(daily * 45)
  return {
    minStock,
    targetStock,
    maxStock,
    safetyStock,
    reorderPoint,
    leadTimeDays: lead,
  }
}

export function evaluateStockPolicy(onHand: number, policy: StockPolicy): StockPolicyState | null {
  const has =
    policy.minStock != null ||
    policy.maxStock != null ||
    policy.reorderPoint != null ||
    policy.safetyStock != null
  if (!has) return null
  if (policy.maxStock != null && onHand > policy.maxStock) return "above_max"
  if (policy.safetyStock != null && onHand <= policy.safetyStock) return "safety"
  if (policy.reorderPoint != null && onHand <= policy.reorderPoint) return "reorder"
  if (policy.minStock != null && onHand < policy.minStock) return "below_min"
  return "ok"
}

export const POLICY_STATE_META: Record<StockPolicyState, { label: string; hint: string }> = {
  below_min: { label: "Ниже min", hint: "Остаток меньше минимума — пополнить или заказать." },
  safety: { label: "Страховой", hint: "Съели страховой запас. Риск останова линии." },
  reorder: { label: "Точка заказа", hint: "Пора закупать: остаток на точке заказа." },
  ok: { label: "В норме", hint: "Между min и max." },
  above_max: { label: "Выше max", hint: "Перезапас — не принимать лишнее и не держать у линии." },
}

export function agingBandFromDays(days: number | null): AgingBand | null {
  if (days == null || days < 0) return null
  if (days < 30) return "fresh"
  if (days < 90) return "aging"
  if (days < 180) return "old"
  return "stale"
}

export const AGING_META: Record<AgingBand, { label: string }> = {
  fresh: { label: "Свежий" },
  aging: { label: "Стареет" },
  old: { label: "Старый" },
  stale: { label: "Залежалый" },
}

function daysSinceIso(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.round((now - t) / 86_400_000))
}

export function computeWarehouseOps(input: {
  availableQty: number
  inProductionQty?: number | null
  locationCount?: number | null
  daysSinceMove?: number | null
  daysSinceOutbound?: number | null
  outboundQty?: number | null
  receivedAt?: string | null
  manufacturedAt?: string | null
  nearestExpiryAt?: string | null
  itemAttrs?: unknown
  fsn?: "F" | "S" | "N" | null
  fsnMoves?: number | null
  isPerishable?: boolean | null
  periodDays?: number
}): WarehouseOpsOverlay {
  const card = parseStockPolicy(input.itemAttrs)
  const period = input.periodDays ?? 90
  const outboundQty = Number(input.outboundQty)
  const inferred = !stockPolicyFromCard(card)
    ? inferStockPolicy(
        Number.isFinite(outboundQty) ? outboundQty : 0,
        period,
        card.leadTimeDays
      )
    : null
  const policy = inferred
    ? { ...inferred, leadTimeDays: card.leadTimeDays ?? inferred.leadTimeDays }
    : card
  const policyInferred = inferred != null
  const lineSideQty = Math.max(0, Number(input.inProductionQty) || 0)
  const onHand = Math.max(0, Number(input.availableQty) || 0) + lineSideQty
  const policyState = evaluateStockPolicy(onHand, policy)
  const agingDays =
    daysSinceIso(input.receivedAt) ?? daysSinceIso(input.manufacturedAt)
  const aging = agingBandFromDays(agingDays)
  const daysSinceOutbound =
    input.daysSinceOutbound != null
      ? input.daysSinceOutbound
      : input.outboundQty === 0
        ? period
        : input.fsnMoves === 0
          ? period
          : null
  const daysSinceMove =
    input.daysSinceMove != null
      ? input.daysSinceMove
      : input.fsnMoves === 0
        ? period
        : null
  const noOutbound =
    input.outboundQty === 0 ||
    (daysSinceOutbound != null && daysSinceOutbound >= period)
  const deadStock =
    onHand > 0 && (input.fsn === "N" || noOutbound)

  let expiryDays: number | null = null
  if (input.nearestExpiryAt) {
    const t = new Date(input.nearestExpiryAt).getTime()
    if (!Number.isNaN(t)) expiryDays = Math.round((t - Date.now()) / 86_400_000)
  }

  let obsolescence: ObsolescenceRisk = "low"
  if (expiryDays != null && expiryDays <= 14) obsolescence = "high"
  else if (deadStock && expiryDays != null && expiryDays <= 60) obsolescence = "high"
  else if (deadStock && (aging === "stale" || aging === "old")) obsolescence = "high"
  else if (deadStock || (expiryDays != null && expiryDays <= 45) || aging === "stale") obsolescence = "watch"

  const supermarket = lineSideQty > 0
  const twoBin = Number(input.locationCount) >= 2
  const consumed = Number.isFinite(outboundQty) && outboundQty > 0
  const kanban =
    onHand > lineSideQty &&
    ((policy.minStock != null && lineSideQty < policy.minStock) ||
      (lineSideQty === 0 && consumed))

  const bits: string[] = []
  if (policyState && policyState !== "ok") {
    bits.push(
      policyInferred
        ? `${POLICY_STATE_META[policyState].hint} Пороги по расходу за ${period} дн.`
        : POLICY_STATE_META[policyState].hint
    )
  }
  if (kanban) bits.push("Линия или супермаркет просят пополнение (e-Kanban).")
  if (deadStock) {
    bits.push(`Нет расхода ${daysSinceOutbound ?? period} дн. — dead stock. Приёмка не считается движением.`)
  }
  if (aging === "stale" || aging === "old") {
    bits.push(`Возраст запаса ${agingDays} дн. (${AGING_META[aging].label}).`)
  }
  if (obsolescence === "high") bits.push("Высокий риск устаревания — в производство или списание.")

  return {
    policy,
    policyState,
    policyLabel: policyState ? POLICY_STATE_META[policyState].label : null,
    policyInferred,
    onHand,
    lineSideQty,
    deadStock,
    daysSinceMove,
    daysSinceOutbound,
    agingDays,
    agingBand: aging,
    obsolescence,
    kanban,
    twoBin,
    supermarket,
    hint: bits[0] ?? null,
  }
}

export function formatPolicyShort(ops: WarehouseOpsOverlay): string | null {
  const p = ops.policy
  const approx = ops.policyInferred ? "~" : ""
  const hideInferredOverstock = ops.policyInferred && ops.policyState === "above_max"
  if (ops.policyLabel && !hideInferredOverstock) {
    const min = p.minStock != null ? ` min ${p.minStock}` : ""
    return `${approx}${ops.policyLabel}${min} · ${ops.onHand}`
  }
  if (ops.deadStock) return `Dead ${ops.daysSinceOutbound ?? ops.daysSinceMove ?? "—"}д`
  if (ops.agingBand && ops.agingBand !== "fresh") {
    return `${AGING_META[ops.agingBand].label} ${ops.agingDays}д`
  }
  if (ops.kanban) return "Kanban"
  if (ops.twoBin) return "Two-bin"
  if (ops.supermarket) return "Супермаркет"
  return null
}

/** Петля тягача по ячейкам цеха A-1…A-140: по 20 ячеек на круг. */
export const TUGGER_LOOP_SIZE = 20

export function tuggerLoopForCell(locationCode: string | null | undefined): {
  loopId: string
  label: string
  cellNo: number
} | null {
  const m = /^A-(\d+)$/i.exec((locationCode ?? "").trim())
  if (!m) return null
  const cellNo = Number(m[1])
  if (!Number.isFinite(cellNo) || cellNo < 1) return null
  const loop = Math.ceil(cellNo / TUGGER_LOOP_SIZE)
  const from = (loop - 1) * TUGGER_LOOP_SIZE + 1
  const to = loop * TUGGER_LOOP_SIZE
  return {
    loopId: `T${loop}`,
    label: `Петля ${loop}: A-${from}…A-${to}`,
    cellNo,
  }
}

/** Разные остановки рейса — не все SKU в одну ячейку. */
export function pickDistinctStops(emptyCells: string[], n: number, fallback = "A-1"): string[] {
  if (n <= 0) return []
  if (emptyCells.length === 0) return Array.from({ length: n }, () => fallback)
  return Array.from({ length: n }, (_, i) => emptyCells[i % emptyCells.length])
}

export const WAREHOUSE_OPS_CATALOG: WarehouseOpsCatalogRow[] = [
  {
    id: "supermarket",
    title: "Supermarket storage",
    applies: "materials",
    status: "live",
    meaning: "Промежуточная зона у линии. Основной склад пополняет её, а не каждую коробку.",
    inWms: "Остаток в ячейках цеха A-*. Пополнение с OS — очередь методов.",
  },
  {
    id: "two-bin",
    title: "Two-bin",
    applies: "materials",
    status: "live",
    meaning: "Две ячейки на материал. Пустая → вторая в работу, первую пополнить.",
    inWms: "Сигнал при ≥2 ячейках. Задание пополнения создаётся из очереди методов.",
  },
  {
    id: "ekanban",
    title: "e-Kanban",
    applies: "materials",
    status: "live",
    meaning: "Электронный сигнал, когда остаток у линии ниже порога.",
    inWms: "Фильтр Kanban на материалах. «Задание» и рейс на /warehouse-stock/ops создают replenishment.",
  },
  {
    id: "minmax",
    title: "Min / Max / target",
    applies: "both",
    status: "live",
    meaning: "Для SKU хранить минимум, цель и максимум.",
    inWms: "Карточка или, если пусто, пороги по расходу за 90 дней. Фильтры на обоих складах.",
  },
  {
    id: "safety",
    title: "Safety stock",
    applies: "both",
    status: "live",
    meaning: "Страховой запас отдельно от минимума.",
    inWms: "Поле на карточке. Состояние «Страховой», если остаток ≤ safety.",
  },
  {
    id: "reorder",
    title: "Reorder point",
    applies: "both",
    status: "live",
    meaning: "Точка заказа: остаток (+ ожидаемое) ниже уровня → закупка.",
    inWms: "Точка заказа на карточке. Ожидаемые поставки в расчёт пока не входят.",
  },
  {
    id: "lead-time",
    title: "Lead time planning",
    applies: "both",
    status: "partial",
    meaning: "Учитывать срок поставки, чтобы не заказать поздно.",
    inWms: "Поле на карточке. Если пусто — 14 дней в точке заказа, посчитанной по расходу.",
  },
  {
    id: "dock-scheduling",
    title: "Dock scheduling",
    applies: "both",
    status: "partial",
    meaning: "Окна разгрузки поставщиков.",
    inWms: "Ближайшие события календаря на /warehouse-stock/ops. Отдельного слота ворот нет.",
  },
  {
    id: "putaway-strategy",
    title: "Putaway strategy",
    applies: "both",
    status: "live",
    meaning: "same-SKU, empty-bin, nearest, dedicated, random.",
    inWms: "Балл размещения ГП: своя номенклатура, пустая, ближе к отбору, закрепление.",
  },
  {
    id: "directed-putaway",
    title: "Directed putaway",
    applies: "both",
    status: "live",
    meaning: "WMS сама назначает ячейку.",
    inWms: "Рекомендация ячейки при приёмке и слоттинг ГП.",
  },
  {
    id: "directed-picking",
    title: "Directed picking",
    applies: "both",
    status: "live",
    meaning: "WMS сама говорит, какую партию и ячейку брать.",
    inWms: "FEFO/FIFO отбор ГП, fefo-pick и выдача в цех.",
  },
  {
    id: "zone-picking",
    title: "Zone picking",
    applies: "fg",
    status: "partial",
    meaning: "Сотрудник только в своей зоне.",
    inWms: "Зоны и ряды есть. Жёсткое закрепление комплектовщика за зоной — нет.",
  },
  {
    id: "wave-picking",
    title: "Wave picking",
    applies: "fg",
    status: "live",
    meaning: "Волны отбора под смену / рейс / заказ.",
    inWms: "Открытый pick/ship/replenish клеится в волну (waveId в задании).",
  },
  {
    id: "batch-picking",
    title: "Batch picking",
    applies: "fg",
    status: "partial",
    meaning: "Одним проходом несколько заказов.",
    inWms: "Волна склеивает задания. Отдельный batch-pick лист — следующий шаг.",
  },
  {
    id: "pick-path",
    title: "Pick path",
    applies: "fg",
    status: "live",
    meaning: "Кратчайший маршрут отбора / кары.",
    inWms: "Маршрут кары и теги пути. Interleaving — попутный забор.",
  },
  {
    id: "dead-stock",
    title: "Dead stock",
    applies: "both",
    status: "live",
    meaning: "Лежит без движения слишком долго.",
    inWms: "Нет расхода (выдача / consume / отгрузка) за период. Приёмка dead stock не сбрасывает.",
  },
  {
    id: "aging",
    title: "Aging control",
    applies: "both",
    status: "live",
    meaning: "Возраст запаса по партии.",
    inWms: "Дни с прихода / эмиссии. Свежий / стареет / старый / залежалый.",
  },
  {
    id: "obsolescence",
    title: "Obsolescence risk",
    applies: "both",
    status: "live",
    meaning: "Риск, что материал или ГП устареет на полке.",
    inWms: "Dead stock + близкий срок. Этикетку с риском — в производство.",
  },
  {
    id: "accuracy",
    title: "Inventory accuracy",
    applies: "both",
    status: "partial",
    meaning: "Факт vs учёт.",
    inWms: "На /warehouse-stock/ops: % = 1 − |ревизия| / остаток за 180 дней. Нет ревизий — пусто, не 100%.",
  },
  {
    id: "shrinkage",
    title: "Shrinkage tracking",
    applies: "both",
    status: "partial",
    meaning: "Потери, недостачи, бой, списания.",
    inWms: "Движения writeoff и revision_adjustment за 180 дней. На заводе часто пусто — это не 0 потерь в отчёте, а нет такого типа движения.",
  },
  {
    id: "damage",
    title: "Damage tracking",
    applies: "both",
    status: "partial",
    meaning: "Повреждения и причины.",
    inWms: "Из списаний с причиной бой/повреждение/брак. Перебор ГП по-прежнему отдельно.",
  },
  {
    id: "quarantine-wf",
    title: "Quarantine workflows",
    applies: "both",
    status: "live",
    meaning: "Нельзя использовать, пока ОТК не снимет.",
    inWms: "RELEASED / QUARANTINE / HOLD / REJECTED. Выдача в цех только допущенного.",
  },
  {
    id: "sampling",
    title: "Sampling control",
    applies: "materials",
    status: "partial",
    meaning: "Проба из партии, остальное держать.",
    inWms: "HOLD / карантин. Акт пробы не заводим — статус партии.",
  },
  {
    id: "coa",
    title: "COA / сертификаты",
    applies: "materials",
    status: "partial",
    meaning: "Сертификат поставщика на партию.",
    inWms: "certificateUrl карточки в очереди методов. На партии — если вписали в note.",
  },
  {
    id: "shelf-receipt",
    title: "Shelf-life at receipt",
    applies: "both",
    status: "partial",
    meaning: "Не принимать, если остаточный срок слишком мал.",
    inWms: "Поле «Мин. дней для приёмки» на карточке + warning на приёмке. Жёсткий отказ — если включён.",
  },
  {
    id: "genealogy",
    title: "Lot genealogy",
    applies: "both",
    status: "partial",
    meaning: "Из какой партии сырья какая партия ГП.",
    inWms: "Расход issue/consume с партией в очереди методов. Дерево сырьё→ГП ещё не сшито.",
  },
  {
    id: "recall",
    title: "Recall support",
    applies: "both",
    status: "live",
    meaning: "Быстро найти, куда ушла партия.",
    inWms: "Поиск по партии на ГП и материалах, ячейка FEFO, движения в карточке.",
  },
  {
    id: "fefo-ex",
    title: "FIFO/FEFO exceptions",
    applies: "both",
    status: "live",
    meaning: "Отклонение от FEFO только с причиной.",
    inWms: "Запись в журнал на /warehouse-stock/ops. Без причины не сохраняется.",
  },
  {
    id: "hu",
    title: "Container / HU",
    applies: "both",
    status: "partial",
    meaning: "Палета, короб, мешок, рулон — не только SKU.",
    inWms: "Палеты ГП и load unit на документах. Неполная ЕИ материалов — план.",
  },
  {
    id: "nested-hu",
    title: "Nested HU",
    applies: "fg",
    status: "partial",
    meaning: "Коробки в палете, бутылки в блоке.",
    inWms: "ЧЗ: бутылка → блок → палета.",
  },
  {
    id: "split-merge",
    title: "Split / Merge HU",
    applies: "fg",
    status: "planned",
    meaning: "Делить и склеивать логистические единицы.",
    inWms: "Перебор палеты есть, merge/split как операция — нет.",
  },
  {
    id: "catch-weight",
    title: "Catch weight",
    applies: "materials",
    status: "planned",
    meaning: "Штуки плюс фактический вес.",
    inWms: "Нет второго количества на остатке.",
  },
  {
    id: "var-length",
    title: "Variable length",
    applies: "materials",
    status: "planned",
    meaning: "Плёнка, кабель, шланг — остаток в метрах.",
    inWms: "ЕИ на карточке может быть м. Остаток рулона в метрах не ведём.",
  },
  {
    id: "roll",
    title: "Roll management",
    applies: "materials",
    status: "partial",
    meaning: "Рулон: длина, остаток, диаметр, ширина, партия.",
    inWms: "Поля рулона на карточке этикетки. Остаток длины не списываем.",
  },
  {
    id: "bulk",
    title: "Bulk / силосы",
    applies: "materials",
    status: "planned",
    meaning: "Насыпное, резервуары, бункеры.",
    inWms: "Нет.",
  },
  {
    id: "bin-capacity",
    title: "Bin capacity V/W",
    applies: "both",
    status: "live",
    meaning: "Ячейка ограничена штуками, литрами и кг.",
    inWms: "ВГХ и ёмкость в рекомендации размещения.",
  },
  {
    id: "stackability",
    title: "Stackability",
    applies: "fg",
    status: "partial",
    meaning: "Сколько ярусов можно ставить.",
    inWms: "Слои в правилах отгрузки и ВГХ палеты. Не общий запрет штабеля.",
  },
  {
    id: "hazmat",
    title: "Hazmat segregation",
    applies: "materials",
    status: "partial",
    meaning: "Химию не класть к пищевым / этикеткам.",
    inWms: "Семейство ХИМ и матрица совместимости. Жёсткий putaway — следующий шаг.",
  },
  {
    id: "temp-zone",
    title: "Temperature zones",
    applies: "both",
    status: "partial",
    meaning: "Зоны по температуре.",
    inWms: "Признак на карточке. Отдельных холодных зон на плане нет.",
  },
  {
    id: "humidity",
    title: "Humidity control",
    applies: "materials",
    status: "partial",
    meaning: "Чувствительность к влажности.",
    inWms: "Диапазон на карточке. На очередь методов не выводим.",
  },
  {
    id: "esd",
    title: "ESD storage",
    applies: "materials",
    status: "partial",
    meaning: "Электроника отдельно.",
    inWms: "Семейство ЭЛ. Отдельной ESD-зоны нет.",
  },
  {
    id: "clean-dirty",
    title: "Clean / dirty zones",
    applies: "both",
    status: "planned",
    meaning: "Чистые и грязные потоки.",
    inWms: "Нет.",
  },
  {
    id: "allergen",
    title: "Allergen segregation",
    applies: "materials",
    status: "partial",
    meaning: "Пищевые аллергены отдельно.",
    inWms: "Поле allergenCodes на карточке. Жёсткий putaway — следующий шаг.",
  },
  {
    id: "returnable",
    title: "Returnable packaging",
    applies: "both",
    status: "planned",
    meaning: "Возвратная тара.",
    inWms: "Нет контура тары.",
  },
  {
    id: "consignment",
    title: "Vendor-owned / consignment",
    applies: "materials",
    status: "partial",
    meaning: "Физически у нас, принадлежит поставщику.",
    inWms: "На карточке можно отметить, что товар поставщика. На партии — нет.",
  },
  {
    id: "customer-owned",
    title: "Customer-owned / давалец",
    applies: "materials",
    status: "partial",
    meaning: "Сырьё заказчика, дали на розлив.",
    inWms: "На карточке можно отметить. На очереди методов нет.",
  },
  {
    id: "ownership",
    title: "Stock ownership",
    applies: "both",
    status: "partial",
    meaning: "Кому принадлежит конкретный остаток.",
    inWms: "На карточке: чей товар. На очереди методов блока нет.",
  },
  {
    id: "reservation",
    title: "Reservation hierarchy",
    applies: "both",
    status: "partial",
    meaning: "Резерв по приоритетам, не просто «занято».",
    inWms: "Есть reserved qty. Приоритетов нет.",
  },
  {
    id: "allocation",
    title: "Allocation rules",
    applies: "both",
    status: "live",
    meaning: "Какой запас можно выдать под какой заказ.",
    inWms: "FEFO/FIFO + качество. Карантин не выделяется.",
  },
  {
    id: "shortage",
    title: "Shortage management",
    applies: "both",
    status: "partial",
    meaning: "Что делать, если не хватает.",
    inWms: "Нехватка видна (план vs остаток). Авторазбор нехватки нет.",
  },
  {
    id: "substitution",
    title: "Substitution rules",
    applies: "materials",
    status: "live",
    meaning: "Разрешённые аналоги.",
    inWms: "Алиасы SKU/GTIN. Если другой артикул с тем же кодом — показываем его остаток.",
  },
  {
    id: "starvation",
    title: "Line starvation risk",
    applies: "materials",
    status: "live",
    meaning: "Прогноз, что линия встанет.",
    inWms: "Причина starvation в очереди пополнения, если линия пустая и расход идёт.",
  },
  {
    id: "call-off",
    title: "Material call-off",
    applies: "materials",
    status: "partial",
    meaning: "Линия вызывает материал.",
    inWms: "Выдача в цех и расход с ячейки. Автовызов с APS — нет.",
  },
  {
    id: "milk-run",
    title: "Milk run scheduling",
    applies: "materials",
    status: "live",
    meaning: "Подвоз по расписанию.",
    inWms: "«Рейс к линии»: один replenishment на все сигналы, у каждой SKU своя ячейка A-*.",
  },
  {
    id: "tugger",
    title: "Tugger train",
    applies: "materials",
    status: "live",
    meaning: "Тягач с несколькими тележками.",
    inWms: "«Тягач»: тот же рейс, остановки по петлям A-1…A-20, A-21…A-40…",
  },
  {
    id: "interleaving",
    title: "Forklift interleaving",
    applies: "fg",
    status: "live",
    meaning: "После выгрузки — забор рядом.",
    inWms: "Кары и маршруты: попутное задание.",
  },
  {
    id: "dock-to-stock",
    title: "Dock-to-stock time",
    applies: "both",
    status: "live",
    meaning: "Время от приёмки до доступности.",
    inWms: "Средние часы receiving → первый putaway/transfer за 180 дней.",
  },
  {
    id: "supplier-perf",
    title: "Supplier performance",
    applies: "materials",
    status: "partial",
    meaning: "Недовозы, пересорт, качество поставщика.",
    inWms: "Объём приёмок в очереди методов. Балл качества не считаем, пока списание нельзя привязать к поставщику.",
  },
  {
    id: "space-util",
    title: "Space utilization",
    applies: "both",
    status: "live",
    meaning: "Насколько занят объём склада.",
    inWms: "Заполненность зон и рядов ГП, occupancy.",
  },
  {
    id: "heatmap",
    title: "Heatmap",
    applies: "both",
    status: "live",
    meaning: "Где больше движений.",
    inWms: "Топ ячеек по движениям за 30 дней в очереди методов.",
  },
  {
    id: "congestion",
    title: "Congestion detection",
    applies: "fg",
    status: "live",
    meaning: "Пробки в рядах.",
    inWms: "Штраф плотности в слоттинге ГП.",
  },
  {
    id: "dynamic-slotting",
    title: "Dynamic slotting",
    applies: "fg",
    status: "live",
    meaning: "Периодически пересчитывать лучшее место.",
    inWms: "Балл ряда пересчитывается при рекомендации. FSN/ABC за 30/60/90 дн.",
  },
  {
    id: "reslot-tasks",
    title: "Re-slotting tasks",
    applies: "fg",
    status: "partial",
    meaning: "Система предлагает переставить в выгодную ячейку.",
    inWms: "Подсказка re-slot на ГП. Задание на перестановку не создаём сами.",
  },
]

export function warehouseOpsStatusLabel(status: WarehouseOpsStatus): string {
  if (status === "live") return "Работает"
  if (status === "partial") return "Частично"
  return "План"
}
