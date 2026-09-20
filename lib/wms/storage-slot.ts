import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { resolveItemByCodeOrBarcode } from "@/lib/wms/resolve";
import { extractLocationPhysical } from "@/lib/wms/putaway-physical";
import {
  applyStorageRuleBonuses,
  listStorageRules,
  storageRuleMatchesRequirements,
  type StorageRuleRow,
} from "@/lib/wms/storage-rules";
import {
  deriveProductPhysicalProfile,
  fillPercentBonus,
  inferLocationStorageClass,
  itemFitsLocationLimits,
  locationAcceptsStorageClass,
  parseLocationPhysicalLimits,
  parsePhysicalProfileFromItemAttrs,
  storageClassLabel,
  type ProductPhysicalProfile,
} from "@/lib/wms/physical-profile";

/** Смысловые коды ячеек (префиксы в location_code). */
export const SLOT_MATERIAL = {
  ST: "ST",
  LB: "LB",
  PK: "PK",
  CP: "CP",
  PL: "PL",
  ANY: "ANY",
} as const;

export const SLOT_PROCESS = {
  SER: "SER",
  BAGG: "BAGG",
  CAGG: "CAGG",
  PAGG: "PAGG",
  PACK_WATER: "PACK-WATER",
  DRINK: "DRINK",
  STORE: "STORE",
  RECV: "RECV",
  QUARANTINE: "QUARANTINE",
  DEFECT: "DEFECT",
  WRITEOFF: "WRITEOFF",
  ANY: "ANY",
} as const;

export const SLOT_SHAPE = { RND: "RND", SQR: "SQR", RECT: "RECT", ANY: "ANY" } as const;

export const SLOT_PRODUCT_GROUP = {
  SLNG: "SLNG",
  SLGZ: "SLGZ",
  DSLV: "DSLV",
  SLKR: "SLKR",
  DRNK: "DRNK",
  PWTR: "PWTR",
  ANY: "ANY",
} as const;

export const SLOT_VOLUME = {
  V05: "05",
  V10: "10",
  V15: "15",
  V50: "50",
  V190: "190",
  ANY: "ANY",
} as const;

export const SLOT_APPLICATION = {
  CAP: "CAP",
  BTL: "BTL",
  BLOCK: "BLOCK",
  BOX: "BOX",
  PALLET: "PALLET",
  ANY: "ANY",
} as const;

export type StorageSlotProfile = {
  materialType?: string | null;
  processType?: string | null;
  stickerShape?: string | null;
  productGroup?: string | null;
  brand?: string | null;
  productType?: string | null;
  carbonationType?: string | null;
  volume?: string | null;
  applicationPlace?: string | null;
  equipment?: string | null;
  physicalAddress?: string | null;
  storagePurpose?: string | null;
  receivingCategoryCode?: string | null;
  allowedItemGroupCodes?: string[] | null;
  allowMixedNomenclature?: boolean;
  allowMixedBatches?: boolean;
  capacityUnits?: number | null;
  priority?: number;
  /** Закреплённая номенклатура для подсказки ячейки цеха. */
  preferredItemCode?: string | null;
  preferredItemName?: string | null;
  /** Включить подсказку этой ячейки при выдаче той же номенклатуры в цех. */
  rememberNomenclature?: boolean;
  storageClass?: string | null;
  allowedStorageClasses?: string[] | null;
  maxLengthMm?: number | null;
  maxWidthMm?: number | null;
  maxHeightMm?: number | null;
  maxWeightG?: number | null;
  handling?: string | null;
  sizeClass?: string | null;
};

export type ItemSlotRequirements = StorageSlotProfile & {
  itemId: string;
  itemCode: string;
  itemName: string;
  gtin?: string | null;
  physical: ProductPhysicalProfile;
};

export type StorageRecommendRow = {
  locationId: string;
  locationCode: string;
  displayName: string;
  zoneCode: string;
  score: number;
  forbidden: boolean;
  reasons: string[];
  availableCapacity: number | null;
  currentUnits: number;
  skuCount: number;
  hasSameItem: boolean;
  hasSameGtin: boolean;
};

