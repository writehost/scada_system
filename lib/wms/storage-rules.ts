import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import type { ItemSlotRequirements } from "@/lib/wms/storage-slot";
import {
  defaultCriteriaForClass,
  describePhysicalCriteria,
  inferLocationStorageClass,
  normalizeStorageClass,
  parseRulePhysicalCriteria,
  physicalCriteriaMatch,
  storageClassLabel,
  type RulePhysicalCriteria,
  type StorageClassCode,
} from "@/lib/wms/physical-profile";

function ruleFieldMatches(ruleVal: string | null, reqVal: string | null | undefined): boolean {
  const r = normCode(ruleVal);
  if (!r) return true;
  const q = normCode(reqVal ?? null);
  if (!q) return false;
  return r === q;
}

export type StorageRuleRow = {
  ruleId: string;
  name: string;
  materialType: string | null;
  processType: string | null;
  stickerShape: string | null;
  productGroup: string | null;
  brand: string | null;
  productType: string | null;
  carbonationType: string | null;
  volume: string | null;
  applicationPlace: string | null;
  storageClass: string | null;
  allowedZoneCodes: string[] | null;
  forbiddenZoneCodes: string[] | null;
  enforcePreferredLocation: boolean;
  criteria: RulePhysicalCriteria;
  preferredZoneId: string | null;
  preferredZoneCode: string | null;
  preferredZoneName: string | null;
  preferredLocationId: string | null;
  preferredLocationCode: string | null;
  priority: number;
  isActive: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StorageRuleInput = {
  name: string;
  materialType?: string | null;
  processType?: string | null;
  stickerShape?: string | null;
  productGroup?: string | null;
  brand?: string | null;
  productType?: string | null;
  carbonationType?: string | null;
  volume?: string | null;
  applicationPlace?: string | null;
  storageClass?: string | null;
  allowedZoneCodes?: string[] | null;
  forbiddenZoneCodes?: string[] | null;
  enforcePreferredLocation?: boolean;
  criteria?: RulePhysicalCriteria | null;
  preferredZoneId?: string | null;
  preferredLocationId?: string | null;
  priority?: number;
  isActive?: boolean;
  note?: string | null;
};

function normCode(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "ANY") return null;
  return s;
}

function normStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return out.length ? out : null;
}

let schemaReady = false;

export async function ensureStorageRulesSchema(client: PoolClient): Promise<void> {
  if (schemaReady) return;
  await client.query(`
    ALTER TABLE wms_storage_rules
      ADD COLUMN IF NOT EXISTS storage_class text,
      ADD COLUMN IF NOT EXISTS allowed_zone_codes text[],
      ADD COLUMN IF NOT EXISTS forbidden_zone_codes text[],
      ADD COLUMN IF NOT EXISTS enforce_preferred_location boolean NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS criteria_json jsonb
  `);
  schemaReady = true;
}

/** Правило подходит к партии: класс/физика, затем опциональные производственные поля. */
export function storageRuleMatchesRequirements(
  rule: Pick<
    StorageRuleRow,
    | "materialType"
    | "processType"
    | "stickerShape"
    | "productGroup"
    | "brand"
    | "productType"
    | "carbonationType"
    | "volume"
    | "applicationPlace"
    | "storageClass"
    | "criteria"
  >,
  req: ItemSlotRequirements
): boolean {
  const wantClass = normalizeStorageClass(rule.storageClass ?? rule.criteria.storageClass);
  if (wantClass && req.physical.storageClass !== wantClass) return false;
  if (!physicalCriteriaMatch(rule.criteria, req.physical)) return false;
  return (
    ruleFieldMatches(rule.materialType, req.materialType) &&
    ruleFieldMatches(rule.processType, req.processType) &&
    ruleFieldMatches(rule.stickerShape, req.stickerShape) &&
    ruleFieldMatches(rule.productGroup, req.productGroup) &&
    ruleFieldMatches(rule.brand, req.brand) &&
    ruleFieldMatches(rule.productType, req.productType) &&
    ruleFieldMatches(rule.carbonationType, req.carbonationType) &&
    ruleFieldMatches(rule.volume, req.volume) &&
    ruleFieldMatches(rule.applicationPlace, req.applicationPlace)
  );
}

