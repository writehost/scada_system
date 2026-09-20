import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import {
  filterRulesForLocation,
  filterRulesForRequirements,
  listStorageRules,
} from "@/lib/wms/storage-rules";
import { extractItemSlotRequirements, parseSlotProfileFromAttrs } from "@/lib/wms/storage-slot";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const itemCode = (url.searchParams.get("itemCode") ?? "").trim();
  const locationCode = (url.searchParams.get("locationCode") ?? "").trim();

  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }
  if (!itemCode && !locationCode) {
    return NextResponse.json({ error: "itemCode or locationCode required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }

    const allRules = await listStorageRules(client, siteId, true);

    let forItem: ReturnType<typeof filterRulesForRequirements> = [];
    let requirements = null;

    if (itemCode) {
      const resolved = await resolveItemByCodeOrBarcode(client, siteId, itemCode);
      if (!resolved) {
        return NextResponse.json({ error: "item not found" }, { status: 404 });
      }
      const itemRow = await client.query(
        `SELECT item_id::text, item_code, name, material_type, product_group, item_group_code,
                item_type_code, item_class_code, nomenclature, item_attrs_json
         FROM wms_items WHERE item_id = $1::bigint`,
        [resolved.item_id]
      );
      if (itemRow.rows.length === 0) {
        return NextResponse.json({ error: "item not found" }, { status: 404 });
      }
      requirements = extractItemSlotRequirements(itemRow.rows[0] as Parameters<typeof extractItemSlotRequirements>[0]);
      forItem = filterRulesForRequirements(allRules, requirements);
    }

    let forLocation: ReturnType<typeof filterRulesForLocation> = [];
    let location: { locationId: string; zoneId: string; locationCode: string } | null = null;

    if (locationCode) {
      const loc = await client.query<{
        location_id: string;
        zone_id: string;
        location_code: string;
        zone_code: string;
        warehouse_code: string;
        location_attrs_json: unknown;
      }>(
        `SELECT l.location_id::text, l.zone_id::text, l.location_code,
                z.zone_code, w.warehouse_code, l.location_attrs_json
         FROM wms_locations l
         JOIN wms_zones z ON z.zone_id = l.zone_id
         JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
         WHERE l.site_id = $1 AND l.location_code = $2`,
        [siteId, locationCode]
      );
      if (loc.rows.length > 0) {
        const row = loc.rows[0]!;
        const profile = parseSlotProfileFromAttrs(row.location_attrs_json);
        location = {
          locationId: row.location_id,
          zoneId: row.zone_id,
          locationCode: row.location_code,
        };
        forLocation = filterRulesForLocation(allRules, {
          ...location,
          zoneCode: row.zone_code,
          warehouseCode: row.warehouse_code,
          storageClass: profile.storageClass,
          processType: profile.processType,
        });
      }
    }

    return NextResponse.json({
      requirements,
      forItem,
      forLocation,
      location,
    });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}
