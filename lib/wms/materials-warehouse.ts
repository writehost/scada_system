import type { PoolClient } from "pg"
import {
  computeMaterialsMethods,
  type MaterialFamily,
  type MaterialUrgency,
  type QualityStatus,
  type RotationPolicy,
} from "@/lib/wms/materials-methods"
import type { StorageClassCode } from "@/lib/wms/physical-profile"
import {
  computeWarehouseOps,
  formatPolicyShort,
  type ObsolescenceRisk,
  type StockPolicyState,
  type AgingBand,
} from "@/lib/wms/warehouse-ops"
import { loadLastMovementDays, loadOutboundUsage } from "@/lib/wms/warehouse-ops-db"

export const MATERIALS_ITEM_TYPES = [
  "stickers",
  "materials",
  "packaging",
  "components",
  "equipment",
] as const

export type MaterialsWarehouseRow = {
  itemCode: string
  name: string
  sku: string | null
  itemTypeCode: string | null
  productGroup: string | null
  itemGroupCode: string | null
  materialType: string | null
  itemClassCode: string | null
  uomCode: string | null
  isMarked: boolean
  isPerishable: boolean
  rotationPolicy: RotationPolicy
  shelfLifeDays: number | null
  expiryWarningDays: number | null
  availableQty: number
  reservedQty: number
  inProductionQty: number
  inTransitQty: number
  quarantineQty: number
  rejectedQty: number
  lotCount: number
  lotCode: string | null
  vendorLot: string | null
  lotManufacturedAtMin: string | null
  stockEarliestReceivedAt: string | null
  nearestExpiryAt: string | null
  fefoLocationCode: string | null
  anyLotBlocked: boolean
  lotQaStatuses: string | null
  storageClass: StorageClassCode
  family: MaterialFamily
  familyLabel: string
  qualityStatus: QualityStatus
  qualityLabel: string
  urgency: MaterialUrgency
  profile: string
  issueHint: string | null
  issuable: boolean
  locationCount: number
  policyState: StockPolicyState | null
  policyLabel: string | null
  policyShort: string | null
  policyInferred: boolean
  deadStock: boolean
  agingDays: number | null
  agingBand: AgingBand | null
  obsolescence: ObsolescenceRisk
  kanban: boolean
  twoBin: boolean
  supermarket: boolean
  opsHint: string | null
}

type MaterialsDbRow = {
  itemCode: string
  name: string
  sku: string | null
  itemTypeCode: string | null
  productGroup: string | null
  itemGroupCode: string | null
  materialType: string | null
  itemClassCode: string | null
  itemAttrs: unknown
  uomCode: string | null
  isMarked: boolean
  isPerishable: boolean
  rotationPolicy: string | null
  shelfLifeDays: number | null
  expiryWarningDays: number | null
  availableQty: string | number
  reservedQty: string | number
  inProductionQty: string | number
  inTransitQty: string | number
  quarantineQty: string | number
  rejectedQty: string | number
  lotCount: string | number
  lotCode: string | null
  vendorLot: string | null
  lotManufacturedAtMin: Date | string | null
  stockEarliestReceivedAt: Date | string | null
  nearestExpiryAt: Date | string | null
  fefoLocationCode: string | null
  anyLotBlocked: boolean | null
  lotQaStatuses: string | null
  locationCount: string | number | null
}

