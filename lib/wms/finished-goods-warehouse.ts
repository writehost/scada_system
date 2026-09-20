import type { PoolClient } from "pg"
import { formatGs1MarkingCode } from "@/lib/wms/format-marking-code"
import {
  daysUntilExpiry,
  fgCrptStatusFromCounts,
  fgEmptyItemStatuses,
  kindFromMarking,
  type FgCodeLookupHit,
  type FgExpiryBucket,
  type FgItemStatuses,
  type FgMarkingNode,
  type FgMarkingTag,
  type FgNomenclatureRow,
  type FgPagedResult,
  type FgPalletRow,
  type FgRowPalletSummary,
  type FgStorageRowSummary,
  type FgSummaryStats,
} from "@/lib/wms/finished-goods-types"
import { mergePlacedIntoFgNomenclature, overlayPlacedOnStorageRows, ensureFinishedGoodsFromPlan } from "@/lib/wms/fg-plan-placed"
import { loadFgVekasLotAggs, mergeVekasLotsIntoFgNomenclature, overlayVekasLotsOnPallets } from "@/lib/wms/fg-vekas-lots"
import { applyResortToItem, applyResortToNode, applyResortToPallet, listOpenResortIndex } from "@/lib/wms/fg-resort"
import { canonicalPlanRowId } from "@/lib/wms/fg-plan-location-codes"
import { plantLinesFromBatches, uniquePlantBatches, warehouseBottleQty } from "@/lib/wms/fg-plan-stock-helpers"
import { DEFAULT_FSN_DAYS } from "@/lib/wms/fsn"
import { deriveProductPhysicalProfile } from "@/lib/wms/physical-profile"
import { EURO_PALLET_M3, formatSkuProfile, suggestReslot } from "@/lib/wms/sku-demand"
import { classifyFgDemand } from "@/lib/wms/sku-demand-history"
import { loadOutboundDemand } from "@/lib/wms/fg-cross-dock"
import { computeWarehouseOps, formatPolicyShort } from "@/lib/wms/warehouse-ops"
import { loadItemAttrsByCode, loadLastMovementDays, loadOutboundUsage } from "@/lib/wms/warehouse-ops-db"

function qtySubgroup(subgroup: string | null, qty: number) {
  const s = (subgroup ?? "unit").toLowerCase()
  return {
    bottles: s === "unit" || s === "bottle" ? qty : 0,
    blocks: s === "block" ? qty : 0,
    pallets: s === "pallet" ? qty : 0,
  }
}

function tagsFromExpiry(expiryIso: string | null, qaBlocked: boolean): FgMarkingTag[] {
  const tags: FgMarkingTag[] = []
  if (qaBlocked) tags.push("quarantine")
  const days = daysUntilExpiry(expiryIso)
  if (days != null && days >= 0 && days <= 30) tags.push("expiry-risk")
  return tags
}

function statusesFromRow(input: {
  crptIntroducedCount: number
  crptNotIntroducedCount: number
  quarantine: boolean
  inProduction: boolean
}): FgItemStatuses {
  return {
    crpt: fgCrptStatusFromCounts(input.crptIntroducedCount, input.crptNotIntroducedCount),
    quarantine: input.quarantine,
    inProduction: input.inProduction,
    onResort: false,
  }
}

/** Id палеты (SSCC 00… или pack_level=pallet) для codes c + mic и предков p1/p2. */
const SQL_RESOLVE_PALLET_ID = `
  COALESCE(
    CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
    CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
    CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
  )
`

type NomenclatureDbRow = {
  itemCode: string
  name: string
  gtin: string | null
  productGroup: string | null
  itemSubgroup: string | null
  bottles: string
  stockBottles: string
  blocks: string
  pallets: string
  markingCodesCount: string
  productionLineCode: string | null
  productionLineName: string | null
  lotCodes: string | null
  nearestExpiryAt: string | null
  oldestProductionAt: string | null
  anyLotBlocked: boolean | null
  hasQuarantineQty: boolean | null
  hasInProductionQty: boolean | null
  crptIntroducedCount: string
  crptNotIntroducedCount: string
}