const WEIGHTS = {
  classMatch: 40,
  classMismatch: -80,
  dimFit: 20,
  materialMatch: 12,
  processMatch: 10,
  shapeMatch: 8,
  productGroupMatch: 8,
  volumeMatch: 6,
  applicationMatch: 6,
  sameItem: 15,
  sameGtin: 8,
  preferredNomenclature: 85,
  preferredMismatch: -90,
  emptySuitable: 5,
  blocked: -50,
  noCapacity: -40,
  materialMismatch: -8,
  processMismatch: -8,
  shapeMismatch: -6,
  specialZoneMismatch: -15,
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return fallback;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function strArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
  return out.length ? out : null;
}

export function parseSlotProfileFromAttrs(locationAttrsJson: unknown): StorageSlotProfile {
  const attrs = asRecord(locationAttrsJson);
  const slot = asRecord(attrs?.slotProfile ?? attrs?.slot);
  if (!slot) {
    return { allowMixedNomenclature: false, allowMixedBatches: true };
  }
  return {
    materialType: str(slot.materialType) ?? str(slot.material_type),
    processType: str(slot.processType) ?? str(slot.process_type),
    stickerShape: str(slot.stickerShape) ?? str(slot.sticker_shape),
    productGroup: str(slot.productGroup) ?? str(slot.product_group),
    brand: str(slot.brand),
    productType: str(slot.productType) ?? str(slot.product_type),
    carbonationType: str(slot.carbonationType) ?? str(slot.carbonation_type),
    volume: str(slot.volume),
    applicationPlace: str(slot.applicationPlace) ?? str(slot.application_place),
    equipment: str(slot.equipment),
    physicalAddress: str(slot.physicalAddress) ?? str(slot.physical_address),
    storagePurpose: str(slot.storagePurpose) ?? str(slot.storage_purpose),
    receivingCategoryCode:
      str(slot.receivingCategoryCode) ?? str(slot.receiving_category_code),
    allowedItemGroupCodes:
      strArray(slot.allowedItemGroupCodes) ?? strArray(slot.allowed_item_group_codes),
    allowMixedNomenclature: bool(slot.allowMixedNomenclature, false),
    allowMixedBatches: bool(slot.allowMixedBatches, true),
    capacityUnits: num(slot.capacityUnits ?? slot.capacity_units),
    priority: num(slot.priority) ?? undefined,
    preferredItemCode: str(slot.preferredItemCode) ?? str(slot.preferred_item_code),
    preferredItemName: str(slot.preferredItemName) ?? str(slot.preferred_item_name),
    rememberNomenclature: bool(slot.rememberNomenclature, false),
    storageClass: str(slot.storageClass) ?? str(slot.storage_class),
    allowedStorageClasses:
      strArray(slot.allowedStorageClasses) ?? strArray(slot.allowed_storage_classes),
    maxLengthMm: num(slot.maxLengthMm ?? slot.max_length_mm),
    maxWidthMm: num(slot.maxWidthMm ?? slot.max_width_mm),
    maxHeightMm: num(slot.maxHeightMm ?? slot.max_height_mm),
    maxWeightG: num(slot.maxWeightG ?? slot.max_weight_g),
    handling: str(slot.handling),
    sizeClass: str(slot.sizeClass) ?? str(slot.size_class),
  };
}

export function mergeSlotIntoLocationAttrs(
  existing: unknown,
  profile: StorageSlotProfile
): Record<string, unknown> {
  const base = asRecord(existing) ?? {};
  return {
    ...base,
    slotProfile: {
      materialType: profile.materialType ?? null,
      processType: profile.processType ?? null,
      stickerShape: profile.stickerShape ?? null,
      productGroup: profile.productGroup ?? null,
      brand: profile.brand ?? null,
      productType: profile.productType ?? null,
      carbonationType: profile.carbonationType ?? null,
      volume: profile.volume ?? null,
      applicationPlace: profile.applicationPlace ?? null,
      equipment: profile.equipment ?? null,
      physicalAddress: profile.physicalAddress ?? null,
      storagePurpose: profile.storagePurpose ?? null,
      receivingCategoryCode: profile.receivingCategoryCode ?? null,
      allowedItemGroupCodes: profile.allowedItemGroupCodes ?? null,
      allowMixedNomenclature: profile.allowMixedNomenclature ?? false,
      allowMixedBatches: profile.allowMixedBatches ?? true,
      capacityUnits: profile.capacityUnits ?? null,
      priority: profile.priority ?? null,
      preferredItemCode: profile.preferredItemCode ?? null,
      preferredItemName: profile.preferredItemName ?? null,
      rememberNomenclature: profile.rememberNomenclature ?? false,
      storageClass: profile.storageClass ?? null,
      allowedStorageClasses: profile.allowedStorageClasses ?? null,
      maxLengthMm: profile.maxLengthMm ?? null,
      maxWidthMm: profile.maxWidthMm ?? null,
      maxHeightMm: profile.maxHeightMm ?? null,
      maxWeightG: profile.maxWeightG ?? null,
      handling: profile.handling ?? null,
      sizeClass: profile.sizeClass ?? null,
    },
  };
}

