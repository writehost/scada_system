import type { PoolClient } from "pg";
import { fetchCrptInfoFromUpstream, normalizeCrptCode } from "@/lib/wms/crpt";
import { lookupPrintedLabelCode } from "@/lib/wms/label-code-orders";
import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth";
import {
  russifyCrptPackageType,
  russifyCrptProductGroup,
} from "@/lib/wms/crpt-product-groups";
import { WmsHttpError } from "@/lib/wms/errors";
import { extractItemImageUrl } from "@/lib/wms/item-image";
import { ensureItemClass, ensureItemGroup } from "@/lib/wms/item-master-refs";
import {
  getStickersGroupShelfLifeDays,
  LEGACY_STICKER_SHELF_LIFE_DAYS,
  seedStickersGroupShelfLifeDefault,
} from "@/lib/wms/stickers-group-shelf-life";
import { withStickerNamePrefix } from "@/lib/wms/sticker-item-name";
import { isBottledDrinkName, isStickerOrLabelName } from "@/lib/wms/physical-profile";
import { productGroupIconSrcForRow } from "@/lib/wms-product-group-icons";

/** Публичный URL фото GTIN из кэша GSMT (как в режиме «Инфо» на ТСД). */
function gsmtGtinImageUrl(gtin: string | null | undefined): string | null {
  const digits = String(gtin ?? "").replace(/\D/g, "");
  if (digits.length < 8) return null;
  const gtin14 = digits.padStart(14, "0").slice(-14);
  return `/gsmt/api/gtin-images/${gtin14}`;
}

/**
 * Фото для приёмки на ТСД:
 * 1) карточка номенклатуры;
 * 2) кэш GSMT по GTIN (`/gsmt/api/gtin-images/…`);
 * 3) иконка группы (стикеры → `/wms/groups/stickers.png`).
 */
function resolveReceivingItemImageUrl(input: {
  attrs: Record<string, unknown> | null | undefined;
  productGroup: string | null | undefined;
  productGroupLabel: string | null | undefined;
  name: string | null | undefined;
  itemCode: string | null | undefined;
  gtin?: string | null;
  stickersSession?: boolean;
}): string | null {
  const fromCard = extractItemImageUrl(input.attrs);
  if (fromCard) return fromCard;
  const fromGsmt = gsmtGtinImageUrl(input.gtin || input.itemCode);
  if (fromGsmt) return fromGsmt;
  const fromGroup =
    productGroupIconSrcForRow(input.productGroupLabel || input.productGroup, input.name, input.itemCode) ||
    (input.stickersSession ? "/wms/groups/stickers.png" : null);
  return fromGroup;
}

/** Срок годности кода по умолчанию (напитки, блоки ЧЗ и т.д.). */
export const DEFAULT_CODE_SHELF_LIFE_DAYS = 365;
/** Устаревшее значение в карточках; новые стикеры берут срок из справочника группы stickers. */
export const LOCAL_STICKER_SHELF_LIFE_DAYS = LEGACY_STICKER_SHELF_LIFE_DAYS;

/** expirationDate в ответе ЧЗ — часто срок действия КМ (30–90 д.), не «годен до» товара. */
export const MARKING_CODE_VALIDITY_MAX_DAYS = 120;

export type CrptCisInfo = Record<string, unknown>;

export type ExpiryState = "ok" | "warning" | "expired";

export type ResolvedReceivingItem = {
  itemId: string;
  itemCode: string;
  name: string;
  gtin: string;
  created: boolean;
  packageRole: "unit" | "block";
  productGroup: string | null;
  productGroupLabel: string | null;
  itemClassCode: string | null;
  itemClassLabel: string | null;
  generalPackageType: string | null;
  generalPackageTypeLabel: string | null;
  /** Фото из карточки номенклатуры (`item_attrs_json`), если есть. */
  imageUrl: string | null;
};

export type ReceivingExpiryCheck = {
  emissionAt: string | null;
  expiresAt: string | null;
  shelfLifeDays: number;
  daysRemaining: number | null;
  state: ExpiryState;
  message: string;
};

export type ResolveReceivingScanResult = {
  scannedCode: string;
  normalizedCode: string;
  primaryItem: ResolvedReceivingItem;
  nestedItem: ResolvedReceivingItem | null;
  specLinked: boolean;
  specQtyPer: number | null;
  crptStatus: string | null;
  warnings: string[];
  expiry: ReceivingExpiryCheck;
};

/** Контекст активной приёмки с ТСД (категория/группа маршрута). */
export type ReceivingScanContext = {
  receivingCategory?: string | null;
  productGroup?: string | null;
};

const STICKERS_WMS_GROUP = "stickers";
const STICKERS_WMS_GROUP_LABEL = "Стикеры";
const STICKERS_ITEM_CLASS = "S1";
const STICKERS_ITEM_CLASS_LABEL = "S1 · Мелкоштучный";
/** Колонка «Тип» в номенклатуре: Материалы (не путать с группой «Стикеры»). */
const STICKERS_ITEM_TYPE_CODE = "materials";

function normalizeReceivingRouteKey(value: unknown): string {
  return asText(value).toLowerCase().replace(/ё/g, "е");
}

