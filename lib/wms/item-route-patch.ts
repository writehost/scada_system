import { WmsHttpError } from "@/lib/wms/errors";
import type { ItemMasterPatch } from "@/lib/wms/catalog";

export function parseItemPatch(body: unknown): ItemMasterPatch {
  if (!body || typeof body !== "object") return {};
  const b = body as Record<string, unknown>;
  const out: ItemMasterPatch = {};

  if ("name" in b) {
    if (typeof b.name !== "string") throw new WmsHttpError(400, "invalid name", "invalid_name");
    out.name = b.name;
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
