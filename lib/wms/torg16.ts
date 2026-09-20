import type { PoolClient } from "pg";
import { formatDateRu, ruMonthGenitive, splitRuDate } from "@/lib/wms/torg1";
import { getTorg1Settings } from "@/lib/wms/torg1";

export const TORG16_FORM_CODE = "torg16";
export const TORG16_SETTING_KEY = "torg16";
export const TORG16_OKUD = "0330216";

export type Torg16Line = {
  lineNo: number;
  name: string;
  itemCode: string;
  uom: string;
  qty: string;
  lotCode: string;
  expiryAt: string;
  codes: string;
  note: string;
};

export type Torg16Fields = {
  orgName: string;
  orgAddress: string;
  orgPhone: string;
  okpo: string;
  okud: string;
  okdp: string;
  structuralUnit: string;
  documentNo: string;
  composedAt: string;
  operationKind: string;
  reasonCode: string;
  reasonName: string;
  basisDoc: string;
  basisNo: string;
  basisDate: string;
  locationCode: string;
  locationName: string;
  warehouseCode: string;
  warehouseName: string;
  comment: string;
  materiallyResponsible: string;
  commissionChair: string;
  commissionMember1: string;
  commissionMember2: string;
  approveTitle: string;
  approveName: string;
  approveDate: string;
  codes: string;
  codesCount: string;
  linesQtyTotal: string;
  lines: Torg16Line[];
};

export type Torg16Settings = {
  orgName: string;
  orgAddress: string;
  orgPhone: string;
  okpo: string;
  okdp: string;
  approveTitle: string;
  approveName: string;
  commissionChair: string;
  commissionMember1: string;
  commissionMember2: string;
  materiallyResponsible: string;
  updatedAt?: string | null;
};

export type Torg16FormRecord = {
  formId: string | null;
  documentId: string | null;
  formCode: string;
  title: string;
  fields: Torg16Fields;
  overrides: Partial<Torg16Fields>;
  auto: Torg16Fields;
  updatedAt: string | null;
};

export const TORG16_VARIABLE_KEYS: Array<{ key: string; hint: string }> = [
  { key: "orgName", hint: "Организация" },
  { key: "orgAddress", hint: "Адрес" },
  { key: "orgPhone", hint: "Телефон" },
  { key: "orgLine", hint: "Организация, адрес, телефон одной строкой" },
  { key: "okpo", hint: "ОКПО" },
  { key: "okud", hint: "ОКУД (0330216)" },
  { key: "okdp", hint: "ОКДП" },
  { key: "structuralUnit", hint: "Структурное подразделение / склад" },
  { key: "documentNo", hint: "Номер акта списания" },
  { key: "composedAt", hint: "Дата составления (ДД.ММ.ГГГГ)" },
  { key: "composedAt.day", hint: "День даты составления" },
  { key: "composedAt.month", hint: "Месяц (число)" },
  { key: "composedAt.monthWord", hint: "Месяц словом (сентября)" },
  { key: "composedAt.year", hint: "Год даты составления" },
  { key: "composedAt.yearShort", hint: "Год короткий (26)" },
  { key: "operationKind", hint: "Вид операции" },
  { key: "reasonCode", hint: "Код основания списания" },
  { key: "reasonName", hint: "Основание списания" },
  { key: "basisDoc", hint: "Основание (приказ / акт)" },
  { key: "basisNo", hint: "Номер основания" },
  { key: "basisDate", hint: "Дата основания" },
  { key: "locationCode", hint: "Код ячейки" },
  { key: "locationName", hint: "Название ячейки" },
  { key: "warehouseCode", hint: "Код склада" },
  { key: "warehouseName", hint: "Название склада" },
  { key: "comment", hint: "Комментарий" },
  { key: "materiallyResponsible", hint: "МОЛ" },
  { key: "commissionChair", hint: "Председатель комиссии" },
  { key: "commissionMember1", hint: "Член комиссии 1" },
  { key: "commissionMember2", hint: "Член комиссии 2" },
  { key: "approveTitle", hint: "Утверждаю — должность" },
  { key: "approveName", hint: "Утверждаю — ФИО" },
  { key: "approveDate", hint: "Дата утверждения" },
  { key: "codes", hint: "Списанные коды, каждый с новой строки" },
  { key: "codes.list", hint: "То же, что codes" },
  { key: "codes.count", hint: "Количество списанных кодов" },
  { key: "lines", hint: "Наименования позиций, каждая с новой строки" },
  { key: "lines.names", hint: "Только наименования" },
  { key: "lines.count", hint: "Количество позиций" },
  { key: "lines.qtyTotal", hint: "Суммарное количество" },
  { key: "line.lineNo", hint: "В строке таблицы: номер" },
  { key: "line.name", hint: "В строке таблицы: наименование" },
  { key: "line.itemCode", hint: "В строке таблицы: код номенклатуры" },
  { key: "line.uom", hint: "В строке таблицы: ед. изм." },
  { key: "line.qty", hint: "В строке таблицы: количество" },
  { key: "line.lotCode", hint: "В строке таблицы: партия" },
  { key: "line.expiryAt", hint: "В строке таблицы: срок годности" },
  { key: "line.codes", hint: "В строке таблицы: коды позиции" },
  { key: "line.note", hint: "В строке таблицы: примечание" },
  { key: "lines.1.name", hint: "Наименование 1-й позиции (lines.2.name, …)" },
  { key: "lines.1.itemCode", hint: "Код 1-й позиции" },
  { key: "lines.1.qty", hint: "Количество 1-й позиции" },
  { key: "lines.1.codes", hint: "Коды 1-й позиции" },
];