async function listNomenclatureDb(
  client: PoolClient,
  siteId: number,
  query: string
): Promise<NomenclatureDbRow[]> {
  const q = query.trim()
  const r = await client.query<NomenclatureDbRow>(
    `
    SELECT
      i.item_code AS "itemCode",
      i.name,
      (
        SELECT b.barcode
        FROM wms_item_barcodes b
        WHERE b.item_id = i.item_id AND b.is_primary
        ORDER BY b.created_at DESC
        LIMIT 1
      ) AS gtin,
      COALESCE(i.item_group_code, i.product_group, '') AS "productGroup",
      i.item_subgroup AS "itemSubgroup",
      COALESCE((
        SELECT COUNT(*)::text
        FROM wms_item_codes mic
        JOIN codes c ON c.code_id = mic.code_id
        WHERE mic.item_id = i.item_id
          AND mic.current_site_id = i.site_id
          AND mic.unlinked_at IS NULL
          AND COALESCE(mic.pack_level, 'unit') IN ('unit', 'bottle')
          AND c.ai01_gtin NOT LIKE '00%'
      ), '0') AS bottles,
      COALESCE((
        SELECT SUM(sb.available_qty)::text
        FROM wms_stock_balances sb
        WHERE sb.site_id = i.site_id AND sb.item_id = i.item_id
      ), '0') AS "stockBottles",
      COALESCE((
        SELECT COUNT(DISTINCT blk.code_id)::text
        FROM wms_item_codes mic
        JOIN codes c ON c.code_id = mic.code_id
        LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            CASE WHEN COALESCE(mic.pack_level, '') = 'block' THEN c.code_id END,
            CASE WHEN p1.code_id IS NOT NULL AND p1.ai01_gtin NOT LIKE '00%' THEN p1.code_id END
          ) AS code_id
        ) blk
        WHERE mic.item_id = i.item_id
          AND mic.current_site_id = i.site_id
          AND mic.unlinked_at IS NULL
          AND blk.code_id IS NOT NULL
      ), '0') AS blocks,
      COALESCE((
        SELECT COUNT(DISTINCT pal.code_id)::text
        FROM wms_item_codes mic
        JOIN codes c ON c.code_id = mic.code_id
        LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
        LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
            CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
            CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
          ) AS code_id
        ) pal
        WHERE mic.item_id = i.item_id
          AND mic.current_site_id = i.site_id
          AND mic.unlinked_at IS NULL
          AND pal.code_id IS NOT NULL
      ), '0') AS pallets,
      COALESCE((
        SELECT COUNT(*)::text
        FROM wms_item_codes mic
        WHERE mic.item_id = i.item_id
          AND mic.current_site_id = i.site_id
          AND mic.unlinked_at IS NULL
      ), '0') AS "markingCodesCount",
      NULLIF(BTRIM(COALESCE(
        i.line_group,
        i.item_attrs_json->'productionLine'->>'code',
        ''
      )), '') AS "productionLineCode",
      NULLIF(BTRIM(COALESCE(
        pld.display_name,
        i.item_attrs_json->'productionLine'->>'name',
        i.line_group,
        i.item_attrs_json->'productionLine'->>'code',
        ''
      )), '') AS "productionLineName",
      (
        SELECT string_agg(DISTINCT lot.lot_code, ',' ORDER BY lot.lot_code)
        FROM (
          SELECT COALESCE(wl.lot_code, sl.lot_code) AS lot_code
          FROM wms_stock_balances sb2
          INNER JOIN wms_stock_lots sl ON sl.balance_id = sb2.balance_id AND sl.available_qty > 0
          LEFT JOIN wms_lots wl ON (
            (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
            OR (sl.lot_id IS NULL AND wl.site_id = sb2.site_id AND wl.item_id = sb2.item_id AND wl.lot_code = sl.lot_code)
          )
          WHERE sb2.site_id = i.site_id AND sb2.item_id = i.item_id
        ) lot
        WHERE lot.lot_code IS NOT NULL AND BTRIM(lot.lot_code) <> ''
      ) AS "lotCodes",
      (
        SELECT MIN(le.exp) FILTER (WHERE le.exp IS NOT NULL AND le.exp < 'infinity'::timestamptz)
        FROM (
          SELECT LEAST(
            COALESCE(sl.expiry_at, 'infinity'::timestamptz),
            COALESCE(wl.expiry_at, 'infinity'::timestamptz),
            COALESCE(wl.best_before_at, 'infinity'::timestamptz)
          ) AS exp
          FROM wms_stock_balances sb2
          INNER JOIN wms_stock_lots sl ON sl.balance_id = sb2.balance_id AND sl.available_qty > 0
          LEFT JOIN wms_lots wl ON (
            (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
            OR (sl.lot_id IS NULL AND wl.site_id = sb2.site_id AND wl.item_id = sb2.item_id AND wl.lot_code = sl.lot_code)
          )
          WHERE sb2.site_id = i.site_id AND sb2.item_id = i.item_id
        ) le
      ) AS "nearestExpiryAt",
      (
        SELECT MIN(wl.manufactured_at)
        FROM wms_stock_balances sb2
        INNER JOIN wms_stock_lots sl ON sl.balance_id = sb2.balance_id AND sl.available_qty > 0
        LEFT JOIN wms_lots wl ON (
          (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
          OR (sl.lot_id IS NULL AND wl.site_id = sb2.site_id AND wl.item_id = sb2.item_id AND wl.lot_code = sl.lot_code)
        )
        WHERE sb2.site_id = i.site_id AND sb2.item_id = i.item_id
      ) AS "oldestProductionAt",
      (
        SELECT BOOL_OR(COALESCE(wl.is_blocked, FALSE))
        FROM wms_stock_balances sb2
        INNER JOIN wms_stock_lots sl ON sl.balance_id = sb2.balance_id AND sl.available_qty > 0
        LEFT JOIN wms_lots wl ON (
          (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
          OR (sl.lot_id IS NULL AND wl.site_id = sb2.site_id AND wl.item_id = sb2.item_id AND wl.lot_code = sl.lot_code)
        )
        WHERE sb2.site_id = i.site_id AND sb2.item_id = i.item_id
      ) AS "anyLotBlocked",
      (
        SELECT COALESCE(SUM(sb2.quarantine_qty), 0) > 0
        FROM wms_stock_balances sb2
        WHERE sb2.site_id = i.site_id AND sb2.item_id = i.item_id
      ) AS "hasQuarantineQty",
      (
        SELECT COALESCE(SUM(sb2.in_production_qty), 0) > 0
        FROM wms_stock_balances sb2
        WHERE sb2.site_id = i.site_id AND sb2.item_id = i.item_id
      ) AS "hasInProductionQty",
      COALESCE((
        SELECT COUNT(*)::text
        FROM wms_item_codes mic2
        LEFT JOIN code_state cs2 ON cs2.code_id = mic2.code_id
        WHERE mic2.item_id = i.item_id
          AND mic2.current_site_id = i.site_id
          AND mic2.unlinked_at IS NULL
          AND (
            COALESCE(cs2.status_id, 0) >= 5
            OR cs2.introduced_at IS NOT NULL
          )
      ), '0') AS "crptIntroducedCount",
      COALESCE((
        SELECT COUNT(*)::text
        FROM wms_item_codes mic2
        LEFT JOIN code_state cs2 ON cs2.code_id = mic2.code_id
        WHERE mic2.item_id = i.item_id
          AND mic2.current_site_id = i.site_id
          AND mic2.unlinked_at IS NULL
          AND NOT (
            COALESCE(cs2.status_id, 0) >= 5
            OR cs2.introduced_at IS NOT NULL
          )
      ), '0') AS "crptNotIntroducedCount"
    FROM wms_items i
    LEFT JOIN wms_production_line_defs pld
      ON pld.site_id = i.site_id
     AND UPPER(pld.line_code) = UPPER(COALESCE(
       NULLIF(BTRIM(i.line_group), ''),
       NULLIF(BTRIM(i.item_attrs_json->'productionLine'->>'code'), '')
     ))
    WHERE i.site_id = $1
      AND i.item_type_code = 'finished_goods'
      AND COALESCE(i.item_subgroup, 'product') NOT IN ('unit', 'block', 'pallet')
      AND (
        i.is_active
        OR EXISTS (
          SELECT 1 FROM wms_item_codes mic0
          WHERE mic0.item_id = i.item_id AND mic0.unlinked_at IS NULL
        )
      )
      AND ($2::text = '' OR i.name ILIKE $3 OR i.item_code ILIKE $3 OR COALESCE(i.line_group, '') ILIKE $3 OR COALESCE(pld.display_name, '') ILIKE $3)
    ORDER BY i.name, i.item_code
    `,
    [siteId, q, `%${q}%`]
  )
  return r.rows
}