export type RuleLocationRef = {
  locationId: string;
  zoneId: string;
  zoneCode?: string | null;
  warehouseCode?: string | null;
  locationCode?: string | null;
  storageClass?: string | null;
  processType?: string | null;
};

export function storageRuleAppliesToLocation(rule: StorageRuleRow, loc: RuleLocationRef): boolean {
  const zone = (loc.zoneCode ?? "").trim().toUpperCase();
  const forbidden = (rule.forbiddenZoneCodes ?? []).map((z) => z.trim().toUpperCase());
  if (zone && forbidden.includes(zone)) return false;

  if (rule.preferredLocationId && loc.locationId === rule.preferredLocationId) return true;

  const locationClass = inferLocationStorageClass({
    storageClass: loc.storageClass,
    warehouseCode: loc.warehouseCode,
    zoneCode: loc.zoneCode,
    locationCode: loc.locationCode,
    processType: loc.processType,
  });
  const ruleClass = normalizeStorageClass(rule.storageClass ?? rule.criteria.storageClass);
  if (ruleClass && locationClass && ruleClass !== locationClass) return false;

  const allowed = (rule.allowedZoneCodes ?? []).map((z) => z.trim().toUpperCase());
  if (allowed.length && zone && !allowed.includes(zone) && !(ruleClass && locationClass === ruleClass)) {
    return false;
  }

  if (rule.preferredZoneId && loc.zoneId === rule.preferredZoneId) return true;
  if (ruleClass && locationClass === ruleClass) return true;
  if (allowed.length && zone && allowed.includes(zone)) return true;
  if (!ruleClass && !allowed.length && !rule.preferredZoneId && !rule.preferredLocationId) return true;
  return false;
}

export function applyStorageRuleBonuses(
  rule: StorageRuleRow,
  loc: RuleLocationRef,
  score: number,
  reasons: string[]
): number {
  if (!storageRuleAppliesToLocation(rule, loc)) return score;
  let s = score;
  if (rule.preferredLocationId && loc.locationId === rule.preferredLocationId) {
    s += 55 + Math.min(45, Math.floor(rule.priority / 2));
    reasons.push(`Правило «${rule.name}»: целевая ячейка`);
    return s;
  }
  if (rule.preferredZoneId && loc.zoneId === rule.preferredZoneId) {
    s += 30 + Math.min(30, Math.floor(rule.priority / 3));
    reasons.push(`Правило «${rule.name}»: зона ${rule.preferredZoneCode ?? ""}`.trim());
    return s;
  }
  const cls = normalizeStorageClass(rule.storageClass ?? rule.criteria.storageClass);
  if (cls) {
    s += 24 + Math.min(20, Math.floor(rule.priority / 5));
    reasons.push(`Правило «${rule.name}»: ${storageClassLabel(cls)}`);
    return s;
  }
  s += 10 + Math.min(20, Math.floor(rule.priority / 5));
  reasons.push(`Правило «${rule.name}»: совпадение критериев`);
  return s;
}

