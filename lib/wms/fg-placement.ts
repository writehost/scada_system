import type { PoolClient } from "pg"
import {
  canonicalPlanRowId,
  fgPlanLocationCode,
  normalizePlanRowId,
  planRowIdFromLocationCode,
} from "@/lib/wms/fg-plan-location-codes"
import { readFgPlanInventory } from "@/lib/wms/fg-plan-inventory-storage"
import { ensureFgPlacementSchema, writePlacementAudit } from "@/lib/wms/fg-placement-schema"
import { fsnSlotScore, normalizeRowDistance, type FsnClass } from "@/lib/wms/fsn"
import {
  abcxyzSlotScore,
  coiSlotScore,
  EURO_PALLET_M3,
  medianPositive,
  type AbcClass,
  type XyzClass,
} from "@/lib/wms/sku-demand"
import { classifyFgDemand } from "@/lib/wms/sku-demand-history"
import { findCrossDockForItem } from "@/lib/wms/fg-cross-dock"
import {
  ALLOCATION_STRATEGIES,
  ALLOWED_MODES,
  CONFLICT_POLICIES,
  DEFAULT_PLACEMENT_WEIGHTS,
  DEFAULT_WAREHOUSE_POLICY,
  LANE_SIDES,
  PRODUCT_MATCH_KINDS,
  STORAGE_STRATEGIES,
  type AllocatedPallet,
  type AllocationConflict,
  type AllocationResult,
  type AllocationStrategy,
  type AllowedMode,
  type ConflictPolicy,
  type EffectiveRowSettings,
  type HighlightStop,
  type LaneSide,
  type MapTint,
  type MapViewMode,
  type PlaceCheckResult,
  type PlacementAuditRow,
  type PlacementCandidate,
  type PlacementPallet,
  type PlacementRule,
  type PlacementWeights,
  type ProductMatchKind,
  type ProductMatcher,
  type ProductionPlanPreviewItem,
  type RowPlacementDraft,
  type StorageStrategy,
  type WarehousePlacementPolicy,
} from "@/lib/wms/fg-placement-types"

type FgRowRecord = {
  locationId: string
  locationCode: string
  planRowId: string
  zone: string
  label: string
  capacity: number
  palletCount: number
}

type ItemRef = {
  itemCode: string
  itemName: string
  sku: string
  itemGroup: string
  productGroup: string
  itemClass: string
  lotCode?: string | null
  fsn?: FsnClass | null
  abc?: AbcClass | null
  xyz?: XyzClass | null
  coi?: number | null
}

function asStorage(v: unknown, fallback: StorageStrategy): StorageStrategy {
  const s = String(v ?? "").trim()
  return (STORAGE_STRATEGIES as readonly string[]).includes(s) ? (s as StorageStrategy) : fallback
}
function asAlloc(v: unknown, fallback: AllocationStrategy): AllocationStrategy {
  const s = String(v ?? "").trim()
  return (ALLOCATION_STRATEGIES as readonly string[]).includes(s) ? (s as AllocationStrategy) : fallback
}
function asConflict(v: unknown, fallback: ConflictPolicy): ConflictPolicy {
  const s = String(v ?? "").trim()
  return (CONFLICT_POLICIES as readonly string[]).includes(s) ? (s as ConflictPolicy) : fallback
}
function asMode(v: unknown, fallback: AllowedMode): AllowedMode {
  const s = String(v ?? "").trim()
  return (ALLOWED_MODES as readonly string[]).includes(s) ? (s as AllowedMode) : fallback
}
function asSide(v: unknown, fallback: LaneSide): LaneSide {
  const s = String(v ?? "").trim()
  return (LANE_SIDES as readonly string[]).includes(s) ? (s as LaneSide) : fallback
}
function asKind(v: unknown): ProductMatchKind {
  const s = String(v ?? "").trim()
  return (PRODUCT_MATCH_KINDS as readonly string[]).includes(s) ? (s as ProductMatchKind) : "name_ilike"
}
function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v
  if (v == null) return fallback
  return Boolean(v)
}

function parseWeights(raw: unknown): PlacementWeights {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const d = DEFAULT_PLACEMENT_WEIGHTS
  return {
    preferredProductRow: num(o.preferredProductRow, d.preferredProductRow),
    sameSkuNearby: num(o.sameSkuNearby, d.sameSkuNearby),
    sameLotNearby: num(o.sameLotNearby, d.sameLotNearby),
    preferredZone: num(o.preferredZone, d.preferredZone),
    placementPriority: num(o.placementPriority, d.placementPriority),
    productionPlanPriority: num(o.productionPlanPriority, d.productionPlanPriority),
    closeToPicking: num(o.closeToPicking, d.closeToPicking),
    distance: num(o.distance, d.distance),
    fragmentation: num(o.fragmentation, d.fragmentation),
    congestion: num(o.congestion, d.congestion),
    fsnSlotting: num(o.fsnSlotting, d.fsnSlotting),
    abcxyzSlotting: num(o.abcxyzSlotting, d.abcxyzSlotting),
    coiSlotting: num(o.coiSlotting, d.coiSlotting),
  }
}

export function productMatches(matchers: ProductMatcher[], item: ItemRef): boolean {
  if (matchers.length === 0) return true
  if (matchers.some((m) => m.kind === "any")) return true
  const name = item.itemName.toLocaleLowerCase("ru")
  const code = item.itemCode.toLowerCase()
  const sku = (item.sku || "").toLowerCase()
  return matchers.some((m) => {
    const v = m.value.trim()
    if (!v && m.kind !== "any") return false
    const lv = v.toLocaleLowerCase("ru")
    switch (m.kind) {
      case "any":
        return true
      case "sku":
        return sku === lv || code === lv || item.itemCode === v
      case "item_code":
        return item.itemCode === v || code === lv
      case "name_ilike":
        return name.includes(lv)
      case "group":
        return item.itemGroup.toLocaleLowerCase("ru") === lv || item.productGroup.toLocaleLowerCase("ru") === lv
      case "category":
        return item.productGroup.toLocaleLowerCase("ru") === lv
      case "class":
        return item.itemClass.toLocaleLowerCase("ru") === lv
      default:
        return false
    }
  })
}

export function parseRowSelector(raw: string): { planIds: string[]; range: { zone: string; from: number; to: number } | null } {
  const text = raw.trim().toUpperCase().replace(/\s+/g, "")
  if (!text) return { planIds: [], range: null }
  const range = text.match(/^([A-ZА-ЯЁ])-?(\d+)-(?:[A-ZА-ЯЁ]-?)?(\d+)$/)
  if (range) {
    const from = Number(range[2])
    const to = Number(range[3])
    if (from > 0 && to >= from) return { planIds: [], range: { zone: range[1], from, to } }
  }
  const ids = text
    .split(/[,;]+/)
    .map((p) => normalizePlanRowId(p) || p.replace(/^FG-/, ""))
    .filter(Boolean)
  return { planIds: ids, range: null }
}

export function rowMatchesSelector(planRowId: string, selector: string): boolean {
  const parsed = parseRowSelector(selector)
  const id = normalizePlanRowId(planRowId) || planRowId.toUpperCase()
  if (parsed.range) {
    const m = id.match(/^([A-ZА-ЯЁ])-(\d+)$/)
    if (!m) return false
    const n = Number(m[2])
    return m[1] === parsed.range.zone && n >= parsed.range.from && n <= parsed.range.to
  }
  return parsed.planIds.includes(id)
}

function rowInRule(planRowId: string, zone: string, rule: PlacementRule): boolean {
  if (rule.zoneCodes.length > 0 && !rule.zoneCodes.map((z) => z.toUpperCase()).includes(zone.toUpperCase())) {
    if (rule.rowCodes.length === 0 && !rule.rowFrom) return false
  }
  if (rule.rowCodes.length > 0) {
    const id = normalizePlanRowId(planRowId) || planRowId
    if (rule.rowCodes.some((c) => normalizePlanRowId(c) === id || c === planRowId || c === `FG-${id}`)) return true
    if (!rule.rowFrom) return rule.zoneCodes.length === 0 ? true : false
  }
  if (rule.rowFrom && rule.rowTo) {
    return rowMatchesSelector(planRowId, `${rule.rowFrom}-${rule.rowTo}`)
  }
  if (rule.rowFrom) return rowMatchesSelector(planRowId, rule.rowFrom)
  return rule.zoneCodes.length === 0 || rule.zoneCodes.map((z) => z.toUpperCase()).includes(zone.toUpperCase())
}

/** Физика ряда: позиции 1..capacity, start = сторона отбора по умолчанию. */
export function laneOrder(capacity: number, fromSide: LaneSide): number[] {
  const n = Math.max(1, capacity)
  const positions = Array.from({ length: n }, (_, i) => i + 1)
  return fromSide === "start" ? positions : positions.slice().reverse()
}

export function nextPutawayPosition(
  occupied: number[],
  capacity: number,
  storage: StorageStrategy,
  loadSide: LaneSide,
  pickSide: LaneSide
): number | null {
  const cap = Math.max(1, capacity)
  const taken = new Set(occupied.filter((p) => p >= 1 && p <= cap))
  if (taken.size >= cap) return null
  if (storage === "random") {
    for (let p = 1; p <= cap; p++) if (!taken.has(p)) return p
    return null
  }
  const loadOrder = laneOrder(cap, loadSide)
  if (storage === "fifo_lane") {
    const pickOrder = laneOrder(cap, pickSide)
    let lastOccupiedIdx = -1
    pickOrder.forEach((pos, idx) => {
      if (taken.has(pos)) lastOccupiedIdx = idx
    })
    if (lastOccupiedIdx < 0) return loadOrder[loadOrder.length - 1] === pickOrder[0] ? pickOrder[0] : pickOrder[0]
    const next = pickOrder[lastOccupiedIdx + 1]
    return next && !taken.has(next) ? next : null
  }
  for (const pos of loadOrder) {
    if (!taken.has(pos)) return pos
  }
  return null
}

export function pickAccessibleLpns(
  pallets: Array<{ lpn: string; position: number }>,
  capacity: number,
  storage: StorageStrategy,
  pickSide: LaneSide
): { accessible: string[]; blockedBy: Record<string, string[]> } {
  const blockedBy: Record<string, string[]> = {}
  if (pallets.length === 0) return { accessible: [], blockedBy }
  if (storage === "random") {
    return { accessible: pallets.map((p) => p.lpn), blockedBy }
  }
  const order = laneOrder(Math.max(1, capacity), pickSide)
  const byPos = new Map(pallets.map((p) => [p.position, p.lpn]))
  const first = order.find((pos) => byPos.has(pos))
  if (!first) return { accessible: [], blockedBy }
  const face = byPos.get(first)!
  for (const p of pallets) {
    if (p.lpn === face) continue
    const blockers: string[] = []
    for (const pos of order) {
      const lpn = byPos.get(pos)
      if (!lpn) continue
      if (lpn === p.lpn) break
      blockers.push(lpn)
    }
    blockedBy[p.lpn] = blockers
  }
  return { accessible: [face], blockedBy }
}

function mapMatchers(rows: Array<{ match_kind: string; match_value: string; match_label: string | null }>): ProductMatcher[] {
  return rows.map((r) => ({
    kind: asKind(r.match_kind),
    value: r.match_value,
    label: r.match_label ?? undefined,
  }))
}

