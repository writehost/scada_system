import type { PoolClient } from "pg";

export const TORG1_FORM_CODE = "torg1";
export const TORG1_SETTING_KEY = "torg1";
export const TORG1_OKUD = "0330201";

/** Постоянные реквизиты сайта (шаблон) — не правятся на бланке документа. */
export const TORG1_PERMANENT_FIELD_KEYS = [
  "orgName",
  "orgAddress",
  "orgPhone",
  "okpo",
  "okud",
  "okdp",
  "approveTitle",
  "approveName",
] as const;

export type Torg1PermanentFieldKey = (typeof TORG1_PERMANENT_FIELD_KEYS)[number];

export function isTorg1PermanentField(key: string): key is Torg1PermanentFieldKey {
  return (TORG1_PERMANENT_FIELD_KEYS as readonly string[]).includes(key);
}

export type Torg1Line = {
  lineNo: number;
  name: string;
  itemCode: string;
  uom: string;
  qtyDoc: string;
  qtyFact: string;
  lotCode: string;
  note: string;
};

/** Редактируемые поля бланка ТОРГ-1 (стр.1 + строки). */
export type Torg1Fields = {
  orgName: string;
  orgAddress: string;
  orgPhone: string;
  okpo: string;
  okud: string;
  okdp: string;
  structuralUnit: string;
  cameraNo: string;
  sectionNo: string;
  basisDoc: string;
  basisNo: string;
  basisDate: string;
  operationKind: string;
  documentNo: string;
  composedAt: string;
  approveTitle: string;
  approveName: string;
  approveSign: string;
  approveDate: string;
  place: string;
  commissionNote: string;
  commissionDate: string;
  accompanyingDocs: string;
  representativeCall: string;
  callDocNo: string;
  callDocDate: string;
  shipper: string;
  manufacturer: string;
  supplier: string;
  insurer: string;
  contractNo: string;
  contractDate: string;
  invoiceNo: string;
  invoiceDate: string;
  commercialAct: string;
  commercialActDate: string;
  vetCert: string;
  vetCertDate: string;
  railWaybill: string;
  railWaybillDate: string;
  deliveryMethod: string;
  vehicleNo: string;
  shipDate: string;
  fromStation: string;
  fromStationOrWarehouse: string;
  meatTemp: string;
  arrivedAt: string;
  arrivedTime: string;
  acceptStart: string;
  acceptStartTime: string;
  acceptPause: string;
  acceptPauseTime: string;
  acceptResume: string;
  acceptResumeTime: string;
  acceptEnd: string;
  acceptEndTime: string;
  lines: Torg1Line[];
};

export type Torg1Settings = {
  orgName: string;
  orgAddress: string;
  orgPhone: string;
  okpo: string;
  okdp: string;
  approveTitle: string;
  approveName: string;
  updatedAt?: string | null;
};

export type Torg1AutoContext = {
  documentNo?: string | null;
  composedAt?: string | null;
  warehouseCode?: string | null;
  warehouseName?: string | null;
  locationCode?: string | null;
  externalRef?: string | null;
  comment?: string | null;
  supplierHint?: string | null;
  lines?: Array<{
    lineNo?: number;
    itemCode?: string | null;
    itemName?: string | null;
    uom?: string | null;
    qtyDoc?: number | string | null;
    qtyFact?: number | string | null;
    lotCode?: string | null;
    note?: string | null;
  }>;
};

export type Torg1FormRecord = {
  formId: string | null;
  documentId: string | null;
  sessionId: string | null;
  formCode: string;
  title: string;
  fields: Torg1Fields;
  overrides: Partial<Torg1Fields>;
  auto: Torg1Fields;
  updatedAt: string | null;
};

export const TORG1_VARIABLE_HELP: Array<{ key: string; hint: string }> = [
  { key: "orgName", hint: "Название организации из шаблона сайта" },
  { key: "orgAddress", hint: "Адрес организации из шаблона" },
  { key: "orgPhone", hint: "Телефон организации из шаблона" },
  { key: "okpo", hint: "ОКПО из шаблона" },
  { key: "okud", hint: "Форма по ОКУД (0330201)" },
  { key: "structuralUnit", hint: "Склад / структурное подразделение" },
  { key: "documentNo", hint: "Номер документа приёмки" },
  { key: "composedAt", hint: "Дата составления" },
  { key: "place", hint: "Место приёмки (ячейка / склад)" },
  { key: "supplier", hint: "Поставщик из комментария / строк" },
  { key: "accompanyingDocs", hint: "Внешняя ссылка / основание 1С" },
  { key: "lines", hint: "Позиции из состава документа или сканов ТСД" },
];