function mapNomenclatureRow(row: NomenclatureDbRow): FgNomenclatureRow {
  const bottles = warehouseBottleQty(Number(row.bottles) || 0, Number(row.stockBottles) || 0)
  const blocks = Number(row.blocks) || 0
  const pallets = Number(row.pallets) || 0
  const markingCodesCount = Number(row.markingCodesCount) || 0
  const lotCodes = uniquePlantBatches(String(row.lotCodes || "").split(","))
  const fromBatch = plantLinesFromBatches(lotCodes)
  const days = daysUntilExpiry(row.nearestExpiryAt)
  const tags = tagsFromExpiry(row.nearestExpiryAt, Boolean(row.anyLotBlocked))
  const quarantine = Boolean(row.anyLotBlocked) || Boolean(row.hasQuarantineQty)
  const statuses = statusesFromRow({
    crptIntroducedCount: Number(row.crptIntroducedCount) || 0,
    crptNotIntroducedCount: Number(row.crptNotIntroducedCount) || 0,
    quarantine,
    inProduction: Boolean(row.hasInProductionQty),
  })

  let expiryCritical = 0
  let expiryWarning = 0
  let expiryOk = bottles
  if (days != null) {
    if (days < 0) {
      expiryCritical = bottles
      expiryOk = 0
    } else if (days <= 7) {
      expiryCritical = bottles
      expiryOk = 0
    } else if (days <= 30) {
      expiryWarning = bottles
      expiryOk = 0
    }
  }

  return {
    itemCode: row.itemCode,
    name: row.name,
    gtin: row.gtin ?? row.itemCode,
    productGroup: row.productGroup ?? "",
    bottles,
    blocks,
    pallets,
    markingCodesCount,
    productionLineCode: row.productionLineCode || fromBatch.code,
    productionLineName: row.productionLineName || fromBatch.name,
    lotCodes,
    nearestExpiryAt: row.nearestExpiryAt,
    oldestProductionAt: row.oldestProductionAt,
    tags,
    statuses,
    expiryCritical,
    expiryWarning,
    expiryOk,
    placedBottles: 0,
    placedBlocks: 0,
    placedPallets: 0,
    planRows: [],
  }
}

export async function getFgSummary(client: PoolClient, siteId: number): Promise<FgSummaryStats> {
  const rows = await listFgNomenclature(client, siteId, "")
  return {
    nomenclatureCount: rows.length,
    bottles: rows.reduce((s, r) => s + r.bottles, 0),
    blocks: rows.reduce((s, r) => s + r.blocks, 0),
    pallets: rows.reduce((s, r) => s + r.pallets, 0),
    placedBottles: rows.reduce((s, r) => s + (r.placedBottles ?? 0), 0),
    placedBlocks: rows.reduce((s, r) => s + (r.placedBlocks ?? 0), 0),
    placedPallets: rows.reduce((s, r) => s + (r.placedPallets ?? 0), 0),
    unplacedBottles: rows.reduce((s, r) => s + (r.unplacedBottles ?? 0), 0),
    unplacedPallets: rows.reduce((s, r) => s + (r.unplacedPallets ?? 0), 0),
    markingCodesCount: rows.reduce((s, r) => s + r.markingCodesCount, 0),
    expiryCritical: rows.reduce((s, r) => s + r.expiryCritical, 0),
    expiryWarning: rows.reduce((s, r) => s + r.expiryWarning, 0),
    exportBottles: 0,
  }
}

export async function listFgNomenclature(
  client: PoolClient,
  siteId: number,
  query = "",
  fsnDays: number = DEFAULT_FSN_DAYS
): Promise<FgNomenclatureRow[]> {
  try {
    await ensureFinishedGoodsFromPlan(client, siteId)
  } catch (error) {
    console.error("ensureFinishedGoodsFromPlan", error)
  }
  const rows = (await listNomenclatureDb(client, siteId, query)).map(mapNomenclatureRow)
  const merged = await mergePlacedIntoFgNomenclature(client, siteId, rows, query)
  let withVekas = merged
  try {
    const lots = await loadFgVekasLotAggs(client, siteId)
    withVekas = mergeVekasLotsIntoFgNomenclature(merged, lots, query)
  } catch (error) {
    console.error("mergeVekasLotsIntoFgNomenclature", error)
  }
  let withFsn = withVekas
  try {
    const volumes = new Map<string, number>()
    for (const row of withVekas) {
      const pallets = Math.max(row.pallets, row.placedPallets ?? 0)
      if (pallets > 0) volumes.set(row.itemCode, pallets * EURO_PALLET_M3)
    }
    const demand = await classifyFgDemand(
      client,
      siteId,
      withVekas.map((row) => row.itemCode),
      fsnDays,
      volumes
    )
    const allPlanRowIds = [
      ...new Set(withVekas.flatMap((row) => (row.planRows ?? []).map((loc) => loc.planRowId).filter(Boolean))),
    ]
    withFsn = withVekas.map((row) => {
      const profile = demand.get(row.itemCode)
      const storageClass = deriveProductPhysicalProfile({
        name: row.name,
        itemTypeCode: "finished_goods",
        productGroup: row.productGroup,
      }).storageClass
      const fsn = profile?.fsn ?? "N"
      const abc = profile?.abc ?? "C"
      const xyz = profile?.xyz ?? "Z"
      return {
        ...row,
        fsn,
        fsnMoves: profile?.moves ?? 0,
        fsnQty: profile?.qty ?? 0,
        fsnDays: profile?.periodDays ?? fsnDays,
        abc,
        xyz,
        abcxyz: profile?.abcxyz ?? "CZ",
        cv: profile?.cv ?? null,
        coi: profile?.coi ?? null,
        storageClass,
        skuProfile: formatSkuProfile(storageClass, abc, xyz, fsn),
        reslotHint: suggestReslot({
          fsn,
          abc,
          currentPlanRowIds: (row.planRows ?? []).map((loc) => loc.planRowId),
          allPlanRowIds,
        }),
        crossDock: null,
      }
    })
  } catch (error) {
    console.error("[sku-demand] overlay nomenclature", error)
  }
  try {
    const outbound = await loadOutboundDemand(
      client,
      siteId,
      withFsn.map((row) => row.itemCode)
    )
    const byCode = new Map(outbound.map((row) => [row.itemCode, row]))
    withFsn = withFsn.map((row) => {
      const hint = byCode.get(row.itemCode)
      return hint
        ? {
            ...row,
            crossDock: {
              dockCode: hint.dockCode,
              documentNo: hint.documentNo,
              qty: hint.qty,
              reason: hint.reason,
            },
          }
        : row
    })
  } catch (error) {
    console.error("[cross-dock] overlay nomenclature", error)
  }
  try {
    const codes = withFsn.map((row) => row.itemCode)
    const periodDays = withFsn[0]?.fsnDays ?? 90
    const [attrs, lastMove, outbound] = await Promise.all([
      loadItemAttrsByCode(client, siteId, codes),
      loadLastMovementDays(client, siteId, codes),
      loadOutboundUsage(client, siteId, codes, periodDays),
    ])
    withFsn = withFsn.map((row) => {
      const usage = outbound.get(row.itemCode)
      const ops = computeWarehouseOps({
        availableQty: Math.max(row.bottles, row.placedBottles ?? 0),
        inProductionQty: 0,
        daysSinceMove: lastMove.get(row.itemCode) ?? (row.fsnMoves === 0 ? row.fsnDays ?? 90 : null),
        daysSinceOutbound: usage?.daysSince ?? (row.fsnMoves === 0 ? row.fsnDays ?? 90 : null),
        outboundQty: usage?.qty ?? row.fsnQty ?? 0,
        manufacturedAt: row.oldestProductionAt,
        nearestExpiryAt: row.nearestExpiryAt,
        itemAttrs: attrs.get(row.itemCode),
        fsn: row.fsn,
        fsnMoves: row.fsnMoves,
        isPerishable: true,
        periodDays: row.fsnDays,
      })
      return {
        ...row,
        policyState: ops.policyState,
        policyShort: formatPolicyShort(ops),
        policyInferred: ops.policyInferred,
        deadStock: ops.deadStock,
        agingDays: ops.agingDays,
        agingBand: ops.agingBand,
        obsolescence: ops.obsolescence,
        opsHint: ops.hint,
      }
    })
  } catch (error) {
    console.error("[warehouse-ops] overlay nomenclature", error)
  }
  try {
    const open = await listOpenResortIndex(client, siteId)
    return withFsn.map((row) => applyResortToItem(row, open.itemCodes))
  } catch (error) {
    console.error("[fg-resort] overlay nomenclature", error)
    return withFsn
  }
}