async function loadFgRows(client: PoolClient, siteId: number): Promise<FgRowRecord[]> {
  const r = await client.query<{
    locationId: string
    locationCode: string
    planRowId: string | null
    zone: string
    label: string
    capacity: string
    palletCount: string
  }>(
    `
    SELECT
      l.location_id::text AS "locationId",
      l.location_code AS "locationCode",
      NULLIF(COALESCE(l.location_attrs_json->>'planRowId', ''), '') AS "planRowId",
      COALESCE(z.zone_code, '') AS zone,
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS label,
      COALESCE(
        (l.location_attrs_json->'slotProfile'->>'capacityUnits')::numeric,
        (l.location_attrs_json->>'planCapacity')::numeric,
        24
      )::text AS capacity,
      (
        SELECT COUNT(DISTINCT COALESCE(
          CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
          CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
          CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
        ))::text
        FROM wms_item_codes mic
        JOIN codes c ON c.code_id = mic.code_id
        LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
        LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
        WHERE mic.current_location_id = l.location_id
          AND mic.current_site_id = l.site_id
          AND mic.unlinked_at IS NULL
      ) AS "palletCount"
    FROM wms_locations l
    LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
    WHERE l.site_id = $1
      AND (
        COALESCE(l.location_attrs_json->>'planRowId', '') <> ''
        OR COALESCE(l.location_attrs_json->>'fgRow', '') = 'true'
        OR COALESCE(l.location_attrs_json->>'storageModel', '') = 'pallet_row'
        OR l.location_code ILIKE 'FG-%'
      )
    ORDER BY z.zone_code, l.location_code
    `,
    [siteId]
  )
  return r.rows.map((row) => ({
    locationId: row.locationId,
    locationCode: row.locationCode,
    planRowId:
      normalizePlanRowId(row.planRowId) ||
      planRowIdFromLocationCode(row.locationCode) ||
      row.locationCode,
    zone: row.zone,
    label: row.label,
    capacity: Math.max(1, Number(row.capacity) || 24),
    palletCount: Number(row.palletCount) || 0,
  }))
}

export async function loadPolicy(
  client: PoolClient,
  siteId: number
): Promise<WarehousePlacementPolicy> {
  await ensureFgPlacementSchema(client)
  const r = await client.query(
    `SELECT * FROM wms_fg_placement_policy WHERE site_id = $1`,
    [siteId]
  )
  const row = r.rows[0]
  if (!row) return { ...DEFAULT_WAREHOUSE_POLICY, weights: { ...DEFAULT_PLACEMENT_WEIGHTS } }
  return {
    storageStrategy: asStorage(row.storage_strategy, DEFAULT_WAREHOUSE_POLICY.storageStrategy),
    allocationStrategy: asAlloc(row.allocation_strategy, DEFAULT_WAREHOUSE_POLICY.allocationStrategy),
    conflictPolicy: asConflict(row.conflict_policy, DEFAULT_WAREHOUSE_POLICY.conflictPolicy),
    allowedMode: asMode(row.allowed_mode, DEFAULT_WAREHOUSE_POLICY.allowedMode),
    placementPriority: num(row.placement_priority, 50),
    maxOccupancy: num(row.max_occupancy, 100),
    allowMixedSku: bool(row.allow_mixed_sku, true),
    allowMixedLot: bool(row.allow_mixed_lot, true),
    allowReserve: bool(row.allow_reserve, true),
    allowQuarantine: bool(row.allow_quarantine, false),
    loadSide: asSide(row.load_side, "end"),
    pickSide: asSide(row.pick_side, "start"),
    useExpiry: bool(row.use_expiry, true),
    useMfg: bool(row.use_mfg, false),
    minRemainingDays: num(row.min_remaining_days, 0),
    weights: parseWeights(row.weights_json),
  }
}

export async function savePolicy(
  client: PoolClient,
  siteId: number,
  policy: WarehousePlacementPolicy,
  actor: string
): Promise<WarehousePlacementPolicy> {
  await ensureFgPlacementSchema(client)
  const before = await loadPolicy(client, siteId)
  await client.query(
    `INSERT INTO wms_fg_placement_policy (
       site_id, storage_strategy, allocation_strategy, conflict_policy, allowed_mode,
       placement_priority, max_occupancy, allow_mixed_sku, allow_mixed_lot, allow_reserve,
       allow_quarantine, load_side, pick_side, use_expiry, use_mfg, min_remaining_days, weights_json
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)
     ON CONFLICT (site_id) DO UPDATE SET
       storage_strategy = EXCLUDED.storage_strategy,
       allocation_strategy = EXCLUDED.allocation_strategy,
       conflict_policy = EXCLUDED.conflict_policy,
       allowed_mode = EXCLUDED.allowed_mode,
       placement_priority = EXCLUDED.placement_priority,
       max_occupancy = EXCLUDED.max_occupancy,
       allow_mixed_sku = EXCLUDED.allow_mixed_sku,
       allow_mixed_lot = EXCLUDED.allow_mixed_lot,
       allow_reserve = EXCLUDED.allow_reserve,
       allow_quarantine = EXCLUDED.allow_quarantine,
       load_side = EXCLUDED.load_side,
       pick_side = EXCLUDED.pick_side,
       use_expiry = EXCLUDED.use_expiry,
       use_mfg = EXCLUDED.use_mfg,
       min_remaining_days = EXCLUDED.min_remaining_days,
       weights_json = EXCLUDED.weights_json,
       updated_at = now()`,
    [
      siteId,
      policy.storageStrategy,
      policy.allocationStrategy,
      policy.conflictPolicy,
      policy.allowedMode,
      policy.placementPriority,
      policy.maxOccupancy,
      policy.allowMixedSku,
      policy.allowMixedLot,
      policy.allowReserve,
      policy.allowQuarantine,
      policy.loadSide,
      policy.pickSide,
      policy.useExpiry,
      policy.useMfg,
      policy.minRemainingDays,
      JSON.stringify(policy.weights),
    ]
  )
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "policy",
    target: "WAREHOUSE",
    detail: "Обновлены настройки склада",
    beforeJson: before,
    afterJson: policy,
  })
  return loadPolicy(client, siteId)
}

export async function listPlacementRules(client: PoolClient, siteId: number): Promise<PlacementRule[]> {
  await ensureFgPlacementSchema(client)
  const rules = await client.query(
    `SELECT * FROM wms_fg_placement_rules WHERE site_id = $1 ORDER BY placement_priority DESC, code`,
    [siteId]
  )
  const products = await client.query(
    `SELECT p.rule_id::text, p.match_kind, p.match_value, p.match_label
     FROM wms_fg_placement_rule_products p
     JOIN wms_fg_placement_rules r ON r.rule_id = p.rule_id
     WHERE r.site_id = $1`,
    [siteId]
  )
  const byRule = new Map<string, ProductMatcher[]>()
  for (const p of products.rows) {
    const list = byRule.get(p.rule_id) ?? []
    list.push({ kind: asKind(p.match_kind), value: p.match_value, label: p.match_label ?? undefined })
    byRule.set(p.rule_id, list)
  }
  return rules.rows.map((row) => ({
    ruleId: String(row.rule_id),
    code: String(row.code),
    name: String(row.name),
    isActive: Boolean(row.is_active),
    storageStrategy: row.storage_strategy ? asStorage(row.storage_strategy, "fifo_lane") : null,
    allocationStrategy: row.allocation_strategy ? asAlloc(row.allocation_strategy, "fefo") : null,
    conflictPolicy: row.conflict_policy ? asConflict(row.conflict_policy, "next_accessible") : null,
    placementPriority: num(row.placement_priority, 80),
    maxOccupancy: row.max_occupancy == null ? null : num(row.max_occupancy, 100),
    allowMixedSku: row.allow_mixed_sku == null ? null : Boolean(row.allow_mixed_sku),
    allowMixedLot: row.allow_mixed_lot == null ? null : Boolean(row.allow_mixed_lot),
    allowReserve: row.allow_reserve == null ? null : Boolean(row.allow_reserve),
    allowQuarantine: row.allow_quarantine == null ? null : Boolean(row.allow_quarantine),
    zoneCodes: Array.isArray(row.zone_codes) ? row.zone_codes.map(String) : [],
    rowFrom: row.row_from ? String(row.row_from) : null,
    rowTo: row.row_to ? String(row.row_to) : null,
    rowCodes: Array.isArray(row.row_codes) ? row.row_codes.map(String) : [],
    products: byRule.get(String(row.rule_id)) ?? [],
    productionPlanPriority: num(row.production_plan_priority, 0),
    note: row.note != null ? String(row.note) : null,
  }))
}