export function emptyTorg1Fields(): Torg1Fields {
  return {
    orgName: "",
    orgAddress: "",
    orgPhone: "",
    okpo: "",
    okud: TORG1_OKUD,
    okdp: "",
    structuralUnit: "",
    cameraNo: "",
    sectionNo: "",
    basisDoc: "приказ, распоряжение",
    basisNo: "",
    basisDate: "",
    operationKind: "",
    documentNo: "",
    composedAt: "",
    approveTitle: "",
    approveName: "",
    approveSign: "",
    approveDate: "",
    place: "",
    commissionNote: "Настоящий акт составлен комиссией, которая установила:",
    commissionDate: "",
    accompanyingDocs: "",
    representativeCall: "телеграмма, факс, телефонограмма, радиограмма",
    callDocNo: "",
    callDocDate: "",
    shipper: "",
    manufacturer: "",
    supplier: "",
    insurer: "",
    contractNo: "",
    contractDate: "",
    invoiceNo: "",
    invoiceDate: "",
    commercialAct: "",
    commercialActDate: "",
    vetCert: "",
    vetCertDate: "",
    railWaybill: "",
    railWaybillDate: "",
    deliveryMethod: "",
    vehicleNo: "",
    shipDate: "",
    fromStation: "",
    fromStationOrWarehouse: "",
    meatTemp: "",
    arrivedAt: "",
    arrivedTime: "",
    acceptStart: "",
    acceptStartTime: "",
    acceptPause: "",
    acceptPauseTime: "",
    acceptResume: "",
    acceptResumeTime: "",
    acceptEnd: "",
    acceptEndTime: "",
    lines: [],
  };
}