function iso(v: Date | string | null | undefined): string | null {
  if (v == null) return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function num(v: string | number | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function listMaterialsWarehouse(
  client: PoolClient,
  siteId: number,
  options?: {
    query?: string
    productGroupNames?: string[]
    includeBareProductGroup?: boolean
    itemTypeCode?: string
  }
): Promise<MaterialsWarehouseRow[]> {
  const query = options?.query?.trim() ?? ""
  const productGroupNames = (options?.productGroupNames ?? []).map((s) => s.trim()).filter(Boolean)
  const includeBare = Boolean(options?.includeBareProductGroup)
  const applyGroup = includeBare || productGroupNames.length > 0
  const itemTypeCode = (options?.itemTypeCode ?? MATERIALS_ITEM_TYPES.join(",")).trim()

  const r = await client.query<MaterialsDbRow>(
    `
    WITH stock AS (
      SELECT
        sb.item_id,
        SUM(COALESCE(sb.available_qty, 0))::float8 AS available_qty,
        SUM(COALESCE(sb.reserved_qty, 0))::float8 AS reserved_qty,
        SUM(COALESCE(sb.in_production_qty, 0))::float8 AS in_production_qty,
        SUM(COALESCE(sb.in_transit_qty, 0))::float8 AS in_transit_qty,
        SUM(COALESCE(sb.quarantine_qty, 0))::float8 AS quarantine_qty,
        SUM(COALESCE(sb.rejected_qty, 0))::float8 AS rejected_qty
      FROM wms_stock_balances sb
      WHERE sb.site_id = $1
      GROUP BY sb.item_id
      HAVING SUM(
        COALESCE(sb.available_qty, 0) + COALESCE(sb.reserved_qty, 0)
        + COALESCE(sb.in_production_qty, 0) + COALESCE(sb.in_transit_qty, 0)
        + COALESCE(sb.quarantine_qty, 0) + COALESCE(sb.rejected_qty, 0)
      ) > 0
    ),
    lots AS (
      SELECT
        sb.item_id,
        COUNT(DISTINCT COALESCE(sl.lot_id::text, sl.lot_code, wl.lot_code))
          FILTER (
            WHERE COALESCE(sl.available_qty, 0) + COALESCE(sl.quarantine_qty, 0)
              + COALESCE(sl.rejected_qty, 0) + COALESCE(sl.in_production_qty, 0) > 0
          )::int AS lot_count,
        MIN(wl.manufactured_at) FILTER (
          WHERE COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0) > 0
        ) AS manufactured_min,
        MIN(COALESCE(wl.received_at, sl.received_at)) FILTER (
          WHERE COALESCE(sl.available_qty, 0) > 0
        ) AS received_min,
        MIN(COALESCE(wl.expiry_at, wl.best_before_at)) FILTER (
          WHERE COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0) > 0
        ) AS nearest_expiry,
        BOOL_OR(COALESCE(wl.is_blocked, FALSE)) AS any_blocked,
        NULLIF(
          string_agg(DISTINCT NULLIF(BTRIM(wl.qa_status_code), ''), ','),
          ''
        ) AS qa_statuses,
        (
          array_agg(NULLIF(BTRIM(COALESCE(wl.lot_code, sl.lot_code)), '') ORDER BY
            COALESCE(wl.expiry_at, wl.best_before_at, 'infinity'::timestamptz) ASC,
            COALESCE(wl.received_at, sl.received_at, wl.manufactured_at, 'infinity'::timestamptz) ASC
          ) FILTER (
            WHERE COALESCE(sl.available_qty, 0) > 0
              AND NULLIF(BTRIM(COALESCE(wl.lot_code, sl.lot_code)), '') IS NOT NULL
          )
        )[1] AS fefo_lot,
        (
          array_agg(
            NULLIF(BTRIM(COALESCE(wl.supplier_lot_code, wl.batch_label, sl.batch_label)), '')
            ORDER BY
              COALESCE(wl.expiry_at, wl.best_before_at, 'infinity'::timestamptz) ASC,
              COALESCE(wl.received_at, sl.received_at, 'infinity'::timestamptz) ASC
          ) FILTER (
            WHERE COALESCE(sl.available_qty, 0) > 0
              AND NULLIF(BTRIM(COALESCE(wl.supplier_lot_code, wl.batch_label, sl.batch_label)), '') IS NOT NULL
          )
        )[1] AS vendor_lot,
        (
          array_agg(l.location_code ORDER BY
            COALESCE(wl.expiry_at, wl.best_before_at, 'infinity'::timestamptz) ASC,
            COALESCE(wl.received_at, sl.received_at, wl.manufactured_at, 'infinity'::timestamptz) ASC
          ) FILTER (WHERE COALESCE(sl.available_qty, 0) > 0)
        )[1] AS fefo_location,
        COUNT(DISTINCT l.location_code) FILTER (
          WHERE COALESCE(sl.available_qty, 0) + COALESCE(sl.in_production_qty, 0) > 0
        )::int AS location_count
      FROM wms_stock_balances sb
      JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
      JOIN wms_stock_lots sl ON sl.balance_id = sb.balance_id
      LEFT JOIN wms_lots wl ON (
        (sl.lot_id IS NOT NULL AND wl.lot_id = sl.lot_id)
        OR (
          sl.lot_id IS NULL
          AND wl.site_id = sb.site_id
          AND wl.item_id = sb.item_id
          AND wl.lot_code = sl.lot_code
        )
      )
      WHERE sb.site_id = $1
      GROUP BY sb.item_id
    )
    SELECT
      i.item_code AS "itemCode",
      i.name AS "name",
      i.sku AS "sku",
      i.item_type_code AS "itemTypeCode",
      i.product_group AS "productGroup",
      i.item_group_code AS "itemGroupCode",
      i.material_type AS "materialType",
      i.item_class_code AS "itemClassCode",
      i.item_attrs_json AS "itemAttrs",
      i.uom_code AS "uomCode",
      COALESCE(i.is_marked, FALSE) AS "isMarked",
      COALESCE(i.is_perishable, FALSE) AS "isPerishable",
      i.rotation_policy AS "rotationPolicy",
      i.shelf_life_days AS "shelfLifeDays",
      i.expiry_warning_days AS "expiryWarningDays",
      COALESCE(s.available_qty, 0) AS "availableQty",
      COALESCE(s.reserved_qty, 0) AS "reservedQty",
      COALESCE(s.in_production_qty, 0) AS "inProductionQty",
      COALESCE(s.in_transit_qty, 0) AS "inTransitQty",
      COALESCE(s.quarantine_qty, 0) AS "quarantineQty",
      COALESCE(s.rejected_qty, 0) AS "rejectedQty",
      COALESCE(lt.lot_count, 0) AS "lotCount",
      lt.fefo_lot AS "lotCode",
      lt.vendor_lot AS "vendorLot",
      lt.manufactured_min AS "lotManufacturedAtMin",
      lt.received_min AS "stockEarliestReceivedAt",
      lt.nearest_expiry AS "nearestExpiryAt",
      lt.fefo_location AS "fefoLocationCode",
      COALESCE(lt.any_blocked, FALSE) AS "anyLotBlocked",
      lt.qa_statuses AS "lotQaStatuses",
      COALESCE(lt.location_count, 0) AS "locationCount"
    FROM wms_items i
    JOIN stock s ON s.item_id = i.item_id
    LEFT JOIN lots lt ON lt.item_id = i.item_id
    WHERE i.site_id = $1
      AND COALESCE(i.is_active, TRUE)
      AND (
        $2::text = ''
        OR i.name ILIKE $3
        OR i.item_code ILIKE $3
        OR COALESCE(i.sku, '') ILIKE $3
        OR COALESCE(i.nomenclature, '') ILIKE $3
        OR COALESCE(lt.fefo_lot, '') ILIKE $3
        OR COALESCE(lt.vendor_lot, '') ILIKE $3
      )
      AND (
        $4::text = ''
        OR COALESCE(i.item_type_code, '') = ANY(string_to_array($4, ','))
      )
      AND (
        NOT $5::boolean
        OR (
          $6::boolean IS TRUE
          AND NULLIF(TRIM(COALESCE(i.product_group, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(i.item_group_code, '')), '') IS NULL
        )
        OR (
          COALESCE(cardinality($7::text[]), 0) > 0
          AND COALESCE(i.item_group_code, COALESCE(i.product_group, '')) = ANY($7::text[])
        )
      )
    ORDER BY i.name, i.item_code
    `,
    [siteId, query, `%${query}%`, itemTypeCode, applyGroup, includeBare, productGroupNames]
  )

  const mapped = r.rows.map((row) => {
    const nearestExpiryAt = iso(row.nearestExpiryAt)
    const lotManufacturedAtMin = iso(row.lotManufacturedAtMin)
    const methods = computeMaterialsMethods({
      name: row.name,
      itemTypeCode: row.itemTypeCode,
      productGroup: row.productGroup,
      itemGroupCode: row.itemGroupCode,
      materialType: row.materialType,
      itemClassCode: row.itemClassCode,
      itemAttrs: row.itemAttrs,
      rotationPolicy: row.rotationPolicy,
      isPerishable: row.isPerishable,
      shelfLifeDays: row.shelfLifeDays == null ? null : Number(row.shelfLifeDays),
      nearestExpiryAt,
      lotManufacturedAtMin,
      rejectedQty: num(row.rejectedQty),
      quarantineQty: num(row.quarantineQty),
      anyLotBlocked: Boolean(row.anyLotBlocked),
      lotQaStatuses: row.lotQaStatuses,
      lotCode: row.lotCode,
      locationCode: row.fefoLocationCode,
    })
    return {
      itemCode: row.itemCode,
      name: row.name,
      sku: row.sku,
      itemTypeCode: row.itemTypeCode,
      productGroup: row.productGroup,
      itemGroupCode: row.itemGroupCode,
      materialType: row.materialType,
      itemClassCode: row.itemClassCode,
      itemAttrs: row.itemAttrs,
      uomCode: row.uomCode,
      isMarked: Boolean(row.isMarked),
      isPerishable: Boolean(row.isPerishable),
      rotationPolicy: methods.rotation,
      shelfLifeDays: row.shelfLifeDays == null ? null : Number(row.shelfLifeDays),
      expiryWarningDays: row.expiryWarningDays == null ? null : Number(row.expiryWarningDays),
      availableQty: num(row.availableQty),
      reservedQty: num(row.reservedQty),
      inProductionQty: num(row.inProductionQty),
      inTransitQty: num(row.inTransitQty),
      quarantineQty: num(row.quarantineQty),
      rejectedQty: num(row.rejectedQty),
      lotCount: num(row.lotCount),
      lotCode: row.lotCode,
      vendorLot: row.vendorLot,
      lotManufacturedAtMin,
      stockEarliestReceivedAt: iso(row.stockEarliestReceivedAt),
      nearestExpiryAt,
      fefoLocationCode: row.fefoLocationCode,
      anyLotBlocked: Boolean(row.anyLotBlocked),
      lotQaStatuses: row.lotQaStatuses,
      locationCount: num(row.locationCount),
      storageClass: methods.storageClass,
      family: methods.family,
      familyLabel: methods.familyLabel,
      qualityStatus: methods.qualityStatus,
      qualityLabel: methods.qualityLabel,
      urgency: methods.urgency,
      profile: methods.profile,
      issueHint: methods.issueHint,
      issuable: methods.issuable,
    }
  })

  const codes = mapped.map((row) => row.itemCode)
  const [lastMove, outbound] = await Promise.all([
    loadLastMovementDays(client, siteId, codes),
    loadOutboundUsage(client, siteId, codes, 90),
  ])

  return mapped.map((row) => {
    const usage = outbound.get(row.itemCode)
    const ops = computeWarehouseOps({
      availableQty: row.availableQty,
      inProductionQty: row.inProductionQty,
      locationCount: row.locationCount,
      daysSinceMove: lastMove.get(row.itemCode) ?? null,
      daysSinceOutbound: usage?.daysSince ?? null,
      outboundQty: usage?.qty ?? 0,
      receivedAt: row.stockEarliestReceivedAt,
      manufacturedAt: row.lotManufacturedAtMin,
      nearestExpiryAt: row.nearestExpiryAt,
      itemAttrs: row.itemAttrs,
      isPerishable: row.isPerishable,
    })
    const { itemAttrs: _ignored, ...rest } = row
    void _ignored
    return {
      ...rest,
      policyState: ops.policyState,
      policyLabel: ops.policyLabel,
      policyShort: formatPolicyShort(ops),
      policyInferred: ops.policyInferred,
      deadStock: ops.deadStock,
      agingDays: ops.agingDays,
      agingBand: ops.agingBand,
      obsolescence: ops.obsolescence,
      kanban: ops.kanban,
      twoBin: ops.twoBin,
      supermarket: ops.supermarket,
      opsHint: ops.hint,
    }
  })
}
