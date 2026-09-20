/** Правила размещения ГП: физика ряда ≠ стратегия отбора партии. */

export const STORAGE_STRATEGIES = ["fifo_lane", "lifo_lane", "random"] as const
export type StorageStrategy = (typeof STORAGE_STRATEGIES)[number]

export const ALLOCATION_STRATEGIES = ["fifo", "fefo", "manual", "priority"] as const
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number]

export const CONFLICT_POLICIES = ["next_accessible", "reshuffle_task", "show_conflict"] as const
export type ConflictPolicy = (typeof CONFLICT_POLICIES)[number]

export const ALLOWED_MODES = ["inherit", "any", "list"] as const
export type AllowedMode = (typeof ALLOWED_MODES)[number]

export const LANE_SIDES = ["start", "end"] as const
export type LaneSide = (typeof LANE_SIDES)[number]

export const PRODUCT_MATCH_KINDS = [
  "any",
  "sku",
  "item_code",
  "name_ilike",
  "group",
  "category",
  "class",
] as const
export type ProductMatchKind = (typeof PRODUCT_MATCH_KINDS)[number]

export type ProductMatcher = {
  kind: ProductMatchKind
  value: string
  label?: string
}

export type PlacementWeights = {
  preferredProductRow: number
  sameSkuNearby: number
  sameLotNearby: number
  preferredZone: number
  placementPriority: number
  productionPlanPriority: number
  closeToPicking: number
  distance: number
  fragmentation: number
  congestion: number
  fsnSlotting: number
  abcxyzSlotting: number
  coiSlotting: number
}

export const DEFAULT_PLACEMENT_WEIGHTS: PlacementWeights = {
  preferredProductRow: 40,
  sameSkuNearby: 30,
  sameLotNearby: 20,
  preferredZone: 40,
  placementPriority: 1,
  productionPlanPriority: 10,
  closeToPicking: 15,
  distance: 8,
  fragmentation: 20,
  congestion: 15,
  fsnSlotting: 25,
  abcxyzSlotting: 20,
  coiSlotting: 10,
}

export type WarehousePlacementPolicy = {
  storageStrategy: StorageStrategy
  allocationStrategy: AllocationStrategy
  conflictPolicy: ConflictPolicy
  allowedMode: AllowedMode
  placementPriority: number
  maxOccupancy: number
  allowMixedSku: boolean
  allowMixedLot: boolean
  allowReserve: boolean
  allowQuarantine: boolean
  loadSide: LaneSide
  pickSide: LaneSide
  useExpiry: boolean
  useMfg: boolean
  minRemainingDays: number
  weights: PlacementWeights
}

export const DEFAULT_WAREHOUSE_POLICY: WarehousePlacementPolicy = {
  storageStrategy: "fifo_lane",
  allocationStrategy: "fefo",
  conflictPolicy: "next_accessible",
  allowedMode: "any",
  placementPriority: 50,
  maxOccupancy: 100,
  allowMixedSku: true,
  allowMixedLot: true,
  allowReserve: true,
  allowQuarantine: false,
  loadSide: "end",
  pickSide: "start",
  useExpiry: true,
  useMfg: false,
  minRemainingDays: 0,
  weights: { ...DEFAULT_PLACEMENT_WEIGHTS },
}

export type RowPlacementDraft = {
  inherit: boolean
  isActive: boolean
  isBlocked: boolean
  storageStrategy: StorageStrategy | null
  allocationStrategy: AllocationStrategy | null
  conflictPolicy: ConflictPolicy | null
  allowedMode: AllowedMode
  allowedProducts: ProductMatcher[]
  placementPriority: number | null
  maxOccupancy: number | null
  allowMixedSku: boolean | null
  allowMixedLot: boolean | null
  allowReserve: boolean | null
  allowQuarantine: boolean | null
  loadSide: LaneSide | null
  pickSide: LaneSide | null
  useExpiry: boolean | null
  useMfg: boolean | null
  minRemainingDays: number | null
}