/** Приёмка «Стикеры»: WMS-группа/класс из маршрута ТСД, а не productGroup ЧЗ. */
export function isStickersReceivingContext(ctx?: ReceivingScanContext | null): boolean {
  const keys = [ctx?.receivingCategory, ctx?.productGroup].map(normalizeReceivingRouteKey).filter(Boolean);
  return keys.some(
    (k) =>
      k === STICKERS_WMS_GROUP ||
      k === "sticker" ||
      k.includes("sticker") ||
      k.includes("стикер") ||
      k.includes("этикет")
  );
}

function itemClassDisplayLabel(code: string | null | undefined): string | null {
  const c = asText(code);
  if (!c) return null;
  if (c.toUpperCase() === STICKERS_ITEM_CLASS || c.toUpperCase() === "A") return STICKERS_ITEM_CLASS_LABEL;
  return c;
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
}

function asNum(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function extractGtin14(codeOrCis: string, cisInfo?: CrptCisInfo | null): string | null {
  const fromInfo = asText(cisInfo?.gtin);
  if (/^\d{13,14}$/.test(fromInfo)) {
    return fromInfo.padStart(14, "0").slice(-14);
  }
  const compact = normalizeCrptCode(codeOrCis).replace(/\s/g, "");
  const m = compact.match(/^01(\d{14})/);
  return m?.[1] ?? null;
}

function normalizeChildCode(raw: string): string {
  return normalizeCrptCode(raw.replace(/,+$/, "").trim());
}

function parseCrptItems(payload: unknown): CrptCisInfo[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const rec = row as Record<string, unknown>;
      if (rec.cisInfo && typeof rec.cisInfo === "object") {
        return rec.cisInfo as CrptCisInfo;
      }
      return null;
    })
    .filter((x): x is CrptCisInfo => x != null);
}

async function cisInfoFromPrintedOrder(code: string): Promise<CrptCisInfo | null> {
  const printed = await lookupPrintedLabelCode(code);
  if (!printed) return null;
  const cis = normalizeCrptCode(printed.code || code);
  return {
    cis,
    requestedCis: cis,
    gtin: printed.gtin,
    productName: printed.nomenclatureName || `GTIN ${printed.gtin}`,
    status: "EMITTED",
    productGroup: "softdrinks",
    emissionDate: printed.createdAt || new Date().toISOString(),
    emissionType: "LOCAL",
  };
}

async function fetchCisInfo(code: string, bearerToken?: string | null): Promise<CrptCisInfo> {
  const normalized = normalizeCrptCode(code);
  try {
    const payload = await fetchCrptInfoFromUpstream([normalized], bearerToken);
    const items = parseCrptItems(payload);
    if (items.length === 0) {
      throw new WmsHttpError(404, "ЧЗ не вернул данных по коду", "crpt_not_found");
    }
    return items[0]!;
  } catch (error) {
    const printed = await cisInfoFromPrintedOrder(normalized);
    if (printed) return printed;
    throw error;
  }
}

function childCodes(cisInfo: CrptCisInfo): string[] {
  const raw = cisInfo.child;
  if (!Array.isArray(raw)) return [];
  return raw.map((c) => normalizeChildCode(String(c))).filter(Boolean);
}

function innerUnitCount(cisInfo: CrptCisInfo, fallback: number): number {
  const partial = cisInfo.partialSaleInfo;
  if (partial && typeof partial === "object") {
    const inner = asNum((partial as Record<string, unknown>).innerUnitCount, 0);
    if (inner > 0) return Math.trunc(inner);
  }
  return fallback;
}

/** Только стикеры/этикетки (LOCAL-эмиссия на производстве) — короткий срок. */
const STICKER_ONLY_PRODUCT_GROUPS = new Set([
  "stickers",
  "sticker",
  "lp",
  "labels",
  "label",
]);

function isStickerOnlyProductGroup(cisInfo: CrptCisInfo): boolean {
  const pg = asText(cisInfo.productGroup).toLowerCase();
  if (!pg) return false;
  if (STICKER_ONLY_PRODUCT_GROUPS.has(pg)) return true;
  return pg.includes("sticker") || pg.includes("этикет");
}

/** Срок при автосоздании номенклатуры по скану ЧЗ. */
function defaultShelfLifeDaysForNewItem(cisInfo: CrptCisInfo): number {
  const emissionType = asText(cisInfo.emissionType).toUpperCase();
  if (emissionType === "LOCAL" && isStickerOnlyProductGroup(cisInfo)) {
    return LOCAL_STICKER_SHELF_LIFE_DAYS;
  }
  return DEFAULT_CODE_SHELF_LIFE_DAYS;
}

/** Срок годности для проверки кода ЧЗ: из карточки или 365; 30 только для стикеров. */
export function resolveReceivingShelfLifeDays(
  itemShelfLife: number | null | undefined,
  cisInfo: CrptCisInfo
): number {
  const fromCard =
    itemShelfLife != null && Number.isFinite(itemShelfLife) && itemShelfLife > 0
      ? Math.trunc(itemShelfLife)
      : null;

  // Раньше LOCAL-эмиссия ошибочно давала 30 дней напиткам — не используем для проверки срока.
  if (fromCard === LOCAL_STICKER_SHELF_LIFE_DAYS && !isStickerOnlyProductGroup(cisInfo)) {
    return DEFAULT_CODE_SHELF_LIFE_DAYS;
  }

  if (fromCard != null) return fromCard;
  return defaultShelfLifeDaysForNewItem(cisInfo);
}