export type ReceivingMissingCellDetails = {
  itemCode: string;
  itemName: string;
  slotProfile: StorageSlotProfile;
  slotTitle: string;
  warehouseCode: string;
  zoneCode: string;
  locationCode: string;
  displayName: string;
};

function inferWarehouseZoneForSlot(profile: StorageSlotProfile): {
  warehouseCode: string;
  zoneCode: string;
} {
  const pt = (profile.processType ?? SLOT_PROCESS.STORE).toUpperCase();
  if (pt === SLOT_PROCESS.SER) return { warehouseCode: "OS", zoneCode: "ST-SER" };
  if (pt === SLOT_PROCESS.BAGG || pt === SLOT_PROCESS.CAGG) {
    return { warehouseCode: "OS", zoneCode: "ST-BAGG" };
  }
  if (pt === SLOT_PROCESS.RECV) return { warehouseCode: "OS", zoneCode: "RECV" };
  if (pt === SLOT_PROCESS.DRINK || pt === SLOT_PROCESS.STORE) {
    return { warehouseCode: "FG", zoneCode: "STORE" };
  }
  return { warehouseCode: "OS", zoneCode: "ST-BAGG" };
}

/** Подсказка для создания ячейки при ошибке проведения приёмки. */
export function buildReceivingCellCreationSuggestion(
  req: ItemSlotRequirements
): ReceivingMissingCellDetails {
  const slotProfile: StorageSlotProfile = {
    materialType: req.materialType ?? SLOT_MATERIAL.ST,
    processType: req.processType ?? SLOT_PROCESS.BAGG,
    stickerShape: req.stickerShape ?? SLOT_SHAPE.ANY,
    productGroup: req.productGroup ?? SLOT_PRODUCT_GROUP.ANY,
    volume: req.volume ?? SLOT_VOLUME.ANY,
    applicationPlace: req.applicationPlace ?? SLOT_APPLICATION.BLOCK,
    physicalAddress: `ПРИЁМКА-${req.itemCode.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "AUTO"}`,
    allowMixedNomenclature: req.allowMixedNomenclature ?? false,
    allowMixedBatches: req.allowMixedBatches ?? true,
    brand: req.brand ?? null,
    productType: req.productType ?? null,
    carbonationType: req.carbonationType ?? null,
  };
  const { warehouseCode, zoneCode } = inferWarehouseZoneForSlot(slotProfile);
  const locationCode = buildSemanticLocationCode(
    slotProfile,
    slotProfile.physicalAddress ?? "AUTO"
  );
  const displayName = buildSlotDisplayName(slotProfile);
  return {
    itemCode: req.itemCode,
    itemName: req.itemName,
    slotProfile,
    slotTitle: displayName,
    warehouseCode,
    zoneCode,
    locationCode,
    displayName,
  };
}

export function buildSemanticLocationCode(
  profile: StorageSlotProfile,
  physicalAddress: string
): string {
  const parts = [
    profile.materialType || SLOT_MATERIAL.ST,
    profile.processType || SLOT_PROCESS.STORE,
    profile.stickerShape || SLOT_SHAPE.ANY,
    profile.productGroup || SLOT_PRODUCT_GROUP.ANY,
    profile.volume || SLOT_VOLUME.ANY,
    physicalAddress.trim().replace(/\s+/g, "-"),
  ].filter(Boolean);
  return parts.join("-").toUpperCase();
}