export async function getFgExpiryBuckets(client: PoolClient, siteId: number): Promise<FgExpiryBucket[]> {
  const rows = await listFgNomenclature(client, siteId)
  const critical: FgExpiryBucket["items"] = []
  const warning: FgExpiryBucket["items"] = []
  const ok: FgExpiryBucket["items"] = []
  const expired: FgExpiryBucket["items"] = []

  for (const row of rows) {
    if (!row.nearestExpiryAt) continue
    const d = daysUntilExpiry(row.nearestExpiryAt)
    if (d == null) continue
    const item = {
      itemCode: row.itemCode,
      name: row.name,
      bottles: row.bottles,
      nearestExpiryAt: row.nearestExpiryAt,
      daysLeft: d,
    }
    if (d < 0) expired.push(item)
    else if (d <= 7) critical.push(item)
    else if (d <= 30) warning.push(item)
    else ok.push(item)
  }

  return [
    { key: "expired", label: "Просрочено", daysRange: "< 0 дн.", items: expired },
    { key: "critical", label: "Критично", daysRange: "≤ 7 дн.", items: critical },
    { key: "warning", label: "Внимание", daysRange: "8–30 дн.", items: warning },
    { key: "ok", label: "Норма", daysRange: "> 30 дн.", items: ok },
  ]
}

export async function listFgStorageRows(
  client: PoolClient,
  siteId: number,
  options?: { query?: string; tag?: FgMarkingTag | "all" }
): Promise<FgStorageRowSummary[]> {
  const q = (options?.query ?? "").trim()
  // Ряды ГП — по кодам ЧЗ (pack_level), а не по item_subgroup в остатках:
  // nest-import вешает все уровни на одну карточку продукта.
  const r = await client.query<{
    rowId: string
    rowCode: string
    label: string
    zone: string
    palletCount: string
    markingCodesCount: string
    bottles: string
    blocks: string
    nearestExpiryAt: string | null
    nomenclatureSkus: string
    fillPercent: string
  }>(
    `
    SELECT
      l.location_id::text AS "rowId",
      l.location_code AS "rowCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS label,
      COALESCE(z.zone_code, '') AS zone,
      COUNT(DISTINCT ${SQL_RESOLVE_PALLET_ID}) FILTER (
        WHERE ${SQL_RESOLVE_PALLET_ID} IS NOT NULL
      )::text AS "palletCount",
      COUNT(mic.code_id) FILTER (WHERE i.item_id IS NOT NULL)::text AS "markingCodesCount",
      COUNT(mic.code_id) FILTER (
        WHERE i.item_id IS NOT NULL
          AND COALESCE(mic.pack_level, 'unit') IN ('unit', 'bottle')
      )::text AS bottles,
      COUNT(mic.code_id) FILTER (
        WHERE i.item_id IS NOT NULL AND COALESCE(mic.pack_level, '') = 'block'
      )::text AS blocks,
      NULL::timestamptz AS "nearestExpiryAt",
      COUNT(DISTINCT mic.item_id) FILTER (WHERE i.item_id IS NOT NULL)::text AS "nomenclatureSkus",
      LEAST(100, GREATEST(0, ROUND(
        100.0 * COUNT(DISTINCT ${SQL_RESOLVE_PALLET_ID}) FILTER (
          WHERE ${SQL_RESOLVE_PALLET_ID} IS NOT NULL
        )
        / NULLIF(COALESCE(
          (l.location_attrs_json->'slotProfile'->>'capacityUnits')::numeric,
          (l.location_attrs_json->>'planCapacity')::numeric,
          0
        ), 0)
      )))::text AS "fillPercent"
    FROM wms_locations l
    LEFT JOIN wms_zones z ON z.zone_id = l.zone_id
    LEFT JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id
    LEFT JOIN wms_item_codes mic
      ON mic.current_location_id = l.location_id
     AND mic.current_site_id = l.site_id
     AND mic.unlinked_at IS NULL
    LEFT JOIN codes c ON c.code_id = mic.code_id
    LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
    LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
    LEFT JOIN wms_items i ON i.item_id = mic.item_id AND i.item_type_code = 'finished_goods'
    WHERE l.site_id = $1
      AND (
        COALESCE(l.location_attrs_json->>'planRowId', '') <> ''
        OR COALESCE(l.location_attrs_json->>'fgRow', '') = 'true'
        OR COALESCE(l.location_attrs_json->>'storageModel', '') = 'pallet_row'
        OR l.location_code ILIKE 'FG-%'
        OR COALESCE(z.zone_code, '') ILIKE 'ROW%'
      )
      AND ($2::text = '' OR l.location_code ILIKE $3 OR l.display_name ILIKE $3 OR z.zone_code ILIKE $3)
    GROUP BY l.location_id, l.location_code, l.display_name, z.zone_code, l.location_attrs_json
    HAVING COUNT(i.item_id) > 0
        OR COALESCE(l.location_attrs_json->>'planRowId', '') <> ''
        OR COALESCE(l.location_attrs_json->>'fgRow', '') = 'true'
    ORDER BY
      COUNT(DISTINCT ${SQL_RESOLVE_PALLET_ID}) FILTER (
        WHERE ${SQL_RESOLVE_PALLET_ID} IS NOT NULL
      ) DESC,
      z.zone_code,
      l.location_code
    `,
    [siteId, q, `%${q}%`]
  )

  let rows = r.rows.map((row) => ({
    rowId: row.rowId,
    rowCode: row.rowCode,
    label: row.label,
    zone: row.zone,
    palletCount: Number(row.palletCount) || 0,
    markingCodesCount: Number(row.markingCodesCount) || 0,
    bottles: Number(row.bottles) || 0,
    blocks: Number(row.blocks) || 0,
    nearestExpiryAt: row.nearestExpiryAt,
    tags: tagsFromExpiry(row.nearestExpiryAt, false),
    nomenclatureSkus: Number(row.nomenclatureSkus) || 0,
    fillPercent: Number(row.fillPercent) || 0,
  }))

  const tag = options?.tag ?? "all"
  if (tag !== "all") {
    rows = rows.filter((row) => row.tags.includes(tag))
  }
  const withPlaced = await overlayPlacedOnStorageRows(siteId, rows)
  return overlayStockOnStorageRows(client, siteId, withPlaced)
}