export function defaultTorg1Settings(): Torg1Settings {
  return {
    orgName: "",
    orgAddress: "",
    orgPhone: "",
    okpo: "",
    okdp: "",
    approveTitle: "Генеральный директор",
    approveName: "",
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

export function formatDateRu(iso?: string | null): string {
  const raw = (iso ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    // уже ДД.ММ.ГГГГ или «14» апреля …
    const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}.${y}`;
    }
    return raw;
  }
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTimeRu(iso?: string | null): string {
  const raw = (iso ?? "").trim();
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Разбор ДД.ММ.ГГГГ → [день, месяц, год] для ячеек бланка. */
export function splitRuDate(value?: string | null): [string, string, string] {
  const raw = (value ?? "").trim();
  const m = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})/);
  if (!m) return ["", "", ""];
  const y = m[3].length === 2 ? `20${m[3]}` : m[3];
  return [m[1].padStart(2, "0"), m[2].padStart(2, "0"), y];
}

export function joinRuDate(day: string, month: string, year: string): string {
  const d = day.trim();
  const m = month.trim();
  const y = year.trim();
  if (!d && !m && !y) return "";
  return `${d}.${m}.${y}`;
}

const RU_MONTHS_GEN = [
  "",
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

export function ruMonthGenitive(monthNum: string | number): string {
  const n = typeof monthNum === "number" ? monthNum : Number(monthNum);
  return RU_MONTHS_GEN[n] || "";
}

export function parseSupplierFromComment(comment?: string | null): string {
  const text = (comment ?? "").trim();
  if (!text) return "";
  const m = text.match(/Поставщик:\s*([^·\n|;]+)/i);
  return m?.[1]?.trim() || "";
}

export function normalizeTorg1Line(raw: unknown, index: number): Torg1Line {
  const o = jsonObject(raw);
  return {
    lineNo: Number(o.lineNo) > 0 ? Math.trunc(Number(o.lineNo)) : index + 1,
    name: stringValue(o.name),
    itemCode: stringValue(o.itemCode),
    uom: stringValue(o.uom) || "шт",
    qtyDoc: stringValue(o.qtyDoc),
    qtyFact: stringValue(o.qtyFact),
    lotCode: stringValue(o.lotCode),
    note: stringValue(o.note),
  };
}

export function parseTorg1FieldsPartial(raw: unknown): Partial<Torg1Fields> {
  const o = jsonObject(raw);
  const out: Partial<Torg1Fields> = {};
  const keys = Object.keys(emptyTorg1Fields()) as Array<keyof Torg1Fields>;
  for (const key of keys) {
    if (!(key in o)) continue;
    if (key === "lines") {
      const arr = Array.isArray(o.lines) ? o.lines : [];
      out.lines = arr.map((row, i) => normalizeTorg1Line(row, i));
      continue;
    }
    out[key] = stringValue(o[key]);
  }
  return out;
}

export function parseTorg1Settings(raw: unknown): Torg1Settings {
  const o = jsonObject(raw);
  const base = defaultTorg1Settings();
  return {
    orgName: stringValue(o.orgName) || base.orgName,
    orgAddress: stringValue(o.orgAddress) || base.orgAddress,
    orgPhone: stringValue(o.orgPhone) || base.orgPhone,
    okpo: stringValue(o.okpo) || base.okpo,
    okdp: stringValue(o.okdp) || base.okdp,
    approveTitle: stringValue(o.approveTitle) || base.approveTitle,
    approveName: stringValue(o.approveName) || base.approveName,
    updatedAt: stringValue(o.updatedAt) || null,
  };
}

export function buildTorg1AutoFields(
  settings: Torg1Settings,
  ctx: Torg1AutoContext
): Torg1Fields {
  const warehouse =
    (ctx.warehouseName || "").trim() ||
    (ctx.warehouseCode || "").trim() ||
    "";
  const place =
    (ctx.locationCode || "").trim() ||
    warehouse ||
    "";
  const supplier =
    (ctx.supplierHint || "").trim() ||
    parseSupplierFromComment(ctx.comment);
  const lines = (ctx.lines ?? []).map((row, i) => {
    const qtyFact = formatQty(row.qtyFact ?? row.qtyDoc);
    const qtyDoc = formatQty(row.qtyDoc ?? row.qtyFact);
    return {
      lineNo: row.lineNo && row.lineNo > 0 ? row.lineNo : i + 1,
      name: (row.itemName || "").trim() || (row.itemCode || "").trim() || "",
      itemCode: (row.itemCode || "").trim(),
      uom: (row.uom || "").trim() || "шт",
      qtyDoc,
      qtyFact,
      lotCode: (row.lotCode || "").trim(),
      note: (row.note || "").trim(),
    } satisfies Torg1Line;
  });

  const composedDate =
    formatDateRu(ctx.composedAt) || formatDateRu((ctx.composedAt || "").trim()) || "";
  const composedDisplay =
    composedDate || formatDateTimeRu(ctx.composedAt) || (ctx.composedAt || "").trim();

  return {
    ...emptyTorg1Fields(),
    orgName: settings.orgName,
    orgAddress: settings.orgAddress,
    orgPhone: settings.orgPhone,
    okpo: settings.okpo,
    okud: TORG1_OKUD,
    okdp: settings.okdp,
    structuralUnit: warehouse,
    documentNo: (ctx.documentNo || "").trim(),
    composedAt: composedDisplay,
    approveTitle: settings.approveTitle,
    approveName: settings.approveName,
    approveDate: composedDate,
    place,
    commissionDate: composedDate,
    accompanyingDocs: (ctx.externalRef || "").trim(),
    supplier,
    lines,
  };
}

/** Overrides поверх auto: пустая строка в override тоже считается заданной. */
export function mergeTorg1Fields(
  auto: Torg1Fields,
  overrides: Partial<Torg1Fields> | null | undefined
): Torg1Fields {
  if (!overrides) return { ...auto, lines: auto.lines.map((l) => ({ ...l })) };
  const merged: Torg1Fields = { ...auto, lines: auto.lines.map((l) => ({ ...l })) };
  const keys = Object.keys(emptyTorg1Fields()) as Array<keyof Torg1Fields>;
  for (const key of keys) {
    if (!(key in overrides) || overrides[key] === undefined) continue;
    if (key === "lines") {
      const lines = overrides.lines;
      if (Array.isArray(lines)) {
        merged.lines = lines.map((row, i) => normalizeTorg1Line(row, i));
      }
      continue;
    }
    merged[key] = stringValue(overrides[key]);
  }
  return merged;
}

export async function ensureTorg1Tables(client: PoolClient) {
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
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_document_forms_site_time
      ON wms_document_forms(site_id, created_at DESC)`);
}

export async function getTorg1Settings(
  client: PoolClient,
  siteId: number
): Promise<Torg1Settings> {
  await ensureTorg1Tables(client);
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `SELECT setting_value, updated_at::text
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, TORG1_SETTING_KEY]
  );
  const parsed = parseTorg1Settings(r.rows[0]?.setting_value);
  return { ...parsed, updatedAt: r.rows[0]?.updated_at ?? null };
}

export async function saveTorg1Settings(
  client: PoolClient,
  siteId: number,
  settings: Torg1Settings
): Promise<Torg1Settings> {
  await ensureTorg1Tables(client);
  const payload = {
    orgName: settings.orgName.trim(),
    orgAddress: settings.orgAddress.trim(),
    orgPhone: settings.orgPhone.trim(),
    okpo: settings.okpo.trim(),
    okdp: settings.okdp.trim(),
    approveTitle: settings.approveTitle.trim() || "Генеральный директор",
    approveName: settings.approveName.trim(),
  };
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING setting_value, updated_at::text`,
    [siteId, TORG1_SETTING_KEY, JSON.stringify(payload)]
  );
  return { ...parseTorg1Settings(r.rows[0]?.setting_value), updatedAt: r.rows[0]?.updated_at ?? null };
}