export function emptyTorg16Fields(): Torg16Fields {
  return {
    orgName: "",
    orgAddress: "",
    orgPhone: "",
    okpo: "",
    okud: TORG16_OKUD,
    okdp: "",
    structuralUnit: "",
    documentNo: "",
    composedAt: "",
    operationKind: "Списание",
    reasonCode: "",
    reasonName: "",
    basisDoc: "акт о списании товаров",
    basisNo: "",
    basisDate: "",
    locationCode: "",
    locationName: "",
    warehouseCode: "",
    warehouseName: "",
    comment: "",
    materiallyResponsible: "",
    commissionChair: "",
    commissionMember1: "",
    commissionMember2: "",
    approveTitle: "",
    approveName: "",
    approveDate: "",
    codes: "",
    codesCount: "0",
    linesQtyTotal: "",
    lines: [],
  };
}

export function defaultTorg16Settings(): Torg16Settings {
  return {
    orgName: "",
    orgAddress: "",
    orgPhone: "",
    okpo: "",
    okdp: "",
    approveTitle: "Генеральный директор",
    approveName: "",
    commissionChair: "",
    commissionMember1: "",
    commissionMember2: "",
    materiallyResponsible: "",
    updatedAt: null,
  };
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function formatQty(qty: number | string | null | undefined): string {
  if (qty == null || qty === "") return "";
  const n = typeof qty === "number" ? qty : Number(String(qty).replace(",", "."));
  if (!Number.isFinite(n)) return String(qty);
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function normalizeTorg16Line(raw: unknown, index: number): Torg16Line {
  const o = jsonObject(raw);
  return {
    lineNo: Number(o.lineNo) > 0 ? Math.trunc(Number(o.lineNo)) : index + 1,
    name: stringValue(o.name),
    itemCode: stringValue(o.itemCode),
    uom: stringValue(o.uom) || "шт",
    qty: stringValue(o.qty),
    lotCode: stringValue(o.lotCode),
    expiryAt: stringValue(o.expiryAt),
    codes: stringValue(o.codes),
    note: stringValue(o.note),
  };
}

export function parseTorg16FieldsPartial(raw: unknown): Partial<Torg16Fields> {
  const o = jsonObject(raw);
  const next: Partial<Torg16Fields> = {};
  const keys: Array<keyof Omit<Torg16Fields, "lines">> = [
    "orgName",
    "orgAddress",
    "orgPhone",
    "okpo",
    "okud",
    "okdp",
    "structuralUnit",
    "documentNo",
    "composedAt",
    "operationKind",
    "reasonCode",
    "reasonName",
    "basisDoc",
    "basisNo",
    "basisDate",
    "locationCode",
    "locationName",
    "warehouseCode",
    "warehouseName",
    "comment",
    "materiallyResponsible",
    "commissionChair",
    "commissionMember1",
    "commissionMember2",
    "approveTitle",
    "approveName",
    "approveDate",
    "codes",
    "codesCount",
    "linesQtyTotal",
  ];
  for (const key of keys) {
    if (key in o) next[key] = stringValue(o[key]);
  }
  if (Array.isArray(o.lines)) {
    next.lines = o.lines.map((line, i) => normalizeTorg16Line(line, i));
  }
  return next;
}

export function parseTorg16Settings(raw: unknown): Torg16Settings {
  const o = jsonObject(raw);
  const base = defaultTorg16Settings();
  return {
    orgName: stringValue(o.orgName) || base.orgName,
    orgAddress: stringValue(o.orgAddress) || base.orgAddress,
    orgPhone: stringValue(o.orgPhone) || base.orgPhone,
    okpo: stringValue(o.okpo) || base.okpo,
    okdp: stringValue(o.okdp) || base.okdp,
    approveTitle: stringValue(o.approveTitle) || base.approveTitle,
    approveName: stringValue(o.approveName) || base.approveName,
    commissionChair: stringValue(o.commissionChair) || base.commissionChair,
    commissionMember1: stringValue(o.commissionMember1) || base.commissionMember1,
    commissionMember2: stringValue(o.commissionMember2) || base.commissionMember2,
    materiallyResponsible: stringValue(o.materiallyResponsible) || base.materiallyResponsible,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : null,
  };
}

export function mergeTorg16Fields(base: Torg16Fields, partial: Partial<Torg16Fields>): Torg16Fields {
  return {
    ...base,
    ...partial,
    lines: partial.lines ?? base.lines,
  };
}

export type Torg16AutoContext = {
  documentNo?: string | null;
  composedAt?: string | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  locationName?: string | null;
  comment?: string | null;
  reasonCode?: string | null;
  reasonName?: string | null;
  codes?: string[];
  lines?: Array<{
    lineNo?: number;
    itemCode?: string | null;
    itemName?: string | null;
    uom?: string | null;
    qty?: number | string | null;
    lotCode?: string | null;
    expiryAt?: string | null;
    codes?: string[] | string | null;
    note?: string | null;
  }>;
};

export function buildTorg16AutoFields(
  settings: Torg16Settings,
  ctx: Torg16AutoContext
): Torg16Fields {
  const composedAt = formatDateRu(ctx.composedAt) || formatDateRu(new Date().toISOString());
  const lines = (ctx.lines ?? []).map((line, i) => {
    const codes = Array.isArray(line.codes)
      ? line.codes.filter(Boolean).join("\n")
      : stringValue(line.codes);
    return {
      lineNo: line.lineNo && line.lineNo > 0 ? line.lineNo : i + 1,
      name: (line.itemName || line.itemCode || "").trim(),
      itemCode: (line.itemCode || "").trim(),
      uom: (line.uom || "шт").trim(),
      qty: formatQty(line.qty),
      lotCode: (line.lotCode || "").trim(),
      expiryAt: formatDateRu(line.expiryAt),
      codes,
      note: (line.note || "").trim(),
    };
  });
  const codes = (ctx.codes ?? []).map((c) => c.trim()).filter(Boolean);
  const qtyTotal = lines.reduce((sum, line) => {
    const n = Number(String(line.qty).replace(",", "."));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
  return {
    ...emptyTorg16Fields(),
    orgName: settings.orgName,
    orgAddress: settings.orgAddress,
    orgPhone: settings.orgPhone,
    okpo: settings.okpo,
    okud: TORG16_OKUD,
    okdp: settings.okdp,
    structuralUnit: ctx.warehouseName || ctx.warehouseCode || "",
    documentNo: (ctx.documentNo || "").trim(),
    composedAt,
    operationKind: "Списание",
    reasonCode: (ctx.reasonCode || "").trim(),
    reasonName: (ctx.reasonName || "").trim(),
    basisDoc: (ctx.reasonName || "").trim() || "акт о списании товаров",
    basisNo: (ctx.documentNo || "").trim(),
    basisDate: composedAt,
    locationCode: (ctx.locationCode || "").trim(),
    locationName: (ctx.locationName || "").trim(),
    warehouseCode: (ctx.warehouseCode || "").trim(),
    warehouseName: (ctx.warehouseName || "").trim(),
    comment: (ctx.comment || "").trim(),
    materiallyResponsible: settings.materiallyResponsible,
    commissionChair: settings.commissionChair,
    commissionMember1: settings.commissionMember1,
    commissionMember2: settings.commissionMember2,
    approveTitle: settings.approveTitle,
    approveName: settings.approveName,
    approveDate: composedAt,
    codes: codes.join("\n"),
    codesCount: String(codes.length),
    linesQtyTotal: formatQty(qtyTotal),
    lines,
  };
}

export function torg16FieldsToVarMap(fields: Torg16Fields): Record<string, string> {
  const map: Record<string, string> = {
    orgName: fields.orgName,
    orgAddress: fields.orgAddress,
    orgPhone: fields.orgPhone,
    orgLine: [fields.orgName, fields.orgAddress, fields.orgPhone].filter(Boolean).join(", "),
    okpo: fields.okpo,
    okud: fields.okud || TORG16_OKUD,
    okdp: fields.okdp,
    structuralUnit: fields.structuralUnit,
    documentNo: fields.documentNo,
    composedAt: fields.composedAt,
    operationKind: fields.operationKind,
    reasonCode: fields.reasonCode,
    reasonName: fields.reasonName,
    basisDoc: fields.basisDoc,
    basisNo: fields.basisNo,
    basisDate: fields.basisDate,
    locationCode: fields.locationCode,
    locationName: fields.locationName,
    warehouseCode: fields.warehouseCode,
    warehouseName: fields.warehouseName,
    comment: fields.comment,
    materiallyResponsible: fields.materiallyResponsible,
    commissionChair: fields.commissionChair,
    commissionMember1: fields.commissionMember1,
    commissionMember2: fields.commissionMember2,
    approveTitle: fields.approveTitle,
    approveName: fields.approveName,
    approveDate: fields.approveDate,
    codes: fields.codes,
    "codes.list": fields.codes,
    "codes.count": fields.codesCount,
    lines: fields.lines.map((l) => l.name || l.itemCode).filter(Boolean).join("\n"),
    "lines.names": fields.lines.map((l) => l.name || l.itemCode).filter(Boolean).join("\n"),
    "lines.count": String(fields.lines.length),
    "lines.qtyTotal": fields.linesQtyTotal,
  };
  const [d, m, y] = splitRuDate(fields.composedAt);
  map["composedAt.day"] = d;
  map["composedAt.month"] = m;
  map["composedAt.monthWord"] = ruMonthGenitive(m);
  map["composedAt.year"] = y;
  map["composedAt.yearShort"] = y.slice(-2);
  const [ad, am, ay] = splitRuDate(fields.approveDate);
  map["approveDate.day"] = ad;
  map["approveDate.month"] = am;
  map["approveDate.monthWord"] = ruMonthGenitive(am);
  map["approveDate.year"] = ay;
  map["approveDate.yearShort"] = ay.slice(-2);

  fields.lines.forEach((line, i) => {
    const n = i + 1;
    const row = {
      lineNo: String(line.lineNo || n),
      name: line.name,
      itemCode: line.itemCode,
      uom: line.uom,
      qty: line.qty,
      lotCode: line.lotCode,
      expiryAt: line.expiryAt,
      codes: line.codes,
      note: line.note,
    };
    for (const [field, val] of Object.entries(row)) {
      map[`lines.${n}.${field}`] = val;
      map[`line.${n}.${field}`] = val;
      if (n === 1) map[`line.${field}`] = val;
    }
  });
  return map;
}

export async function ensureTorg16Tables(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_app_settings (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      setting_key TEXT NOT NULL,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, setting_key)
    )`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_document_forms (
      form_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      document_id BIGINT NOT NULL REFERENCES wms_documents(document_id) ON DELETE CASCADE,
      form_code TEXT NOT NULL,
      title TEXT NOT NULL,
      body_text TEXT NOT NULL,
      payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (document_id, form_code)
    )`);
}

export async function getTorg16Settings(
  client: PoolClient,
  siteId: number
): Promise<Torg16Settings> {
  await ensureTorg16Tables(client);
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `SELECT setting_value, updated_at::text
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, TORG16_SETTING_KEY]
  );
  const parsed = parseTorg16Settings(r.rows[0]?.setting_value);
  if (!parsed.orgName) {
    const torg1 = await getTorg1Settings(client, siteId);
    parsed.orgName = parsed.orgName || torg1.orgName;
    parsed.orgAddress = parsed.orgAddress || torg1.orgAddress;
    parsed.orgPhone = parsed.orgPhone || torg1.orgPhone;
    parsed.okpo = parsed.okpo || torg1.okpo;
    parsed.okdp = parsed.okdp || torg1.okdp;
    parsed.approveTitle = parsed.approveTitle || torg1.approveTitle;
    parsed.approveName = parsed.approveName || torg1.approveName;
  }
  return { ...parsed, updatedAt: r.rows[0]?.updated_at ?? null };
}

export async function saveTorg16Settings(
  client: PoolClient,
  siteId: number,
  settings: Torg16Settings
): Promise<Torg16Settings> {
  await ensureTorg16Tables(client);
  const payload = {
    orgName: settings.orgName.trim(),
    orgAddress: settings.orgAddress.trim(),
    orgPhone: settings.orgPhone.trim(),
    okpo: settings.okpo.trim(),
    okdp: settings.okdp.trim(),
    approveTitle: settings.approveTitle.trim() || "Генеральный директор",
    approveName: settings.approveName.trim(),
    commissionChair: settings.commissionChair.trim(),
    commissionMember1: settings.commissionMember1.trim(),
    commissionMember2: settings.commissionMember2.trim(),
    materiallyResponsible: settings.materiallyResponsible.trim(),
  };
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING setting_value, updated_at::text`,
    [siteId, TORG16_SETTING_KEY, JSON.stringify(payload)]
  );
  return { ...parseTorg16Settings(r.rows[0]?.setting_value), updatedAt: r.rows[0]?.updated_at ?? null };
}

export async function getTorg16DocumentForm(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<{ title: string; overrides: Partial<Torg16Fields>; formId: string; updatedAt: string | null } | null> {
  await ensureTorg16Tables(client);
  const r = await client.query<{
    formId: string;
    title: string;
    payload: unknown;
    updatedAt: string | null;
  }>(
    `SELECT
       form_id::text AS "formId",
       title,
       payload_json AS payload,
       created_at::text AS "updatedAt"
     FROM wms_document_forms
     WHERE site_id = $1 AND document_id = $2::bigint AND form_code = $3
     LIMIT 1`,
    [siteId, documentId, TORG16_FORM_CODE]
  );
  const row = r.rows[0];
  if (!row) return null;
  const payload = jsonObject(row.payload);
  return {
    formId: row.formId,
    title: row.title,
    overrides: parseTorg16FieldsPartial(payload.overrides ?? payload.fields ?? payload),
    updatedAt: row.updatedAt,
  };
}

export async function saveTorg16DocumentForm(
  client: PoolClient,
  siteId: number,
  documentId: string,
  overrides: Partial<Torg16Fields>,
  title?: string
): Promise<{ formId: string; title: string; updatedAt: string | null }> {
  await ensureTorg16Tables(client);
  const actTitle = (title || "").trim() || `ТОРГ-16 № ${documentId}`;
  const r = await client.query<{ formId: string; title: string; updatedAt: string | null }>(
    `INSERT INTO wms_document_forms (
       site_id, document_id, form_code, title, body_text, payload_json, created_at
     ) VALUES ($1, $2::bigint, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT (document_id, form_code)
     DO UPDATE SET
       title = EXCLUDED.title,
       body_text = EXCLUDED.body_text,
       payload_json = EXCLUDED.payload_json,
       created_at = now()
     RETURNING
       form_id::text AS "formId",
       title,
       created_at::text AS "updatedAt"`,
    [
      siteId,
      documentId,
      TORG16_FORM_CODE,
      actTitle,
      `ТОРГ-16 ${new Date().toISOString()}`,
      JSON.stringify({ overrides }),
    ]
  );
  return r.rows[0]!;
}