async function overlayStockOnStorageRows<T extends { rowCode: string; bottles: number }>(
  client: PoolClient,
  siteId: number,
  rows: T[]
): Promise<T[]> {
  const r = await client.query<{ code: string; bottles: string }>(
    `
    SELECT l.location_code AS code, COALESCE(SUM(sb.available_qty), 0)::text AS bottles
    FROM wms_stock_balances sb
    JOIN wms_locations l ON l.location_id = sb.location_id
    JOIN wms_items i ON i.item_id = sb.item_id
    WHERE sb.site_id = $1
      AND i.item_type_code = 'finished_goods'
      AND i.name !~* '^(стикер|этикетка)\\b'
    GROUP BY l.location_code
    `,
    [siteId]
  )
  const byCode = new Map<string, number>()
  for (const row of r.rows) {
    const qty = Number(row.bottles) || 0
    if (qty <= 0) continue
    byCode.set(row.code, qty)
    const planRow = canonicalPlanRowId(row.code)
    if (planRow) byCode.set(planRow, (byCode.get(planRow) ?? 0) + qty)
  }
  return rows.map((row) => {
    const stock = Math.max(
      byCode.get(row.rowCode) ?? 0,
      byCode.get(canonicalPlanRowId(row.rowCode) || "") ?? 0
    )
    return { ...row, bottles: warehouseBottleQty(row.bottles, stock) }
  })
}

