import type { PoolClient } from "pg";
import { createCalendarEvent } from "@/lib/wms/calendar-events";
import { WmsHttpError } from "@/lib/wms/errors";
import {
  normalizePlanCode,
  planCodeFromDate,
  reservedForPlan,
  type ProductionPlanExternalSource,
  type ProductionPlanLinkRow,
  type ProductionPlanLinkType,
  type ProductionPlanMaterialRow,
  type ProductionPlanRow,
  type ProductionPlanStatus,
} from "@/lib/wms/production-plan-meta";
import { canonicalWarehouseCode } from "@/lib/wms/warehouse-codes";

export type { ProductionPlanRow, ProductionPlanMaterialRow, ProductionPlanLinkRow } from "@/lib/wms/production-plan-meta";

const MATERIAL_WAREHOUSE_CODES = ["OS", "MAT", "СКЛАД-МАТЕРИАЛОВ"];
const PLAN_STATUSES = new Set<ProductionPlanStatus>([
  "draft",
  "checked",
  "reserved",
  "in_progress",
  "done",
  "cancelled",
]);

function normalizeDateKey(value: string, field: string): string {
  const key = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new WmsHttpError(400, `${field} must be YYYY-MM-DD`, "bad_request");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  ) {
    throw new WmsHttpError(400, `${field} is not a valid date`, "bad_request");
  }
  return key;
}

function validateDateRange(planDate: string, planDateTo: string | null): void {
  if (planDateTo && planDateTo < planDate) {
    throw new WmsHttpError(
      400,
      "дата окончания не может быть раньше даты начала",
      "invalid_date_range"
    );
  }
}

const PLAN_SELECT = `SELECT p.plan_id::text, p.plan_code, p.plan_date::text, p.plan_date_to::text,
  p.workshop_code, p.line_code, i.item_code, i.name AS item_name,
  i.nomenclature AS item_nomenclature, i.sku AS item_sku,
  i.packaging_format AS packaging_format, i.packaging_profile AS packaging_profile,
  p.planned_qty::float8, p.status_code, p.material_warehouse_code,
  p.external_source, p.external_id,
  p.actual_percent::float8, p.actual_qty::float8, p.actual_updated_at::text, p.actual_source,
  p.note,
  p.shortage_count::int, p.is_fully_covered, p.reserved_at::text,
  p.created_at::text, p.updated_at::text,
  vw.started_at::text AS vekas_started_at,
  vw.finished_at::text AS vekas_finished_at,
  vw.produced_qty::float8 AS vekas_produced_qty
 FROM wms_production_plans p
 JOIN wms_items i ON i.item_id = p.item_id AND i.site_id = p.site_id
 LEFT JOIN LATERAL (
   SELECT w.started_at, w.finished_at, w.produced_qty
   FROM wms_vekas_aps_watches w
   WHERE w.plan_id = p.plan_id
   ORDER BY CASE w.watch_state WHEN 'watching' THEN 0 ELSE 1 END, w.watch_id DESC
   LIMIT 1
 ) vw ON TRUE`;

function rowToDto(r: {
  plan_id: string;
  plan_code: string;
  plan_date: string;
  plan_date_to: string | null;
  workshop_code: string | null;
  line_code: string | null;
  item_code: string;
  item_name: string;
  item_nomenclature: string | null;
  item_sku: string | null;
  packaging_format: string | null;
  packaging_profile: string | null;
  planned_qty: number;
  status_code: string;
  material_warehouse_code: string;
  external_source: string;
  external_id: string | null;
  actual_percent: number;
  actual_qty: number | null;
  actual_updated_at: string | null;
  actual_source: string | null;
  note: string | null;
  shortage_count: number;
  is_fully_covered: boolean;
  reserved_at: string | null;
  created_at: string;
  updated_at: string;
  vekas_started_at?: string | null;
  vekas_finished_at?: string | null;
  vekas_produced_qty?: number | null;
}): ProductionPlanRow {
  return {
    planId: r.plan_id,
    code: r.plan_code,
    planDate: r.plan_date,
    planDateTo: r.plan_date_to,
    workshopCode: r.workshop_code,
    lineCode: r.line_code,
    itemCode: r.item_code,
    itemName: r.item_name,
    itemNomenclature: r.item_nomenclature,
    itemSku: r.item_sku,
    packagingFormat: r.packaging_format,
    packagingProfile: r.packaging_profile,
    plannedQty: r.planned_qty,
    status: r.status_code as ProductionPlanStatus,
    materialWarehouseCode: r.material_warehouse_code,
    externalSource: r.external_source as ProductionPlanExternalSource,
    externalId: r.external_id,
    actualPercent: r.actual_percent,
    actualQty: r.actual_qty,
    actualUpdatedAt: r.actual_updated_at,
    actualSource: r.actual_source,
    note: r.note,
    shortageCount: r.shortage_count,
    isFullyCovered: r.is_fully_covered,
    reservedAt: r.reserved_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.vekas_started_at ?? null,
    finishedAt: r.vekas_finished_at ?? null,
    vekasProducedQty: r.vekas_produced_qty ?? null,
  };
}

