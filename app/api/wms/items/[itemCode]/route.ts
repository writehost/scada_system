import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import {
  getItemOverview,
  getItemResources,
  listItemRecentMovements,
  type ItemMasterPatch,
  updateItemMaster,
} from "@/lib/wms/catalog";
import { WmsHttpError } from "@/lib/wms/errors";
import { placedLocationsForItem } from "@/lib/wms/fg-plan-placed";
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const itemCode = decodeURIComponent(params.itemCode ?? "");
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json(
      { error: "siteCode and itemCode are required" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    /* Состав и обзор независимы, поэтому не ждут друг друга: до базы далеко. */
    const resourcesPromise = (async () => {
      const resourcesClient = await pool.connect();
      try {
        return await getItemResources(resourcesClient, siteId, itemCode);
      } catch {
        return null;
      } finally {
        resourcesClient.release();
      }
    })();

    const overview = await getItemOverview(client, siteId, itemCode, pool);
    const resources = await resourcesPromise;
    if (!overview) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    const includeMovements = url.searchParams.get("includeMovements") === "1";
    const movements = includeMovements
      ? await listItemRecentMovements(client, siteId, overview.item.itemId as string)
      : undefined;
    let stockByLocation = overview.stockByLocation as Array<Record<string, unknown>>
    let totals = overview.totals as Record<string, number>
    try {
      const placedLocs = await placedLocationsForItem(siteId, {
        itemCode: String(overview.item.itemCode || itemCode),
        sku: overview.item.sku as string | null,
        itemAttrs: overview.item.itemAttrs,
        primaryBarcode: overview.item.primaryBarcode as string | null,
      })
      const placedBottles = placedLocs.reduce((sum, loc) => sum + loc.bottles, 0)
      const placedPallets = placedLocs.reduce((sum, loc) => sum + loc.pallets, 0)
      if (placedLocs.length > 0) {
        const existing = new Set(stockByLocation.map((row) => String(row.locationCode || "")))
        for (const loc of placedLocs) {
          if (existing.has(loc.locationCode)) {
            stockByLocation = stockByLocation.map((row) =>
              String(row.locationCode) === loc.locationCode
                ? { ...row, placedQty: loc.bottles, placedPallets: loc.pallets }
                : row
            )
          } else {
            stockByLocation = [
              ...stockByLocation,
              {
                locationCode: loc.locationCode,
                warehouseCode: "FG",
                zoneCode: loc.planRowId.split("-")[0] || "",
                availableQty: 0,
                reservedQty: 0,
                inProductionQty: 0,
                placedQty: loc.bottles,
                placedPallets: loc.pallets,
              },
            ]
          }
        }
        totals = { ...totals, placedQty: placedBottles, placedPallets }
      }
    } catch (error) {
      console.error("placedLocationsForItem", itemCode, error)
    }
    return NextResponse.json({
      ...overview,
      totals,
      stockByLocation,
      resources: resources?.resources ?? [],
      ...(movements ? { recentMovements: movements } : {}),
    });
  } finally {
    client.release();
  }
}