export async function listFgRowPallets(
  client: PoolClient,
  siteId: number,
  rowId: string,
  options?: { page?: number; pageSize?: number; query?: string }
): Promise<FgPagedResult<FgRowPalletSummary>> {
  const page = Math.max(1, options?.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, options?.pageSize ?? 50))
  const q = (options?.query ?? "").trim()
  const offset = (page - 1) * pageSize

  const palletCte = `
    WITH pallets_at_row AS (
      SELECT DISTINCT ${SQL_RESOLVE_PALLET_ID} AS pallet_id
      FROM wms_item_codes mic
      JOIN codes c ON c.code_id = mic.code_id
      JOIN wms_items i ON i.item_id = mic.item_id
      LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
      LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
      WHERE mic.current_site_id = $1
        AND mic.current_location_id = $2::bigint
        AND mic.unlinked_at IS NULL
        AND i.item_type_code = 'finished_goods'
    )
  `

  const countR = await client.query<{ total: string }>(
    `
    ${palletCte}
    SELECT COUNT(*)::text AS total
    FROM pallets_at_row
    WHERE pallet_id IS NOT NULL
    `,
    [siteId, rowId]
  )
  const total = Number(countR.rows[0]?.total ?? 0)

  const r = await client.query<{
    palletId: string
    palletCode: string
    serial: string
    itemCode: string
    itemName: string
    manufacturedAt: string | null
    blocks: string
    bottles: string
    markingCodesCount: string
  }>(
    `
    ${palletCte}
    SELECT
      c.code_id::text AS "palletId",
      (c.ai01_gtin || COALESCE(c.ai21_serial, '')) AS "palletCode",
      COALESCE(c.ai21_serial, c.ai01_gtin) AS serial,
      COALESCE(i.item_code, '') AS "itemCode",
      COALESCE(i.name, '—') AS "itemName",
      cs.emitted_at AS "manufacturedAt",
      (
        SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = c.code_id
      ) AS blocks,
      (
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        WHERE b.parent_code_id = c.code_id
      ) AS bottles,
      (
        SELECT (COUNT(*) + 1)::text
        FROM codes x
        WHERE x.parent_code_id = c.code_id
           OR x.parent_code_id IN (SELECT b.code_id FROM codes b WHERE b.parent_code_id = c.code_id)
      ) AS "markingCodesCount"
    FROM pallets_at_row par
    JOIN codes c ON c.code_id = par.pallet_id
    LEFT JOIN wms_item_codes mic ON mic.code_id = c.code_id AND mic.unlinked_at IS NULL
    LEFT JOIN LATERAL (
      SELECT mic3.item_id
      FROM wms_item_codes mic3
      JOIN codes cx ON cx.code_id = mic3.code_id
      LEFT JOIN codes b ON b.code_id = cx.parent_code_id
      LEFT JOIN codes p ON p.code_id = b.parent_code_id
      WHERE mic3.current_site_id = $1
        AND mic3.current_location_id = $2::bigint
        AND mic3.unlinked_at IS NULL
        AND COALESCE(
          CASE WHEN cx.ai01_gtin LIKE '00%' OR COALESCE(mic3.pack_level, '') = 'pallet' THEN cx.code_id END,
          CASE WHEN b.ai01_gtin LIKE '00%' THEN b.code_id END,
          CASE WHEN p.ai01_gtin LIKE '00%' THEN p.code_id END
        ) = par.pallet_id
      LIMIT 1
    ) item_pick ON true
    LEFT JOIN wms_items i ON i.item_id = COALESCE(mic.item_id, item_pick.item_id)
    LEFT JOIN code_state cs ON cs.code_id = c.code_id
    WHERE par.pallet_id IS NOT NULL
      AND (
        $3::text = ''
        OR COALESCE(i.name, '') ILIKE $4
        OR COALESCE(i.item_code, '') ILIKE $4
        OR c.ai01_gtin ILIKE $4
        OR c.ai21_serial ILIKE $4
        OR (c.ai01_gtin || c.ai21_serial) ILIKE $4
      )
    ORDER BY c.ai01_gtin, c.ai21_serial, c.code_id
    LIMIT $5 OFFSET $6
    `,
    [siteId, rowId, q, `%${q}%`, pageSize, offset]
  )

  const items: FgRowPalletSummary[] = r.rows.map((row, idx) => ({
    palletId: row.palletId,
    palletCode: row.palletCode,
    serialNumber: row.serial,
    rowId,
    position: offset + idx + 1,
    itemName: row.itemName,
    itemCode: row.itemCode,
    blocks: Number(row.blocks) || 0,
    bottles: Number(row.bottles) || 0,
    markingCodesCount: Number(row.markingCodesCount) || 0,
    producedAt: row.manufacturedAt,
    expiresAt: null,
    tags: [],
  }))

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export async function listFgPallets(
  client: PoolClient,
  siteId: number,
  query = ""
): Promise<FgPalletRow[]> {
  const q = query.trim()
  const r = await client.query<{
    palletId: string
    palletCode: string
    itemCode: string
    itemName: string
    locationCode: string
    rowLabel: string
    manufacturedAt: string | null
    blocks: string
    bottles: string
    markingCodesCount: string
    locationQuarantine: boolean | null
    hasInProductionQty: boolean | null
    crptIntroducedCount: string
    crptNotIntroducedCount: string
  }>(
    `
    SELECT
      c.code_id::text AS "palletId",
      (c.ai01_gtin || COALESCE(c.ai21_serial, '')) AS "palletCode",
      i.item_code AS "itemCode",
      i.name AS "itemName",
      COALESCE(l.location_code, '—') AS "locationCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code, 'Без ряда') AS "rowLabel",
      cs.emitted_at AS "manufacturedAt",
      (
        SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = c.code_id
      ) AS blocks,
      (
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        WHERE b.parent_code_id = c.code_id
      ) AS bottles,
      (
        SELECT (COUNT(*) + 1)::text
        FROM codes x
        WHERE x.parent_code_id = c.code_id
           OR x.parent_code_id IN (SELECT b.code_id FROM codes b WHERE b.parent_code_id = c.code_id)
      ) AS "markingCodesCount",
      (COALESCE(l.location_status_id, 0) = 2) AS "locationQuarantine",
      (
        SELECT COALESCE(SUM(sb2.in_production_qty), 0) > 0
        FROM wms_stock_balances sb2
        WHERE sb2.site_id = $1
          AND sb2.item_id = i.item_id
          AND sb2.location_id = mic.current_location_id
      ) AS "hasInProductionQty",
      COALESCE((
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        LEFT JOIN code_state cs_u ON cs_u.code_id = u.code_id
        WHERE b.parent_code_id = c.code_id
          AND (
            COALESCE(cs_u.status_id, 0) >= 5
            OR cs_u.introduced_at IS NOT NULL
          )
      ), '0') AS "crptIntroducedCount",
      COALESCE((
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        LEFT JOIN code_state cs_u ON cs_u.code_id = u.code_id
        WHERE b.parent_code_id = c.code_id
          AND NOT (
            COALESCE(cs_u.status_id, 0) >= 5
            OR cs_u.introduced_at IS NOT NULL
          )
      ), '0') AS "crptNotIntroducedCount"
    FROM wms_item_codes mic
    JOIN codes c ON c.code_id = mic.code_id
    JOIN wms_items i ON i.item_id = mic.item_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    LEFT JOIN code_state cs ON cs.code_id = c.code_id
    WHERE mic.current_site_id = $1
      AND mic.unlinked_at IS NULL
      AND (c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet')
      AND i.item_type_code = 'finished_goods'
      AND (
        $2::text = ''
        OR i.name ILIKE $3
        OR i.item_code ILIKE $3
        OR COALESCE(l.location_code, '') ILIKE $3
        OR c.ai01_gtin ILIKE $3
        OR c.ai21_serial ILIKE $3
        OR (c.ai01_gtin || c.ai21_serial) ILIKE $3
      )
    ORDER BY l.location_code NULLS LAST, c.ai01_gtin, c.ai21_serial
    LIMIT 500
    `,
    [siteId, q, `%${q}%`]
  )

  const mapped = r.rows.map((row) => {
    const tags = tagsFromExpiry(null, Boolean(row.locationQuarantine))
    const statuses = statusesFromRow({
      crptIntroducedCount: Number(row.crptIntroducedCount) || 0,
      crptNotIntroducedCount: Number(row.crptNotIntroducedCount) || 0,
      quarantine: Boolean(row.locationQuarantine),
      inProduction: Boolean(row.hasInProductionQty),
    })
    return {
      palletId: row.palletId,
      palletCode: row.palletCode,
      itemCode: row.itemCode,
      itemName: row.itemName,
      locationCode: row.locationCode,
      rowLabel: row.rowLabel,
      blocks: Number(row.blocks) || 0,
      bottles: Number(row.bottles) || 0,
      markingCodesCount: Number(row.markingCodesCount) || 0,
      producedAt: row.manufacturedAt,
      expiresAt: null,
      tags,
      statuses,
    }
  })
  try {
    const open = await listOpenResortIndex(client, siteId)
    const withResort = mapped.map((row) => applyResortToPallet(row, open))
    return overlayVekasLotsOnPallets(client, siteId, withResort, query)
  } catch (error) {
    console.error("[fg-resort] overlay pallets", error)
    return overlayVekasLotsOnPallets(client, siteId, mapped, query)
  }
}

export async function findFgMarkingCode(
  client: PoolClient,
  siteId: number,
  rawQuery: string
): Promise<FgCodeLookupHit | null> {
  const q = rawQuery.trim().replace(/\s+/g, "")
  if (q.length < 8) return null

  const r = await client.query<{
    code: string
    serial: string
    itemCode: string
    itemName: string
    rowId: string
    rowLabel: string
  }>(
    `
    SELECT
      COALESCE(encode(c.raw, 'escape'), c.ai01_gtin || c.ai21_serial) AS code,
      c.ai21_serial AS serial,
      i.item_code AS "itemCode",
      i.name AS "itemName",
      l.location_id::text AS "rowId",
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS "rowLabel"
    FROM wms_item_codes mic
    JOIN codes c ON c.code_id = mic.code_id
    JOIN wms_items i ON i.item_id = mic.item_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    WHERE mic.current_site_id = $1
      AND mic.unlinked_at IS NULL
      AND i.item_type_code = 'finished_goods'
      AND (
        c.ai21_serial = $2
        OR c.ai01_gtin = $2
        OR c.ai01_gtin || c.ai21_serial = $2
        OR encode(c.raw, 'escape') ILIKE '%' || $2 || '%'
      )
    ORDER BY mic.linked_at DESC
    LIMIT 1
    `,
    [siteId, q.replace(/^01/, "").slice(-20)]
  )

  const row = r.rows[0]
  if (!row) return null
  return {
    code: row.code,
    rowId: row.rowId,
    rowLabel: row.rowLabel,
    palletSerial: row.serial,
    itemName: row.itemName,
    itemCode: row.itemCode,
  }
}