async function getItemId(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<number | null> {
  const r = await client.query<{ item_id: string }>(
    `SELECT item_id FROM wms_items
     WHERE site_id = $1 AND upper(item_code) = $2`,
    [siteId, itemCode.trim().toUpperCase()]
  );
  return r.rows[0] ? Number(r.rows[0].item_id) : null;
}

async function nextPlanCode(
  client: PoolClient,
  siteId: number,
  planDate: string
): Promise<string> {
  const r = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt FROM wms_production_plans
     WHERE site_id = $1 AND plan_date = $2::date`,
    [siteId, planDate]
  );
  const seq = Number(r.rows[0]?.cnt ?? "0") + 1;
  return planCodeFromDate(planDate, seq);
}

async function loadPlanMaterials(
  client: PoolClient,
  planId: number
): Promise<ProductionPlanMaterialRow[]> {
  const r = await client.query<{
    plan_material_id: string;
    item_code: string;
    item_name: string;
    qty_per: number;
    scrap_pct: number;
    required_qty: number;
    available_qty: number;
    reserved_qty: number;
    shortage_qty: number;
    uom_code: string;
    sort_order: number;
  }>(
    `SELECT pm.plan_material_id::text, i.item_code, i.name AS item_name,
       pm.qty_per::float8, pm.scrap_pct::float8,
       pm.required_qty::float8, pm.available_qty::float8,
       pm.reserved_qty::float8, pm.shortage_qty::float8,
       pm.uom_code, pm.sort_order
     FROM wms_production_plan_materials pm
     JOIN wms_items i ON i.item_id = pm.component_item_id
     WHERE pm.plan_id = $1
     ORDER BY pm.sort_order, i.item_code`,
    [planId]
  );
  return r.rows.map((row) => ({
    planMaterialId: row.plan_material_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    qtyPer: row.qty_per,
    scrapPct: row.scrap_pct,
    requiredQty: row.required_qty,
    availableQty: row.available_qty,
    reservedQty: row.reserved_qty,
    shortageQty: row.shortage_qty,
    uomCode: row.uom_code,
    sortOrder: row.sort_order,
  }));
}

async function getPlanIdByCode(
  client: PoolClient,
  siteId: number,
  planCode: string
): Promise<number | null> {
  const r = await client.query<{ plan_id: string }>(
    `SELECT plan_id FROM wms_production_plans
     WHERE site_id = $1 AND upper(plan_code) = $2`,
    [siteId, normalizePlanCode(planCode)]
  );
  return r.rows[0] ? Number(r.rows[0].plan_id) : null;
}

async function getNetAvailableQty(
  client: PoolClient,
  siteId: number,
  itemId: number,
  warehouseCode: string,
  excludePlanId?: number
): Promise<number> {
  const wh = canonicalWarehouseCode(warehouseCode);
  const codes =
    wh === "OS" ? MATERIAL_WAREHOUSE_CODES : [wh, canonicalWarehouseCode(wh)];

  const stock = await client.query<{ available: string }>(
    `SELECT COALESCE(SUM(sb.available_qty), 0)::text AS available
     FROM wms_stock_balances sb
     JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id AND w.site_id = l.site_id
     WHERE sb.site_id = $1 AND sb.item_id = $2
       AND upper(w.warehouse_code) = ANY($3::text[])`,
    [siteId, itemId, codes.map((c) => c.toUpperCase())]
  );
  const onHand = Number(stock.rows[0]?.available ?? "0");

  const reserved = await client.query<{ qty: string }>(
    `SELECT COALESCE(SUM(r.reserved_qty), 0)::text AS qty
     FROM wms_reservations r
     WHERE r.site_id = $1 AND r.item_id = $2 AND r.is_active
       AND r.reserved_for LIKE 'aps:plan:%'
       AND ($3::bigint IS NULL OR r.reserved_for <> $4)`,
    [siteId, itemId, excludePlanId ?? null, excludePlanId ? reservedForPlan(excludePlanId) : null]
  );
  const reservedOther = Number(reserved.rows[0]?.qty ?? "0");

  return Math.max(0, onHand - reservedOther);
}

export async function refreshPlanMaterials(
  client: PoolClient,
  siteId: number,
  planId: number
): Promise<ProductionPlanMaterialRow[]> {
  const plan = await client.query<{
    item_id: string;
    planned_qty: string;
    material_warehouse_code: string;
    status_code: string;
  }>(
    `SELECT item_id::text, planned_qty::text, material_warehouse_code, status_code
     FROM wms_production_plans
     WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId]
  );
  const row = plan.rows[0];
  if (!row) throw new WmsHttpError(404, "plan not found", "not_found");

  if (row.status_code === "reserved") {
    throw new WmsHttpError(409, "нельзя пересчитать материалы у зарезервированного плана", "plan_reserved");
  }

  const plannedQty = Number(row.planned_qty);
  const itemId = Number(row.item_id);
  const wh = row.material_warehouse_code;

  const components = await client.query<{
    spec_component_id: string;
    component_item_id: string;
    qty_per: string;
    scrap_pct: string;
    uom_code: string;
    sort_order: number;
  }>(
    `WITH active_spec AS (
       SELECT spec_id FROM wms_item_specs
       WHERE site_id = $1 AND parent_item_id = $2::bigint AND is_active
       ORDER BY version_no DESC
       LIMIT 1
     )
     SELECT sc.spec_component_id::text, sc.component_item_id::text,
       sc.qty_per::text, sc.scrap_pct::text, sc.uom_code, sc.sort_order
     FROM active_spec s
     JOIN wms_item_spec_components sc ON sc.spec_id = s.spec_id
     ORDER BY sc.sort_order, sc.component_item_id`,
    [siteId, itemId]
  );

  if (components.rows.length === 0) {
    throw new WmsHttpError(
      400,
      "у номенклатуры нет активной спецификации (BOM)",
      "no_active_spec"
    );
  }

  await client.query(`DELETE FROM wms_production_plan_materials WHERE plan_id = $1`, [planId]);

  let shortageCount = 0;
  const materials: ProductionPlanMaterialRow[] = [];

  for (const comp of components.rows) {
    const componentItemId = Number(comp.component_item_id);
    const qtyPer = Number(comp.qty_per);
    const scrapPct = Number(comp.scrap_pct);
    const requiredQty = plannedQty * qtyPer * (1 + scrapPct / 100);
    const availableQty = await getNetAvailableQty(client, siteId, componentItemId, wh, planId);
    const shortageQty = Math.max(0, requiredQty - availableQty);
    if (shortageQty > 1e-6) shortageCount += 1;

    const ins = await client.query<{ plan_material_id: string; item_code: string; item_name: string }>(
      `INSERT INTO wms_production_plan_materials
         (plan_id, component_item_id, spec_component_id, qty_per, scrap_pct,
          required_qty, available_qty, reserved_qty, shortage_qty, uom_code, sort_order)
       VALUES ($1, $2, $3::bigint, $4, $5, $6, $7, 0, $8, $9, $10)
       RETURNING plan_material_id::text,
         (SELECT item_code FROM wms_items WHERE item_id = $2) AS item_code,
         (SELECT name FROM wms_items WHERE item_id = $2) AS item_name`,
      [
        planId,
        componentItemId,
        comp.spec_component_id,
        qtyPer,
        scrapPct,
        requiredQty,
        availableQty,
        shortageQty,
        comp.uom_code,
        comp.sort_order,
      ]
    );
    const insRow = ins.rows[0];
    materials.push({
      planMaterialId: insRow.plan_material_id,
      itemCode: insRow.item_code,
      itemName: insRow.item_name,
      qtyPer,
      scrapPct,
      requiredQty,
      availableQty,
      reservedQty: 0,
      shortageQty,
      uomCode: comp.uom_code,
      sortOrder: comp.sort_order,
    });
  }

  const isFullyCovered = shortageCount === 0;
  const status: ProductionPlanStatus = isFullyCovered ? "checked" : "draft";

  await client.query(
    `UPDATE wms_production_plans
     SET shortage_count = $3, is_fully_covered = $4,
         status_code = CASE WHEN status_code IN ('done', 'cancelled', 'in_progress') THEN status_code ELSE $5 END,
         updated_at = now()
     WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId, shortageCount, isFullyCovered, status]
  );

  return materials;
}

async function syncPlanCalendarEvent(
  client: PoolClient,
  siteId: number,
  plan: ProductionPlanRow
): Promise<void> {
  const startAt = `${plan.planDate}T08:00:00+03:00`;
  const endDate = plan.planDateTo ?? plan.planDate;
  const endAt = `${endDate}T20:00:00+03:00`;
  const severity = plan.isFullyCovered ? "info" : "critical";
  const title = plan.isFullyCovered
    ? `Выпуск: ${plan.itemName} — ${plan.plannedQty}`
    : `Дефицит материалов: ${plan.itemName} (${plan.shortageCount})`;
  const refs = { planCode: plan.code, planId: plan.planId };
  const existing = await client.query<{ event_id: string }>(
    `SELECT event_id::text
     FROM wms_calendar_events
     WHERE site_id = $1
       AND type_code = 'production_plan'
       AND (refs->>'planId' = $2 OR upper(refs->>'planCode') = $3)
       AND deleted_at IS NULL
     ORDER BY updated_at DESC, event_id DESC`,
    [siteId, plan.planId, normalizePlanCode(plan.code)]
  );
  const keeperId = existing.rows[0]?.event_id;

  if (keeperId) {
    await client.query(
      `UPDATE wms_calendar_events
       SET title = $3,
           description = NULLIF($4::text, ''),
           start_at = $5::timestamptz,
           end_at = $6::timestamptz,
           all_day = TRUE,
           status_code = $7,
           severity_code = $8,
           tags = $9::text[],
           refs = $10::jsonb,
           updated_at = now()
       WHERE site_id = $1 AND event_id = $2::bigint`,
      [
        siteId,
        keeperId,
        title,
        plan.note ?? "",
        startAt,
        endAt,
        plan.status,
        severity,
        ["aps", "production"],
        JSON.stringify(refs),
      ]
    );
    if (existing.rows.length > 1) {
      await client.query(
        `UPDATE wms_calendar_events
         SET deleted_at = now(), updated_at = now()
         WHERE site_id = $1
           AND event_id = ANY($2::bigint[])
           AND deleted_at IS NULL`,
        [siteId, existing.rows.slice(1).map((row) => row.event_id)]
      );
    }
    return;
  }

  await createCalendarEvent(client, siteId, {
    typeCode: "production_plan",
    title,
    description: plan.note ?? undefined,
    startAt,
    endAt,
    allDay: true,
    statusCode: plan.status,
    severityCode: severity,
    tags: ["aps", "production"],
    refs,
  });
}

export async function listProductionPlans(
  client: PoolClient,
  siteId: number,
  opts?: { from?: string; to?: string; status?: string; includeMaterials?: boolean }
): Promise<ProductionPlanRow[]> {
  const from = opts?.from?.trim() || null;
  const to = opts?.to?.trim() || null;
  const status = opts?.status?.trim() || null;

  const r = await client.query<{
    plan_id: string;
    plan_code: string;
    plan_date: string;
    plan_date_to: string | null;
    workshop_code: string | null;
    line_code: string | null;
    item_code: string;
    item_name: string;
    planned_qty: number;
    status_code: string;
    material_warehouse_code: string;
    external_source: string;
    external_id: string | null;
    note: string | null;
    shortage_count: number;
    is_fully_covered: boolean;
    reserved_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `${PLAN_SELECT}
     WHERE p.site_id = $1
       AND ($2::date IS NULL OR p.plan_date >= $2::date OR COALESCE(p.plan_date_to, p.plan_date) >= $2::date)
       AND ($3::date IS NULL OR p.plan_date <= $3::date)
       AND ($4::text IS NULL OR p.status_code = $4)
     ORDER BY p.plan_date DESC, p.plan_code DESC`,
    [siteId, from, to, status]
  );

  const plans = r.rows.map(rowToDto);
  if (opts?.includeMaterials) {
    for (const plan of plans) {
      plan.materials = await loadPlanMaterials(client, Number(plan.planId));
    }
  }
  return plans;
}

export async function getProductionPlan(
  client: PoolClient,
  siteId: number,
  planCode: string,
  opts?: { includeMaterials?: boolean }
): Promise<ProductionPlanRow | null> {
  const r = await client.query<{
    plan_id: string;
    plan_code: string;
    plan_date: string;
    plan_date_to: string | null;
    workshop_code: string | null;
    line_code: string | null;
    item_code: string;
    item_name: string;
    planned_qty: number;
    status_code: string;
    material_warehouse_code: string;
    external_source: string;
    external_id: string | null;
    note: string | null;
    shortage_count: number;
    is_fully_covered: boolean;
    reserved_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `${PLAN_SELECT}
     WHERE p.site_id = $1 AND upper(p.plan_code) = $2`,
    [siteId, normalizePlanCode(planCode)]
  );
  const row = r.rows[0];
  if (!row) return null;
  const plan = rowToDto(row);
  if (opts?.includeMaterials !== false) {
    plan.materials = await loadPlanMaterials(client, Number(plan.planId));
  }
  return plan;
}

type CreatePlanInput = {
  code?: string;
  planDate: string;
  planDateTo?: string | null;
  itemCode: string;
  plannedQty: number;
  workshopCode?: string | null;
  lineCode?: string | null;
  materialWarehouseCode?: string;
  note?: string | null;
  externalSource?: ProductionPlanExternalSource;
  externalId?: string | null;
  syncCalendar?: boolean;
  /** Партии Векас: план ставим сразу, BOM может появиться позже. */
  skipMaterials?: boolean;
};

export async function createProductionPlan(
  client: PoolClient,
  siteId: number,
  input: CreatePlanInput
): Promise<ProductionPlanRow> {
  const planDate = normalizeDateKey(input.planDate, "planDate");
  const planDateTo = input.planDateTo?.trim()
    ? normalizeDateKey(input.planDateTo, "planDateTo")
    : null;
  validateDateRange(planDate, planDateTo);
  const itemId = await getItemId(client, siteId, input.itemCode);
  if (itemId == null) throw new WmsHttpError(404, "item not found", "item_not_found");

  const plannedQty = Number(input.plannedQty);
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
    throw new WmsHttpError(400, "plannedQty must be > 0", "bad_request");
  }

  const code =
    input.code?.trim()
      ? normalizePlanCode(input.code)
      : await nextPlanCode(client, siteId, planDate);

  const wh = canonicalWarehouseCode(input.materialWarehouseCode?.trim() || "OS") || "OS";

  const ins = await client.query<{ plan_id: string }>(
    `INSERT INTO wms_production_plans
       (site_id, plan_code, plan_date, plan_date_to, workshop_code, line_code,
        item_id, planned_qty, material_warehouse_code, external_source, external_id, note)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING plan_id::text`,
    [
      siteId,
      code,
      planDate,
      planDateTo,
      input.workshopCode?.trim() || null,
      input.lineCode?.trim() || null,
      itemId,
      plannedQty,
      wh,
      input.externalSource ?? "manual",
      input.externalId?.trim() || null,
      input.note?.trim() || null,
    ]
  );
  const planId = Number(ins.rows[0]?.plan_id);
  if (!input.skipMaterials) {
    await refreshPlanMaterials(client, siteId, planId);
  }

  const plan = await getProductionPlan(client, siteId, code, { includeMaterials: !input.skipMaterials });
  if (!plan) throw new WmsHttpError(500, "plan missing after create", "internal_error");

  if (input.syncCalendar) {
    try {
      await syncPlanCalendarEvent(client, siteId, plan);
    } catch (e) {
      console.warn("[createProductionPlan] calendar sync failed", e);
    }
  }
  return plan;
}

export async function updateProductionPlan(
  client: PoolClient,
  siteId: number,
  planCode: string,
  patch: Partial<{
    planDate: string;
    planDateTo: string | null;
    itemCode: string;
    plannedQty: number;
    workshopCode: string | null;
    lineCode: string | null;
    materialWarehouseCode: string;
    note: string | null;
    status: ProductionPlanStatus;
    syncCalendar: boolean;
  }>
): Promise<ProductionPlanRow> {
  const planId = await getPlanIdByCode(client, siteId, planCode);
  if (planId == null) throw new WmsHttpError(404, "plan not found", "not_found");

  const cur = await client.query<{
    status_code: string;
    plan_date: string;
    plan_date_to: string | null;
  }>(
    `SELECT status_code, plan_date::text, plan_date_to::text
     FROM wms_production_plans WHERE plan_id = $1`,
    [planId]
  );
  if (cur.rows[0]?.status_code === "reserved") {
    throw new WmsHttpError(409, "нельзя редактировать зарезервированный план", "plan_reserved");
  }

  const current = cur.rows[0]!;
  const planDate =
    patch.planDate !== undefined ? normalizeDateKey(patch.planDate, "planDate") : current.plan_date;
  const planDateTo =
    patch.planDateTo === undefined
      ? current.plan_date_to
      : patch.planDateTo?.trim()
        ? normalizeDateKey(patch.planDateTo, "planDateTo")
        : null;
  validateDateRange(planDate, planDateTo);

  if (patch.plannedQty !== undefined) {
    const qty = Number(patch.plannedQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new WmsHttpError(400, "plannedQty must be > 0", "bad_request");
    }
  }
  if (patch.status !== undefined && !PLAN_STATUSES.has(patch.status)) {
    throw new WmsHttpError(400, "invalid plan status", "bad_status");
  }

  let itemId: number | null = null;
  if (patch.itemCode?.trim()) {
    itemId = await getItemId(client, siteId, patch.itemCode);
    if (itemId == null) throw new WmsHttpError(404, "item not found", "item_not_found");
  }

  await client.query(
    `UPDATE wms_production_plans
     SET plan_date = $3::date,
         plan_date_to = CASE WHEN $12 THEN $4::date ELSE plan_date_to END,
         workshop_code = CASE WHEN $13 THEN $5 ELSE workshop_code END,
         line_code = CASE WHEN $14 THEN $6 ELSE line_code END,
         item_id = COALESCE($7::bigint, item_id),
         planned_qty = COALESCE($8, planned_qty),
         material_warehouse_code = COALESCE($9, material_warehouse_code),
         note = CASE WHEN $15 THEN $10 ELSE note END,
         status_code = COALESCE($11, status_code),
         updated_at = now()
     WHERE site_id = $1 AND plan_id = $2`,
    [
      siteId,
      planId,
      planDate,
      planDateTo,
      patch.workshopCode !== undefined ? patch.workshopCode : null,
      patch.lineCode !== undefined ? patch.lineCode : null,
      itemId,
      patch.plannedQty ?? null,
      patch.materialWarehouseCode ? canonicalWarehouseCode(patch.materialWarehouseCode) : null,
      patch.note !== undefined ? patch.note : null,
      patch.status ?? null,
      patch.planDateTo !== undefined,
      patch.workshopCode !== undefined,
      patch.lineCode !== undefined,
      patch.note !== undefined,
    ]
  );

  const needsRefresh =
    patch.itemCode != null || patch.plannedQty != null || patch.materialWarehouseCode != null;
  if (needsRefresh) {
    await refreshPlanMaterials(client, siteId, planId);
  }

  const plan = await getProductionPlan(client, siteId, planCode, { includeMaterials: true });
  if (!plan) throw new WmsHttpError(500, "plan missing after update", "internal_error");

  if (patch.syncCalendar) {
    try {
      await syncPlanCalendarEvent(client, siteId, plan);
    } catch (e) {
      console.warn("[updateProductionPlan] calendar sync failed", e);
    }
  }
  return plan;
}

export async function updateProductionPlanProgress(
  client: PoolClient,
  siteId: number,
  input: {
    planCode: string;
    percent: number;
    doneQty?: number | null;
    source?: string | null;
  }
): Promise<ProductionPlanRow> {
  const planId = await getPlanIdByCode(client, siteId, input.planCode);
  if (planId == null) throw new WmsHttpError(404, "plan not found", "not_found");

  const percent = Number(input.percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new WmsHttpError(400, "percent must be between 0 and 100", "bad_request");
  }

  let doneQty: number | null = null;
  if (input.doneQty !== undefined && input.doneQty !== null) {
    doneQty = Number(input.doneQty);
    if (!Number.isFinite(doneQty) || doneQty < 0) {
      throw new WmsHttpError(400, "doneQty must be >= 0", "bad_request");
    }
  }

  await client.query(
    `UPDATE wms_production_plans
     SET actual_percent = $3,
         actual_qty = CASE WHEN $4::boolean THEN $5::numeric ELSE actual_qty END,
         actual_source = NULLIF($6::text, ''),
         actual_updated_at = now(),
         status_code = CASE
           WHEN status_code = 'cancelled' THEN status_code
           WHEN $3::numeric >= 100 THEN 'done'
           WHEN $3::numeric > 0 THEN 'in_progress'
           ELSE status_code
         END,
         updated_at = now()
     WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId, percent, input.doneQty !== undefined, doneQty, input.source?.trim() || null]
  );

  const plan = await getProductionPlan(client, siteId, input.planCode, { includeMaterials: true });
  if (!plan) throw new WmsHttpError(500, "plan missing after progress update", "internal_error");
  return plan;
}