function torg1SessionSettingKey(sessionId: string): string {
  return `torg1_session:${sessionId.trim()}`;
}

export async function getTorg1DocumentForm(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<{ title: string; overrides: Partial<Torg1Fields>; formId: string; updatedAt: string | null } | null> {
  await ensureTorg1Tables(client);
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
    [siteId, documentId, TORG1_FORM_CODE]
  );
  const row = r.rows[0];
  if (!row) return null;
  const payload = jsonObject(row.payload);
  return {
    formId: row.formId,
    title: row.title,
    overrides: parseTorg1FieldsPartial(payload.overrides ?? payload.fields ?? payload),
    updatedAt: row.updatedAt,
  };
}

export async function saveTorg1DocumentForm(
  client: PoolClient,
  siteId: number,
  documentId: string,
  overrides: Partial<Torg1Fields>,
  title?: string
): Promise<{ formId: string; title: string; updatedAt: string | null }> {
  await ensureTorg1Tables(client);
  const actTitle = (title || "").trim() || `ТОРГ-1 № ${documentId}`;
  const bodyText = `ТОРГ-1 overrides saved ${new Date().toISOString()}`;
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
      TORG1_FORM_CODE,
      actTitle,
      bodyText,
      JSON.stringify({ overrides }),
    ]
  );
  return r.rows[0]!;
}

export async function getTorg1SessionDraft(
  client: PoolClient,
  siteId: number,
  sessionId: string
): Promise<{ overrides: Partial<Torg1Fields>; updatedAt: string | null } | null> {
  await ensureTorg1Tables(client);
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `SELECT setting_value, updated_at::text
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, torg1SessionSettingKey(sessionId)]
  );
  if (!r.rows[0]) return null;
  const payload = jsonObject(r.rows[0].setting_value);
  return {
    overrides: parseTorg1FieldsPartial(payload.overrides ?? payload),
    updatedAt: r.rows[0].updated_at,
  };
}

export async function saveTorg1SessionDraft(
  client: PoolClient,
  siteId: number,
  sessionId: string,
  overrides: Partial<Torg1Fields>
): Promise<{ updatedAt: string | null }> {
  await ensureTorg1Tables(client);
  const r = await client.query<{ updated_at: string | null }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING updated_at::text`,
    [siteId, torg1SessionSettingKey(sessionId), JSON.stringify({ overrides })]
  );
  return { updatedAt: r.rows[0]?.updated_at ?? null };
}

export function demoTorg1AutoContext(): Torg1AutoContext {
  return {
    documentNo: "123",
    composedAt: new Date().toISOString(),
    warehouseCode: "FG",
    warehouseName: "Склад готовой продукции",
    locationCode: "A-1-01",
    externalRef: "Накладная №345",
    comment: "Поставщик: ООО «Сатурн»",
    supplierHint: "ООО «Сатурн»",
    lines: [
      {
        lineNo: 1,
        itemCode: "04607017162279",
        itemName: "Напиток безалкогольный 1,5л",
        uom: "шт",
        qtyDoc: 100,
        qtyFact: 100,
        lotCode: "LOT-1",
      },
    ],
  };
}