export async function getFgNomenclatureTree(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  limit = 200
): Promise<FgMarkingNode[]> {
  const itemId = await resolveFgItemId(client, siteId, itemCode)
  if (!itemId) return []

  // Корни — палеты: pack_level, SSCC 00… или родитель/дед единицы по parent_code_id.
  const r = await client.query<{
    codeId: string
    gtin: string
    serial: string
    subgroup: string | null
    ai93Tail: Buffer | null
    emittedAt: string | null
    locationCode: string | null
    rowLabel: string | null
    childCount: string
    blocksCount: string
    bottlesCount: string
  }>(
    `
    WITH pallet_ids AS (
      SELECT DISTINCT pal.code_id
      FROM wms_item_codes mic
      JOIN codes c ON c.code_id = mic.code_id
      LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
      LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
          CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
          CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
        ) AS code_id
      ) pal
      WHERE mic.item_id = $1::bigint
        AND mic.current_site_id = $2
        AND mic.unlinked_at IS NULL
        AND pal.code_id IS NOT NULL
    )
    SELECT
      p.code_id::text AS "codeId",
      p.ai01_gtin AS gtin,
      p.ai21_serial AS serial,
      COALESCE(mic.pack_level, 'pallet') AS subgroup,
      p.ai93_tail AS "ai93Tail",
      cs.emitted_at AS "emittedAt",
      l.location_code AS "locationCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS "rowLabel",
      (SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = p.code_id) AS "childCount",
      (SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = p.code_id) AS "blocksCount",
      (
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        WHERE b.parent_code_id = p.code_id
      ) AS "bottlesCount"
    FROM pallet_ids ids
    JOIN codes p ON p.code_id = ids.code_id
    LEFT JOIN wms_item_codes mic ON mic.code_id = p.code_id AND mic.unlinked_at IS NULL
    LEFT JOIN code_state cs ON cs.code_id = p.code_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    ORDER BY p.code_id
    LIMIT $3
    `,
    [itemId, siteId, limit]
  )

  const tree = r.rows.map((row) => ({
    id: row.codeId,
    code: formatGs1MarkingCode(row.gtin, row.serial, row.ai93Tail),
    kind: kindFromMarking(row.gtin, row.subgroup, Number(row.childCount) || 0),
    gtin: row.gtin,
    serialNumber: row.serial,
    producedAt: row.emittedAt,
    expiresAt: null,
    tags: [] as FgMarkingNode["tags"],
    locationCode: row.locationCode ?? undefined,
    rowLabel: row.rowLabel ?? undefined,
    children: [],
    childCount: Number(row.childCount) || 0,
    blocksCount: Number(row.blocksCount) || 0,
    bottlesCount: Number(row.bottlesCount) || 0,
  }))
  try {
    const open = await listOpenResortIndex(client, siteId)
    return tree.map((node) => applyResortToNode(node, open.palletIds))
  } catch (error) {
    console.error("[fg-resort] overlay tree", error)
    return tree
  }
}