export async function deleteProductionPlan(
  client: PoolClient,
  siteId: number,
  planCode: string
): Promise<void> {
  const planId = await getPlanIdByCode(client, siteId, planCode);
  if (planId == null) throw new WmsHttpError(404, "plan not found", "not_found");

  const cur = await client.query<{ status_code: string }>(
    `SELECT status_code FROM wms_production_plans WHERE plan_id = $1`,
    [planId]
  );
  if (cur.rows[0]?.status_code === "reserved") {
    throw new WmsHttpError(409, "сначала снимите резерв", "plan_reserved");
  }

  await client.query(
    `UPDATE wms_calendar_events
     SET deleted_at = now(), updated_at = now()
     WHERE site_id = $1
       AND type_code = 'production_plan'
       AND (refs->>'planId' = $2 OR upper(refs->>'planCode') = $3)
       AND deleted_at IS NULL`,
    [siteId, String(planId), normalizePlanCode(planCode)]
  );
  await client.query(
    `DELETE FROM wms_production_plans WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId]
  );
}

async function allocateFromBalances(
  client: PoolClient,
  siteId: number,
  itemId: number,
  warehouseCode: string,
  qty: number
): Promise<Array<{ locationId: number; qty: number }>> {
  const wh = canonicalWarehouseCode(warehouseCode);
  const codes =
    wh === "OS" ? MATERIAL_WAREHOUSE_CODES : [wh, canonicalWarehouseCode(wh)];

  const rows = await client.query<{ location_id: string; available: string }>(
    `SELECT sb.location_id::text, sb.available_qty::text AS available
     FROM wms_stock_balances sb
     JOIN wms_locations l ON l.location_id = sb.location_id AND l.site_id = sb.site_id
     JOIN wms_warehouses w ON w.warehouse_id = l.warehouse_id AND w.site_id = l.site_id
     WHERE sb.site_id = $1 AND sb.item_id = $2
       AND upper(w.warehouse_code) = ANY($3::text[])
       AND sb.available_qty > 0
     ORDER BY sb.available_qty DESC, sb.balance_id ASC`,
    [siteId, itemId, codes.map((c) => c.toUpperCase())]
  );

  let remaining = qty;
  const out: Array<{ locationId: number; qty: number }> = [];
  for (const row of rows.rows) {
    if (remaining <= 1e-9) break;
    const available = Number(row.available);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    out.push({ locationId: Number(row.location_id), qty: take });
    remaining -= take;
  }
  if (remaining > 1e-6) {
    throw new WmsHttpError(409, "недостаточно остатков для резерва", "insufficient_stock");
  }
  return out;
}

export async function reserveProductionPlan(
  client: PoolClient,
  siteId: number,
  planCode: string
): Promise<ProductionPlanRow> {
  const planId = await getPlanIdByCode(client, siteId, planCode);
  if (planId == null) throw new WmsHttpError(404, "plan not found", "not_found");

  const planRow = await client.query<{
    status_code: string;
    material_warehouse_code: string;
  }>(
    `SELECT status_code, material_warehouse_code FROM wms_production_plans WHERE plan_id = $1`,
    [planId]
  );
  const status = planRow.rows[0]?.status_code;
  if (status === "reserved") {
    throw new WmsHttpError(409, "план уже зарезервирован", "already_reserved");
  }
  if (status === "cancelled" || status === "done") {
    throw new WmsHttpError(409, "нельзя резервировать этот статус", "bad_status");
  }

  await refreshPlanMaterials(client, siteId, planId);
  const materials = await loadPlanMaterials(client, planId);
  const shortages = materials.filter((m) => m.shortageQty > 1e-6);
  if (shortages.length > 0) {
    throw new WmsHttpError(
      409,
      `не хватает материалов: ${shortages.length} поз.`,
      "material_shortage",
      { shortages: shortages.map((s) => ({ itemCode: s.itemCode, shortageQty: s.shortageQty })) }
    );
  }

  const reservedFor = reservedForPlan(planId);

  for (const mat of materials) {
    const comp = await client.query<{ component_item_id: string }>(
      `SELECT component_item_id::text FROM wms_production_plan_materials
       WHERE plan_material_id = $1::bigint`,
      [mat.planMaterialId]
    );
    const itemId = Number(comp.rows[0]?.component_item_id);
    const allocations = await allocateFromBalances(
      client,
      siteId,
      itemId,
      planRow.rows[0]?.material_warehouse_code ?? "OS",
      mat.requiredQty
    );

    let reservedTotal = 0;
    for (const alloc of allocations) {
      await client.query(
        `UPDATE wms_stock_balances
         SET available_qty = available_qty - $1,
             reserved_qty = reserved_qty + $1,
             updated_at = now()
         WHERE site_id = $2 AND location_id = $3 AND item_id = $4
           AND available_qty >= $1`,
        [alloc.qty, siteId, alloc.locationId, itemId]
      );

      await client.query(
        `INSERT INTO wms_reservations
           (site_id, item_id, location_id, reserved_for, reserved_qty, is_active)
         VALUES ($1, $2, $3, $4, $5, true)`,
        [siteId, itemId, alloc.locationId, reservedFor, alloc.qty]
      );
      reservedTotal += alloc.qty;
    }

    await client.query(
      `UPDATE wms_production_plan_materials
       SET reserved_qty = $2, updated_at = now()
       WHERE plan_material_id = $1::bigint`,
      [mat.planMaterialId, reservedTotal]
    );
  }

  await client.query(
    `UPDATE wms_production_plans
     SET status_code = 'reserved', reserved_at = now(), updated_at = now()
     WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId]
  );

  const plan = await getProductionPlan(client, siteId, planCode, { includeMaterials: true });
  if (!plan) throw new WmsHttpError(500, "plan missing after reserve", "internal_error");
  return plan;
}