function mapRuleRow(r: Record<string, unknown>): StorageRuleRow {
  const criteria = parseRulePhysicalCriteria(r.criteria_json);
  const storageClass =
    (r.storage_class != null ? String(r.storage_class) : null) ?? criteria.storageClass ?? null;
  if (storageClass && !criteria.storageClass) criteria.storageClass = storageClass;
  return {
    ruleId: String(r.rule_id),
    name: String(r.name),
    materialType: r.material_type != null ? String(r.material_type) : null,
    processType: r.process_type != null ? String(r.process_type) : null,
    stickerShape: r.sticker_shape != null ? String(r.sticker_shape) : null,
    productGroup: r.product_group != null ? String(r.product_group) : null,
    brand: r.brand != null ? String(r.brand) : null,
    productType: r.product_type != null ? String(r.product_type) : null,
    carbonationType: r.carbonation_type != null ? String(r.carbonation_type) : null,
    volume: r.volume != null ? String(r.volume) : null,
    applicationPlace: r.application_place != null ? String(r.application_place) : null,
    storageClass,
    allowedZoneCodes: normStringList(r.allowed_zone_codes),
    forbiddenZoneCodes: normStringList(r.forbidden_zone_codes),
    enforcePreferredLocation: Boolean(r.enforce_preferred_location),
    criteria,
    preferredZoneId: r.preferred_zone_id != null ? String(r.preferred_zone_id) : null,
    preferredZoneCode: r.preferred_zone_code != null ? String(r.preferred_zone_code) : null,
    preferredZoneName: r.preferred_zone_name != null ? String(r.preferred_zone_name) : null,
    preferredLocationId: r.preferred_location_id != null ? String(r.preferred_location_id) : null,
    preferredLocationCode: r.preferred_location_code != null ? String(r.preferred_location_code) : null,
    priority: Number(r.priority ?? 100),
    isActive: Boolean(r.is_active),
    note: r.note != null ? String(r.note) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const RULE_SELECT = `
  SELECT
    r.rule_id,
    r.name,
    r.material_type,
    r.process_type,
    r.sticker_shape,
    r.product_group,
    r.brand,
    r.product_type,
    r.carbonation_type,
    r.volume,
    r.application_place,
    r.storage_class,
    r.allowed_zone_codes,
    r.forbidden_zone_codes,
    r.enforce_preferred_location,
    r.criteria_json,
    r.preferred_zone_id,
    z.zone_code AS preferred_zone_code,
    z.name AS preferred_zone_name,
    r.preferred_location_id,
    pl.location_code AS preferred_location_code,
    r.priority,
    r.is_active,
    r.note,
    r.created_at::text,
    r.updated_at::text
  FROM wms_storage_rules r
  LEFT JOIN wms_zones z ON z.zone_id = r.preferred_zone_id
  LEFT JOIN wms_locations pl ON pl.location_id = r.preferred_location_id
`;

const P1_DEFAULTS: Record<
  string,
  { name: string; class: StorageClassCode; allowed: string[] | null; forbidden: string[] | null; note: string }
> = {
  A: {
    name: "S1 · Мелкоштучный",
    class: "S1",
    allowed: ["STORE", "ST-SER", "ST-BAGG", "RECV", "MARK"],
    forbidden: ["QUARANTINE", "DEFECT"],
    note: "",
  },
  B: {
    name: "S2 · Средний тарный",
    class: "S2",
    allowed: ["STORE", "ST-BAGG", "RECV"],
    forbidden: ["QUARANTINE", "DEFECT"],
    note: "",
  },
  C: {
    name: "S3 · Сырьё",
    class: "S3",
    allowed: ["STORE", "RECV"],
    forbidden: ["QUARANTINE", "DEFECT"],
    note: "",
  },
  D: {
    name: "S4 · Палетный / ГП",
    class: "S4",
    allowed: ["STORE", "SHIP", "RECV", "A", "B", "C", "D", "E", "F", "K", "ROWS"],
    forbidden: ["QUARANTINE", "DEFECT"],
    note: "",
  },
  E: {
    name: "S5 · Карантин",
    class: "S5",
    allowed: ["QUARANTINE", "DEFECT"],
    forbidden: ["STORE", "RECV", "SHIP", "WORK", "LINE", "ST-SER", "ST-BAGG"],
    note: "",
  },
};

async function refreshLegacyClassRules(client: PoolClient, siteId: number): Promise<void> {
  const rows = await client.query<{
    rule_id: string;
    name: string;
    storage_class: string | null;
    criteria_json: unknown;
  }>(
    `SELECT rule_id::text, name, storage_class, criteria_json
     FROM wms_storage_rules
     WHERE site_id = $1`,
    [siteId]
  );
  for (const row of rows.rows) {
    const cls = normalizeStorageClass(row.storage_class);
    if (!cls) continue;
    const preset = P1_DEFAULTS[STORAGE_CLASS_TO_LEGACY[cls]];
    if (!preset) continue;
    const rename = /^P1 default\b/i.test(row.name) || /Коробочн/i.test(row.name);
    if (row.criteria_json && !rename) continue;
    const criteria = {
      ...defaultCriteriaForClass(cls),
      storageClass: cls,
    };
    await client.query(
      `UPDATE wms_storage_rules SET
         name = CASE WHEN $3 THEN $4 ELSE name END,
         criteria_json = COALESCE(criteria_json, $5::jsonb),
         note = CASE
           WHEN note IS NULL THEN NULL
           WHEN note LIKE 'P1-%'
             OR note LIKE 'Статика%'
             OR note LIKE 'Упаковка%'
             OR note LIKE 'Сырьё%'
             OR note LIKE 'ГП %'
             OR note LIKE 'Мелкоштучный%'
             OR note LIKE 'Средний тарный%'
             OR note LIKE 'Палета%'
             OR note LIKE 'Брак%'
             THEN NULL
           ELSE note
         END,
         updated_at = now()
       WHERE rule_id = $1::bigint AND site_id = $2`,
      [row.rule_id, siteId, rename, preset.name, JSON.stringify(criteria)]
    );
  }
}

const STORAGE_CLASS_TO_LEGACY: Record<StorageClassCode, string> = {
  S1: "A",
  S2: "B",
  S3: "C",
  S4: "D",
  S5: "E",
};

export async function listStorageRules(
  client: PoolClient,
  siteId: number,
  activeOnly = false
): Promise<StorageRuleRow[]> {
  await ensureStorageRulesSchema(client);
  try {
    await refreshLegacyClassRules(client, siteId);
  } catch {
    /* схема могла быть без новых колонок на первом проходе */
  }
  const r = await client.query(
    `${RULE_SELECT}
     WHERE r.site_id = $1
       AND ($2::boolean = FALSE OR r.is_active = TRUE)
     ORDER BY r.priority DESC, r.rule_id`,
    [siteId, activeOnly]
  );
  return r.rows.map((row) => mapRuleRow(row as Record<string, unknown>));
}

export async function getStorageRuleById(
  client: PoolClient,
  siteId: number,
  ruleId: string
): Promise<StorageRuleRow | null> {
  await ensureStorageRulesSchema(client);
  const r = await client.query(
    `${RULE_SELECT}
     WHERE r.site_id = $1 AND r.rule_id = $2::bigint`,
    [siteId, ruleId]
  );
  if (r.rows.length === 0) return null;
  return mapRuleRow(r.rows[0] as Record<string, unknown>);
}

async function resolveZoneId(
  client: PoolClient,
  siteId: number,
  zoneId: string | null | undefined
): Promise<string | null> {
  const id = (zoneId ?? "").trim();
  if (!id) return null;
  const r = await client.query<{ zone_id: string }>(
    `SELECT z.zone_id::text
     FROM wms_zones z
     JOIN wms_warehouses w ON w.warehouse_id = z.warehouse_id
     WHERE w.site_id = $1 AND z.zone_id = $2::bigint`,
    [siteId, id]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(404, "preferred zone not found", "zone_not_found");
  }
  return r.rows[0]!.zone_id;
}

async function resolveLocationId(
  client: PoolClient,
  siteId: number,
  locationId: string | null | undefined
): Promise<string | null> {
  const id = (locationId ?? "").trim();
  if (!id) return null;
  const r = await client.query<{ location_id: string }>(
    `SELECT location_id::text FROM wms_locations WHERE site_id = $1 AND location_id = $2::bigint`,
    [siteId, id]
  );
  if (r.rows.length === 0) {
    throw new WmsHttpError(404, "preferred location not found", "location_not_found");
  }
  return r.rows[0]!.location_id;
}

function persistClass(input: StorageRuleInput): string | null {
  return normalizeStorageClass(input.storageClass ?? input.criteria?.storageClass) ??
    normCode(input.storageClass);
}

function persistCriteria(input: StorageRuleInput): RulePhysicalCriteria {
  const cls = normalizeStorageClass(input.storageClass ?? input.criteria?.storageClass);
  return {
    ...(cls ? defaultCriteriaForClass(cls) : {}),
    ...(input.criteria ?? {}),
    storageClass: cls ?? input.criteria?.storageClass ?? null,
  };
}

export async function createStorageRule(
  client: PoolClient,
  siteId: number,
  input: StorageRuleInput
): Promise<StorageRuleRow> {
  await ensureStorageRulesSchema(client);
  const name = input.name.trim();
  if (!name) throw new WmsHttpError(400, "name is required", "validation");

  const preferredZoneId = await resolveZoneId(client, siteId, input.preferredZoneId);
  const preferredLocationId = await resolveLocationId(client, siteId, input.preferredLocationId);
  const storageClass = persistClass(input);
  const criteria = persistCriteria(input);

  const r = await client.query<{ rule_id: string }>(
    `INSERT INTO wms_storage_rules (
       site_id, name, material_type, process_type, sticker_shape, product_group,
       brand, product_type, carbonation_type, volume, application_place,
       storage_class, allowed_zone_codes, forbidden_zone_codes, enforce_preferred_location,
       criteria_json,
       preferred_zone_id, preferred_location_id, priority, is_active, note, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
       $12, $13, $14, $15, $16::jsonb,
       $17::bigint, $18::bigint, $19, $20, $21, now()
     )
     RETURNING rule_id::text`,
    [
      siteId,
      name,
      normCode(input.materialType),
      normCode(input.processType),
      normCode(input.stickerShape),
      normCode(input.productGroup),
      normCode(input.brand),
      normCode(input.productType),
      normCode(input.carbonationType),
      normCode(input.volume),
      normCode(input.applicationPlace),
      storageClass,
      input.allowedZoneCodes ?? null,
      input.forbiddenZoneCodes ?? null,
      input.enforcePreferredLocation === true,
      JSON.stringify(criteria),
      preferredZoneId,
      preferredLocationId,
      Math.min(10000, Math.max(0, Number(input.priority ?? 100))),
      input.isActive !== false,
      input.note?.trim() || null,
    ]
  );

  const created = await getStorageRuleById(client, siteId, r.rows[0]!.rule_id);
  if (!created) throw new WmsHttpError(500, "failed to load created rule", "internal");
  return created;
}

export async function updateStorageRule(
  client: PoolClient,
  siteId: number,
  ruleId: string,
  input: Partial<StorageRuleInput>
): Promise<StorageRuleRow> {
  await ensureStorageRulesSchema(client);
  const cur = await getStorageRuleById(client, siteId, ruleId);
  if (!cur) throw new WmsHttpError(404, "rule not found", "rule_not_found");

  const merged: StorageRuleInput = {
    name: (input.name ?? cur.name).trim(),
    materialType: input.materialType !== undefined ? input.materialType : cur.materialType,
    processType: input.processType !== undefined ? input.processType : cur.processType,
    stickerShape: input.stickerShape !== undefined ? input.stickerShape : cur.stickerShape,
    productGroup: input.productGroup !== undefined ? input.productGroup : cur.productGroup,
    brand: input.brand !== undefined ? input.brand : cur.brand,
    productType: input.productType !== undefined ? input.productType : cur.productType,
    carbonationType:
      input.carbonationType !== undefined ? input.carbonationType : cur.carbonationType,
    volume: input.volume !== undefined ? input.volume : cur.volume,
    applicationPlace:
      input.applicationPlace !== undefined ? input.applicationPlace : cur.applicationPlace,
    storageClass: input.storageClass !== undefined ? input.storageClass : cur.storageClass,
    allowedZoneCodes:
      input.allowedZoneCodes !== undefined ? input.allowedZoneCodes : cur.allowedZoneCodes,
    forbiddenZoneCodes:
      input.forbiddenZoneCodes !== undefined ? input.forbiddenZoneCodes : cur.forbiddenZoneCodes,
    enforcePreferredLocation:
      input.enforcePreferredLocation !== undefined
        ? input.enforcePreferredLocation
        : cur.enforcePreferredLocation,
    criteria: input.criteria !== undefined ? input.criteria : cur.criteria,
    preferredZoneId:
      input.preferredZoneId !== undefined ? input.preferredZoneId : cur.preferredZoneId,
    preferredLocationId:
      input.preferredLocationId !== undefined
        ? input.preferredLocationId
        : cur.preferredLocationId,
    priority: input.priority !== undefined ? input.priority : cur.priority,
    isActive: input.isActive !== undefined ? input.isActive : cur.isActive,
    note: input.note !== undefined ? input.note : cur.note,
  };

  const preferredZoneId = await resolveZoneId(client, siteId, merged.preferredZoneId);
  const preferredLocationId = await resolveLocationId(client, siteId, merged.preferredLocationId);

  await client.query(
    `UPDATE wms_storage_rules SET
       name = $3,
       material_type = $4,
       process_type = $5,
       sticker_shape = $6,
       product_group = $7,
       brand = $8,
       product_type = $9,
       carbonation_type = $10,
       volume = $11,
       application_place = $12,
       storage_class = $13,
       allowed_zone_codes = $14,
       forbidden_zone_codes = $15,
       enforce_preferred_location = $16,
       criteria_json = $17::jsonb,
       preferred_zone_id = $18::bigint,
       preferred_location_id = $19::bigint,
       priority = $20,
       is_active = $21,
       note = $22,
       updated_at = now()
     WHERE site_id = $1 AND rule_id = $2::bigint`,
    [
      siteId,
      ruleId,
      merged.name,
      normCode(merged.materialType),
      normCode(merged.processType),
      normCode(merged.stickerShape),
      normCode(merged.productGroup),
      normCode(merged.brand),
      normCode(merged.productType),
      normCode(merged.carbonationType),
      normCode(merged.volume),
      normCode(merged.applicationPlace),
      persistClass(merged),
      merged.allowedZoneCodes ?? null,
      merged.forbiddenZoneCodes ?? null,
      merged.enforcePreferredLocation === true,
      JSON.stringify(persistCriteria(merged)),
      preferredZoneId,
      preferredLocationId,
      Math.min(10000, Math.max(0, Number(merged.priority ?? 100))),
      merged.isActive !== false,
      merged.note?.trim() || null,
    ]
  );

  const updated = await getStorageRuleById(client, siteId, ruleId);
  if (!updated) throw new WmsHttpError(404, "rule not found", "rule_not_found");
  return updated;
}

export async function deleteStorageRule(
  client: PoolClient,
  siteId: number,
  ruleId: string
): Promise<void> {
  const r = await client.query(
    `DELETE FROM wms_storage_rules WHERE site_id = $1 AND rule_id = $2::bigint`,
    [siteId, ruleId]
  );
  if (r.rowCount === 0) throw new WmsHttpError(404, "rule not found", "rule_not_found");
}

export function filterRulesForRequirements(
  rules: StorageRuleRow[],
  req: ItemSlotRequirements
): StorageRuleRow[] {
  return rules.filter((r) => r.isActive && storageRuleMatchesRequirements(r, req));
}

export function filterRulesForLocation(
  rules: StorageRuleRow[],
  location: RuleLocationRef
): StorageRuleRow[] {
  return rules.filter((r) => r.isActive && storageRuleAppliesToLocation(r, location));
}

export function describeStorageRuleCriteria(rule: StorageRuleRow): string {
  const parts = describePhysicalCriteria({
    ...rule.criteria,
    storageClass: rule.storageClass ?? rule.criteria.storageClass,
  });
  if (rule.allowedZoneCodes?.length) {
    parts.push(`зоны ${rule.allowedZoneCodes.join(", ")}`);
  }
  if (rule.materialType) parts.push(`материал ${rule.materialType}`);
  if (rule.processType) parts.push(`этап ${rule.processType}`);
  if (rule.volume) parts.push(`объём ${rule.volume}`);
  if (rule.applicationPlace) parts.push(`нанесение ${rule.applicationPlace}`);
  return parts.length ? parts.join(" · ") : "Любая партия";
}