const LABELS: Record<string, Record<string, string>> = {
  materialType: {
    ST: "Стикеры",
    LB: "Этикетки",
    PK: "Упаковка",
    CP: "Пробки",
    PL: "Палетные",
    ANY: "Любой",
  },
  processType: {
    SER: "Сериализация",
    BAGG: "Блочная агрегация",
    PAGG: "Палетная агрегация",
    CAGG: "Коробочная агрегация",
    "PACK-WATER": "Упакованная вода",
    DRINK: "Напитки",
    STORE: "Складской материал",
    RECV: "Приёмка",
    QUARANTINE: "Карантин",
    DEFECT: "Брак",
    WRITEOFF: "Списание",
    ANY: "Любой",
  },
  stickerShape: { RND: "Круглые", SQR: "Квадратные", RECT: "Прямоугольные", ANY: "Любой" },
  productGroup: {
    SLNG: "Славда негаз",
    SLGZ: "Славда газ",
    DSLV: "Детская Славда",
    SLKR: "Славда курортная",
    DRNK: "Напитки",
    PWTR: "Упак. вода",
    ANY: "Любой",
  },
  volume: { "05": "0,5 л", "10": "1 л", "15": "1,5 л", "50": "5 л", "190": "19 л", ANY: "Любой" },
  applicationPlace: {
    CAP: "Пробка",
    BTL: "Бутылка",
    BLOCK: "Блок",
    BOX: "Короб",
    PALLET: "Палета",
    ANY: "Любой",
  },
};

export function slotLabel(field: keyof typeof LABELS, code: string | null | undefined): string {
  if (!code) return "—";
  return LABELS[field]?.[code] ?? code;
}

export function buildSlotDisplayName(profile: StorageSlotProfile): string {
  const parts = [
    slotLabel("materialType", profile.materialType),
    slotLabel("processType", profile.processType),
    profile.stickerShape && profile.stickerShape !== "ANY"
      ? slotLabel("stickerShape", profile.stickerShape)
      : null,
    profile.productGroup && profile.productGroup !== "ANY"
      ? slotLabel("productGroup", profile.productGroup)
      : null,
    profile.volume && profile.volume !== "ANY" ? slotLabel("volume", profile.volume) : null,
    profile.physicalAddress ? profile.physicalAddress : null,
  ].filter((p) => p && p !== "—");
  return parts.join(" / ");
}

function parseVolumeFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (/\b0[,.]5\b|0\.5\s*л|500\s*мл/.test(t)) return SLOT_VOLUME.V05;
  if (/\b1[,.]5\b|1\.5\s*л/.test(t)) return SLOT_VOLUME.V15;
  if (/\b1\s*л\b|1000\s*мл/.test(t) && !/\b1[,.]5/.test(t)) return SLOT_VOLUME.V10;
  if (/\b5\s*л/.test(t)) return SLOT_VOLUME.V50;
  if (/\b19\s*л/.test(t)) return SLOT_VOLUME.V190;
  return null;
}

function inferProductGroup(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("детск")) return SLOT_PRODUCT_GROUP.DSLV;
  if (t.includes("курорт")) return SLOT_PRODUCT_GROUP.SLKR;
  if (t.includes("негаз") || t.includes("не газ")) return SLOT_PRODUCT_GROUP.SLNG;
  if (t.includes("газ") || t.includes("среднегаз")) return SLOT_PRODUCT_GROUP.SLGZ;
  if (t.includes("напиток")) return SLOT_PRODUCT_GROUP.DRNK;
  if (t.includes("вода") && t.includes("упак")) return SLOT_PRODUCT_GROUP.PWTR;
  return null;
}

function inferMaterialType(item: {
  material_type: string | null;
  product_group: string | null;
  name: string;
}): string {
  const mt = (item.material_type ?? "").toLowerCase();
  const pg = (item.product_group ?? "").toLowerCase();
  const name = item.name.toLowerCase();
  if (mt.includes("sticker") || pg.includes("sticker") || pg.includes("стикер") || name.includes("стикер")) {
    return SLOT_MATERIAL.ST;
  }
  if (mt.includes("label") || name.includes("этикет")) return SLOT_MATERIAL.LB;
  if (mt.includes("pack") || name.includes("упаков") || name.includes("картон")) return SLOT_MATERIAL.PK;
  if (name.includes("пробк") || name.includes("колпач")) return SLOT_MATERIAL.CP;
  return SLOT_MATERIAL.ANY;
}