export type EffectiveRowSettings = {
  locationId: string
  locationCode: string
  planRowId: string
  zone: string
  label: string
  capacity: number
  palletCount: number
  fillPercent: number
  isActive: boolean
  isBlocked: boolean
  storageStrategy: StorageStrategy
  allocationStrategy: AllocationStrategy
  conflictPolicy: ConflictPolicy
  allowedMode: AllowedMode
  allowedProducts: ProductMatcher[]
  placementPriority: number
  maxOccupancy: number
  allowMixedSku: boolean
  allowMixedLot: boolean
  allowReserve: boolean
  allowQuarantine: boolean
  loadSide: LaneSide
  pickSide: LaneSide
  useExpiry: boolean
  useMfg: boolean
  minRemainingDays: number
  inheritedFrom: Array<"warehouse" | "zone" | "rule" | "row">
  overrides: string[]
  ruleCode: string | null
  ruleName: string | null
}

export type PlacementRule = {
  ruleId: string
  code: string
  name: string
  isActive: boolean
  storageStrategy: StorageStrategy | null
  allocationStrategy: AllocationStrategy | null
  conflictPolicy: ConflictPolicy | null
  placementPriority: number
  maxOccupancy: number | null
  allowMixedSku: boolean | null
  allowMixedLot: boolean | null
  allowReserve: boolean | null
  allowQuarantine: boolean | null
  zoneCodes: string[]
  rowFrom: string | null
  rowTo: string | null
  rowCodes: string[]
  products: ProductMatcher[]
  productionPlanPriority: number
  note: string | null
}

export type PlacementPallet = {
  palletId: string
  lpn: string
  palletCode: string
  itemCode: string
  itemName: string
  sku: string
  itemGroup: string
  productGroup: string
  itemClass: string
  lotCode: string | null
  expiryAt: string | null
  manufacturedAt: string | null
  receivedAt: string | null
  locationId: string
  locationCode: string
  planRowId: string
  zone: string
  position: number
  reserved: boolean
  blocked: boolean
  quarantine: boolean
  available: boolean
  source: "live" | "demo" | "plan"
  /** Бутылок с плана ряда (API идентификации / Vekas), если в БД кодов ещё нет. */
  unitQty?: number
}

export type PlacementCandidate = {
  locationId: string
  locationCode: string
  planRowId: string
  zone: string
  position: number
  score: number
  reasons: string[]
  kind?: "storage" | "cross_dock"
}

export type PlaceCheckResult = {
  ok: boolean
  canOverride: boolean
  reason: string
  recommended: PlacementCandidate | null
  alternatives: PlacementCandidate[]
}

export type AllocatedPallet = PlacementPallet & {
  accessible: boolean
  blockedBy: string[]
  pickOrder: number
}

export type AllocationConflict = {
  wanted: AllocatedPallet
  reason: string
  nextAccessible: AllocatedPallet | null
}

export type HighlightStop = {
  step: number
  planRowId: string
  locationCode: string
  position: number
  lpn: string
  itemName: string
  expiryAt: string | null
}

export type AllocationResult = {
  taskId: string
  itemQuery: string
  itemCode: string | null
  itemName: string | null
  requestedQty: number
  selected: AllocatedPallet[]
  conflicts: AllocationConflict[]
  reshuffle: Array<{ lpn: string; planRowId: string; position: number; reason: string }>
  highlight: HighlightStop[]
  strategy: AllocationStrategy
}

export type MapViewMode =
  | "normal"
  | "occupancy"
  | "fifo"
  | "fefo"
  | "nomenclature"
  | "lots"
  | "expiry"
  | "tasks"
  | "recommend"
  | "blocked"

export type MapTint = {
  planRowId: string
  color: string
  label: string
  positions?: number[]
}

export type PlacementAuditRow = {
  auditId: string
  at: string
  actor: string
  kind: string
  target: string
  detail: string
  beforeJson: unknown
  afterJson: unknown
}

export type ProductionPlanPreviewItem = {
  itemQuery: string
  dueDate: string
  qty: number
  materials: string[]
}

export const STORAGE_STRATEGY_LABEL: Record<StorageStrategy, string> = {
  fifo_lane: "FIFO-ряд (загрузка с одной стороны, отбор с другой)",
  lifo_lane: "LIFO-ряд (загрузка и отбор с одной стороны)",
  random: "Свободный доступ к любому месту",
}