export async function releaseProductionPlan(
  client: PoolClient,
  siteId: number,
  planCode: string
): Promise<ProductionPlanRow> {
  const planId = await getPlanIdByCode(client, siteId, planCode);
  if (planId == null) throw new WmsHttpError(404, "plan not found", "not_found");

  const statusR = await client.query<{ status_code: string }>(
    `SELECT status_code FROM wms_production_plans WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId]
  );
  const status = statusR.rows[0]?.status_code ?? "";
  if (status === "in_progress") {
    throw new WmsHttpError(
      409,
      "План в производстве — резерв нельзя снять до списания по партии",
      "plan_in_production"
    );
  }
  if (status === "done") {
    throw new WmsHttpError(409, "План уже выполнен", "plan_done");
  }

  const reservedFor = reservedForPlan(planId);
  const reservations = await client.query<{
    reservation_id: string;
    item_id: string;
    location_id: string;
    reserved_qty: string;
  }>(
    `SELECT reservation_id::text, item_id::text, location_id::text, reserved_qty::text
     FROM wms_reservations
     WHERE site_id = $1 AND reserved_for = $2 AND is_active`,
    [siteId, reservedFor]
  );

  for (const r of reservations.rows) {
    const qty = Number(r.reserved_qty);
    await client.query(
      `UPDATE wms_stock_balances
       SET available_qty = available_qty + $1,
           reserved_qty = GREATEST(reserved_qty - $1, 0),
           updated_at = now()
       WHERE site_id = $2 AND location_id = $3::bigint AND item_id = $4::bigint`,
      [qty, siteId, r.location_id, r.item_id]
    );
  }

  await client.query(
    `UPDATE wms_reservations
     SET is_active = false, updated_at = now()
     WHERE site_id = $1 AND reserved_for = $2 AND is_active`,
    [siteId, reservedFor]
  );

  await client.query(
    `UPDATE wms_production_plan_materials
     SET reserved_qty = 0, updated_at = now()
     WHERE plan_id = $1`,
    [planId]
  );

  await client.query(
    `UPDATE wms_production_plans
     SET status_code = 'checked', reserved_at = NULL, updated_at = now()
     WHERE site_id = $1 AND plan_id = $2`,
    [siteId, planId]
  );

  await refreshPlanMaterials(client, siteId, planId);

  const plan = await getProductionPlan(client, siteId, planCode, { includeMaterials: true });
  if (!plan) throw new WmsHttpError(500, "plan missing after release", "internal_error");
  return plan;
}

type UpsertExternalInput = {
  externalId: string;
  planDate: string;
  planDateTo?: string | null;
  itemCode: string;
  plannedQty: number;
  workshopCode?: string | null;
  lineCode?: string | null;
  note?: string | null;
  code?: string;
};

export async function upsertExternalProductionPlan(
  client: PoolClient,
  siteId: number,
  input: UpsertExternalInput
): Promise<ProductionPlanRow> {
  const externalId = input.externalId.trim();
  if (!externalId) throw new WmsHttpError(400, "externalId is required", "bad_request");

  const existing = await client.query<{ plan_code: string; status_code: string }>(
    `SELECT plan_code, status_code FROM wms_production_plans
     WHERE site_id = $1 AND external_source = '1c' AND external_id = $2`,
    [siteId, externalId]
  );

  if (existing.rows[0]) {
    if (existing.rows[0].status_code === "reserved") {
      throw new WmsHttpError(409, "зарезервированный план из 1С нельзя менять", "plan_reserved");
    }
    return updateProductionPlan(client, siteId, existing.rows[0].plan_code, {
      planDate: input.planDate,
      planDateTo: input.planDateTo ?? null,
      itemCode: input.itemCode,
      plannedQty: input.plannedQty,
      workshopCode: input.workshopCode ?? null,
      lineCode: input.lineCode ?? null,
      note: input.note ?? null,
    });
  }

  return createProductionPlan(client, siteId, {
    ...input,
    externalSource: "1c",
    externalId,
    code: input.code,
  });
}

export async function upsertImportedProductionPlan(
  client: PoolClient,
  siteId: number,
  input: UpsertExternalInput
): Promise<{ plan: ProductionPlanRow; created: boolean }> {
  const externalId = input.externalId.trim();
  if (!externalId) throw new WmsHttpError(400, "externalId is required", "bad_request");

  const existing = await client.query<{ plan_code: string; status_code: string }>(
    `SELECT plan_code, status_code FROM wms_production_plans
     WHERE site_id = $1 AND external_source = 'import' AND external_id = $2`,
    [siteId, externalId]
  );

  if (existing.rows[0]) {
    if (existing.rows[0].status_code === "reserved") {
      throw new WmsHttpError(409, "зарезервированный импортированный план нельзя менять", "plan_reserved");
    }
    const plan = await updateProductionPlan(client, siteId, existing.rows[0].plan_code, {
      planDate: input.planDate,
      planDateTo: input.planDateTo ?? null,
      itemCode: input.itemCode,
      plannedQty: input.plannedQty,
      workshopCode: input.workshopCode ?? null,
      lineCode: input.lineCode ?? null,
      note: input.note ?? null,
    });
    return { plan, created: false };
  }

  const plan = await createProductionPlan(client, siteId, {
    ...input,
    externalSource: "import",
    externalId,
    code: input.code,
  });
  return { plan, created: true };
}

export type SkitPlanImportInput = {
  externalId: string;
  planDate: string;
  planDateTo?: string | null;
  productLabel: string;
  lineCode?: string | null;
  plannedQty: number;
  workshopCode?: string | null;
  note?: string | null;
};

export async function batchImportSkitProductionPlans(
  client: PoolClient,
  siteId: number,
  rows: SkitPlanImportInput[],
  itemMapping: Record<string, string>
): Promise<
  Array<{
    externalId: string;
    productLabel: string;
    planDate: string;
    status: "created" | "updated" | "skipped" | "error";
    planCode?: string;
    error?: string;
  }>
> {
  const results: Array<{
    externalId: string;
    productLabel: string;
    planDate: string;
    status: "created" | "updated" | "skipped" | "error";
    planCode?: string;
    error?: string;
  }> = [];

  for (const row of rows) {
    const externalId = row.externalId.trim();
    const productLabel = row.productLabel.trim();
    const planDate = row.planDate.trim();
    const itemCode = itemMapping[productLabel]?.trim();
    const plannedQty = Number(row.plannedQty);

    if (!externalId || !productLabel || !planDate) {
      results.push({
        externalId: externalId || row.externalId,
        productLabel,
        planDate,
        status: "error",
        error: "неполные данные строки",
      });
      continue;
    }
    if (!itemCode) {
      results.push({
        externalId,
        productLabel,
        planDate,
        status: "skipped",
        error: "номенклатура не сопоставлена",
      });
      continue;
    }
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      results.push({
        externalId,
        productLabel,
        planDate,
        status: "skipped",
        error: "количество ≤ 0",
      });
      continue;
    }

    try {
      const { plan, created } = await upsertImportedProductionPlan(client, siteId, {
        externalId,
        planDate,
        planDateTo: row.planDateTo ?? null,
        itemCode,
        plannedQty,
        workshopCode: row.workshopCode ?? null,
        lineCode: row.lineCode ?? null,
        note: row.note ?? `СКИТ: ${productLabel}`,
      });
      results.push({
        externalId,
        productLabel,
        planDate,
        status: created ? "created" : "updated",
        planCode: plan.code,
      });
    } catch (e) {
      const message = e instanceof WmsHttpError ? e.message : e instanceof Error ? e.message : "ошибка импорта";
      results.push({
        externalId,
        productLabel,
        planDate,
        status: "error",
        error: message,
      });
    }
  }

  return results;
}

const LINK_TYPES = new Set<ProductionPlanLinkType>(["s2s", "s2e", "e2s", "e2e"]);

function normalizeLinkType(raw: string): ProductionPlanLinkType {
  const t = raw.trim() as ProductionPlanLinkType;
  if (!LINK_TYPES.has(t)) throw new WmsHttpError(400, "invalid link type", "invalid_link_type");
  return t;
}

export async function listProductionPlanLinks(
  client: PoolClient,
  siteId: number,
  opts?: { from?: string; to?: string }
): Promise<ProductionPlanLinkRow[]> {
  const from = opts?.from?.trim() || null;
  const to = opts?.to?.trim() || null;

  const r = await client.query<{
    link_id: string;
    source_plan_id: string;
    target_plan_id: string;
    link_type: string;
    lag_days: number;
  }>(
    `SELECT l.link_id::text, l.source_plan_id::text, l.target_plan_id::text,
            l.link_type, l.lag_days::int
     FROM wms_production_plan_links l
     JOIN wms_production_plans sp ON sp.plan_id = l.source_plan_id AND sp.site_id = l.site_id
     JOIN wms_production_plans tp ON tp.plan_id = l.target_plan_id AND tp.site_id = l.site_id
     WHERE l.site_id = $1
       AND ($2::date IS NULL OR sp.plan_date >= $2::date OR COALESCE(sp.plan_date_to, sp.plan_date) >= $2::date)
       AND ($3::date IS NULL OR sp.plan_date <= $3::date)
       AND ($2::date IS NULL OR tp.plan_date >= $2::date OR COALESCE(tp.plan_date_to, tp.plan_date) >= $2::date)
       AND ($3::date IS NULL OR tp.plan_date <= $3::date)
     ORDER BY l.link_id`,
    [siteId, from, to]
  );

  return r.rows.map((row) => ({
    linkId: row.link_id,
    sourcePlanId: row.source_plan_id,
    targetPlanId: row.target_plan_id,
    type: normalizeLinkType(row.link_type),
    lagDays: row.lag_days,
  }));
}

async function assertPlanEditable(client: PoolClient, planId: number): Promise<void> {
  const r = await client.query<{ status_code: string }>(
    `SELECT status_code FROM wms_production_plans WHERE plan_id = $1`,
    [planId]
  );
  if (!r.rows[0]) throw new WmsHttpError(404, "plan not found", "not_found");
  if (r.rows[0].status_code === "reserved") {
    throw new WmsHttpError(409, "нельзя редактировать зарезервированный план", "plan_reserved");
  }
}

export async function createProductionPlanLink(
  client: PoolClient,
  siteId: number,
  input: {
    sourcePlanId: string;
    targetPlanId: string;
    type?: ProductionPlanLinkType;
    lagDays?: number;
  }
): Promise<ProductionPlanLinkRow> {
  const sourcePlanId = Number(input.sourcePlanId);
  const targetPlanId = Number(input.targetPlanId);
  if (!Number.isFinite(sourcePlanId) || !Number.isFinite(targetPlanId)) {
    throw new WmsHttpError(400, "invalid plan id", "invalid_plan_id");
  }
  if (sourcePlanId === targetPlanId) {
    throw new WmsHttpError(400, "source and target must differ", "invalid_link");
  }

  await assertPlanEditable(client, sourcePlanId);
  await assertPlanEditable(client, targetPlanId);

  const type = normalizeLinkType(input.type ?? "e2s");
  const lagDays = Number.isFinite(input.lagDays) ? Math.trunc(input.lagDays!) : 0;

  const ins = await client.query<{ link_id: string }>(
    `INSERT INTO wms_production_plan_links
       (site_id, source_plan_id, target_plan_id, link_type, lag_days)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING link_id::text`,
    [siteId, sourcePlanId, targetPlanId, type, lagDays]
  );

  return {
    linkId: ins.rows[0]!.link_id,
    sourcePlanId: String(sourcePlanId),
    targetPlanId: String(targetPlanId),
    type,
    lagDays,
  };
}

export async function updateProductionPlanLink(
  client: PoolClient,
  siteId: number,
  linkId: string,
  patch: Partial<{ type: ProductionPlanLinkType; lagDays: number }>
): Promise<ProductionPlanLinkRow> {
  const id = Number(linkId);
  if (!Number.isFinite(id)) throw new WmsHttpError(400, "invalid link id", "invalid_link_id");

  const cur = await client.query<{
    source_plan_id: string;
    target_plan_id: string;
  }>(
    `SELECT source_plan_id::text, target_plan_id::text
     FROM wms_production_plan_links
     WHERE site_id = $1 AND link_id = $2`,
    [siteId, id]
  );
  if (!cur.rows[0]) throw new WmsHttpError(404, "link not found", "not_found");

  await assertPlanEditable(client, Number(cur.rows[0].source_plan_id));
  await assertPlanEditable(client, Number(cur.rows[0].target_plan_id));

  const type = patch.type ? normalizeLinkType(patch.type) : null;
  const lagDays = patch.lagDays !== undefined ? Math.trunc(patch.lagDays) : null;

  await client.query(
    `UPDATE wms_production_plan_links
     SET link_type = COALESCE($3, link_type),
         lag_days = COALESCE($4, lag_days),
         updated_at = now()
     WHERE site_id = $1 AND link_id = $2`,
    [siteId, id, type, lagDays]
  );

  const r = await client.query<{
    link_id: string;
    source_plan_id: string;
    target_plan_id: string;
    link_type: string;
    lag_days: number;
  }>(
    `SELECT link_id::text, source_plan_id::text, target_plan_id::text, link_type, lag_days::int
     FROM wms_production_plan_links WHERE site_id = $1 AND link_id = $2`,
    [siteId, id]
  );

  const row = r.rows[0]!;
  return {
    linkId: row.link_id,
    sourcePlanId: row.source_plan_id,
    targetPlanId: row.target_plan_id,
    type: normalizeLinkType(row.link_type),
    lagDays: row.lag_days,
  };
}

export async function deleteProductionPlanLink(
  client: PoolClient,
  siteId: number,
  linkId: string
): Promise<{ ok: true; linkId: string }> {
  const id = Number(linkId);
  if (!Number.isFinite(id)) throw new WmsHttpError(400, "invalid link id", "invalid_link_id");

  const cur = await client.query<{ source_plan_id: string; target_plan_id: string }>(
    `SELECT source_plan_id::text, target_plan_id::text
     FROM wms_production_plan_links
     WHERE site_id = $1 AND link_id = $2`,
    [siteId, id]
  );
  if (!cur.rows[0]) throw new WmsHttpError(404, "link not found", "not_found");

  await assertPlanEditable(client, Number(cur.rows[0].source_plan_id));
  await assertPlanEditable(client, Number(cur.rows[0].target_plan_id));

  await client.query(`DELETE FROM wms_production_plan_links WHERE site_id = $1 AND link_id = $2`, [
    siteId,
    id,
  ]);
  return { ok: true, linkId: String(id) };
}