function inferProcessFromText(text: string): string {
  const t = text.toLowerCase();
  if (t.includes("сериал")) return SLOT_PROCESS.SER;
  if (t.includes("блочн") || t.includes("block agg")) return SLOT_PROCESS.BAGG;
  if (t.includes("палет")) return SLOT_PROCESS.PAGG;
  if (t.includes("напит")) return SLOT_PROCESS.DRINK;
  if (t.includes("упак") && t.includes("вод")) return SLOT_PROCESS.PACK_WATER;
  return SLOT_PROCESS.STORE;
}

function matchesCode(
  required: string | null | undefined,
  actual: string | null | undefined
): "match" | "wildcard" | "mismatch" {
  if (!required || required === "ANY") return "wildcard";
  if (!actual || actual === "ANY") return "wildcard";
  if (required === actual) return "match";
  return "mismatch";
}

function isSpecialPurpose(processType: string | null | undefined): boolean {
  return (
    processType === SLOT_PROCESS.QUARANTINE ||
    processType === SLOT_PROCESS.DEFECT ||
    processType === SLOT_PROCESS.WRITEOFF
  );
}

export function locationHasConfiguredProfile(locationAttrsJson: unknown): boolean {
  const profile = parseSlotProfileFromAttrs(locationAttrsJson);
  return Boolean(
    profile.storageClass ||
      profile.materialType ||
      profile.processType ||
      profile.stickerShape ||
      profile.productGroup ||
      profile.volume ||
      profile.applicationPlace ||
      profile.physicalAddress?.trim()
  );
}

export function extractItemSlotRequirements(item: {
  item_id: string;
  item_code: string;
  name: string;
  material_type: string | null;
  product_group: string | null;
  item_group_code: string | null;
  item_type_code?: string | null;
  item_class_code?: string | null;
  nomenclature: string | null;
  item_attrs_json: unknown;
}): ItemSlotRequirements {
  const attrs = asRecord(item.item_attrs_json);
  const nom = asRecord(attrs?.nomenclature);
  const slotFromAttrs = parseSlotProfileFromAttrs(attrs);
  const fromAttrs = parsePhysicalProfileFromItemAttrs(item.item_attrs_json);
  const text = [
    item.name,
    item.product_group,
    item.nomenclature,
    nom?.groupName,
    nom?.brandName,
    attrs?.brand,
  ]
    .filter(Boolean)
    .join(" ");

  const physical = deriveProductPhysicalProfile({
    ...fromAttrs,
    name: item.name,
    itemTypeCode: item.item_type_code,
    itemClassCode: item.item_class_code,
    itemGroupCode: item.item_group_code,
    productGroup: item.product_group,
    materialType: item.material_type ?? slotFromAttrs.materialType,
    storageClass: fromAttrs.storageClass ?? slotFromAttrs.storageClass,
  });

  const materialType = slotFromAttrs.materialType ?? inferMaterialType(item);
  const volume = slotFromAttrs.volume ?? parseVolumeFromText(text) ?? SLOT_VOLUME.ANY;
  const productGroup = slotFromAttrs.productGroup ?? inferProductGroup(text) ?? SLOT_PRODUCT_GROUP.ANY;
  const carbonationType = text.toLowerCase().includes("негаз") ? "still" : text.toLowerCase().includes("газ") ? "sparkling" : null;

  let stickerShape: string = slotFromAttrs.stickerShape ?? SLOT_SHAPE.ANY;
  if (stickerShape === SLOT_SHAPE.ANY && text.toLowerCase().includes("кругл")) stickerShape = SLOT_SHAPE.RND;
  if (stickerShape === SLOT_SHAPE.ANY && text.toLowerCase().includes("квадрат")) stickerShape = SLOT_SHAPE.SQR;

  return {
    itemId: item.item_id,
    itemCode: item.item_code,
    itemName: item.name,
    gtin: str(nom?.gtin) ?? str(attrs?.gtin),
    materialType,
    processType: slotFromAttrs.processType ?? inferProcessFromText(text),
    stickerShape,
    productGroup,
    volume,
    carbonationType,
    applicationPlace:
      slotFromAttrs.applicationPlace ??
      (text.toLowerCase().includes("пробк") ? SLOT_APPLICATION.CAP : SLOT_APPLICATION.ANY),
    brand: str(nom?.brandName) ?? str(attrs?.brand),
    storageClass: physical.storageClass,
    handling: physical.handling,
    sizeClass: physical.sizeClass,
    allowMixedNomenclature: false,
    allowMixedBatches: true,
    physical,
  };
}