/** Дата эмиссии из ответа ЧЗ (поля различаются по товарным группам). */
export function pickEmissionDateValue(cisInfo: CrptCisInfo): unknown {
  const direct =
    cisInfo.emissionDate ??
    cisInfo.emission_date ??
    cisInfo.emittedDate ??
    cisInfo.emitDate ??
    cisInfo.emissionDateTime ??
    cisInfo.emissionTs ??
    cisInfo.emissionTimestamp ??
    cisInfo.producedDate ??
    cisInfo.productionDate ??
    cisInfo.manufacturingDate ??
    cisInfo.manufacturedDate ??
    cisInfo.applicationDate ??
    cisInfo.introducedDate ??
    cisInfo.introductionDate ??
    null;
  if (direct) return direct;

  const wanted = new Set([
    "emissiondate",
    "emission_date",
    "emitteddate",
    "emitdate",
    "emissiondatetime",
    "emissionts",
    "emissiontimestamp",
    "produceddate",
    "productiondate",
    "manufacturingdate",
    "manufactureddate",
    "applicationdate",
    "introduceddate",
    "introductiondate",
  ]);
  const queue: unknown[] = [cisInfo];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    for (const [key, value] of Object.entries(cur as Record<string, unknown>)) {
      const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
      if (wanted.has(normalizedKey) && value != null && asText(value)) return value;
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

/** Срок годности товара из ЧЗ (bestBefore). */
export function pickProductExpirationDateValue(cisInfo: CrptCisInfo): unknown {
  const direct = cisInfo.bestBeforeDate ?? cisInfo.bestBefore ?? null;
  if (direct) return direct;
  for (const [key, value] of Object.entries(cisInfo)) {
    const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
    if (
      (normalizedKey === "bestbeforedate" || normalizedKey === "bestbefore") &&
      value != null &&
      asText(value)
    ) {
      return value;
    }
  }
  return null;
}

/** expirationDate / expireDate — часто срок действия кода маркировки, не товара. */
export function pickMarkingCodeExpirationDateValue(cisInfo: CrptCisInfo): unknown {
  const direct =
    cisInfo.expirationDate ??
    cisInfo.expireDate ??
    cisInfo.expiryDate ??
    cisInfo.expDate ??
    null;
  if (direct) return direct;
  const wanted = new Set(["expirationdate", "expiredate", "expirydate", "expdate"]);
  for (const [key, value] of Object.entries(cisInfo)) {
    const normalizedKey = key.replace(/[-_\s]/g, "").toLowerCase();
    if (wanted.has(normalizedKey) && value != null && asText(value)) return value;
  }
  return null;
}

/** Явный срок из ЧЗ: сначала «годен до» товара, иначе expirationDate (может быть срок КМ). */
export function pickExpirationDateValue(cisInfo: CrptCisInfo): unknown {
  return (
    pickProductExpirationDateValue(cisInfo) ?? pickMarkingCodeExpirationDateValue(cisInfo)
  );
}

const WMS_CALENDAR_TZ = "Europe/Moscow";
const MS_DAY = 24 * 60 * 60 * 1000;

type CalendarParts = { y: number; m: number; d: number };

function calendarPartsInTimeZone(d: Date, timeZone: string): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: pick("year"), m: pick("month"), d: pick("day") };
}

function utcDateFromCalendar(parts: CalendarParts): Date {
  return new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
}

function calendarPartsFromUtcDate(d: Date): CalendarParts {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

function addCalendarDays(parts: CalendarParts, days: number): CalendarParts {
  const d = utcDateFromCalendar(parts);
  d.setUTCDate(d.getUTCDate() + days);
  return calendarPartsFromUtcDate(d);
}

/** Календарная дата эмиссии (без сдвига из‑за времени суток / UTC). */
function parseEmissionCalendarDate(value: unknown): CalendarParts | null {
  const s = asText(value);
  if (!s) return null;
  if (/^\d{8}$/.test(s)) {
    return { y: Number(s.slice(0, 4)), m: Number(s.slice(4, 6)), d: Number(s.slice(6, 8)) };
  }
  const isoDate = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    return { y: Number(isoDate[1]), m: Number(isoDate[2]), d: Number(isoDate[3]) };
  }
  const ruDate = s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})(?:\s|$)/);
  if (ruDate) {
    return { y: Number(ruDate[3]), m: Number(ruDate[2]), d: Number(ruDate[1]) };
  }
  if (/^\d{10,13}$/.test(s)) {
    const ms = s.length === 13 ? Number(s) : Number(s) * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return calendarPartsInTimeZone(d, WMS_CALENDAR_TZ);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return calendarPartsInTimeZone(d, WMS_CALENDAR_TZ);
}