export async function upsertPlacementRule(
  client: PoolClient,
  siteId: number,
  input: PlacementRule,
  actor: string
): Promise<PlacementRule> {
  await ensureFgPlacementSchema(client)
  const existing = input.ruleId
    ? (await listPlacementRules(client, siteId)).find((r) => r.ruleId === input.ruleId)
    : null
  const saved = await client.query<{ rule_id: string }>(
    `INSERT INTO wms_fg_placement_rules (
       site_id, code, name, is_active, storage_strategy, allocation_strategy, conflict_policy,
       placement_priority, max_occupancy, allow_mixed_sku, allow_mixed_lot, allow_reserve,
       allow_quarantine, zone_codes, row_from, row_to, row_codes, production_plan_priority, note
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[],$15,$16,$17::text[],$18,$19
     )
     ON CONFLICT (site_id, code) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = EXCLUDED.is_active,
       storage_strategy = EXCLUDED.storage_strategy,
       allocation_strategy = EXCLUDED.allocation_strategy,
       conflict_policy = EXCLUDED.conflict_policy,
       placement_priority = EXCLUDED.placement_priority,
       max_occupancy = EXCLUDED.max_occupancy,
       allow_mixed_sku = EXCLUDED.allow_mixed_sku,
       allow_mixed_lot = EXCLUDED.allow_mixed_lot,
       allow_reserve = EXCLUDED.allow_reserve,
       allow_quarantine = EXCLUDED.allow_quarantine,
       zone_codes = EXCLUDED.zone_codes,
       row_from = EXCLUDED.row_from,
       row_to = EXCLUDED.row_to,
       row_codes = EXCLUDED.row_codes,
       production_plan_priority = EXCLUDED.production_plan_priority,
       note = EXCLUDED.note,
       updated_at = now()
     RETURNING rule_id::text`,
    [
      siteId,
      input.code.trim().toUpperCase(),
      input.name.trim(),
      input.isActive,
      input.storageStrategy,
      input.allocationStrategy,
      input.conflictPolicy,
      input.placementPriority,
      input.maxOccupancy,
      input.allowMixedSku,
      input.allowMixedLot,
      input.allowReserve,
      input.allowQuarantine,
      input.zoneCodes,
      input.rowFrom,
      input.rowTo,
      input.rowCodes,
      input.productionPlanPriority,
      input.note,
    ]
  )
  const ruleId = saved.rows[0]!.rule_id
  await client.query(`DELETE FROM wms_fg_placement_rule_products WHERE rule_id = $1::bigint`, [ruleId])
  for (const p of input.products) {
    await client.query(
      `INSERT INTO wms_fg_placement_rule_products (rule_id, match_kind, match_value, match_label)
       VALUES ($1::bigint, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [ruleId, p.kind, p.value, p.label ?? null]
    )
  }
  const after = (await listPlacementRules(client, siteId)).find((r) => r.ruleId === ruleId)!
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "rule",
    target: after.code,
    detail: existing ? `Правило ${after.code} изменено` : `Правило ${after.code} создано`,
    beforeJson: existing ?? {},
    afterJson: after,
  })
  return after
}

export async function deletePlacementRule(
  client: PoolClient,
  siteId: number,
  ruleId: string,
  actor: string
): Promise<void> {
  await ensureFgPlacementSchema(client)
  const before = (await listPlacementRules(client, siteId)).find((r) => r.ruleId === ruleId)
  await client.query(`DELETE FROM wms_fg_placement_rules WHERE site_id = $1 AND rule_id = $2::bigint`, [siteId, ruleId])
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "rule",
    target: before?.code ?? ruleId,
    detail: `Правило удалено`,
    beforeJson: before ?? {},
    afterJson: {},
  })
}

type ZoneRow = {
  zone_code: string
  storage_strategy: string | null
  allocation_strategy: string | null
  conflict_policy: string | null
  allowed_mode: string
  placement_priority: number | null
  max_occupancy: number | null
  allow_mixed_sku: boolean | null
  allow_mixed_lot: boolean | null
  allow_reserve: boolean | null
  allow_quarantine: boolean | null
  load_side: string | null
  pick_side: string | null
  use_expiry: boolean | null
  use_mfg: boolean | null
  min_remaining_days: number | null
}

async function loadZones(client: PoolClient, siteId: number) {
  const zones = await client.query<ZoneRow>(`SELECT * FROM wms_fg_zone_placement WHERE site_id = $1`, [siteId])
  const products = await client.query(
    `SELECT zone_code, match_kind, match_value, match_label FROM wms_fg_zone_allowed_products WHERE site_id = $1`,
    [siteId]
  )
  const byZone = new Map<string, ProductMatcher[]>()
  for (const p of products.rows) {
    const list = byZone.get(p.zone_code) ?? []
    list.push({ kind: asKind(p.match_kind), value: p.match_value, label: p.match_label ?? undefined })
    byZone.set(p.zone_code, list)
  }
  return { zones: zones.rows, products: byZone }
}

export async function saveZonePlacement(
  client: PoolClient,
  siteId: number,
  zoneCode: string,
  patch: Partial<ZoneRow> & { allowedProducts?: ProductMatcher[] },
  actor: string
): Promise<void> {
  await ensureFgPlacementSchema(client)
  const zone = zoneCode.trim().toUpperCase()
  await client.query(
    `INSERT INTO wms_fg_zone_placement (
       site_id, zone_code, storage_strategy, allocation_strategy, conflict_policy, allowed_mode,
       placement_priority, max_occupancy, allow_mixed_sku, allow_mixed_lot, allow_reserve,
       allow_quarantine, load_side, pick_side, use_expiry, use_mfg, min_remaining_days
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (site_id, zone_code) DO UPDATE SET
       storage_strategy = COALESCE(EXCLUDED.storage_strategy, wms_fg_zone_placement.storage_strategy),
       allocation_strategy = COALESCE(EXCLUDED.allocation_strategy, wms_fg_zone_placement.allocation_strategy),
       conflict_policy = COALESCE(EXCLUDED.conflict_policy, wms_fg_zone_placement.conflict_policy),
       allowed_mode = EXCLUDED.allowed_mode,
       placement_priority = COALESCE(EXCLUDED.placement_priority, wms_fg_zone_placement.placement_priority),
       max_occupancy = COALESCE(EXCLUDED.max_occupancy, wms_fg_zone_placement.max_occupancy),
       allow_mixed_sku = COALESCE(EXCLUDED.allow_mixed_sku, wms_fg_zone_placement.allow_mixed_sku),
       allow_mixed_lot = COALESCE(EXCLUDED.allow_mixed_lot, wms_fg_zone_placement.allow_mixed_lot),
       allow_reserve = COALESCE(EXCLUDED.allow_reserve, wms_fg_zone_placement.allow_reserve),
       allow_quarantine = COALESCE(EXCLUDED.allow_quarantine, wms_fg_zone_placement.allow_quarantine),
       load_side = COALESCE(EXCLUDED.load_side, wms_fg_zone_placement.load_side),
       pick_side = COALESCE(EXCLUDED.pick_side, wms_fg_zone_placement.pick_side),
       use_expiry = COALESCE(EXCLUDED.use_expiry, wms_fg_zone_placement.use_expiry),
       use_mfg = COALESCE(EXCLUDED.use_mfg, wms_fg_zone_placement.use_mfg),
       min_remaining_days = COALESCE(EXCLUDED.min_remaining_days, wms_fg_zone_placement.min_remaining_days),
       updated_at = now()`,
    [
      siteId,
      zone,
      patch.storage_strategy ?? null,
      patch.allocation_strategy ?? null,
      patch.conflict_policy ?? null,
      patch.allowed_mode ?? "inherit",
      patch.placement_priority ?? null,
      patch.max_occupancy ?? null,
      patch.allow_mixed_sku ?? null,
      patch.allow_mixed_lot ?? null,
      patch.allow_reserve ?? null,
      patch.allow_quarantine ?? null,
      patch.load_side ?? null,
      patch.pick_side ?? null,
      patch.use_expiry ?? null,
      patch.use_mfg ?? null,
      patch.min_remaining_days ?? null,
    ]
  )
  if (patch.allowedProducts) {
    await client.query(`DELETE FROM wms_fg_zone_allowed_products WHERE site_id = $1 AND zone_code = $2`, [siteId, zone])
    for (const p of patch.allowedProducts) {
      await client.query(
        `INSERT INTO wms_fg_zone_allowed_products (site_id, zone_code, match_kind, match_value, match_label)
         VALUES ($1,$2,$3,$4,$5)`,
        [siteId, zone, p.kind, p.value, p.label ?? null]
      )
    }
  }
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "zone",
    target: zone,
    detail: `Настройки зоны ${zone}`,
    afterJson: patch,
  })
}

function emptyDraft(): RowPlacementDraft {
  return {
    inherit: true,
    isActive: true,
    isBlocked: false,
    storageStrategy: null,
    allocationStrategy: null,
    conflictPolicy: null,
    allowedMode: "inherit",
    allowedProducts: [],
    placementPriority: null,
    maxOccupancy: null,
    allowMixedSku: null,
    allowMixedLot: null,
    allowReserve: null,
    allowQuarantine: null,
    loadSide: null,
    pickSide: null,
    useExpiry: null,
    useMfg: null,
    minRemainingDays: null,
  }
}

export async function loadRowDraft(
  client: PoolClient,
  siteId: number,
  locationId: string
): Promise<RowPlacementDraft> {
  await ensureFgPlacementSchema(client)
  const r = await client.query(`SELECT * FROM wms_fg_row_placement WHERE site_id = $1 AND location_id = $2::bigint`, [
    siteId,
    locationId,
  ])
  const products = await client.query(
    `SELECT match_kind, match_value, match_label FROM wms_fg_row_allowed_products
     WHERE site_id = $1 AND location_id = $2::bigint`,
    [siteId, locationId]
  )
  const row = r.rows[0]
  if (!row) return { ...emptyDraft(), allowedProducts: mapMatchers(products.rows) }
  return {
    inherit: Boolean(row.inherit),
    isActive: Boolean(row.is_active),
    isBlocked: Boolean(row.is_blocked),
    storageStrategy: row.storage_strategy ? asStorage(row.storage_strategy, "fifo_lane") : null,
    allocationStrategy: row.allocation_strategy ? asAlloc(row.allocation_strategy, "fefo") : null,
    conflictPolicy: row.conflict_policy ? asConflict(row.conflict_policy, "next_accessible") : null,
    allowedMode: asMode(row.allowed_mode, "inherit"),
    allowedProducts: mapMatchers(products.rows),
    placementPriority: row.placement_priority == null ? null : num(row.placement_priority, 50),
    maxOccupancy: row.max_occupancy == null ? null : num(row.max_occupancy, 100),
    allowMixedSku: row.allow_mixed_sku == null ? null : Boolean(row.allow_mixed_sku),
    allowMixedLot: row.allow_mixed_lot == null ? null : Boolean(row.allow_mixed_lot),
    allowReserve: row.allow_reserve == null ? null : Boolean(row.allow_reserve),
    allowQuarantine: row.allow_quarantine == null ? null : Boolean(row.allow_quarantine),
    loadSide: row.load_side ? asSide(row.load_side, "end") : null,
    pickSide: row.pick_side ? asSide(row.pick_side, "start") : null,
    useExpiry: row.use_expiry == null ? null : Boolean(row.use_expiry),
    useMfg: row.use_mfg == null ? null : Boolean(row.use_mfg),
    minRemainingDays: row.min_remaining_days == null ? null : num(row.min_remaining_days, 0),
  }
}

export async function saveRowDraft(
  client: PoolClient,
  siteId: number,
  locationId: string,
  draft: RowPlacementDraft,
  actor: string
): Promise<EffectiveRowSettings> {
  await ensureFgPlacementSchema(client)
  const before = await loadRowDraft(client, siteId, locationId)
  await client.query(
    `INSERT INTO wms_fg_row_placement (
       site_id, location_id, inherit, is_active, is_blocked, storage_strategy, allocation_strategy,
       conflict_policy, allowed_mode, placement_priority, max_occupancy, allow_mixed_sku,
       allow_mixed_lot, allow_reserve, allow_quarantine, load_side, pick_side, use_expiry,
       use_mfg, min_remaining_days
     ) VALUES (
       $1,$2::bigint,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     )
     ON CONFLICT (site_id, location_id) DO UPDATE SET
       inherit = EXCLUDED.inherit,
       is_active = EXCLUDED.is_active,
       is_blocked = EXCLUDED.is_blocked,
       storage_strategy = EXCLUDED.storage_strategy,
       allocation_strategy = EXCLUDED.allocation_strategy,
       conflict_policy = EXCLUDED.conflict_policy,
       allowed_mode = EXCLUDED.allowed_mode,
       placement_priority = EXCLUDED.placement_priority,
       max_occupancy = EXCLUDED.max_occupancy,
       allow_mixed_sku = EXCLUDED.allow_mixed_sku,
       allow_mixed_lot = EXCLUDED.allow_mixed_lot,
       allow_reserve = EXCLUDED.allow_reserve,
       allow_quarantine = EXCLUDED.allow_quarantine,
       load_side = EXCLUDED.load_side,
       pick_side = EXCLUDED.pick_side,
       use_expiry = EXCLUDED.use_expiry,
       use_mfg = EXCLUDED.use_mfg,
       min_remaining_days = EXCLUDED.min_remaining_days,
       updated_at = now()`,
    [
      siteId,
      locationId,
      draft.inherit,
      draft.isActive,
      draft.isBlocked,
      draft.storageStrategy,
      draft.allocationStrategy,
      draft.conflictPolicy,
      draft.allowedMode,
      draft.placementPriority,
      draft.maxOccupancy,
      draft.allowMixedSku,
      draft.allowMixedLot,
      draft.allowReserve,
      draft.allowQuarantine,
      draft.loadSide,
      draft.pickSide,
      draft.useExpiry,
      draft.useMfg,
      draft.minRemainingDays,
    ]
  )
  await client.query(`DELETE FROM wms_fg_row_allowed_products WHERE site_id = $1 AND location_id = $2::bigint`, [
    siteId,
    locationId,
  ])
  for (const p of draft.allowedProducts) {
    await client.query(
      `INSERT INTO wms_fg_row_allowed_products (site_id, location_id, match_kind, match_value, match_label)
       VALUES ($1,$2::bigint,$3,$4,$5)`,
      [siteId, locationId, p.kind, p.value, p.label ?? null]
    )
  }
  const after = await resolveRowSettings(client, siteId, locationId)
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "row",
    target: after.planRowId || after.locationCode,
    detail: summarizeRowDiff(before, draft),
    beforeJson: before,
    afterJson: draft,
  })
  return after
}

function summarizeRowDiff(before: RowPlacementDraft, after: RowPlacementDraft): string {
  const parts: string[] = []
  if (before.storageStrategy !== after.storageStrategy) {
    parts.push(`Стратегия ряда: ${before.storageStrategy ?? "наследование"} → ${after.storageStrategy ?? "наследование"}`)
  }
  if (before.allocationStrategy !== after.allocationStrategy) {
    parts.push(`Отбор: ${before.allocationStrategy ?? "наследование"} → ${after.allocationStrategy ?? "наследование"}`)
  }
  if (before.placementPriority !== after.placementPriority) {
    parts.push(`Приоритет: ${before.placementPriority ?? "—"} → ${after.placementPriority ?? "—"}`)
  }
  const beforeSku = before.allowedProducts.map((p) => p.value).join(",")
  const afterSku = after.allowedProducts.map((p) => p.value).join(",")
  if (beforeSku !== afterSku) parts.push(`Номенклатуры: ${beforeSku || "—"} → ${afterSku || "—"}`)
  return parts.join("; ") || "Сохранены настройки ряда"
}

export async function resetRowDraft(
  client: PoolClient,
  siteId: number,
  locationId: string,
  actor: string
): Promise<EffectiveRowSettings> {
  await ensureFgPlacementSchema(client)
  const before = await loadRowDraft(client, siteId, locationId)
  await client.query(`DELETE FROM wms_fg_row_allowed_products WHERE site_id = $1 AND location_id = $2::bigint`, [
    siteId,
    locationId,
  ])
  await client.query(`DELETE FROM wms_fg_row_placement WHERE site_id = $1 AND location_id = $2::bigint`, [
    siteId,
    locationId,
  ])
  const after = await resolveRowSettings(client, siteId, locationId)
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "row",
    target: after.planRowId,
    detail: "Сброс к наследованию зоны/склада",
    beforeJson: before,
    afterJson: emptyDraft(),
  })
  return after
}

export async function applyToRows(
  client: PoolClient,
  siteId: number,
  selector: string,
  draft: RowPlacementDraft,
  actor: string
): Promise<{ updated: number; locationIds: string[] }> {
  const rows = await loadFgRows(client, siteId)
  const matched = rows.filter((r) => rowMatchesSelector(r.planRowId, selector) || rowMatchesSelector(r.locationCode, selector))
  for (const row of matched) {
    await saveRowDraft(client, siteId, row.locationId, draft, actor)
  }
  return { updated: matched.length, locationIds: matched.map((r) => r.locationId) }
}

function fillPercent(row: FgRowRecord): number {
  return Math.min(100, Math.round((100 * row.palletCount) / Math.max(1, row.capacity)))
}

export async function resolveAllRowSettings(
  client: PoolClient,
  siteId: number
): Promise<EffectiveRowSettings[]> {
  await ensureFgPlacementSchema(client)
  const [policy, rules, rows, zonePack] = await Promise.all([
    loadPolicy(client, siteId),
    listPlacementRules(client, siteId),
    loadFgRows(client, siteId),
    loadZones(client, siteId),
  ])
  const drafts = await client.query(`SELECT * FROM wms_fg_row_placement WHERE site_id = $1`, [siteId])
  const draftProducts = await client.query(
    `SELECT location_id::text, match_kind, match_value, match_label FROM wms_fg_row_allowed_products WHERE site_id = $1`,
    [siteId]
  )
  const draftByLoc = new Map(drafts.rows.map((r) => [String(r.location_id), r]))
  const productsByLoc = new Map<string, ProductMatcher[]>()
  for (const p of draftProducts.rows) {
    const list = productsByLoc.get(p.location_id) ?? []
    list.push({ kind: asKind(p.match_kind), value: p.match_value, label: p.match_label ?? undefined })
    productsByLoc.set(p.location_id, list)
  }

  return rows.map((row) => {
    const inheritedFrom: EffectiveRowSettings["inheritedFrom"] = ["warehouse"]
    const overrides: string[] = []
    let storageStrategy = policy.storageStrategy
    let allocationStrategy = policy.allocationStrategy
    let conflictPolicy = policy.conflictPolicy
    let allowedMode: AllowedMode = policy.allowedMode
    let allowedProducts: ProductMatcher[] = []
    let placementPriority = policy.placementPriority
    let maxOccupancy = policy.maxOccupancy
    let allowMixedSku = policy.allowMixedSku
    let allowMixedLot = policy.allowMixedLot
    let allowReserve = policy.allowReserve
    let allowQuarantine = policy.allowQuarantine
    let loadSide = policy.loadSide
    let pickSide = policy.pickSide
    let useExpiry = policy.useExpiry
    let useMfg = policy.useMfg
    let minRemainingDays = policy.minRemainingDays
    let ruleCode: string | null = null
    let ruleName: string | null = null

    const zone = zonePack.zones.find((z) => z.zone_code.toUpperCase() === row.zone.toUpperCase())
    if (zone) {
      inheritedFrom.push("zone")
      if (zone.storage_strategy) storageStrategy = asStorage(zone.storage_strategy, storageStrategy)
      if (zone.allocation_strategy) allocationStrategy = asAlloc(zone.allocation_strategy, allocationStrategy)
      if (zone.conflict_policy) conflictPolicy = asConflict(zone.conflict_policy, conflictPolicy)
      if (zone.allowed_mode && zone.allowed_mode !== "inherit") {
        allowedMode = asMode(zone.allowed_mode, allowedMode)
        allowedProducts = zonePack.products.get(zone.zone_code) ?? []
      }
      if (zone.placement_priority != null) placementPriority = num(zone.placement_priority, placementPriority)
      if (zone.max_occupancy != null) maxOccupancy = num(zone.max_occupancy, maxOccupancy)
      if (zone.allow_mixed_sku != null) allowMixedSku = Boolean(zone.allow_mixed_sku)
      if (zone.allow_mixed_lot != null) allowMixedLot = Boolean(zone.allow_mixed_lot)
      if (zone.allow_reserve != null) allowReserve = Boolean(zone.allow_reserve)
      if (zone.allow_quarantine != null) allowQuarantine = Boolean(zone.allow_quarantine)
      if (zone.load_side) loadSide = asSide(zone.load_side, loadSide)
      if (zone.pick_side) pickSide = asSide(zone.pick_side, pickSide)
      if (zone.use_expiry != null) useExpiry = Boolean(zone.use_expiry)
      if (zone.use_mfg != null) useMfg = Boolean(zone.use_mfg)
      if (zone.min_remaining_days != null) minRemainingDays = num(zone.min_remaining_days, minRemainingDays)
    }

    const matchingRules = rules
      .filter((rule) => rule.isActive && rowInRule(row.planRowId, row.zone, rule))
      .sort((a, b) => b.placementPriority - a.placementPriority)
    const rule = matchingRules[0]
    if (rule) {
      inheritedFrom.push("rule")
      ruleCode = rule.code
      ruleName = rule.name
      if (rule.storageStrategy) storageStrategy = rule.storageStrategy
      if (rule.allocationStrategy) allocationStrategy = rule.allocationStrategy
      if (rule.conflictPolicy) conflictPolicy = rule.conflictPolicy
      if (rule.products.length > 0) {
        allowedMode = "list"
        allowedProducts = rule.products
      }
      placementPriority = Math.max(placementPriority, rule.placementPriority)
      if (rule.maxOccupancy != null) maxOccupancy = rule.maxOccupancy
      if (rule.allowMixedSku != null) allowMixedSku = rule.allowMixedSku
      if (rule.allowMixedLot != null) allowMixedLot = rule.allowMixedLot
      if (rule.allowReserve != null) allowReserve = rule.allowReserve
      if (rule.allowQuarantine != null) allowQuarantine = rule.allowQuarantine
    }

    const raw = draftByLoc.get(row.locationId)
    const isActive = raw ? Boolean(raw.is_active) : true
    const isBlocked = raw ? Boolean(raw.is_blocked) : false
    if (raw && !raw.inherit) {
      inheritedFrom.push("row")
      if (raw.storage_strategy) {
        storageStrategy = asStorage(raw.storage_strategy, storageStrategy)
        overrides.push("storageStrategy")
      }
      if (raw.allocation_strategy) {
        allocationStrategy = asAlloc(raw.allocation_strategy, allocationStrategy)
        overrides.push("allocationStrategy")
      }
      if (raw.conflict_policy) {
        conflictPolicy = asConflict(raw.conflict_policy, conflictPolicy)
        overrides.push("conflictPolicy")
      }
      if (raw.allowed_mode && raw.allowed_mode !== "inherit") {
        allowedMode = asMode(raw.allowed_mode, allowedMode)
        allowedProducts = productsByLoc.get(row.locationId) ?? allowedProducts
        overrides.push("allowedProducts")
      }
      if (raw.placement_priority != null) {
        placementPriority = num(raw.placement_priority, placementPriority)
        overrides.push("placementPriority")
      }
      if (raw.max_occupancy != null) {
        maxOccupancy = num(raw.max_occupancy, maxOccupancy)
        overrides.push("maxOccupancy")
      }
      if (raw.allow_mixed_sku != null) {
        allowMixedSku = Boolean(raw.allow_mixed_sku)
        overrides.push("allowMixedSku")
      }
      if (raw.allow_mixed_lot != null) {
        allowMixedLot = Boolean(raw.allow_mixed_lot)
        overrides.push("allowMixedLot")
      }
      if (raw.allow_reserve != null) allowReserve = Boolean(raw.allow_reserve)
      if (raw.allow_quarantine != null) allowQuarantine = Boolean(raw.allow_quarantine)
      if (raw.load_side) {
        loadSide = asSide(raw.load_side, loadSide)
        overrides.push("loadSide")
      }
      if (raw.pick_side) {
        pickSide = asSide(raw.pick_side, pickSide)
        overrides.push("pickSide")
      }
      if (raw.use_expiry != null) useExpiry = Boolean(raw.use_expiry)
      if (raw.use_mfg != null) useMfg = Boolean(raw.use_mfg)
      if (raw.min_remaining_days != null) minRemainingDays = num(raw.min_remaining_days, minRemainingDays)
    } else if (raw?.allowed_mode === "list" || raw?.allowed_mode === "any") {
      allowedMode = asMode(raw.allowed_mode, allowedMode)
      if (raw.allowed_mode === "list") allowedProducts = productsByLoc.get(row.locationId) ?? allowedProducts
      inheritedFrom.push("row")
      overrides.push("allowedProducts")
    }

    if (allowedMode === "any") allowedProducts = [{ kind: "any", value: "*", label: "ANY PRODUCT" }]

    return {
      locationId: row.locationId,
      locationCode: row.locationCode,
      planRowId: row.planRowId,
      zone: row.zone,
      label: row.label,
      capacity: row.capacity,
      palletCount: row.palletCount,
      fillPercent: fillPercent(row),
      isActive,
      isBlocked,
      storageStrategy,
      allocationStrategy,
      conflictPolicy,
      allowedMode,
      allowedProducts,
      placementPriority,
      maxOccupancy,
      allowMixedSku,
      allowMixedLot,
      allowReserve,
      allowQuarantine,
      loadSide,
      pickSide,
      useExpiry,
      useMfg,
      minRemainingDays,
      inheritedFrom,
      overrides,
      ruleCode,
      ruleName,
    }
  })
}

export async function resolveRowSettings(
  client: PoolClient,
  siteId: number,
  locationOrPlanId: string
): Promise<EffectiveRowSettings> {
  const all = await resolveAllRowSettings(client, siteId)
  const key = locationOrPlanId.trim()
  const canon = canonicalPlanRowId(key)
  const found =
    all.find((r) => r.locationId === key) ||
    all.find((r) => r.planRowId === normalizePlanRowId(key) || r.planRowId === key) ||
    all.find((r) => canonicalPlanRowId(r.planRowId) === canon) ||
    all.find((r) => r.locationCode === key || r.locationCode === `FG-${normalizePlanRowId(key)}`)
  if (!found) throw new Error(`ряд не найден: ${key}`)
  return found
}

async function loadLivePallets(client: PoolClient, siteId: number): Promise<PlacementPallet[]> {
  const r = await client.query<{
    palletId: string
    lpn: string
    palletCode: string
    itemCode: string
    itemName: string
    sku: string
    itemGroup: string
    productGroup: string
    itemClass: string
    locationId: string
    locationCode: string
    planRowId: string | null
    zone: string
    receivedAt: string | null
    manufacturedAt: string | null
    expiryAt: string | null
    lotCode: string | null
    quarantine: boolean
  }>(
    `
    WITH pallet_ids AS (
      SELECT DISTINCT
        COALESCE(
          CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
          CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
          CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
        ) AS pallet_id,
        mic.current_location_id,
        COALESCE(mic.item_id, (
          SELECT mic3.item_id FROM wms_item_codes mic3
          WHERE mic3.code_id = COALESCE(
            CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
            CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
            CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
          ) AND mic3.unlinked_at IS NULL LIMIT 1
        )) AS item_id,
        mic.linked_at
      FROM wms_item_codes mic
      JOIN codes c ON c.code_id = mic.code_id
      LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
      LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
      JOIN wms_items i ON i.item_id = mic.item_id
      WHERE mic.current_site_id = $1
        AND mic.unlinked_at IS NULL
        AND COALESCE(i.item_type_code, '') IN ('finished_goods', 'fg', 'goods')
        AND i.name !~* '^(стикер|этикетка|эмульсия)\\b'
        AND COALESCE(i.item_group_code, i.product_group, '') NOT IN ('stickers', 'labels')
        AND mic.current_location_id IS NOT NULL
    )
    SELECT
      pal.pallet_id::text AS "palletId",
      COALESCE(NULLIF(pc.ai21_serial, ''), pc.ai01_gtin || COALESCE(pc.ai21_serial, '')) AS lpn,
      (pc.ai01_gtin || COALESCE(pc.ai21_serial, '')) AS "palletCode",
      COALESCE(i.item_code, '') AS "itemCode",
      COALESCE(i.name, '—') AS "itemName",
      COALESCE(i.sku, '') AS sku,
      COALESCE(i.item_group_code, i.product_group, '') AS "itemGroup",
      COALESCE(i.product_group, '') AS "productGroup",
      COALESCE(i.item_class_code, '') AS "itemClass",
      l.location_id::text AS "locationId",
      l.location_code AS "locationCode",
      NULLIF(COALESCE(l.location_attrs_json->>'planRowId', ''), '') AS "planRowId",
      COALESCE(z.zone_code, '') AS zone,
      COALESCE(cs.emitted_at, pal.linked_at)::text AS "receivedAt",
      cs.emitted_at::text AS "manufacturedAt",
      (
        SELECT MIN(le.exp)::text
        FROM (
          SELECT LEAST(
            COALESCE(sl.expiry_at, 'infinity'::timestamptz),
            COALESCE(wl.expiry_at, 'infinity'::timestamptz),
            COALESCE(wl.best_before_at, 'infinity'::timestamptz)
          ) AS exp
          FROM wms_stock_balances sb
          JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id AND sl.available_qty > 0
          LEFT JOIN wms_lots wl ON wl.lot_id = sl.lot_id
          WHERE sb.site_id = $1 AND sb.item_id = i.item_id AND sb.location_id = l.location_id
        ) le
        WHERE le.exp IS NOT NULL AND le.exp < 'infinity'::timestamptz
      ) AS "expiryAt",
      (
        SELECT wl.lot_code
        FROM wms_stock_balances sb
        JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id AND sl.available_qty > 0
        LEFT JOIN wms_lots wl ON wl.lot_id = sl.lot_id
        WHERE sb.site_id = $1 AND sb.item_id = i.item_id AND sb.location_id = l.location_id
        ORDER BY COALESCE(sl.expiry_at, wl.expiry_at, wl.best_before_at) ASC NULLS LAST
        LIMIT 1
      ) AS "lotCode",
      COALESCE((
        SELECT BOOL_OR(COALESCE(wl.is_blocked, FALSE) OR COALESCE(sb.quarantine_qty, 0) > 0)
        FROM wms_stock_balances sb
        LEFT JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id
        LEFT JOIN wms_lots wl ON wl.lot_id = sl.lot_id
        WHERE sb.site_id = $1 AND sb.item_id = i.item_id AND sb.location_id = l.location_id
      ), FALSE) AS quarantine
    FROM pallet_ids pal
    JOIN codes pc ON pc.code_id = pal.pallet_id
    JOIN wms_locations l ON l.location_id = pal.current_location_id
    LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
    LEFT JOIN wms_items i ON i.item_id = pal.item_id
    LEFT JOIN code_state cs ON cs.code_id = pc.code_id
    WHERE pal.pallet_id IS NOT NULL
    `,
    [siteId]
  )

  const reserved = await client.query<{ lpn: string }>(
    `SELECT lpn FROM wms_fg_placement_reservations WHERE site_id = $1`,
    [siteId]
  )
  const reservedSet = new Set(reserved.rows.map((x) => x.lpn))

  const byRow = new Map<string, number>()
  const mapped = r.rows.map((row) => {
    const loc = row.locationId
    const pos = (byRow.get(loc) ?? 0) + 1
    byRow.set(loc, pos)
    const lpn = row.lpn
    return {
      palletId: row.palletId,
      lpn,
      palletCode: row.palletCode,
      itemCode: row.itemCode,
      itemName: row.itemName,
      sku: row.sku,
      itemGroup: row.itemGroup,
      productGroup: row.productGroup,
      itemClass: row.itemClass,
      lotCode: row.lotCode,
      expiryAt: row.expiryAt,
      manufacturedAt: row.manufacturedAt,
      receivedAt: row.receivedAt,
      locationId: row.locationId,
      locationCode: row.locationCode,
      planRowId: normalizePlanRowId(row.planRowId) || planRowIdFromLocationCode(row.locationCode) || "",
      zone: row.zone,
      position: pos,
      reserved: reservedSet.has(lpn),
      blocked: false,
      quarantine: Boolean(row.quarantine),
      available: !Boolean(row.quarantine),
      source: "live" as const,
    }
  })
  try {
    const { listOpenResortIndex, resortIndexHasPallet } = await import("@/lib/wms/fg-resort")
    const open = await listOpenResortIndex(client, siteId)
    if (open.palletIds.size === 0 && open.palletCodes.size === 0) return mapped
    return mapped.map((pallet) =>
      resortIndexHasPallet(open, pallet)
        ? { ...pallet, available: false, blocked: true }
        : pallet
    )
  } catch (error) {
    console.error("[fg-resort] placement overlay", error)
    return mapped
  }
}

async function loadDemoPallets(client: PoolClient, siteId: number): Promise<PlacementPallet[]> {
  const r = await client.query(
    `SELECT * FROM wms_fg_placement_demo_pallets WHERE site_id = $1 ORDER BY plan_row_id, position, lpn`,
    [siteId]
  )
  const reserved = await client.query<{ lpn: string }>(
    `SELECT lpn FROM wms_fg_placement_reservations WHERE site_id = $1`,
    [siteId]
  )
  const reservedSet = new Set(reserved.rows.map((x) => x.lpn))
  return r.rows.map((row) => {
    const status = String(row.status || "available")
    return {
      palletId: `demo:${row.lpn}`,
      lpn: String(row.lpn),
      palletCode: String(row.lpn),
      itemCode: String(row.item_code),
      itemName: String(row.item_name),
      sku: String(row.sku || ""),
      itemGroup: "WATER",
      productGroup: "WATER",
      itemClass: "FG",
      lotCode: row.lot_code != null ? String(row.lot_code) : null,
      expiryAt: row.expiry_at ? new Date(row.expiry_at).toISOString() : null,
      manufacturedAt: row.manufactured_at ? new Date(row.manufactured_at).toISOString() : null,
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
      locationId: row.location_id != null ? String(row.location_id) : "",
      locationCode: `FG-${row.plan_row_id}`,
      planRowId: String(row.plan_row_id),
      zone: String(row.plan_row_id).split("-")[0] || "",
      position: num(row.position, 1),
      reserved: reservedSet.has(String(row.lpn)) || status === "reserved",
      blocked: status === "blocked",
      quarantine: status === "quarantine",
      available: status !== "blocked" && status !== "quarantine",
      source: "demo" as const,
    }
  })
}

async function loadPlanInventoryPallets(client: PoolClient, siteId: number): Promise<PlacementPallet[]> {
  let snapshot
  try {
    snapshot = await readFgPlanInventory(siteId)
  } catch {
    return []
  }
  const occupied = Object.values(snapshot.inventory).filter(
    (slot) => slot.status === "occupied" && String(slot.palletId || "").trim()
  )
  if (occupied.length === 0) return []
  occupied.sort((a, b) => String(a.address).localeCompare(String(b.address), "en"))

  const locR = await client.query<{ locationId: string; locationCode: string; planRowId: string | null }>(
    `
    SELECT
      l.location_id::text AS "locationId",
      l.location_code AS "locationCode",
      NULLIF(COALESCE(l.location_attrs_json->>'planRowId', ''), '') AS "planRowId"
    FROM wms_locations l
    JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
    WHERE l.site_id = $1
      AND (
        l.location_code ILIKE 'FG-%'
        OR COALESCE(w.warehouse_type, '') ILIKE '%FINISH%'
        OR COALESCE(w.name, '') ILIKE '%готов%'
      )
    `,
    [siteId]
  )
  const locByRow = new Map<string, { locationId: string; locationCode: string }>()
  for (const row of locR.rows) {
    const id =
      canonicalPlanRowId(row.planRowId) ||
      planRowIdFromLocationCode(row.locationCode) ||
      canonicalPlanRowId(row.locationCode)
    if (!id) continue
    locByRow.set(id, { locationId: row.locationId, locationCode: row.locationCode })
  }

  const posByRow = new Map<string, number>()
  const out: PlacementPallet[] = []
  for (const slot of occupied) {
    const planRowId = canonicalPlanRowId(slot.address)
    if (!planRowId) continue
    const pos = (posByRow.get(planRowId) ?? 0) + 1
    posByRow.set(planRowId, pos)
    const loc = locByRow.get(planRowId)
    const sscc = String(slot.palletId).trim()
    const gtin = String(slot.gtin || "").trim()
    const day = String(slot.productionDate || "").trim()
    const isoDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T00:00:00` : null
    out.push({
      palletId: `plan:${slot.address}`,
      lpn: sscc,
      palletCode: sscc,
      itemCode: gtin,
      itemName: String(slot.nomenclature || "").trim(),
      sku: gtin,
      itemGroup: "",
      productGroup: "finished_goods",
      itemClass: "F",
      lotCode: slot.batch?.trim() || null,
      expiryAt: null,
      manufacturedAt: isoDay,
      receivedAt: isoDay,
      locationId: loc?.locationId || "",
      locationCode: loc?.locationCode || fgPlanLocationCode(planRowId),
      planRowId,
      zone: planRowId.split("-")[0] || "",
      position: pos,
      reserved: false,
      blocked: false,
      quarantine: false,
      available: true,
      source: "plan",
      unitQty: Number(slot.quantity) || 0,
    })
  }
  return overlayPlanResort(client, siteId, out)
}

async function overlayPlanResort(
  client: PoolClient,
  siteId: number,
  pallets: PlacementPallet[]
): Promise<PlacementPallet[]> {
  try {
    const { listOpenResortIndex, resortIndexHasPallet } = await import("@/lib/wms/fg-resort")
    const open = await listOpenResortIndex(client, siteId)
    if (open.palletIds.size === 0 && open.palletCodes.size === 0) return pallets
    return pallets.map((pallet) =>
      resortIndexHasPallet(open, pallet)
        ? { ...pallet, available: false, blocked: true }
        : pallet
    )
  } catch (error) {
    console.error("[fg-resort] plan overlay", error)
    return pallets
  }
}

export async function listPlacementPallets(client: PoolClient, siteId: number): Promise<PlacementPallet[]> {
  await ensureFgPlacementSchema(client)
  let live: PlacementPallet[] = []
  try {
    live = await loadLivePallets(client, siteId)
  } catch {
    live = []
  }
  let plan: PlacementPallet[] = []
  try {
    plan = await loadPlanInventoryPallets(client, siteId)
  } catch {
    plan = []
  }
  const demo = await loadDemoPallets(client, siteId)
  const liveLpns = new Set(live.map((p) => p.lpn))
  const afterPlan = [...live, ...plan.filter((p) => !liveLpns.has(p.lpn))]
  const taken = new Set(afterPlan.map((p) => p.lpn))
  return [...afterPlan, ...demo.filter((p) => !taken.has(p.lpn))]
}

function itemFromUnknown(input: {
  itemCode?: string
  itemName?: string
  sku?: string
  lotCode?: string
  query?: string
}): ItemRef {
  return {
    itemCode: input.itemCode ?? "",
    itemName: input.itemName ?? input.query ?? "",
    sku: input.sku ?? "",
    itemGroup: "",
    productGroup: "",
    itemClass: "",
    lotCode: input.lotCode,
  }
}

async function resolveItemRef(client: PoolClient, siteId: number, query: string): Promise<ItemRef | null> {
  const q = query.trim()
  if (!q) return null
  const r = await client.query<{
    itemCode: string
    itemName: string
    sku: string
    itemGroup: string
    productGroup: string
    itemClass: string
  }>(
    `SELECT item_code AS "itemCode", name AS "itemName", COALESCE(sku,'') AS sku,
            COALESCE(item_group_code, product_group, '') AS "itemGroup",
            COALESCE(product_group, '') AS "productGroup",
            COALESCE(item_class_code, '') AS "itemClass"
     FROM wms_items
     WHERE site_id = $1 AND is_active
       AND (
         item_code ILIKE $2 OR sku ILIKE $2 OR name ILIKE $3
       )
     ORDER BY CASE WHEN name ILIKE $3 THEN 0 ELSE 1 END, item_code
     LIMIT 1`,
    [siteId, q, `%${q}%`]
  )
  return r.rows[0]
    ? {
        itemCode: r.rows[0].itemCode,
        itemName: r.rows[0].itemName,
        sku: r.rows[0].sku,
        itemGroup: r.rows[0].itemGroup,
        productGroup: r.rows[0].productGroup,
        itemClass: r.rows[0].itemClass,
      }
    : {
        itemCode: "",
        itemName: q,
        sku: "",
        itemGroup: "",
        productGroup: "",
        itemClass: "",
      }
}

function rowAllowsItem(settings: EffectiveRowSettings, item: ItemRef): boolean {
  if (!settings.isActive || settings.isBlocked) return false
  if (settings.allowedMode === "any") return true
  return productMatches(settings.allowedProducts, item)
}

function rowRejectReason(settings: EffectiveRowSettings, item: ItemRef, pallets: PlacementPallet[]): string | null {
  if (!settings.isActive) return "Ряд выключен"
  if (settings.isBlocked) return "Ряд заблокирован"
  if (!rowAllowsItem(settings, item)) {
    const names = settings.allowedProducts.map((p) => p.label || p.value).join(", ")
    return names
      ? `В ряду разрешены только: ${names}`
      : "Номенклатура не входит в разрешённый список ряда"
  }
  if (settings.fillPercent >= settings.maxOccupancy) {
    return `Заполненность ${settings.fillPercent}% выше лимита ${settings.maxOccupancy}%`
  }
  const inRow = pallets.filter((p) => p.locationId === settings.locationId || p.planRowId === settings.planRowId)
  if (!settings.allowMixedSku && inRow.some((p) => p.itemCode && item.itemCode && p.itemCode !== item.itemCode)) {
    return "В ряду запрещено смешивать разные SKU"
  }
  if (!settings.allowMixedLot && item.lotCode && inRow.some((p) => p.lotCode && p.lotCode !== item.lotCode)) {
    return "В ряду запрещено смешивать партии"
  }
  const occupied = inRow.map((p) => p.position)
  const slot = nextPutawayPosition(
    occupied,
    settings.capacity,
    settings.storageStrategy,
    settings.loadSide,
    settings.pickSide
  )
  if (slot == null) return "Нет свободной позиции по физической стратегии ряда"
  return null
}

async function loadProductionPlan(client: PoolClient, siteId: number): Promise<ProductionPlanPreviewItem[]> {
  const r = await client.query<{ production_plan_json: unknown }>(
    `SELECT production_plan_json FROM wms_fg_placement_policy WHERE site_id = $1`,
    [siteId]
  )
  const raw = r.rows[0]?.production_plan_json
  return Array.isArray(raw) ? (raw as ProductionPlanPreviewItem[]) : []
}

function scoreRow(
  settings: EffectiveRowSettings,
  item: ItemRef,
  pallets: PlacementPallet[],
  weights: PlacementWeights,
  plan: ProductionPlanPreviewItem[],
  allPlanRowIds: string[],
  medianCoi: number | null = null
): { score: number; reasons: string[]; position: number } {
  let score = 0
  const reasons: string[] = []
  const inRow = pallets.filter((p) => p.planRowId === settings.planRowId)
  const occupied = inRow.map((p) => p.position)
  const position =
    nextPutawayPosition(occupied, settings.capacity, settings.storageStrategy, settings.loadSide, settings.pickSide) ?? 0

  const specific = settings.allowedMode === "list" && settings.allowedProducts.some((p) => p.kind !== "any")
  if (specific && productMatches(settings.allowedProducts, item)) {
    score += weights.preferredProductRow
    reasons.push(`Ряд закреплён за этой номенклатурой (+${weights.preferredProductRow})`)
  }
  if (inRow.some((p) => p.itemCode && p.itemCode === item.itemCode)) {
    score += weights.sameSkuNearby
    reasons.push(`Рядом уже стоит тот же SKU (+${weights.sameSkuNearby})`)
  }
  if (item.lotCode && inRow.some((p) => p.lotCode === item.lotCode)) {
    score += weights.sameLotNearby
    reasons.push(`Та же партия рядом (+${weights.sameLotNearby})`)
  }
  if (settings.ruleCode) {
    score += weights.preferredZone
    reasons.push(`Правило ${settings.ruleCode} (+${weights.preferredZone})`)
  }
  const prio = Math.round(settings.placementPriority * weights.placementPriority)
  score += prio
  reasons.push(`Приоритет ряда ${settings.placementPriority} (+${prio})`)

  const planHit = plan.find((p) => item.itemName.toLocaleLowerCase("ru").includes(p.itemQuery.toLocaleLowerCase("ru")))
  if (planHit) {
    score += weights.productionPlanPriority + (planHit.qty > 0 ? 5 : 0)
    reasons.push(`Ближайший план производства «${planHit.itemQuery}» (+${weights.productionPlanPriority})`)
  }

  if (settings.storageStrategy === "fifo_lane" && position > 0) {
    score += weights.closeToPicking
    reasons.push(`Следующая позиция FIFO ${position} (+${weights.closeToPicking})`)
  }

  const zonePenalty = Math.max(0, settings.zone.charCodeAt(0) - 65) * weights.distance
  if (zonePenalty) {
    score -= zonePenalty
    reasons.push(`Удалённость зоны ${settings.zone} (−${zonePenalty})`)
  }
  if (settings.fillPercent > 80) {
    score -= weights.congestion
    reasons.push(`Плотность ${settings.fillPercent}% (−${weights.congestion})`)
  }
  const holes = occupied.length > 0 && position > Math.max(...occupied) + 1
  if (holes) {
    score -= weights.fragmentation
    reasons.push(`Разрыв в ряду (−${weights.fragmentation})`)
  }
  const closeness = 1 - normalizeRowDistance(settings.planRowId, allPlanRowIds)
  if (item.fsn && weights.fsnSlotting) {
    const fsn = fsnSlotScore(item.fsn, closeness, weights.fsnSlotting)
    score += fsn.delta
    reasons.push(fsn.reason)
  }
  if (item.abc && item.xyz && weights.abcxyzSlotting) {
    const cell = abcxyzSlotScore(item.abc, item.xyz, closeness, weights.abcxyzSlotting)
    score += cell.delta
    reasons.push(cell.reason)
  }
  if (item.coi != null && weights.coiSlotting) {
    const coi = coiSlotScore(item.coi, medianCoi, closeness, weights.coiSlotting)
    if (coi.delta && coi.reason) {
      score += coi.delta
      reasons.push(coi.reason)
    }
  }
  return { score, reasons, position }
}

export async function recommendPlacement(
  client: PoolClient,
  siteId: number,
  input: { query: string; itemCode?: string; lotCode?: string; limit?: number }
): Promise<{
  item: ItemRef
  recommended: PlacementCandidate | null
  alternatives: PlacementCandidate[]
  crossDock: import("@/lib/wms/fg-cross-dock").CrossDockHint | null
}> {
  const [item, settings, pallets, policy, plan] = await Promise.all([
    input.itemCode
      ? resolveItemRef(client, siteId, input.itemCode)
      : resolveItemRef(client, siteId, input.query),
    resolveAllRowSettings(client, siteId),
    listPlacementPallets(client, siteId),
    loadPolicy(client, siteId),
    loadProductionPlan(client, siteId),
  ])
  const ref = item ?? itemFromUnknown({ query: input.query, itemCode: input.itemCode, lotCode: input.lotCode })
  let medianCoi: number | null = null
  if (ref.itemCode) {
    try {
      const codes = [...new Set([ref.itemCode, ...pallets.map((p) => p.itemCode)].filter(Boolean))]
      const volumes = new Map<string, number>()
      const countByCode = new Map<string, number>()
      for (const pallet of pallets) {
        if (!pallet.itemCode) continue
        countByCode.set(pallet.itemCode, (countByCode.get(pallet.itemCode) ?? 0) + 1)
      }
      for (const [code, count] of countByCode) volumes.set(code, count * EURO_PALLET_M3)
      const demand = await classifyFgDemand(client, siteId, codes, undefined, volumes)
      const self = demand.get(ref.itemCode)
      ref.fsn = self?.fsn ?? "N"
      ref.abc = self?.abc ?? "C"
      ref.xyz = self?.xyz ?? "Z"
      ref.coi = self?.coi ?? null
      medianCoi = medianPositive([...demand.values()].map((row) => row.coi ?? 0))
    } catch {
      ref.fsn = "N"
    }
  }
  const allPlanRowIds = settings.map((row) => row.planRowId)
  const candidates: PlacementCandidate[] = []
  for (const row of settings) {
    const reject = rowRejectReason(row, ref, pallets)
    if (reject) continue
    const scored = scoreRow(row, ref, pallets, policy.weights, plan, allPlanRowIds, medianCoi)
    if (!scored.position) continue
    candidates.push({
      locationId: row.locationId,
      locationCode: row.locationCode,
      planRowId: row.planRowId,
      zone: row.zone,
      position: scored.position,
      score: scored.score,
      reasons: scored.reasons,
    })
  }
  candidates.sort((a, b) => b.score - a.score || a.planRowId.localeCompare(b.planRowId))
  const limit = Math.min(12, Math.max(1, input.limit ?? 5))
  let crossDock: import("@/lib/wms/fg-cross-dock").CrossDockHint | null = null
  if (ref.itemCode) {
    try {
      crossDock = await findCrossDockForItem(client, siteId, ref.itemCode)
    } catch {
      crossDock = null
    }
  }
  if (crossDock) {
    const dock: PlacementCandidate = {
      locationId: "cross-dock",
      locationCode: crossDock.dockCode,
      planRowId: crossDock.dockCode,
      zone: "SHIP",
      position: 1,
      score: 1000,
      kind: "cross_dock",
      reasons: [crossDock.reason],
    }
    candidates.unshift(dock)
  }
  return {
    item: ref,
    recommended: candidates[0] ?? null,
    alternatives: candidates.slice(1, limit),
    crossDock,
  }
}

export async function checkPlacement(
  client: PoolClient,
  siteId: number,
  input: { query: string; planRowId: string; position?: number; lotCode?: string }
): Promise<PlaceCheckResult> {
  const rec = await recommendPlacement(client, siteId, { query: input.query, lotCode: input.lotCode })
  const settings = await resolveRowSettings(client, siteId, input.planRowId)
  const pallets = await listPlacementPallets(client, siteId)
  const reject = rowRejectReason(settings, rec.item, pallets)
  if (!reject) {
    return {
      ok: true,
      canOverride: Boolean(rec.crossDock),
      reason: rec.crossDock
        ? `${rec.crossDock.reason} Ряд ${settings.planRowId} технически подходит, но выгоднее не класть на хранение.`
        : `Ряд ${settings.planRowId} подходит`,
      recommended: rec.recommended,
      alternatives: rec.alternatives,
    }
  }
  return {
    ok: false,
    canOverride: true,
    reason: reject,
    recommended: rec.recommended,
    alternatives: rec.alternatives,
  }
}

export async function placeAnyway(
  client: PoolClient,
  siteId: number,
  input: {
    query: string
    chosenPlanRowId: string
    chosenPosition?: number
    reason: string
    actor: string
  }
): Promise<PlaceCheckResult> {
  const check = await checkPlacement(client, siteId, {
    query: input.query,
    planRowId: input.chosenPlanRowId,
    position: input.chosenPosition,
  })
  await writePlacementAudit(client, siteId, {
    actor: input.actor,
    kind: "override_place",
    target: input.chosenPlanRowId,
    detail: `Рекомендовано ${check.recommended ? `${check.recommended.planRowId} / ${check.recommended.position}` : "—"}; выбрано ${input.chosenPlanRowId} / ${input.chosenPosition ?? "—"}. ${input.reason}. ${check.reason}`,
    beforeJson: check.recommended,
    afterJson: { planRowId: input.chosenPlanRowId, position: input.chosenPosition, reason: input.reason },
  })
  return check
}

function sortForAllocation(pallets: PlacementPallet[], strategy: AllocationStrategy, useMfg: boolean): PlacementPallet[] {
  const copy = [...pallets]
  copy.sort((a, b) => {
    if (strategy === "fefo") {
      const ae = a.expiryAt ? Date.parse(a.expiryAt) : Number.POSITIVE_INFINITY
      const be = b.expiryAt ? Date.parse(b.expiryAt) : Number.POSITIVE_INFINITY
      if (ae !== be) return ae - be
    }
    if (strategy === "fifo" || strategy === "fefo") {
      const field = useMfg ? "manufacturedAt" : "receivedAt"
      const ar = a[field] ? Date.parse(a[field]!) : Number.POSITIVE_INFINITY
      const br = b[field] ? Date.parse(b[field]!) : Number.POSITIVE_INFINITY
      if (ar !== br) return ar - br
    }
    if (strategy === "priority") return a.planRowId.localeCompare(b.planRowId)
    return a.lpn.localeCompare(b.lpn)
  })
  return copy
}

export async function allocateForTask(
  client: PoolClient,
  siteId: number,
  input: { query: string; qty: number; taskId?: string; persist?: boolean; actor?: string }
): Promise<AllocationResult> {
  const item = (await resolveItemRef(client, siteId, input.query)) ?? itemFromUnknown({ query: input.query })
  const [settings, pallets] = await Promise.all([
    resolveAllRowSettings(client, siteId),
    listPlacementPallets(client, siteId),
  ])
  const byRow = new Map<string, (typeof settings)[number]>()
  for (const s of settings) {
    byRow.set(s.planRowId, s)
    byRow.set(canonicalPlanRowId(s.planRowId), s)
    byRow.set(s.locationId, s)
  }
  const qty = Math.max(1, Math.min(200, Math.trunc(input.qty)))
  const q = input.query.toLocaleLowerCase("ru")

  const eligible = pallets.filter((p) => {
    if (p.blocked) return false
    const row = byRow.get(p.planRowId) || byRow.get(canonicalPlanRowId(p.planRowId))
    if (p.quarantine && !row?.allowQuarantine) return false
    const nameHit = p.itemName.toLocaleLowerCase("ru").includes(q)
    const codeHit = Boolean(item.itemCode) && p.itemCode === item.itemCode
    return (
      nameHit ||
      codeHit ||
      productMatches(
        [
          { kind: "name_ilike", value: q },
          { kind: "item_code", value: item.itemCode },
        ],
        p
      )
    )
  })

  const rowStrategy =
    eligible
      .map((p) => (byRow.get(p.planRowId) || byRow.get(canonicalPlanRowId(p.planRowId)))?.allocationStrategy)
      .find((s) => s) ?? (await loadPolicy(client, siteId)).allocationStrategy
  const firstRow = eligible[0] ? byRow.get(eligible[0].planRowId) || byRow.get(canonicalPlanRowId(eligible[0].planRowId)) : null
  const ranked = sortForAllocation(eligible, rowStrategy, Boolean(firstRow?.useMfg))

  const selected: AllocatedPallet[] = []
  const conflicts: AllocationConflict[] = []
  const reshuffle: AllocationResult["reshuffle"] = []
  const used = new Set<string>()

  function rowOf(planRowId: string) {
    return byRow.get(planRowId) || byRow.get(canonicalPlanRowId(planRowId))
  }

  function accessNow(planRowId: string) {
    const row = rowOf(planRowId)
    const mates = pallets.filter((p) => p.planRowId === planRowId && !used.has(p.lpn))
    return pickAccessibleLpns(
      mates,
      row?.capacity ?? 24,
      row?.storageStrategy ?? "fifo_lane",
      row?.pickSide ?? "start"
    )
  }

  for (const pallet of ranked) {
    if (selected.length >= qty) break
    if (used.has(pallet.lpn)) continue
    const row = rowOf(pallet.planRowId)
    if (!row) {
      selected.push({ ...pallet, accessible: true, blockedBy: [], pickOrder: selected.length + 1 })
      used.add(pallet.lpn)
      continue
    }
    const access = accessNow(pallet.planRowId)
    const accessible = access.accessible.includes(pallet.lpn) || row.storageStrategy === "random"
    const blockedBy = access.blockedBy[pallet.lpn] ?? []
    const allocated: AllocatedPallet = {
      ...pallet,
      accessible,
      blockedBy,
      pickOrder: selected.length + 1,
    }
    if (accessible) {
      selected.push(allocated)
      used.add(pallet.lpn)
      continue
    }
    if (row.conflictPolicy === "show_conflict") {
      conflicts.push({ wanted: allocated, reason: `Палета перекрыта: ${blockedBy.join(", ")}`, nextAccessible: null })
      break
    }
    if (row.conflictPolicy === "reshuffle_task") {
      reshuffle.push({
        lpn: pallet.lpn,
        planRowId: pallet.planRowId,
        position: pallet.position,
        reason: `FEFO/FIFO требует ${pallet.lpn}, но физически впереди ${blockedBy.join(", ")}`,
      })
    }
    const nextLpn = access.accessible.find((lpn) => !used.has(lpn) && eligible.some((p) => p.lpn === lpn))
    const next = nextLpn ? ranked.find((p) => p.lpn === nextLpn) : null
    conflicts.push({
      wanted: allocated,
      reason: `Нужна ${pallet.lpn}, но она перекрыта ${blockedBy.join(", ")}`,
      nextAccessible: next ? { ...next, accessible: true, blockedBy: [], pickOrder: selected.length + 1 } : null,
    })
    if (next) {
      selected.push({ ...next, accessible: true, blockedBy: [], pickOrder: selected.length + 1 })
      used.add(next.lpn)
    }
  }

  const highlight: HighlightStop[] = selected.map((p, idx) => ({
    step: idx + 1,
    planRowId: canonicalPlanRowId(p.planRowId) || p.planRowId,
    locationCode: p.locationCode,
    position: p.position,
    lpn: p.lpn,
    itemName: p.itemName,
    expiryAt: p.expiryAt,
  }))

  const taskId = input.taskId?.trim() || `PLC-${Date.now().toString(36).toUpperCase()}`
  const result: AllocationResult = {
    taskId,
    itemQuery: input.query,
    itemCode: item.itemCode || null,
    itemName: item.itemName || null,
    requestedQty: qty,
    selected,
    conflicts,
    reshuffle,
    highlight,
    strategy: rowStrategy,
  }

  if (input.persist) {
    await client.query(
      `INSERT INTO wms_fg_placement_tasks
         (site_id, task_id, item_query, item_code, item_name, requested_qty, allocation_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       ON CONFLICT (site_id, task_id) DO UPDATE SET
         allocation_json = EXCLUDED.allocation_json,
         requested_qty = EXCLUDED.requested_qty`,
      [siteId, taskId, input.query, result.itemCode, result.itemName, qty, JSON.stringify(result)]
    )
    await client.query(`DELETE FROM wms_fg_placement_reservations WHERE site_id = $1 AND task_id = $2`, [siteId, taskId])
    for (const p of selected) {
      await client.query(
        `INSERT INTO wms_fg_placement_reservations (site_id, lpn, task_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (site_id, lpn) DO UPDATE SET task_id = EXCLUDED.task_id, reserved_at = now()`,
        [siteId, p.lpn, taskId]
      )
    }
    await writePlacementAudit(client, siteId, {
      actor: input.actor || "system",
      kind: "allocate",
      target: taskId,
      detail: `Резерв ${selected.length} палет под «${input.query}» (${rowStrategy})`,
      afterJson: { lpns: selected.map((p) => p.lpn) },
    })
  }
  return result
}

export async function listPlacementTasks(client: PoolClient, siteId: number) {
  await ensureFgPlacementSchema(client)
  const r = await client.query(
    `SELECT task_id AS "taskId", item_query AS "itemQuery", item_code AS "itemCode",
            item_name AS "itemName", requested_qty AS "requestedQty",
            allocation_json AS allocation, created_at AS "createdAt"
     FROM wms_fg_placement_tasks WHERE site_id = $1
     ORDER BY created_at DESC LIMIT 40`,
    [siteId]
  )
  return r.rows
}

export async function getPlacementTask(
  client: PoolClient,
  siteId: number,
  taskId: string
): Promise<AllocationResult | null> {
  await ensureFgPlacementSchema(client)
  const r = await client.query<{ allocation_json: AllocationResult }>(
    `SELECT allocation_json FROM wms_fg_placement_tasks WHERE site_id = $1 AND task_id = $2`,
    [siteId, taskId]
  )
  return r.rows[0]?.allocation_json ?? null
}

export async function mapTints(
  client: PoolClient,
  siteId: number,
  mode: MapViewMode,
  taskId?: string
): Promise<MapTint[]> {
  const [settings, pallets] = await Promise.all([
    resolveAllRowSettings(client, siteId),
    listPlacementPallets(client, siteId),
  ])
  if (mode === "normal") return []
  if (mode === "blocked") {
    return settings
      .filter((s) => s.isBlocked || !s.isActive)
      .map((s) => ({ planRowId: canonicalPlanRowId(s.planRowId) || s.planRowId, color: "#64748b", label: s.isBlocked ? "блок" : "выкл" }))
  }
  if (mode === "occupancy") {
    return settings
      .filter((s) => s.palletCount > 0 || s.fillPercent > 0)
      .map((s) => ({
        planRowId: canonicalPlanRowId(s.planRowId) || s.planRowId,
        color: s.fillPercent >= 90 ? "#ef4444" : s.fillPercent >= 60 ? "#f59e0b" : "#84cc16",
        label: `${s.fillPercent}%`,
      }))
  }
  if (mode === "recommend") return []
  if (mode === "tasks") {
    const alloc = taskId ? await getPlacementTask(client, siteId, taskId) : null
    const stops = alloc?.highlight ?? []
    return stops.map((s) => ({
      planRowId: canonicalPlanRowId(s.planRowId) || s.planRowId,
      color: "#84cc16",
      label: `${s.step}. ${s.lpn}`,
      positions: [s.position],
    }))
  }
  if (mode === "fefo" || mode === "expiry") {
    const byRow = new Map<string, Date>()
    for (const p of pallets) {
      if (!p.expiryAt) continue
      const d = new Date(p.expiryAt)
      const id = canonicalPlanRowId(p.planRowId) || p.planRowId
      const prev = byRow.get(id)
      if (!prev || d < prev) byRow.set(id, d)
    }
    const now = Date.now()
    return [...byRow.entries()].map(([planRowId, d]) => {
      const days = Math.round((d.getTime() - now) / 86400000)
      return {
        planRowId,
        color: days <= 180 ? "#ef4444" : days <= 400 ? "#f59e0b" : "#38bdf8",
        label: d.toLocaleDateString("ru-RU"),
      }
    })
  }
  if (mode === "fifo") {
    const byRow = new Map<string, Date>()
    for (const p of pallets) {
      const iso = p.receivedAt || p.manufacturedAt
      if (!iso) continue
      const d = new Date(iso)
      const id = canonicalPlanRowId(p.planRowId) || p.planRowId
      const prev = byRow.get(id)
      if (!prev || d < prev) byRow.set(id, d)
    }
    return [...byRow.entries()].map(([planRowId, d]) => ({
      planRowId,
      color: "#60a5fa",
      label: d.toLocaleDateString("ru-RU"),
    }))
  }
  if (mode === "nomenclature" || mode === "lots") {
    const colors = ["#84cc16", "#38bdf8", "#a78bfa", "#f59e0b", "#f472b6", "#22d3ee"]
    const keyOf = (p: PlacementPallet) => (mode === "lots" ? p.lotCode || p.itemName : p.itemName)
    const keys = [...new Set(pallets.map(keyOf).filter(Boolean))]
    const colorOf = new Map(keys.map((k, i) => [k, colors[i % colors.length]]))
    const byRow = new Map<string, string>()
    for (const p of pallets) {
      if (!byRow.has(canonicalPlanRowId(p.planRowId) || p.planRowId)) byRow.set(canonicalPlanRowId(p.planRowId) || p.planRowId, keyOf(p))
    }
    return [...byRow.entries()].map(([planRowId, key]) => ({
      planRowId,
      color: colorOf.get(key) || "#84cc16",
      label: key,
    }))
  }
  return []
}

export async function listPlacementAudit(
  client: PoolClient,
  siteId: number,
  limit = 40
): Promise<PlacementAuditRow[]> {
  await ensureFgPlacementSchema(client)
  const r = await client.query(
    `SELECT audit_id::text AS "auditId",
            to_char(at, 'YYYY-MM-DD"T"HH24:MI:SSOF:00') AS at,
            actor, kind, target, detail,
            before_json AS "beforeJson", after_json AS "afterJson"
     FROM wms_fg_placement_audit
     WHERE site_id = $1
     ORDER BY at DESC
     LIMIT $2`,
    [siteId, Math.min(100, Math.max(1, limit))]
  )
  return r.rows
}

async function findWaterItems(client: PoolClient, siteId: number) {
  const r = await client.query<{ itemCode: string; itemName: string; sku: string }>(
    `SELECT item_code AS "itemCode", name AS "itemName", COALESCE(sku,'') AS sku
     FROM wms_items
     WHERE site_id = $1 AND is_active
       AND (
         name ILIKE '%шмаков%' OR name ILIKE '%славда%' OR name ILIKE '%медвеж%'
       )
     ORDER BY name
     LIMIT 40`,
    [siteId]
  )
  return r.rows
}

export async function seedPlacementDemo(
  client: PoolClient,
  siteId: number,
  actor: string
): Promise<{
  rowsTagged: number
  demoPallets: number
  taskId: string
  fifoTaskId: string
  items: Array<{ itemCode: string; itemName: string }>
}> {
  await ensureFgPlacementSchema(client)
  const policy = { ...DEFAULT_WAREHOUSE_POLICY, weights: { ...DEFAULT_PLACEMENT_WEIGHTS } }
  await savePolicy(client, siteId, policy, actor)

  const items = await findWaterItems(client, siteId)
  const shmakovka = items.find((i) => /шмаков/i.test(i.itemName))
  const slavda = items.find((i) => /славда/i.test(i.itemName))
  const medvezhka = items.find((i) => /медвеж/i.test(i.itemName))

  const products: ProductMatcher[] = [
    { kind: "name_ilike", value: "шмаков", label: "Вода «Шмаковка»" },
    { kind: "name_ilike", value: "славда", label: "Вода «Славда»" },
    { kind: "name_ilike", value: "медвеж", label: "Вода «Медвежка»" },
  ]
  if (shmakovka) products.push({ kind: "item_code", value: shmakovka.itemCode, label: shmakovka.itemName })
  if (slavda) products.push({ kind: "item_code", value: slavda.itemCode, label: slavda.itemName })
  if (medvezhka) products.push({ kind: "item_code", value: medvezhka.itemCode, label: medvezhka.itemName })

  await upsertPlacementRule(
    client,
    siteId,
    {
      ruleId: "",
      code: "SHMAKOVKA_MAIN",
      name: "Вода: Шмаковка / Славда / Медвежка",
      isActive: true,
      storageStrategy: "fifo_lane",
      allocationStrategy: "fefo",
      conflictPolicy: "next_accessible",
      placementPriority: 100,
      maxOccupancy: 95,
      allowMixedSku: true,
      allowMixedLot: true,
      allowReserve: true,
      allowQuarantine: false,
      zoneCodes: ["C", "B", "F"],
      rowFrom: "C-1",
      rowTo: "C-40",
      rowCodes: [],
      products,
      productionPlanPriority: 15,
      note: "Основной контур воды. Физика ряда — FIFO, отбор партии — FEFO.",
    },
    actor
  )

  await upsertPlacementRule(
    client,
    siteId,
    {
      ruleId: "",
      code: "PREFORM_STORAGE",
      name: "Резерв: преформа / материалы (заготовка)",
      isActive: false,
      storageStrategy: "fifo_lane",
      allocationStrategy: "fifo",
      conflictPolicy: "show_conflict",
      placementPriority: 80,
      maxOccupancy: 90,
      allowMixedSku: false,
      allowMixedLot: false,
      allowReserve: true,
      allowQuarantine: false,
      zoneCodes: [],
      rowFrom: "E-1",
      rowTo: "E-20",
      rowCodes: [],
      products: [{ kind: "group", value: "preform", label: "Преформа" }],
      productionPlanPriority: 20,
      note: "Абстракция под будущий план производства. Правило выключено.",
    },
    actor
  )

  await saveZonePlacement(
    client,
    siteId,
    "C",
    {
      storage_strategy: "fifo_lane",
      allocation_strategy: "fefo",
      conflict_policy: "next_accessible",
      allowed_mode: "list",
      placement_priority: 100,
      max_occupancy: 95,
      allow_mixed_sku: true,
      allow_mixed_lot: true,
      load_side: "end",
      pick_side: "start",
      use_expiry: true,
    },
    actor
  )
  await client.query(`DELETE FROM wms_fg_zone_allowed_products WHERE site_id = $1 AND zone_code = 'C'`, [siteId])
  for (const p of products) {
    await client.query(
      `INSERT INTO wms_fg_zone_allowed_products (site_id, zone_code, match_kind, match_value, match_label)
       VALUES ($1,'C',$2,$3,$4)`,
      [siteId, p.kind, p.value, p.label ?? null]
    )
  }

  const rows = await loadFgRows(client, siteId)
  const cRows = rows.filter((r) => r.planRowId.startsWith("C-")).slice(0, 40)
  const fifoRow = cRows.find((r) => r.planRowId === "C-20") || cRows[5] || cRows[0]
  const fefoRows = cRows.slice(0, 3)
  let tagged = 0
  for (const row of cRows.slice(0, 12)) {
    await saveRowDraft(
      client,
      siteId,
      row.locationId,
      {
        ...emptyDraft(),
        inherit: false,
        storageStrategy: "fifo_lane",
        allocationStrategy: "fefo",
        conflictPolicy: "next_accessible",
        allowedMode: "list",
        allowedProducts: products,
        placementPriority: 100,
        maxOccupancy: 95,
        allowMixedSku: true,
        allowMixedLot: true,
        allowReserve: true,
        allowQuarantine: false,
        loadSide: "end",
        pickSide: "start",
        useExpiry: true,
        useMfg: false,
        minRemainingDays: 0,
      },
      actor
    )
    tagged += 1
  }

  const shmName = shmakovka?.itemName || "Вода «Шмаковка»"
  const shmCode = shmakovka?.itemCode || "SHMAKOVKA"
  const slavName = slavda?.itemName || "Вода «Славда»"
  const slavCode = slavda?.itemCode || "SLAVDA"
  const medName = medvezhka?.itemName || "Вода «Медвежка»"
  const medCode = medvezhka?.itemCode || "MEDVEZHKA"

  const fefoA = fefoRows[2]?.planRowId || fefoRows[0]?.planRowId || "C-13"
  const fefoB = fefoRows[1]?.planRowId || fefoA
  const fefoC = fefoRows[0]?.planRowId || "C-12"
  const fifoId = fifoRow?.planRowId || "C-20"
  const locOf = (planId: string) => rows.find((r) => r.planRowId === planId)?.locationId ?? null

  const demo = [
    {
      lpn: "PAL000381",
      item_code: shmCode,
      item_name: shmName,
      lot_code: "LOT-C",
      expiry: "2026-11-30",
      mfg: "2025-11-30",
      received: "2025-12-01T08:00:00Z",
      plan: fefoC,
      pos: 1,
    },
    {
      lpn: "PAL000492",
      item_code: shmCode,
      item_name: shmName,
      lot_code: "LOT-B",
      expiry: "2027-03-15",
      mfg: "2026-03-15",
      received: "2026-03-16T08:00:00Z",
      plan: fefoB,
      pos: 1,
    },
    {
      lpn: "PAL000811",
      item_code: shmCode,
      item_name: shmName,
      lot_code: "LOT-A",
      expiry: "2028-12-20",
      mfg: "2027-12-20",
      received: "2027-12-21T08:00:00Z",
      plan: fefoA,
      pos: 1,
    },
    {
      lpn: "P001",
      item_code: slavCode,
      item_name: slavName,
      lot_code: "FIFO-1",
      expiry: "2028-01-01",
      mfg: "2026-01-01",
      received: "2026-01-02T08:00:00Z",
      plan: fifoId,
      pos: 1,
    },
    {
      lpn: "P002",
      item_code: slavCode,
      item_name: slavName,
      lot_code: "FIFO-2",
      expiry: "2028-06-01",
      mfg: "2026-02-01",
      received: "2026-02-02T08:00:00Z",
      plan: fifoId,
      pos: 2,
    },
    {
      lpn: "P003",
      item_code: slavCode,
      item_name: slavName,
      lot_code: "FIFO-3",
      expiry: "2028-12-01",
      mfg: "2026-03-01",
      received: "2026-03-02T08:00:00Z",
      plan: fifoId,
      pos: 3,
    },
    {
      lpn: "PAL-MED-1",
      item_code: medCode,
      item_name: medName,
      lot_code: "MED-1",
      expiry: "2027-08-01",
      mfg: "2026-08-01",
      received: "2026-08-02T08:00:00Z",
      plan: fefoC,
      pos: 2,
    },
  ]

  await client.query(`DELETE FROM wms_fg_placement_demo_pallets WHERE site_id = $1`, [siteId])
  for (const d of demo) {
    await client.query(
      `INSERT INTO wms_fg_placement_demo_pallets (
         site_id, lpn, item_code, item_name, sku, lot_code, expiry_at, manufactured_at,
         received_at, plan_row_id, location_id, position, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz,$9::timestamptz,$10,$11::bigint,$12,'available')`,
      [
        siteId,
        d.lpn,
        d.item_code,
        d.item_name,
        d.item_code,
        d.lot_code,
        d.expiry,
        d.mfg,
        d.received,
        d.plan,
        locOf(d.plan),
        d.pos,
      ]
    )
  }

  await client.query(
    `INSERT INTO wms_fg_placement_policy (site_id, production_plan_json)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (site_id) DO UPDATE SET production_plan_json = EXCLUDED.production_plan_json`,
    [
      siteId,
      JSON.stringify([
        {
          itemQuery: "славда",
          dueDate: "2026-09-08",
          qty: 120000,
          materials: ["Преформа X", "Пробка Y", "Этикетка Z"],
        },
      ]),
    ]
  )

  const fefo = await allocateForTask(client, siteId, {
    query: "шмаков",
    qty: 3,
    taskId: "DEMO-FEFO-SHMAKOVKA",
    persist: true,
    actor,
  })
  const fifo = await allocateForTask(client, siteId, {
    query: "славда",
    qty: 3,
    taskId: "DEMO-FIFO-SLAVDA",
    persist: true,
    actor,
  })

  return {
    rowsTagged: tagged,
    demoPallets: demo.length,
    taskId: fefo.taskId,
    fifoTaskId: fifo.taskId,
    items: items.slice(0, 12),
  }
}

export async function verifyPlacementDemo(client: PoolClient, siteId: number): Promise<{
  fefo: { pass: boolean; got: string[]; expected: string[] }
  fifo: { pass: boolean; got: string[]; expected: string[] }
  recommend: { pass: boolean; planRowId: string | null }
}> {
  const fefo = await allocateForTask(client, siteId, { query: "шмаков", qty: 3, persist: false })
  const fifo = await allocateForTask(client, siteId, { query: "славда", qty: 3, persist: false })
  const rec = await recommendPlacement(client, siteId, { query: "славда" })
  const fefoGot = fefo.selected.map((p) => p.lotCode || p.lpn)
  const fifoGot = fifo.selected.map((p) => p.lpn)
  return {
    fefo: {
      expected: ["LOT-C", "LOT-B", "LOT-A"],
      got: fefoGot,
      pass: fefoGot.slice(0, 3).join() === "LOT-C,LOT-B,LOT-A" || fefo.selected.map((p) => p.lpn).join() === "PAL000381,PAL000492,PAL000811",
    },
    fifo: {
      expected: ["P001", "P002", "P003"],
      got: fifoGot,
      pass: fifoGot.slice(0, 3).join() === "P001,P002,P003",
    },
    recommend: {
      pass: Boolean(rec.recommended?.planRowId),
      planRowId: rec.recommended?.planRowId ?? null,
    },
  }
}

export async function saveProductionPlanPreview(
  client: PoolClient,
  siteId: number,
  items: ProductionPlanPreviewItem[],
  actor: string
): Promise<void> {
  await ensureFgPlacementSchema(client)
  await client.query(
    `INSERT INTO wms_fg_placement_policy (site_id, production_plan_json)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (site_id) DO UPDATE SET production_plan_json = EXCLUDED.production_plan_json, updated_at = now()`,
    [siteId, JSON.stringify(items)]
  )
  await writePlacementAudit(client, siteId, {
    actor,
    kind: "production_plan",
    target: "WAREHOUSE",
    detail: `План производства: ${items.length} позиций (заготовка под интеграцию)`,
    afterJson: items,
  })
}