function parseItemPatch(body: unknown): ItemMasterPatch {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  /** Только поля, реально пришедшие в JSON — иначе `"x" in patch` даёт true при undefined и ломает updateItemMaster. */
  const out: ItemMasterPatch = {};

  if ("name" in b) {
    if (typeof b.name !== "string") throw new WmsHttpError(400, "invalid name", "invalid_name");
    out.name = b.name;
  }
  if ("shortName" in b) {
    if (b.shortName !== null && typeof b.shortName !== "string")
      throw new WmsHttpError(400, "invalid shortName", "invalid_field");
    out.shortName = b.shortName === null ? null : b.shortName;
  }
  if ("isActive" in b) {
    if (typeof b.isActive !== "boolean") throw new WmsHttpError(400, "isActive must be boolean", "invalid_field");
    out.isActive = b.isActive;
  }
  if ("itemTypeCode" in b) {
    if (b.itemTypeCode !== null && typeof b.itemTypeCode !== "string")
      throw new WmsHttpError(400, "invalid itemTypeCode", "invalid_field");
    out.itemTypeCode = b.itemTypeCode === null ? null : b.itemTypeCode;
  }
  if ("sku" in b) {
    if (b.sku !== null && typeof b.sku !== "string") throw new WmsHttpError(400, "invalid sku", "invalid_sku");
    out.sku = b.sku === null ? null : b.sku;
  }
  if ("materialType" in b) {
    if (b.materialType !== null && typeof b.materialType !== "string")
      throw new WmsHttpError(400, "invalid materialType", "invalid_field");
    out.materialType = b.materialType === null ? null : b.materialType;
  }
  if ("productGroup" in b) {
    if (b.productGroup !== null && typeof b.productGroup !== "string")
      throw new WmsHttpError(400, "invalid productGroup", "invalid_field");
    out.productGroup = b.productGroup === null ? null : b.productGroup;
  }
  if ("itemGroupCode" in b) {
    if (b.itemGroupCode !== null && typeof b.itemGroupCode !== "string")
      throw new WmsHttpError(400, "invalid itemGroupCode", "invalid_field");
    out.itemGroupCode = b.itemGroupCode === null ? null : b.itemGroupCode;
  }
  if ("itemClassCode" in b) {
    if (b.itemClassCode !== null && typeof b.itemClassCode !== "string")
      throw new WmsHttpError(400, "invalid itemClassCode", "invalid_field");
    out.itemClassCode = b.itemClassCode === null ? null : b.itemClassCode;
  }
  if ("itemSubgroup" in b) {
    if (b.itemSubgroup !== null && typeof b.itemSubgroup !== "string")
      throw new WmsHttpError(400, "invalid itemSubgroup", "invalid_field");
    out.itemSubgroup = b.itemSubgroup === null ? null : b.itemSubgroup;
  }
  if ("packagingFormat" in b) {
    if (b.packagingFormat !== null && typeof b.packagingFormat !== "string")
      throw new WmsHttpError(400, "invalid packagingFormat", "invalid_field");
    out.packagingFormat = b.packagingFormat === null ? null : b.packagingFormat;
  }
  if ("packagingProfile" in b) {
    if (b.packagingProfile !== null && typeof b.packagingProfile !== "string")
      throw new WmsHttpError(400, "invalid packagingProfile", "invalid_field");
    out.packagingProfile = b.packagingProfile === null ? null : b.packagingProfile;
  }
  if ("nomenclature" in b) {
    if (b.nomenclature !== null && typeof b.nomenclature !== "string")
      throw new WmsHttpError(400, "invalid nomenclature", "invalid_field");
    out.nomenclature = b.nomenclature === null ? null : b.nomenclature;
  }
  if ("lineGroup" in b) {
    if (b.lineGroup !== null && typeof b.lineGroup !== "string")
      throw new WmsHttpError(400, "invalid lineGroup", "invalid_field");
    out.lineGroup = b.lineGroup === null ? null : b.lineGroup;
  }
  if ("uomCode" in b) {
    if (typeof b.uomCode !== "string") throw new WmsHttpError(400, "invalid uomCode", "invalid_uom");
    out.uomCode = b.uomCode;
  }
  if ("isMarked" in b) {
    if (typeof b.isMarked !== "boolean") throw new WmsHttpError(400, "isMarked must be boolean", "invalid_field");
    out.isMarked = b.isMarked;
  }
  if ("isPerishable" in b) {
    if (typeof b.isPerishable !== "boolean") throw new WmsHttpError(400, "isPerishable must be boolean", "invalid_field");
    out.isPerishable = b.isPerishable;
  }
  if ("rotationPolicy" in b) {
    if (typeof b.rotationPolicy !== "string")
      throw new WmsHttpError(400, "invalid rotationPolicy", "invalid_field");
    out.rotationPolicy = b.rotationPolicy as ItemMasterPatch["rotationPolicy"];
  }
  if ("shelfLifeDays" in b) {
    if (b.shelfLifeDays === null) out.shelfLifeDays = null;
    else if (typeof b.shelfLifeDays === "number" && Number.isFinite(b.shelfLifeDays))
      out.shelfLifeDays = b.shelfLifeDays;
    else if (typeof b.shelfLifeDays === "string" && b.shelfLifeDays.trim() !== "") {
      const n = Number(b.shelfLifeDays);
      if (!Number.isFinite(n)) throw new WmsHttpError(400, "invalid shelfLifeDays", "invalid_field");
      out.shelfLifeDays = n;
    } else throw new WmsHttpError(400, "invalid shelfLifeDays", "invalid_field");
  }
  if ("expiryWarningDays" in b) {
    if (b.expiryWarningDays === null) out.expiryWarningDays = null;
    else if (typeof b.expiryWarningDays === "number" && Number.isFinite(b.expiryWarningDays))
      out.expiryWarningDays = b.expiryWarningDays;
    else if (typeof b.expiryWarningDays === "string" && b.expiryWarningDays.trim() !== "") {
      const n = Number(b.expiryWarningDays);
      if (!Number.isFinite(n)) throw new WmsHttpError(400, "invalid expiryWarningDays", "invalid_field");
      out.expiryWarningDays = n;
    } else throw new WmsHttpError(400, "invalid expiryWarningDays", "invalid_field");
  }
  if ("itemAttrs" in b) {
    if (b.itemAttrs !== null && (typeof b.itemAttrs !== "object" || Array.isArray(b.itemAttrs)))
      throw new WmsHttpError(400, "itemAttrs must be an object or null", "invalid_field");
    out.itemAttrs = b.itemAttrs === null ? null : (b.itemAttrs as Record<string, unknown>);
  }

  return out;
}

export async function PATCH(
  req: Request,
  segmentData: { params: Promise<{ itemCode: string }> }
) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const params = await segmentData.params;
  const itemCode = decodeURIComponent(params.itemCode ?? "");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof (body as { siteCode?: string })?.siteCode === "string" ? (body as { siteCode: string }).siteCode : "";
  if (!siteCode.trim() || !itemCode.trim()) {
    return NextResponse.json({ error: "siteCode and itemCode are required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    await requireWmsPermission(client, auth.session.userId, WMS_PERMISSION.itemsWrite, auth.session.login);
    const patch = parseItemPatch(body);
    const result = await updateItemMaster(client, siteId, itemCode, patch);
    if (!result.updated) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    const overview = await getItemOverview(client, siteId, itemCode);
    if (!overview) {
      return NextResponse.json({ error: "item not found" }, { status: 404 });
    }
    const resources = await getItemResources(client, siteId, itemCode);
    return NextResponse.json({
      ...overview,
      resources: resources?.resources ?? [],
    });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