function formatCalendarDateRu(parts: CalendarParts): string {
  return utcDateFromCalendar(parts).toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

function inclusiveCalendarDaysRemaining(expiryParts: CalendarParts, now = new Date()): number {
  const today = calendarPartsInTimeZone(now, WMS_CALENDAR_TZ);
  const diff = Math.floor(
    (utcDateFromCalendar(expiryParts).getTime() - utcDateFromCalendar(today).getTime()) / MS_DAY
  );
  // Последний день срока (дата «годен до») ещё считается действительным.
  return diff + 1;
}

function calendarDaysBetween(from: CalendarParts, to: CalendarParts): number {
  return Math.floor(
    (utcDateFromCalendar(to).getTime() - utcDateFromCalendar(from).getTime()) / MS_DAY
  );
}

/** expirationDate от ЧЗ похож на срок действия КМ (~30–120 д.), не «годен до» товара/рулона. */
function isLikelyMarkingCodeValiditySpan(spanDays: number): boolean {
  return spanDays > 0 && spanDays <= MARKING_CODE_VALIDITY_MAX_DAYS;
}

/** Срок для проверки «годен до» при скане стикеров. */
async function stickersShelfLifeDaysForReceiving(
  client: PoolClient,
  siteId: number,
  itemShelfLife: number | null | undefined
): Promise<number> {
  const groupDefault = await getStickersGroupShelfLifeDays(client, siteId);
  const fromCard =
    itemShelfLife != null && Number.isFinite(itemShelfLife) && itemShelfLife > 0
      ? Math.trunc(itemShelfLife)
      : null;
  if (fromCard == null || fromCard <= LEGACY_STICKER_SHELF_LIFE_DAYS) return groupDefault;
  return fromCard;
}

function absoluteExpiryForReceiving(
  cisInfo: CrptCisInfo,
  scanCtx?: ReceivingScanContext | null
): unknown {
  if (isStickersReceivingContext(scanCtx)) {
    return pickProductExpirationDateValue(cisInfo);
  }
  return pickExpirationDateValue(cisInfo);
}

export function computeCodeExpiry(
  emissionValue: unknown,
  shelfLifeDays: number,
  expiryWarningDays = 0,
  absoluteExpiresValue?: unknown
): ReceivingExpiryCheck {
  const emissionParts = parseEmissionCalendarDate(emissionValue);
  let absoluteExpiresParts = parseEmissionCalendarDate(absoluteExpiresValue ?? null);

  if (absoluteExpiresParts && emissionParts && shelfLifeDays > 0) {
    const span = calendarDaysBetween(emissionParts, absoluteExpiresParts);
    if (isLikelyMarkingCodeValiditySpan(span)) {
      absoluteExpiresParts = null;
    }
  }

  if (absoluteExpiresParts) {
    const expiresAt = utcDateFromCalendar(absoluteExpiresParts);
    const daysRemaining = inclusiveCalendarDaysRemaining(absoluteExpiresParts);
    const expiresLabel = formatCalendarDateRu(absoluteExpiresParts);
    let state: ExpiryState = "ok";
    let message = `Код действителен ещё ${daysRemaining} дн. (до ${expiresLabel})`;
    if (daysRemaining <= 0) {
      state = "expired";
      message = `Код просрочен ${Math.abs(daysRemaining)} дн. — партию нужно изъять на утилизацию`;
    } else if (expiryWarningDays > 0 && daysRemaining <= expiryWarningDays) {
      state = "warning";
      message = `Код истекает через ${daysRemaining} дн. — проверьте партию`;
    }
    return {
      emissionAt: emissionParts ? utcDateFromCalendar(emissionParts).toISOString() : null,
      expiresAt: expiresAt.toISOString(),
      shelfLifeDays,
      daysRemaining,
      state,
      message,
    };
  }

  if (!emissionParts || shelfLifeDays <= 0) {
    return {
      emissionAt: emissionParts ? utcDateFromCalendar(emissionParts).toISOString() : null,
      expiresAt: null,
      shelfLifeDays,
      daysRemaining: null,
      state: "ok",
      message: "Срок годности кода не проверялся (нет даты эмиссии)",
    };
  }

  const expiresParts = addCalendarDays(emissionParts, shelfLifeDays);
  const expiresAt = utcDateFromCalendar(expiresParts);
  const daysRemaining = inclusiveCalendarDaysRemaining(expiresParts);
  const expiresLabel = formatCalendarDateRu(expiresParts);

  let state: ExpiryState = "ok";
  let message = `Код действителен ещё ${daysRemaining} дн. (до ${expiresLabel})`;

  if (daysRemaining <= 0) {
    state = "expired";
    message = `Код просрочен ${Math.abs(daysRemaining)} дн. — партию нужно изъять на утилизацию`;
  } else if (expiryWarningDays > 0 && daysRemaining <= expiryWarningDays) {
    state = "warning";
    message = `Код истекает через ${daysRemaining} дн. — проверьте партию`;
  } else if (shelfLifeDays <= 30 && daysRemaining <= 3) {
    state = "warning";
    message = `Короткий срок кода: осталось ${daysRemaining} дн.`;
  }

  return {
    emissionAt: utcDateFromCalendar(emissionParts).toISOString(),
    expiresAt: expiresAt.toISOString(),
    shelfLifeDays,
    daysRemaining,
    state,
    message,
  };
}

/** Соответствие статуса ЧЗ → ref_status.status_id. */
export function mapCrptStatusToCodeStateId(crptStatus: string | null | undefined): number {
  switch ((crptStatus ?? "").trim().toUpperCase()) {
    case "EMITTED":
      return 1; // received_from_cz
    case "APPLIED":
      return 4; // applied
    case "INTRODUCED":
      return 5; // introduced (= в обороте)
    case "WRITTEN_OFF":
    case "RETIRED":
    case "WITHDRAWN":
      return 8; // retired
    default:
      return 5; // для кодов уже в обороте безопаснее "introduced", не "printed"
  }
}

export async function fetchCrptCisInfo(
  code: string,
  bearerToken?: string | null
): Promise<CrptCisInfo> {
  return fetchCisInfo(code, bearerToken);
}

export type CrptLotDatesSample = {
  emissionAt: string | null;
  expiresAt: string | null;
  crptStatus: string | null;
};

/** Один (до трёх) код из списка → ЧЗ → даты эмиссии и «годен до» для всей партии. */
export async function sampleCrptLotDates(
  codes: string[],
  options?: { shelfLifeDays?: number; bearerToken?: string | null }
): Promise<CrptLotDatesSample | null> {
  const token = options?.bearerToken ?? getUpstreamCrptBearerToken();
  const shelfLifeDays =
    options?.shelfLifeDays != null && options.shelfLifeDays > 0
      ? Math.trunc(options.shelfLifeDays)
      : DEFAULT_CODE_SHELF_LIFE_DAYS;
  let attempts = 0;
  for (const raw of codes) {
    const code = String(raw ?? "").trim();
    if (!code) continue;
    attempts += 1;
    if (attempts > 3) break;
    try {
      const cis = await fetchCisInfo(code, token);
      const expiry = computeCodeExpiry(
        pickEmissionDateValue(cis),
        shelfLifeDays,
        0,
        pickProductExpirationDateValue(cis) ?? pickExpirationDateValue(cis)
      );
      if (!expiry.emissionAt && !expiry.expiresAt) continue;
      return {
        emissionAt: expiry.emissionAt,
        expiresAt: expiry.expiresAt,
        crptStatus: asText(cis.status) || null,
      };
    } catch {
      /* следующий код из списка */
    }
  }
  return null;
}

type GtinItemRow = {
  item_id: string;
  item_code: string;
  name: string;
  shelf_life_days: number | null;
  expiry_warning_days: number | null;
  product_group: string | null;
  item_group_code: string | null;
  item_class_code: string | null;
  item_type_code: string | null;
  item_attrs_json: Record<string, unknown> | null;
};

function isUnusedStickerCard(row: { name: string; item_group_code: string | null; product_group: string | null }): boolean {
  if (isStickerOrLabelName(row.name)) return true;
  if (isBottledDrinkName(row.name)) return false;
  const g = `${row.item_group_code || ""} ${row.product_group || ""}`.toLowerCase();
  return g.includes("sticker") || g.includes("стикер") || g.includes("этикет") || g.includes("label");
}

async function findItemByGtin(
  client: PoolClient,
  siteId: number,
  gtin: string,
  prefer: "sticker" | "bottle" | "any" = "any"
): Promise<GtinItemRow | null> {
  const gtin14 = gtin.padStart(14, "0").slice(-14);
  const r = await client.query<GtinItemRow>(
    `SELECT
       i.item_id::text AS item_id,
       i.item_code,
       i.name,
       i.shelf_life_days,
       i.expiry_warning_days,
       i.product_group,
       i.item_group_code,
       i.item_class_code,
       i.item_type_code,
       i.item_attrs_json
     FROM wms_items i
     LEFT JOIN wms_item_barcodes b ON b.item_id = i.item_id
     WHERE i.site_id = $1
       AND (
         i.item_code = $2
         OR i.item_code = $3
         OR b.barcode = $2
         OR i.nomenclature LIKE '%' || $2 || '%'
         OR i.nomenclature LIKE '%(01)' || $2 || '%'
         OR (i.item_attrs_json->'nomenclature'->>'gtin') = $2
       )
     ORDER BY
       CASE
         WHEN i.item_code = $2 THEN 0
         WHEN b.barcode = $2 THEN 1
         ELSE 2
       END,
       i.item_id`,
    [siteId, gtin14, `STK-${gtin14}`]
  );
  if (r.rows.length === 0) return null;
  if (prefer === "sticker") {
    return r.rows.find((row) => isUnusedStickerCard(row)) ?? null;
  }
  if (prefer === "bottle") {
    return (
      r.rows.find((row) => isBottledDrinkName(row.name) && !isStickerOrLabelName(row.name)) ??
      r.rows.find((row) => !isUnusedStickerCard(row)) ??
      null
    );
  }
  return r.rows[0] ?? null;
}

async function ensureStickersMasterRefs(client: PoolClient, siteId: number): Promise<void> {
  await ensureItemGroup(client, siteId, STICKERS_WMS_GROUP, STICKERS_WMS_GROUP_LABEL);
  await seedStickersGroupShelfLifeDefault(client, siteId);
  await ensureItemClass(
    client,
    siteId,
    STICKERS_ITEM_CLASS,
    STICKERS_WMS_GROUP,
    STICKERS_ITEM_CLASS_LABEL
  );
}

function buildItemAttrs(cisInfo: CrptCisInfo, packageRole: "unit" | "block"): Record<string, unknown> {
  const gtin = extractGtin14(asText(cisInfo.cis), cisInfo) ?? "";
  const productGroup = asText(cisInfo.productGroup) || null;
  return {
    nomenclature: {
      gtin,
      productGroup,
      czProductGroup: productGroup,
      czProductGroupLabel: russifyCrptProductGroup(productGroup),
      crptGeneralPackageType: asText(cisInfo.generalPackageType) || null,
      crptGeneralPackageTypeLabel: russifyCrptPackageType(cisInfo.generalPackageType),
      crptPackageType: asText(cisInfo.packageType) || null,
      packagingKind: packageRole === "block" ? "block" : "unit",
      requiresCzCheck: true,
      expirationControl: true,
      blockExpired: true,
    },
    crpt: {
      tnVedEaes: asText(cisInfo.tnVedEaes) || null,
      brand: asText(cisInfo.brand) || null,
      emissionType: asText(cisInfo.emissionType) || null,
    },
  };
}

async function upsertItemFromCrpt(
  client: PoolClient,
  siteId: number,
  cisInfo: CrptCisInfo,
  packageRole: "unit" | "block",
  scanCtx?: ReceivingScanContext | null
): Promise<{ row: ResolvedReceivingItem; shelfLifeDays: number; expiryWarningDays: number }> {
  const gtin = extractGtin14(asText(cisInfo.cis) || asText(cisInfo.requestedCis), cisInfo);
  if (!gtin) {
    throw new WmsHttpError(400, "Не удалось определить GTIN из ответа ЧЗ", "crpt_no_gtin");
  }

  const crptProductGroup = asText(cisInfo.productGroup) || null;
  const crptProductGroupLabel = russifyCrptProductGroup(crptProductGroup);
  const stickersSession = isStickersReceivingContext(scanCtx);
  const existing = await findItemByGtin(client, siteId, gtin, stickersSession ? "sticker" : "bottle");
  const generalPackageType = asText(cisInfo.generalPackageType) || null;
  const generalPackageTypeLabel = russifyCrptPackageType(generalPackageType);

  let productGroup = crptProductGroup;
  let productGroupLabel = crptProductGroupLabel;
  let itemClassCode: string | null = null;
  let name =
    asText(cisInfo.productName) ||
    (packageRole === "block" ? `Блок ${gtin}` : `Товар ${gtin}`);

  if (stickersSession) {
    await ensureStickersMasterRefs(client, siteId);
    productGroup = STICKERS_WMS_GROUP;
    productGroupLabel = STICKERS_WMS_GROUP_LABEL;
    itemClassCode = STICKERS_ITEM_CLASS;
    name = withStickerNamePrefix(name);
  }

  if (existing) {
    let shelfLifeDays: number;
    if (stickersSession) {
      shelfLifeDays = await stickersShelfLifeDaysForReceiving(
        client,
        siteId,
        existing.shelf_life_days
      );
      if (existing.shelf_life_days !== shelfLifeDays) {
        await client.query(
          `UPDATE wms_items
           SET shelf_life_days = $1, updated_at = now()
           WHERE item_id = $2::bigint`,
          [shelfLifeDays, existing.item_id]
        );
      }
    } else {
      shelfLifeDays = resolveReceivingShelfLifeDays(existing.shelf_life_days, cisInfo);
      if (
        existing.shelf_life_days === LOCAL_STICKER_SHELF_LIFE_DAYS &&
        shelfLifeDays === DEFAULT_CODE_SHELF_LIFE_DAYS &&
        !isStickerOnlyProductGroup(cisInfo)
      ) {
        await client.query(
          `UPDATE wms_items
           SET shelf_life_days = $1, updated_at = now()
           WHERE item_id = $2::bigint`,
          [shelfLifeDays, existing.item_id]
        );
      }
    }

    let resolvedName = existing.name;
    if (stickersSession && isUnusedStickerCard(existing)) {
      const fromCrpt = withStickerNamePrefix(
        asText(cisInfo.productName) || existing.name || name
      );
      resolvedName = fromCrpt || existing.name;
      const needsReclass =
        normalizeReceivingRouteKey(existing.item_group_code || existing.product_group) !==
          STICKERS_WMS_GROUP ||
        normalizeReceivingRouteKey(existing.item_class_code) !== STICKERS_ITEM_CLASS.toLowerCase() ||
        normalizeReceivingRouteKey(existing.item_type_code) !== STICKERS_ITEM_TYPE_CODE;
      const needsNameFix = resolvedName !== existing.name;
      if (needsReclass || needsNameFix) {
        await client.query(
          `UPDATE wms_items
           SET name = $1,
               material_type = $2,
               product_group = $3,
               item_group_code = $3,
               item_class_code = $4,
               item_type_code = $5,
               updated_at = now()
           WHERE item_id = $6::bigint`,
          [
            resolvedName,
            STICKERS_WMS_GROUP_LABEL,
            STICKERS_WMS_GROUP,
            STICKERS_ITEM_CLASS,
            STICKERS_ITEM_TYPE_CODE,
            existing.item_id,
          ]
        );
      }
    } else if (!stickersSession && isBottledDrinkName(existing.name) && !isStickerOrLabelName(existing.name)) {
      if (existing.item_type_code === "stickers" || existing.item_type_code === "sticker") {
        await client.query(
          `UPDATE wms_items
           SET item_type_code = 'finished_goods',
               item_class_code = 'S4',
               updated_at = now()
           WHERE item_id = $1::bigint`,
          [existing.item_id]
        );
        existing.item_type_code = "finished_goods";
        existing.item_class_code = "S4";
      }
    }

    const resolvedClassCode = stickersSession
      ? STICKERS_ITEM_CLASS
      : existing.item_class_code?.trim() || null;
    return {
      row: {
        itemId: existing.item_id,
        itemCode: existing.item_code,
        name: stickersSession ? resolvedName : existing.name,
        gtin,
        created: false,
        packageRole,
        productGroup: stickersSession ? STICKERS_WMS_GROUP : crptProductGroup,
        productGroupLabel: stickersSession ? STICKERS_WMS_GROUP_LABEL : crptProductGroupLabel,
        itemClassCode: resolvedClassCode,
        itemClassLabel: stickersSession
          ? STICKERS_ITEM_CLASS_LABEL
          : itemClassDisplayLabel(resolvedClassCode),
        generalPackageType,
        generalPackageTypeLabel,
        imageUrl: resolveReceivingItemImageUrl({
          attrs: existing.item_attrs_json,
          productGroup: stickersSession ? STICKERS_WMS_GROUP : crptProductGroup,
          productGroupLabel: stickersSession ? STICKERS_WMS_GROUP_LABEL : crptProductGroupLabel,
          name: stickersSession ? resolvedName : existing.name,
          itemCode: existing.item_code,
          gtin,
          stickersSession,
        }),
      },
      shelfLifeDays,
      expiryWarningDays: existing.expiry_warning_days ?? 0,
    };
  }

  const itemCode = stickersSession ? `STK-${gtin}` : gtin;
  const shelfLifeDays = stickersSession
    ? await getStickersGroupShelfLifeDays(client, siteId)
    : defaultShelfLifeDaysForNewItem(cisInfo);
  const itemAttrs = buildItemAttrs(cisInfo, packageRole);
  const nomenclature = `(01)${gtin}`;
  const itemSubgroup = packageRole === "block" ? "block" : "unit";
  const sku =
    gtin.length >= 14
      ? `${gtin.slice(0, 11)}-${gtin.slice(11)}`
      : gtin;

  if (productGroup) {
    if (stickersSession) {
      await ensureStickersMasterRefs(client, siteId);
    } else {
      await ensureItemGroup(client, siteId, productGroup, productGroupLabel || productGroup);
    }
  }

  if (!stickersSession && isBottledDrinkName(name)) {
    itemClassCode = "S4";
  }
  const itemTypeCode = stickersSession
    ? STICKERS_ITEM_TYPE_CODE
    : isBottledDrinkName(name)
      ? "finished_goods"
      : null;
  const up = await client.query<{ item_id: string }>(
    `INSERT INTO wms_items (
       site_id, item_code, sku, name, material_type, product_group, item_group_code,
       item_class_code, item_type_code, item_subgroup, nomenclature, item_attrs_json, uom_code,
       is_marked, is_perishable, rotation_policy, shelf_life_days, expiry_warning_days,
       created_at, updated_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12::jsonb, 'pcs',
       TRUE, TRUE, 'fefo', $13, 0,
       now(), now()
     )
     RETURNING item_id::text AS item_id`,
    [
      siteId,
      itemCode,
      sku,
      name,
      productGroupLabel,
      productGroup,
      productGroup,
      itemClassCode,
      itemTypeCode,
      itemSubgroup,
      nomenclature,
      JSON.stringify(itemAttrs),
      shelfLifeDays,
    ]
  );

  const itemId = up.rows[0]!.item_id;

  if (stickersSession) {
    await client.query(
      `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
       VALUES ($1::bigint, $2, 'sku', TRUE, now())
       ON CONFLICT (barcode) DO NOTHING`,
      [itemId, `STK-${gtin}`]
    );
  } else {
    await client.query(
      `INSERT INTO wms_item_barcodes (item_id, barcode, barcode_type, is_primary, created_at)
       VALUES ($1::bigint, $2, 'gtin', TRUE, now())
       ON CONFLICT (barcode) DO UPDATE SET item_id = EXCLUDED.item_id, is_primary = TRUE`,
      [itemId, gtin]
    );
  }

  return {
    row: {
      itemId,
      itemCode,
      name,
      gtin,
      created: true,
      packageRole,
      productGroup,
      productGroupLabel,
      itemClassCode,
      itemClassLabel: itemClassDisplayLabel(itemClassCode),
      generalPackageType,
      generalPackageTypeLabel,
      imageUrl: resolveReceivingItemImageUrl({
        attrs: null,
        productGroup,
        productGroupLabel,
        name,
        itemCode,
        gtin,
        stickersSession,
      }),
    },
    shelfLifeDays,
    expiryWarningDays: 0,
  };
}

async function ensureBlockSpecLink(
  client: PoolClient,
  siteId: number,
  blockItemId: string,
  unitItemId: string,
  blockItemCode: string,
  qtyPer: number
): Promise<boolean> {
  const specCode = `CRPT-BLOCK-${blockItemCode}`.slice(0, 120);
  let specId: string | null = null;

  const existingSpec = await client.query<{ spec_id: string }>(
    `SELECT spec_id::text AS spec_id
     FROM wms_item_specs
     WHERE site_id = $1 AND parent_item_id = $2::bigint AND is_active
     ORDER BY version_no DESC
     LIMIT 1`,
    [siteId, blockItemId]
  );
  specId = existingSpec.rows[0]?.spec_id ?? null;

  if (!specId) {
    const ins = await client.query<{ spec_id: string }>(
      `INSERT INTO wms_item_specs (site_id, parent_item_id, spec_code, version_no, is_active, comment, created_at)
       VALUES ($1, $2::bigint, $3, 1, TRUE, 'Автосвязка блока ЧЗ', now())
       RETURNING spec_id::text AS spec_id`,
      [siteId, blockItemId, specCode]
    );
    specId = ins.rows[0]?.spec_id ?? null;
  }

  if (!specId) return false;

  await client.query(
    `INSERT INTO wms_item_spec_components (
       spec_id, component_item_id, component_role_code, qty_per, uom_code, sort_order, is_required, note
     ) VALUES ($1::bigint, $2::bigint, 'unit', $3, 'pcs', 10, TRUE, 'Вложение блока ЧЗ')
     ON CONFLICT (spec_id, component_item_id)
     DO UPDATE SET qty_per = EXCLUDED.qty_per, note = EXCLUDED.note`,
    [specId, unitItemId, qtyPer]
  );

  return true;
}

function isBlockPackage(cisInfo: CrptCisInfo): boolean {
  const gpt = asText(cisInfo.generalPackageType).toUpperCase();
  return gpt === "GROUP" || gpt === "BOX" || gpt === "SET" || gpt === "BUNDLE";
}

export async function resolveReceivingScan(
  client: PoolClient,
  siteId: number,
  scannedCode: string,
  bearerToken?: string | null,
  scanCtx?: ReceivingScanContext | null
): Promise<ResolveReceivingScanResult> {
  const token = bearerToken ?? (await getUpstreamCrptBearerToken());
  const normalizedCode = normalizeCrptCode(scannedCode);
  const warnings: string[] = [];

  const cisInfo = await fetchCisInfo(normalizedCode, token);
  const crptStatus = asText(cisInfo.status) || null;

  if (crptStatus === "WRITTEN_OFF" || crptStatus === "RETIRED" || crptStatus === "WITHDRAWN") {
    warnings.push(`Код в ЧЗ со статусом «${crptStatus}» — приёмка может быть запрещена`);
  }

  const primaryPackageRole: "unit" | "block" = isBlockPackage(cisInfo) ? "block" : "unit";
  const primary = await upsertItemFromCrpt(client, siteId, cisInfo, primaryPackageRole, scanCtx);

  if (primary.row.created) {
    warnings.push(`Создана номенклатура: ${primary.row.name}`);
  }

  let nestedItem: ResolvedReceivingItem | null = null;
  let specLinked = false;
  let specQtyPer: number | null = null;

  const children = childCodes(cisInfo);
  if (primaryPackageRole === "block" && children.length > 0) {
    const firstChild = children[0]!;
    try {
      const childInfo = await fetchCisInfo(firstChild, token);
      const nested = await upsertItemFromCrpt(client, siteId, childInfo, "unit", scanCtx);
      nestedItem = nested.row;
      if (nested.row.created) {
        warnings.push(`Создана номенклатура вложения: ${nested.row.name}`);
      }

      specQtyPer = innerUnitCount(cisInfo, children.length);
      specLinked = await ensureBlockSpecLink(
        client,
        siteId,
        primary.row.itemId,
        nested.row.itemId,
        primary.row.itemCode,
        specQtyPer
      );
      if (specLinked) {
        warnings.push(
          `Блок «${primary.row.name}» связан с «${nested.row.name}» (${specQtyPer} шт.)`
        );
      }
    } catch (e) {
      warnings.push(
        e instanceof Error
          ? `Не удалось обработать вложенный код: ${e.message}`
          : "Не удалось обработать вложенный код"
      );
    }
  }

  const expiryShelfDays = isStickersReceivingContext(scanCtx)
    ? await stickersShelfLifeDaysForReceiving(client, siteId, primary.shelfLifeDays)
    : resolveReceivingShelfLifeDays(primary.shelfLifeDays, cisInfo);

  const expiry = computeCodeExpiry(
    pickEmissionDateValue(cisInfo),
    expiryShelfDays,
    primary.expiryWarningDays,
    absoluteExpiryForReceiving(cisInfo, scanCtx)
  );

  if (expiry.state === "expired") {
    warnings.push(expiry.message);
  } else if (expiry.state === "warning") {
    warnings.push(expiry.message);
  }

  return {
    scannedCode: scannedCode.trim(),
    normalizedCode,
    primaryItem: primary.row,
    nestedItem,
    specLinked,
    specQtyPer,
    crptStatus,
    warnings,
    expiry,
  };
}