export const STORAGE_STRATEGY_SHORT: Record<StorageStrategy, string> = {
  fifo_lane: "FIFO-ряд",
  lifo_lane: "LIFO-ряд",
  random: "Свободный доступ",
}

export const ALLOCATION_STRATEGY_LABEL: Record<AllocationStrategy, string> = {
  fifo: "FIFO — сначала самая ранняя приходная",
  fefo: "FEFO — сначала минимальный срок годности",
  manual: "Вручную",
  priority: "По приоритету ряда",
}

export const ALLOCATION_STRATEGY_SHORT: Record<AllocationStrategy, string> = {
  fifo: "FIFO",
  fefo: "FEFO",
  manual: "Вручную",
  priority: "По приоритету",
}

export const CONFLICT_POLICY_LABEL: Record<ConflictPolicy, string> = {
  next_accessible: "Взять следующую физически доступную",
  reshuffle_task: "Создать задачу на перестановку",
  show_conflict: "Показать конфликт и остановиться",
}

export const CONFLICT_POLICY_SHORT: Record<ConflictPolicy, string> = {
  next_accessible: "Следующая доступная",
  reshuffle_task: "Задача на перестановку",
  show_conflict: "Показать конфликт",
}

export const MATCH_KIND_LABEL: Record<ProductMatchKind, string> = {
  any: "Любая номенклатура",
  sku: "SKU / GTIN",
  item_code: "Код позиции",
  name_ilike: "Название содержит",
  group: "Группа",
  category: "Категория",
  class: "Класс хранения",
}

export const MATCH_KIND_SHORT: Record<ProductMatchKind, string> = {
  any: "Любая",
  sku: "SKU",
  item_code: "Код",
  name_ilike: "Название",
  group: "Группа",
  category: "Категория",
  class: "Класс",
}

export const WEIGHT_HELP: Record<keyof PlacementWeights, { label: string; hint: string }> = {
  preferredProductRow: {
    label: "Ряд закреплён за SKU",
    hint: "Плюс, если правило уже привязало этот ряд к номенклатуре (Шмаковка → C-100).",
  },
  sameSkuNearby: {
    label: "Тот же SKU уже в ряду",
    hint: "Плюс, если в ряду уже стоят такие же палеты — не размазываем одну номенклатуру по складу.",
  },
  sameLotNearby: {
    label: "Та же партия рядом",
    hint: "Плюс за ту же партию / срок рядом, чтобы отгрузка FEFO была с одного места.",
  },
  preferredZone: {
    label: "Предпочтительная зона",
    hint: "Плюс за зону из правила (вода в C, преформа в резерве).",
  },
  placementPriority: {
    label: "Множитель приоритета",
    hint: "Насколько учитывать поле «Приоритет» у ряда. 0 — игнорировать, 1 — как есть.",
  },
  productionPlanPriority: {
    label: "Близость к плану",
    hint: "Плюс ряду, который ближе к выпуску / точке приёмки с линии.",
  },
  closeToPicking: {
    label: "Удобно для отбора",
    hint: "Плюс за короткий путь от ряда до отгрузки.",
  },
  distance: {
    label: "Штраф за удалённость",
    hint: "Минус далёким рядам. Чем больше число, тем сильнее двигаем ближе.",
  },
  fragmentation: {
    label: "Штраф за разрывы",
    hint: "Минус, если палета рвёт сплошной ряд и потом FIFO/FEFO заедет в тупик.",
  },
  congestion: {
    label: "Штраф за плотность",
    hint: "Минус переполненным рядам, чтобы не запихивать туда, где уже тесно.",
  },
  fsnSlotting: {
    label: "FSN: ближе / дальше",
    hint: "F — ближние ряды, S — середина, N — дальние. Считается по движениям за 90 дней.",
  },
  abcxyzSlotting: {
    label: "ABC×XYZ",
    hint: "AX у отбора, CZ в дальнем ряду. Ценность оборота плюс стабильность спроса.",
  },
  coiSlotting: {
    label: "COI: объём на обращение",
    hint: "Маленький товар, который часто берут — ближе. Большой и редкий — дальше.",
  },
}