async function resolveFgItemId(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<string | null> {
  const r = await client.query<{ itemId: string }>(
    `SELECT item_id::text AS "itemId"
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2 AND item_type_code = 'finished_goods'
     LIMIT 1`,
    [siteId, itemCode]
  )
  return r.rows[0]?.itemId ?? null
}

/** Прямые дочерние коды (блоки палеты или бутылки блока). */
export async function getFgMarkingCodeChildren(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  parentCodeId: string
): Promise<FgMarkingNode[]> {
  const itemId = await resolveFgItemId(client, siteId, itemCode)
  if (!itemId) return []

  const r = await client.query<{
    codeId: string
    gtin: string
    serial: string
    subgroup: string | null
    ai93Tail: Buffer | null
    emittedAt: string | null
    locationCode: string | null
    rowLabel: string | null
    childCount: string
  }>(
    `
    SELECT
      c.code_id::text AS "codeId",
      c.ai01_gtin AS gtin,
      c.ai21_serial AS serial,
      COALESCE(mic.pack_level, 'unit') AS subgroup,
      c.ai93_tail AS "ai93Tail",
      cs.emitted_at AS "emittedAt",
      l.location_code AS "locationCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS "rowLabel",
      (SELECT COUNT(*)::text FROM codes ch WHERE ch.parent_code_id = c.code_id) AS "childCount"
    FROM codes c
    LEFT JOIN wms_item_codes mic ON mic.code_id = c.code_id AND mic.unlinked_at IS NULL
    LEFT JOIN code_state cs ON cs.code_id = c.code_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    WHERE c.parent_code_id = $1::bigint
    ORDER BY
      CASE
        WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN 0
        WHEN COALESCE(mic.pack_level, '') = 'block' THEN 1
        WHEN COALESCE(mic.pack_level, '') IN ('unit', 'bottle') THEN 2
        ELSE 3
      END,
      c.code_id
    `,
    [parentCodeId]
  )

  return r.rows.map((row) => {
    const childCount = Number(row.childCount) || 0
    return {
      id: row.codeId,
      code: formatGs1MarkingCode(row.gtin, row.serial, row.ai93Tail),
      kind: kindFromMarking(row.gtin, row.subgroup, childCount),
      gtin: row.gtin,
      serialNumber: row.serial,
      producedAt: row.emittedAt,
      expiresAt: null,
      tags: [],
      locationCode: row.locationCode ?? undefined,
      rowLabel: row.rowLabel ?? undefined,
      children: [],
      childCount,
    }
  })
}

function emptyFgPage<T>(page: number, pageSize: number): FgPagedResult<T> {
  return { items: [], total: 0, page, pageSize, totalPages: 1 }
}

/** Палеты одной позиции ГП — страница для карточки номенклатуры. */
export async function listFgNomenclaturePalletNodes(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  options?: { query?: string; page?: number; pageSize?: number }
): Promise<FgPagedResult<FgMarkingNode>> {
  const page = Math.max(1, Math.trunc(options?.page ?? 1) || 1)
  const pageSize = Math.min(100, Math.max(1, Math.trunc(options?.pageSize ?? 50) || 50))
  const query = (options?.query ?? "").trim()
  const offset = (page - 1) * pageSize
  const itemId = await resolveFgItemId(client, siteId, itemCode)
  if (!itemId) return emptyFgPage(page, pageSize)

  const r = await client.query<{
    codeId: string
    gtin: string
    serial: string
    subgroup: string | null
    ai93Tail: Buffer | null
    emittedAt: string | null
    locationCode: string | null
    rowLabel: string | null
    childCount: string
    blocksCount: string
    bottlesCount: string
    total: string
  }>(
    `
    WITH pallet_ids AS (
      SELECT DISTINCT pal.code_id
      FROM wms_item_codes mic
      JOIN codes c ON c.code_id = mic.code_id
      LEFT JOIN codes p1 ON p1.code_id = c.parent_code_id
      LEFT JOIN codes p2 ON p2.code_id = p1.parent_code_id
      CROSS JOIN LATERAL (
        SELECT COALESCE(
          CASE WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN c.code_id END,
          CASE WHEN p1.ai01_gtin LIKE '00%' THEN p1.code_id END,
          CASE WHEN p2.ai01_gtin LIKE '00%' THEN p2.code_id END
        ) AS code_id
      ) pal
      WHERE mic.item_id = $1::bigint
        AND mic.current_site_id = $2
        AND mic.unlinked_at IS NULL
        AND pal.code_id IS NOT NULL
    )
    SELECT
      p.code_id::text AS "codeId",
      p.ai01_gtin AS gtin,
      p.ai21_serial AS serial,
      COALESCE(mic.pack_level, 'pallet') AS subgroup,
      p.ai93_tail AS "ai93Tail",
      cs.emitted_at AS "emittedAt",
      l.location_code AS "locationCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS "rowLabel",
      (SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = p.code_id) AS "childCount",
      (SELECT COUNT(*)::text FROM codes b WHERE b.parent_code_id = p.code_id) AS "blocksCount",
      (
        SELECT COUNT(*)::text
        FROM codes u
        JOIN codes b ON b.code_id = u.parent_code_id
        WHERE b.parent_code_id = p.code_id
      ) AS "bottlesCount",
      COUNT(*) OVER()::text AS total
    FROM pallet_ids ids
    JOIN codes p ON p.code_id = ids.code_id
    LEFT JOIN wms_item_codes mic ON mic.code_id = p.code_id AND mic.unlinked_at IS NULL
    LEFT JOIN code_state cs ON cs.code_id = p.code_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    WHERE (
      $3::text = ''
      OR p.ai01_gtin ILIKE $4
      OR p.ai21_serial ILIKE $4
      OR (p.ai01_gtin || COALESCE(p.ai21_serial, '')) ILIKE $4
      OR COALESCE(l.location_code, '') ILIKE $4
      OR COALESCE(l.display_name, '') ILIKE $4
    )
    ORDER BY p.code_id
    LIMIT $5 OFFSET $6`,
    [itemId, siteId, query, `%${query}%`, pageSize, offset]
  )

  const total = Number(r.rows[0]?.total ?? 0)
  return {
    items: r.rows.map((row) => ({
      id: row.codeId,
      code: formatGs1MarkingCode(row.gtin, row.serial, row.ai93Tail),
      kind: kindFromMarking(row.gtin, row.subgroup, Number(row.childCount) || 0),
      gtin: row.gtin,
      serialNumber: row.serial,
      producedAt: row.emittedAt,
      expiresAt: null,
      tags: [],
      locationCode: row.locationCode ?? undefined,
      rowLabel: row.rowLabel ?? undefined,
      children: [],
      childCount: Number(row.childCount) || 0,
      blocksCount: Number(row.blocksCount) || 0,
      bottlesCount: Number(row.bottlesCount) || 0,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

export type FgNomenclatureMarkingHit = {
  codeId: string
  code: string
  kind: ReturnType<typeof kindFromMarking>
  gtin: string
  serial: string
  locationCode: string | null
  rowLabel: string | null
}

/** Поиск кодов ЧЗ внутри одной позиции ГП. */
export async function searchFgNomenclatureMarkingCodes(
  client: PoolClient,
  siteId: number,
  itemCode: string,
  rawQuery: string,
  limit = 25
): Promise<FgNomenclatureMarkingHit[]> {
  const q = rawQuery.trim()
  if (q.length < 3) return []
  const itemId = await resolveFgItemId(client, siteId, itemCode)
  if (!itemId) return []
  const cap = Math.min(50, Math.max(1, Math.trunc(limit) || 25))
  const like = `%${q.replace(/\s+/g, "")}%`
  const compact = q.replace(/\s+/g, "")

  const r = await client.query<{
    codeId: string
    gtin: string
    serial: string
    subgroup: string | null
    ai93Tail: Buffer | null
    locationCode: string | null
    rowLabel: string | null
    childCount: string
  }>(
    `
    SELECT
      c.code_id::text AS "codeId",
      c.ai01_gtin AS gtin,
      c.ai21_serial AS serial,
      COALESCE(mic.pack_level, 'unit') AS subgroup,
      c.ai93_tail AS "ai93Tail",
      l.location_code AS "locationCode",
      COALESCE(NULLIF(l.display_name, ''), l.location_code) AS "rowLabel",
      (SELECT COUNT(*)::text FROM codes ch WHERE ch.parent_code_id = c.code_id) AS "childCount"
    FROM wms_item_codes mic
    JOIN codes c ON c.code_id = mic.code_id
    LEFT JOIN wms_locations l ON l.location_id = mic.current_location_id
    WHERE mic.item_id = $1::bigint
      AND mic.current_site_id = $2
      AND mic.unlinked_at IS NULL
      AND (
        c.ai21_serial ILIKE $3
        OR c.ai01_gtin ILIKE $3
        OR (c.ai01_gtin || COALESCE(c.ai21_serial, '')) ILIKE $3
        OR encode(c.raw, 'escape') ILIKE $3
        OR c.ai21_serial = $4
        OR c.ai01_gtin || COALESCE(c.ai21_serial, '') = $4
      )
    ORDER BY
      CASE
        WHEN c.ai01_gtin LIKE '00%' OR COALESCE(mic.pack_level, '') = 'pallet' THEN 0
        WHEN COALESCE(mic.pack_level, '') = 'block' THEN 1
        ELSE 2
      END,
      c.code_id DESC
    LIMIT $5`,
    [itemId, siteId, like, compact, cap]
  )

  return r.rows.map((row) => {
    const childCount = Number(row.childCount) || 0
    return {
      codeId: row.codeId,
      code: formatGs1MarkingCode(row.gtin, row.serial, row.ai93Tail),
      kind: kindFromMarking(row.gtin, row.subgroup, childCount),
      gtin: row.gtin,
      serial: row.serial,
      locationCode: row.locationCode,
      rowLabel: row.rowLabel,
    }
  })
}