type LocCandidate = {
  locationId: string;
  locationCode: string;
  displayName: string;
  warehouseCode: string;
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  locationStatusId: number;
  locationAttrsJson: unknown;
  availableQty: number;
  skuCount: number;
  hasSameItem: boolean;
  hasSameGtin: boolean;
  otherItemCount: number;
};

function scoreLocation(
  loc: LocCandidate,
  req: ItemSlotRequirements,
  incomingQty: number,
  preferReceiving: boolean,
  activeRules: StorageRuleRow[]
): StorageRecommendRow {
  const profile = parseSlotProfileFromAttrs(loc.locationAttrsJson);
  const phys = extractLocationPhysical(loc.locationAttrsJson);
  const capacity =
    profile.capacityUnits ?? phys.capacityQty ?? null;
  const currentUnits = loc.availableQty;
  const reasons: string[] = [];
  let score = profile.priority ?? 0;
  let forbidden = false;

  const locationClass = inferLocationStorageClass({
    storageClass: profile.storageClass,
    warehouseCode: loc.warehouseCode,
    zoneCode: loc.zoneCode,
    locationCode: loc.locationCode,
    processType: profile.processType,
  });
  const limits = parseLocationPhysicalLimits(profile as unknown as Record<string, unknown>);

  if (!locationHasConfiguredProfile(loc.locationAttrsJson) && !locationClass) {
    score -= 5;
    reasons.push("Профиль ячейки не настроен — слабый кандидат");
  }

  if (loc.locationStatusId === 2) {
    forbidden = true;
    score += WEIGHTS.blocked;
    reasons.push("Ячейка заблокирована");
  }

  if (locationAcceptsStorageClass(locationClass, limits.allowedStorageClasses, req.physical.storageClass)) {
    score += WEIGHTS.classMatch;
    reasons.push(
      `Класс хранения ${storageClassLabel(req.physical.storageClass)} → ${
        locationClass ? storageClassLabel(locationClass) : "ячейка без жёсткого класса"
      }`
    );
  } else if (locationClass) {
    forbidden = true;
    score += WEIGHTS.classMismatch;
    reasons.push(
      `Класс ${storageClassLabel(req.physical.storageClass)} не подходит к ${storageClassLabel(locationClass)}`
    );
  }

  const dimFit = itemFitsLocationLimits(req.physical, limits);
  if (!dimFit.ok) {
    forbidden = true;
    score -= 50;
    reasons.push(...dimFit.reasons);
  } else if (dimFit.reasons.length) {
    score += WEIGHTS.dimFit;
    reasons.push(...dimFit.reasons);
  }

  const fillPct =
    capacity != null && capacity > 0 ? Math.min(100, Math.max(0, (currentUnits / capacity) * 100)) : null;
  const fillBonus = fillPercentBonus(fillPct);
  if (fillBonus) {
    score += fillBonus;
    if (fillBonus > 0 && fillPct != null) reasons.push(`Заполненность ${Math.round(fillPct)}%`);
  }

  const mat = matchesCode(req.materialType, profile.materialType);
  if (mat === "match") {
    score += WEIGHTS.materialMatch;
    reasons.push(`Совпал тип материала: ${slotLabel("materialType", profile.materialType)}`);
  } else if (mat === "mismatch") {
    score += WEIGHTS.materialMismatch;
    reasons.push("Тип материала другой — не блокирует, если класс хранения совпал");
  }

  const proc = matchesCode(req.processType, profile.processType);
  if (proc === "match") {
    score += WEIGHTS.processMatch;
    reasons.push(`Совпал процесс: ${slotLabel("processType", profile.processType)}`);
  } else if (proc === "mismatch") {
    score += WEIGHTS.processMismatch;
    reasons.push("Процесс не совпадает (допустимо как ближайшая)");
  }

  const shape = matchesCode(req.stickerShape, profile.stickerShape);
  if (shape === "match") {
    score += WEIGHTS.shapeMatch;
    reasons.push(`Совпала форма: ${slotLabel("stickerShape", profile.stickerShape)}`);
  } else if (shape === "mismatch") {
    score += WEIGHTS.shapeMismatch;
    reasons.push("Форма стикера не совпадает");
  }

  const grp = matchesCode(req.productGroup, profile.productGroup);
  if (grp === "match") {
    score += WEIGHTS.productGroupMatch;
    reasons.push(`Совпала группа: ${slotLabel("productGroup", profile.productGroup)}`);
  }

  const vol = matchesCode(req.volume, profile.volume);
  if (vol === "match") {
    score += WEIGHTS.volumeMatch;
    reasons.push(`Совпал объём: ${slotLabel("volume", profile.volume)}`);
  }

  const app = matchesCode(req.applicationPlace, profile.applicationPlace);
  if (app === "match") {
    score += WEIGHTS.applicationMatch;
    reasons.push(`Совпало место нанесения: ${slotLabel("applicationPlace", profile.applicationPlace)}`);
  }

  if (loc.hasSameItem) {
    score += WEIGHTS.sameItem;
    reasons.push("В ячейке уже есть эта номенклатура");
  }
  if (loc.hasSameGtin) {
    score += WEIGHTS.sameGtin;
    reasons.push("В ячейке уже есть этот GTIN");
  }

  if (profile.rememberNomenclature && profile.preferredItemCode) {
    if (profile.preferredItemCode === req.itemCode) {
      score += WEIGHTS.preferredNomenclature;
      reasons.push(
        `Закреплённая номенклатура: ${profile.preferredItemName || profile.preferredItemCode}`
      );
    } else if (!loc.hasSameItem) {
      score += WEIGHTS.preferredMismatch;
      forbidden = true;
      reasons.push(
        `Ячейка закреплена за ${profile.preferredItemName || profile.preferredItemCode}`
      );
    }
  }

  if (loc.skuCount === 0) {
    score += WEIGHTS.emptySuitable;
    reasons.push("Ячейка пустая и подходит по профилю");
  }

  if (!profile.allowMixedNomenclature && loc.otherItemCount > 0 && !loc.hasSameItem) {
    forbidden = true;
    reasons.push("Смешение номенклатуры запрещено");
  }

  if (capacity != null) {
    const after = currentUnits + incomingQty;
    if (after > capacity + 1e-9) {
      forbidden = true;
      score += WEIGHTS.noCapacity;
      reasons.push(`Нет места: ${after} > вместимость ${capacity}`);
    } else {
      reasons.push(`Свободно ~${Math.max(0, capacity - currentUnits)} из ${capacity}`);
    }
  }

  if (isSpecialPurpose(profile.processType) && !preferReceiving) {
    forbidden = true;
    score += WEIGHTS.specialZoneMismatch;
    reasons.push("Ячейка карантина/брака — не для обычной партии");
  }

  if (preferReceiving && profile.processType === SLOT_PROCESS.RECV) {
    score += 40;
    reasons.push("Зона приёмки");
  }

  for (const rule of activeRules) {
    if (!storageRuleMatchesRequirements(rule, req)) continue;
    score = applyStorageRuleBonuses(
      rule,
      {
        locationId: loc.locationId,
        zoneId: loc.zoneId,
        zoneCode: loc.zoneCode,
        warehouseCode: loc.warehouseCode,
        locationCode: loc.locationCode,
        storageClass: profile.storageClass ?? locationClass,
        processType: profile.processType,
      },
      score,
      reasons
    );
  }

  return {
    locationId: loc.locationId,
    locationCode: loc.locationCode,
    displayName: loc.displayName || buildSlotDisplayName(profile),
    zoneCode: loc.zoneCode,
    score,
    forbidden,
    reasons,
    availableCapacity: capacity != null ? Math.max(0, capacity - currentUnits) : null,
    currentUnits,
    skuCount: loc.skuCount,
    hasSameItem: loc.hasSameItem,
    hasSameGtin: loc.hasSameGtin,
  };
}

