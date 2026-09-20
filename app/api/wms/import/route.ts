import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId, resolveWarehouse } from "@/lib/wms/resolve";
import { canonicalWarehouseCode } from "@/lib/wms/warehouse-codes";
import { resolvePackagingProfileForImport } from "@/lib/wms/packaging-profile-defs";
import { checkItemDuplicates } from "@/lib/wms/catalog";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions";
import { ensureItemClass, ensureItemGroup } from "@/lib/wms/item-master-refs";
import { normalizeCrptProductGroupCode } from "@/lib/wms/crpt-product-groups";
import { nomenclatureFormTypeToItemTypeCode } from "@/lib/nomenclature-model";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportKind = "items" | "item_uoms" | "locations" | "lots" | "stock_balances";

type ItemRow = {
  itemCode: string;
  name: string;
  sku?: string;
  materialType?: string;
  productGroup?: string;
  itemGroupCode?: string;
  itemClassCode?: string;
  itemSubgroup?: string;
  packagingFormat?: string;
  packagingProfile?: string;
  itemAttrs?: Record<string, unknown>;
  nomenclature?: string;
  uomCode?: string;
  isMarked?: boolean;
  isPerishable?: boolean;
  rotationPolicy?: string;
  shelfLifeDays?: number;
  expiryWarningDays?: number;
  primaryBarcode?: string;
  shortName?: string;
  isActive?: boolean;
  itemTypeCode?: string;
};

type LocationRow = {
  warehouseCode: string;
  warehouseName?: string;
  zoneCode: string;
  zoneName?: string;
  locationCode: string;
  displayName?: string;
  locationStatusCode?: string; // ref_wms_location_status.code
  accuracyStatusCode?: string; // ref_wms_accuracy_status.code
  isPickFace?: boolean;
  /** JSON ёмкость/габариты ячейки: capacityQty, capacityVolumeL, innerDimsMm */
  locationAttrs?: Record<string, unknown>;
};

type LotRow = {
  itemCode: string;
  lotCode: string;
  batchLabel?: string;
  supplierLotCode?: string;
  receivedAt?: string;
  manufacturedAt?: string;
  bestBeforeAt?: string;
  expiryAt?: string;
  qaStatusCode?: string;
  isBlocked?: boolean;
  note?: string;
};

type ItemUomRow = {
  itemCode: string;
  uomCode: string;
  uomName?: string;
  qtyInBase: number;
  levelNo?: number;
  isBase?: boolean;
  isShipping?: boolean;
  maxPerLoadUnit?: number;
  weightKg?: number;
  volumeL?: number;
};

type StockBalanceRow = {
  locationCode: string;
  itemCode: string;
  availableQty?: number;
  reservedQty?: number;
  inProductionQty?: number;
  inTransitQty?: number;
  quarantineQty?: number;
  rejectedQty?: number;
  accuracyStatusCode?: string;
};

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeRotationPolicy(v: unknown): "fifo" | "fefo" | "manual" {
  const s = asText(v).trim().toLowerCase();
  if (s === "fefo" || s === "fifo" || s === "manual") return s;
  return "fifo";
}

function assertNonEmpty(v: string, field: string) {
  if (!v.trim()) throw new WmsHttpError(400, `${field} is required`, "bad_input");
}

export async function POST(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    kind?: ImportKind;
    rows?: unknown[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const siteCode = asText(body.siteCode).trim();
  const kind = asText(body.kind) as ImportKind;
  const rows = Array.isArray(body.rows) ? body.rows : [];

  try {
    assertNonEmpty(siteCode, "siteCode");
    if (
      kind !== "items" &&
      kind !== "item_uoms" &&
      kind !== "locations" &&
      kind !== "lots" &&
      kind !== "stock_balances"
    ) {
      throw new WmsHttpError(400, "kind is invalid", "bad_kind");
    }
    if (rows.length === 0) throw new WmsHttpError(400, "rows must be non-empty", "bad_rows");
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: "bad input" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    await client.query("BEGIN");
    let inserted = 0;
    let updated = 0;

    if (kind === "items") {
      await requireWmsPermission(client, auth.session.userId, WMS_PERMISSION.itemsWrite);
      for (const raw of rows) {
        const r = raw as Partial<ItemRow>;
        const itemCode = asText(r.itemCode).trim();
        const name = asText(r.name).trim();
        assertNonEmpty(itemCode, "itemCode");
        assertNonEmpty(name, "name");

        // Import is upsert by itemCode: the same code is an update, not a duplicate.
        const existing = await client.query<{ item_id: string }>(
          `SELECT item_id::text AS item_id
           FROM wms_items
           WHERE site_id = $1 AND lower(item_code) = lower($2)
           LIMIT 1`,
          [siteId, itemCode]
        );
        const dup = await checkItemDuplicates(client, siteId, {
          gtin: asText(r.primaryBarcode).trim() || undefined,
          excludeItemId: existing.rows[0]?.item_id,
        });
        if (dup && dup.itemCode.trim().toLowerCase() !== itemCode.toLowerCase()) {
          throw new WmsHttpError(
            409,
            `Дубликат ${dup.field}: «${dup.value}» уже используется в ${dup.itemCode}`,
            "duplicate_item"
          );
        }

        const rawGroup = asText(r.itemGroupCode || r.productGroup).trim();
        const itemGroupCode = rawGroup
          ? normalizeCrptProductGroupCode(rawGroup) || rawGroup
          : "";
        const itemClassCode = asText(r.itemClassCode || r.materialType).trim();
        if (itemGroupCode) {
          await ensureItemGroup(
            client,
            siteId,
            itemGroupCode,
            asText(r.productGroup).trim() || itemGroupCode
          );
        }
        if (itemClassCode) {
          await ensureItemClass(
            client,
            siteId,
            itemClassCode,
            itemGroupCode || null,
            asText(r.materialType).trim() || itemClassCode
          );
        }

        const uomCode = asText(r.uomCode).trim() || "pcs";
        const rotationPolicy = normalizeRotationPolicy(r.rotationPolicy);
        const packagingProfile = await resolvePackagingProfileForImport(client, siteId, r.packagingProfile);
        const attrsType =
          r.itemAttrs &&
          typeof r.itemAttrs === "object" &&
          r.itemAttrs.nomenclature &&
          typeof r.itemAttrs.nomenclature === "object"
            ? asText((r.itemAttrs.nomenclature as Record<string, unknown>).type).trim()
            : "";
        const itemTypeCode =
          nomenclatureFormTypeToItemTypeCode(asText(r.itemTypeCode).trim() || attrsType) || null;

        const up = await client.query<{ item_id: string; inserted: boolean }>(
          `INSERT INTO wms_items (
             site_id, item_code, short_name, is_active, item_type_code, sku, name, material_type, product_group, item_group_code, item_class_code, nomenclature,
             item_subgroup, packaging_format, packaging_profile, item_attrs_json,
             uom_code, is_marked, is_perishable, rotation_policy, shelf_life_days, expiry_warning_days, created_at, updated_at
           ) VALUES ($1, $2, $3, COALESCE($4::boolean, TRUE), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, COALESCE($18::boolean, false), COALESCE($19::boolean, false), $20, $21, $22, now(), now())
           ON CONFLICT (site_id, item_code)
           DO UPDATE SET
             short_name = COALESCE(EXCLUDED.short_name, wms_items.short_name),
             is_active = COALESCE(EXCLUDED.is_active, wms_items.is_active),
             item_type_code = COALESCE(EXCLUDED.item_type_code, wms_items.item_type_code),
             sku = COALESCE(EXCLUDED.sku, wms_items.sku),
             name = EXCLUDED.name,
             material_type = COALESCE(EXCLUDED.material_type, wms_items.material_type),
             product_group = COALESCE(EXCLUDED.product_group, wms_items.product_group),
             item_group_code = COALESCE(EXCLUDED.item_group_code, wms_items.item_group_code),
             item_class_code = COALESCE(EXCLUDED.item_class_code, wms_items.item_class_code),
             nomenclature = COALESCE(EXCLUDED.nomenclature, wms_items.nomenclature),
             item_subgroup = COALESCE(EXCLUDED.item_subgroup, wms_items.item_subgroup),
             packaging_format = COALESCE(EXCLUDED.packaging_format, wms_items.packaging_format),
             packaging_profile = COALESCE(EXCLUDED.packaging_profile, wms_items.packaging_profile),
             item_attrs_json = COALESCE(EXCLUDED.item_attrs_json, wms_items.item_attrs_json),
             uom_code = COALESCE(EXCLUDED.uom_code, wms_items.uom_code),
             is_marked = COALESCE($18::boolean, wms_items.is_marked),
             is_perishable = COALESCE($19::boolean, wms_items.is_perishable),
             rotation_policy = COALESCE(EXCLUDED.rotation_policy, wms_items.rotation_policy),
             shelf_life_days = COALESCE(EXCLUDED.shelf_life_days, wms_items.shelf_life_days),
             expiry_warning_days = COALESCE(EXCLUDED.expiry_warning_days, wms_items.expiry_warning_days),
             updated_at = now()
           RETURNING item_id::text AS item_id, (xmax = 0) AS inserted`,
          [
            siteId,
            itemCode,
            asText(r.shortName).trim() || null,
            typeof r.isActive === "boolean" ? r.isActive : null,
            itemTypeCode,
            r.sku ?? null,
            name,
            r.materialType ?? itemClassCode ?? null,
            r.productGroup ?? itemGroupCode ?? null,
            itemGroupCode || null,
            itemClassCode || null,
            r.nomenclature ?? null,
            asText(r.itemSubgroup).trim() || null,
            asText(r.packagingFormat).trim() || null,
            packagingProfile,
            r.itemAttrs ? JSON.stringify(r.itemAttrs) : null,
            uomCode,
            typeof r.isMarked === "boolean" ? r.isMarked : null,
            typeof r.isPerishable === "boolean" ? r.isPerishable : null,
            rotationPolicy,
            r.shelfLifeDays == null ? null : Math.trunc(asNum(r.shelfLifeDays, 0)),
            r.expiryWarningDays == null ? null : Math.trunc(asNum(r.expiryWarningDays, 0)),
          ]
        );
        const itemId = up.rows[0]!.item_id;
        if (up.rows[0]!.inserted) inserted += 1;
        else updated += 1;

        const barcode = asText(r.primaryBarcode).trim();
        if (barcode) {
          await client.query(
            `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
             VALUES ($1::bigint, $2, 'ean13', TRUE, now())
             ON CONFLICT (barcode)
             DO UPDATE SET item_id = EXCLUDED.item_id, is_primary = TRUE`,
            [itemId, barcode]
          );
        }
      }
    }

    if (kind === "locations") {
      for (const raw of rows) {
        const r = raw as Partial<LocationRow>;
        const warehouseCode = canonicalWarehouseCode(asText(r.warehouseCode).trim());
        const warehouseName =
          asText(r.warehouseName).trim() ||
          (warehouseCode === "OS"
            ? "Склад материалов"
            : warehouseCode === "FG"
              ? "Склад готовой продукции"
              : warehouseCode);
        const zoneCode = asText(r.zoneCode).trim();
        const zoneName = asText(r.zoneName).trim() || zoneCode;
        const locationCode = asText(r.locationCode).trim();
        assertNonEmpty(warehouseCode, "warehouseCode");
        assertNonEmpty(zoneCode, "zoneCode");
        assertNonEmpty(locationCode, "locationCode");

        const w = await resolveWarehouse(client, siteId, warehouseCode);
        const warehouseId =
          w?.warehouse_id ??
          (
            await client.query<{ warehouse_id: string }>(
              `INSERT INTO wms_warehouses (site_id, warehouse_code, name, is_active, created_at)
               VALUES ($1, $2, $3, TRUE, now())
               ON CONFLICT (site_id, warehouse_code)
               DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
               RETURNING warehouse_id::text AS warehouse_id`,
              [siteId, warehouseCode, warehouseName]
            )
          ).rows[0]!.warehouse_id;

        const zone = await client.query<{ zone_id: string }>(
          `INSERT INTO wms_zones (warehouse_id, zone_code, name, is_active, created_at)
           VALUES ($1::bigint, $2, $3, TRUE, now())
           ON CONFLICT (warehouse_id, zone_code)
           DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
           RETURNING zone_id::text AS zone_id`,
          [warehouseId, zoneCode, zoneName]
        );
        const zoneId = zone.rows[0]!.zone_id;

        const locStatusCode = asText(r.locationStatusCode).trim();
        const accStatusCode = asText(r.accuracyStatusCode).trim();
        const locStatusId = locStatusCode
          ? (
              await client.query<{ id: number }>(
                `SELECT location_status_id AS id FROM ref_wms_location_status WHERE code = $1`,
                [locStatusCode]
              )
            ).rows[0]?.id ?? 1
          : 1;
        const accStatusId = accStatusCode
          ? (
              await client.query<{ id: number }>(
                `SELECT accuracy_status_id AS id FROM ref_wms_accuracy_status WHERE code = $1`,
                [accStatusCode]
              )
            ).rows[0]?.id ?? 1
          : 1;

        const displayName = asText(r.displayName).trim() || locationCode;
        const locationAttrsJson =
          r.locationAttrs && typeof r.locationAttrs === "object" && !Array.isArray(r.locationAttrs)
            ? JSON.stringify(r.locationAttrs)
            : null;

        const up = await client.query<{ inserted: boolean }>(
          `INSERT INTO wms_locations (
             site_id, warehouse_id, zone_id, location_code, display_name,
             location_status_id, accuracy_status_id, is_pick_face, location_attrs_json, updated_at
           ) VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9::jsonb, now())
           ON CONFLICT (site_id, location_code)
           DO UPDATE SET
             warehouse_id = EXCLUDED.warehouse_id,
             zone_id = EXCLUDED.zone_id,
             display_name = EXCLUDED.display_name,
             location_status_id = EXCLUDED.location_status_id,
             accuracy_status_id = EXCLUDED.accuracy_status_id,
             is_pick_face = EXCLUDED.is_pick_face,
             location_attrs_json = COALESCE(EXCLUDED.location_attrs_json, wms_locations.location_attrs_json),
             updated_at = now()
           RETURNING (xmax = 0) AS inserted`,
          [
            siteId,
            warehouseId,
            zoneId,
            locationCode,
            displayName,
            locStatusId,
            accStatusId,
            asBool(r.isPickFace, false),
            locationAttrsJson,
          ]
        );
        if (up.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }
    }

    if (kind === "item_uoms") {
      for (const raw of rows) {
        const r = raw as Partial<ItemUomRow>;
        const itemCode = asText(r.itemCode).trim();
        const uomCode = asText(r.uomCode).trim();
        const qtyInBase = asNum(r.qtyInBase, 0);
        assertNonEmpty(itemCode, "itemCode");
        assertNonEmpty(uomCode, "uomCode");
        if (qtyInBase <= 0) {
          throw new WmsHttpError(400, "qtyInBase must be > 0", "bad_input");
        }

        const it = await client.query<{ item_id: string }>(
          `SELECT item_id::text AS item_id
           FROM wms_items
           WHERE site_id = $1 AND item_code = $2`,
          [siteId, itemCode]
        );
        const itemId = it.rows[0]?.item_id;
        if (!itemId) throw new WmsHttpError(400, `unknown itemCode: ${itemCode}`, "bad_item");

        const up = await client.query<{ inserted: boolean }>(
          `INSERT INTO wms_item_uoms (
             item_id, uom_code, uom_name, qty_in_base, level_no, is_base, is_shipping,
             max_per_load_unit, weight_kg, volume_l, updated_at
           ) VALUES (
             $1::bigint, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()
           )
           ON CONFLICT (item_id, uom_code)
           DO UPDATE SET
             uom_name = EXCLUDED.uom_name,
             qty_in_base = EXCLUDED.qty_in_base,
             level_no = EXCLUDED.level_no,
             is_base = EXCLUDED.is_base,
             is_shipping = EXCLUDED.is_shipping,
             max_per_load_unit = EXCLUDED.max_per_load_unit,
             weight_kg = EXCLUDED.weight_kg,
             volume_l = EXCLUDED.volume_l,
             updated_at = now()
           RETURNING (xmax = 0) AS inserted`,
          [
            itemId,
            uomCode,
            asText(r.uomName).trim() || null,
            qtyInBase,
            Math.trunc(asNum(r.levelNo, 100)),
            asBool(r.isBase, false),
            asBool(r.isShipping, true),
            r.maxPerLoadUnit == null ? null : asNum(r.maxPerLoadUnit, 0),
            r.weightKg == null ? null : asNum(r.weightKg, 0),
            r.volumeL == null ? null : asNum(r.volumeL, 0),
          ]
        );
        if (up.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }
    }

    if (kind === "lots") {
      for (const raw of rows) {
        const r = raw as Partial<LotRow>;
        const itemCode = asText(r.itemCode).trim();
        const lotCode = asText(r.lotCode).trim();
        assertNonEmpty(itemCode, "itemCode");
        assertNonEmpty(lotCode, "lotCode");

        const it = await client.query<{ item_id: string }>(
          `SELECT item_id::text AS item_id FROM wms_items WHERE site_id = $1 AND item_code = $2`,
          [siteId, itemCode]
        );
        const itemId = it.rows[0]?.item_id;
        if (!itemId) throw new WmsHttpError(400, `unknown itemCode: ${itemCode}`, "bad_item");

        const up = await client.query<{ inserted: boolean }>(
          `INSERT INTO wms_lots (
             site_id, item_id, lot_code, batch_label, supplier_lot_code,
             received_at, manufactured_at, best_before_at, expiry_at, qa_status_code, is_blocked, note, updated_at
           ) VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
           ON CONFLICT (site_id, item_id, lot_code)
           DO UPDATE SET
             batch_label = COALESCE(EXCLUDED.batch_label, wms_lots.batch_label),
             supplier_lot_code = COALESCE(EXCLUDED.supplier_lot_code, wms_lots.supplier_lot_code),
             received_at = COALESCE(EXCLUDED.received_at, wms_lots.received_at),
             manufactured_at = COALESCE(EXCLUDED.manufactured_at, wms_lots.manufactured_at),
             best_before_at = COALESCE(EXCLUDED.best_before_at, wms_lots.best_before_at),
             expiry_at = COALESCE(EXCLUDED.expiry_at, wms_lots.expiry_at),
             qa_status_code = COALESCE(EXCLUDED.qa_status_code, wms_lots.qa_status_code),
             is_blocked = COALESCE(EXCLUDED.is_blocked, wms_lots.is_blocked),
             note = COALESCE(EXCLUDED.note, wms_lots.note),
             updated_at = now()
           RETURNING (xmax = 0) AS inserted`,
          [
            siteId,
            itemId,
            lotCode,
            r.batchLabel ?? null,
            r.supplierLotCode ?? null,
            r.receivedAt ? new Date(r.receivedAt) : null,
            r.manufacturedAt ? new Date(r.manufacturedAt) : null,
            r.bestBeforeAt ? new Date(r.bestBeforeAt) : null,
            r.expiryAt ? new Date(r.expiryAt) : null,
            r.qaStatusCode ?? null,
            typeof r.isBlocked === "boolean" ? r.isBlocked : null,
            r.note ?? null,
          ]
        );
        if (up.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }
    }

    if (kind === "stock_balances") {
      for (const raw of rows) {
        const r = raw as Partial<StockBalanceRow>;
        const locationCode = asText(r.locationCode).trim();
        const itemCode = asText(r.itemCode).trim();
        assertNonEmpty(locationCode, "locationCode");
        assertNonEmpty(itemCode, "itemCode");

        const loc = await client.query<{ location_id: string }>(
          `SELECT location_id::text AS location_id
           FROM wms_locations
           WHERE site_id = $1 AND location_code = $2`,
          [siteId, locationCode]
        );
        const locationId = loc.rows[0]?.location_id;
        if (!locationId)
          throw new WmsHttpError(400, `unknown locationCode: ${locationCode}`, "bad_location");

        const it = await client.query<{ item_id: string }>(
          `SELECT item_id::text AS item_id
           FROM wms_items
           WHERE site_id = $1 AND item_code = $2`,
          [siteId, itemCode]
        );
        const itemId = it.rows[0]?.item_id;
        if (!itemId) throw new WmsHttpError(400, `unknown itemCode: ${itemCode}`, "bad_item");

        const accStatusCode = asText(r.accuracyStatusCode).trim();
        const accStatusId = accStatusCode
          ? (
              await client.query<{ id: number }>(
                `SELECT accuracy_status_id AS id FROM ref_wms_accuracy_status WHERE code = $1`,
                [accStatusCode]
              )
            ).rows[0]?.id ?? 1
          : 1;

        const availableQty = Math.max(0, asNum(r.availableQty, 0));
        const reservedQty = Math.max(0, asNum(r.reservedQty, 0));
        const inProductionQty = Math.max(0, asNum(r.inProductionQty, 0));
        const inTransitQty = Math.max(0, asNum(r.inTransitQty, 0));
        const quarantineQty = Math.max(0, asNum(r.quarantineQty, 0));
        const rejectedQty = Math.max(0, asNum(r.rejectedQty, 0));

        const up = await client.query<{ inserted: boolean }>(
          `INSERT INTO wms_stock_balances (
             site_id, location_id, item_id,
             available_qty, reserved_qty, in_production_qty, in_transit_qty, quarantine_qty, rejected_qty,
             accuracy_status_id, updated_at
           ) VALUES ($1, $2::bigint, $3::bigint, $4, $5, $6, $7, $8, $9, $10, now())
           ON CONFLICT (site_id, location_id, item_id)
           DO UPDATE SET
             available_qty = EXCLUDED.available_qty,
             reserved_qty = EXCLUDED.reserved_qty,
             in_production_qty = EXCLUDED.in_production_qty,
             in_transit_qty = EXCLUDED.in_transit_qty,
             quarantine_qty = EXCLUDED.quarantine_qty,
             rejected_qty = EXCLUDED.rejected_qty,
             accuracy_status_id = EXCLUDED.accuracy_status_id,
             updated_at = now()
           RETURNING (xmax = 0) AS inserted`,
          [
            siteId,
            locationId,
            itemId,
            availableQty,
            reservedQty,
            inProductionQty,
            inTransitQty,
            quarantineQty,
            rejectedQty,
            accStatusId,
          ]
        );
        if (up.rows[0]?.inserted) inserted += 1;
        else updated += 1;
      }
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, kind, inserted, updated });
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