export async function recommendStorageLocations(
  client: PoolClient,
  siteId: number,
  input: {
    itemCode: string;
    qty?: number;
    preferReceiving?: boolean;
    limit?: number;
  }
): Promise<{ requirements: ItemSlotRequirements; recommendations: StorageRecommendRow[] }> {
  const resolved = await resolveItemByCodeOrBarcode(client, siteId, input.itemCode.trim());
  if (!resolved) {
    throw new WmsHttpError(404, "item not found", "item_not_found");
  }
  const itemRow = await client.query<{
    item_id: string;
    item_code: string;
    name: string;
    material_type: string | null;
    product_group: string | null;
    item_group_code: string | null;
    item_type_code: string | null;
    item_class_code: string | null;
    nomenclature: string | null;
    item_attrs_json: unknown;
  }>(
    `SELECT item_id::text, item_code, name, material_type, product_group, item_group_code,
            item_type_code, item_class_code, nomenclature, item_attrs_json
     FROM wms_items WHERE item_id = $1::bigint`,
    [resolved.item_id]
  );
  if (itemRow.rows.length === 0) {
    throw new WmsHttpError(404, "item not found", "item_not_found");
  }

  const req = extractItemSlotRequirements(itemRow.rows[0]);
  const qty = Number.isFinite(Number(input.qty)) && Number(input.qty) > 0 ? Number(input.qty) : 1;
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);

  let activeRules: StorageRuleRow[] = [];
  try {
    activeRules = await listStorageRules(client, siteId, true);
  } catch {
    activeRules = [];
  }

  const locs = await client.query<LocCandidate>(
    `
    SELECT
      l.location_id::text AS "locationId",
      l.location_code AS "locationCode",
      l.display_name AS "displayName",
      w.warehouse_code AS "warehouseCode",
      z.zone_id::text AS "zoneId",
      z.zone_code AS "zoneCode",
      z.name AS "zoneName",
      l.location_status_id AS "locationStatusId",
      l.location_attrs_json AS "locationAttrsJson",
      COALESCE(SUM(sb.available_qty + sb.in_production_qty), 0)::float8 AS "availableQty",
      COUNT(DISTINCT sb.item_id)::int AS "skuCount",
      COALESCE(BOOL_OR(sb.item_id = $2::bigint), FALSE) AS "hasSameItem",
      COALESCE(BOOL_OR(
        $3 <> ''
        AND (
          COALESCE(i.item_attrs_json->'nomenclature'->>'gtin', i.item_attrs_json->>'gtin', '') = $3
        )
      ), FALSE) AS "hasSameGtin",
      COALESCE(COUNT(DISTINCT CASE WHEN sb.item_id <> $2::bigint THEN sb.item_id END), 0)::int AS "otherItemCount"
    FROM wms_locations l
    JOIN wms_zones z ON z.zone_id = l.zone_id
    JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
    LEFT JOIN wms_stock_balances sb ON sb.location_id = l.location_id AND sb.site_id = l.site_id
    LEFT JOIN wms_items i ON i.item_id = sb.item_id
    WHERE l.site_id = $1
    GROUP BY l.location_id, l.location_code, l.display_name, w.warehouse_code, z.zone_id, z.zone_code, z.name, l.location_status_id, l.location_attrs_json
    ORDER BY l.location_code
    LIMIT 2000
    `,
    [siteId, req.itemId, req.gtin ?? ""]
  );

  const scored = locs.rows.map((row) =>
    scoreLocation(row as LocCandidate, req, qty, Boolean(input.preferReceiving), activeRules)
  );

  const allowed = scored.filter((r) => !r.forbidden).sort((a, b) => b.score - a.score);
  const fallback = scored.filter((r) => r.forbidden).sort((a, b) => b.score - a.score);
  const recommendations = [...allowed, ...fallback].slice(0, limit);

  const matchingRules = activeRules.filter((r) => storageRuleMatchesRequirements(r, req));

  return { requirements: req, recommendations, matchingRules };
}
