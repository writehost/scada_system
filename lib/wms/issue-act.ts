import type { PoolClient } from "pg";

export const ISSUE_ACT_FORM_CODE = "issue_act";
export const ISSUE_ACT_SETTING_KEY = "issue_act";

export const DEFAULT_ISSUE_ACT_TEMPLATE = `АКТ ВЫДАЧИ МАРКИРОВОЧНЫХ СТИКЕРОВ № {{documentId}}

Дата: {{issuedAt}}

Кладовщик выдал, а получатель принял материалы:

Номенклатура: {{itemName}}
Код / GTIN: {{itemCode}}
Партия: {{lotCode}}
Дата эмиссии: {{emissionDay}}
Количество: {{qty}} шт.

Откуда: {{sourceLocationCode}}
Куда: {{targetLocationCode}}
Линия / участок: {{lineName}}
Получатель: {{recipientName}}

Выдал: ______________________
Получил: _____________________`;

export type IssueActSettings = {
  enabled: boolean;
  template: string;
  updatedAt?: string | null;
};

export type IssueActInput = {
  documentId: string;
  documentNo?: string | null;
  itemCode: string;
  itemName: string;
  qty: number;
  lotCode?: string | null;
  emissionDay?: string | null;
  sourceLocationCode: string;
  targetLocationCode: string;
  recipientName: string;
  lineName?: string | null;
};

export type IssueActResult = {
  formId: string;
  documentId: string;
  formCode: string;
  title: string;
  bodyText: string;
  createdAt: string;
};

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boolValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

export async function ensureIssueActTables(client: PoolClient) {
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

export async function getIssueActSettings(
  client: PoolClient,
  siteId: number
): Promise<IssueActSettings> {
  await ensureIssueActTables(client);
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `SELECT setting_value, updated_at::text
     FROM wms_app_settings
     WHERE site_id = $1 AND setting_key = $2`,
    [siteId, ISSUE_ACT_SETTING_KEY]
  );
  const value = jsonObject(r.rows[0]?.setting_value);
  const template = stringValue(value.template).trim() || DEFAULT_ISSUE_ACT_TEMPLATE;
  return {
    enabled: boolValue(value.enabled),
    template,
    updatedAt: r.rows[0]?.updated_at ?? null,
  };
}

export async function saveIssueActSettings(
  client: PoolClient,
  siteId: number,
  settings: IssueActSettings
): Promise<IssueActSettings> {
  await ensureIssueActTables(client);
  const template = settings.template.trim() || DEFAULT_ISSUE_ACT_TEMPLATE;
  const payload = { enabled: Boolean(settings.enabled), template };
  const r = await client.query<{ setting_value: unknown; updated_at: string | null }>(
    `INSERT INTO wms_app_settings (site_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (site_id, setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()
     RETURNING setting_value, updated_at::text`,
    [siteId, ISSUE_ACT_SETTING_KEY, JSON.stringify(payload)]
  );
  const value = jsonObject(r.rows[0]?.setting_value);
  return {
    enabled: boolValue(value.enabled),
    template: stringValue(value.template) || DEFAULT_ISSUE_ACT_TEMPLATE,
    updatedAt: r.rows[0]?.updated_at ?? null,
  };
}

function formatQty(qty: number): string {
  return Number.isInteger(qty) ? String(qty) : qty.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatEmissionDay(day?: string | null): string {
  const raw = day?.trim() || "";
  if (raw.length === 8 && /^\d+$/.test(raw)) {
    return `${raw.slice(6, 8)}.${raw.slice(4, 6)}.${raw.slice(0, 4)}`;
  }
  return raw || "-";
}

function emissionDayKey(value?: string | null): string {
  const raw = value?.trim() || "";
  if (!raw) return "unknown";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "unknown";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function renderTemplate(template: string, input: IssueActInput): string {
  const vars: Record<string, string> = {
    documentId: input.documentNo?.trim() || input.documentId,
    documentNo: input.documentNo?.trim() || input.documentId,
    issuedAt: new Date().toLocaleString("ru-RU"),
    itemCode: input.itemCode,
    itemName: input.itemName,
    qty: formatQty(input.qty),
    lotCode: input.lotCode?.trim() || "Без партии",
    emissionDay: formatEmissionDay(input.emissionDay),
    sourceLocationCode: input.sourceLocationCode,
    targetLocationCode: input.targetLocationCode,
    recipientName: input.recipientName,
    lineName: input.lineName?.trim() || input.targetLocationCode,
  };
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    return vars[key] ?? "";
  });
}

export async function createIssueActIfEnabled(
  client: PoolClient,
  siteId: number,
  input: IssueActInput
): Promise<IssueActResult | null> {
  const settings = await getIssueActSettings(client, siteId);
  if (!settings.enabled) return null;

  const bodyText = renderTemplate(settings.template, input);
  const title = `Акт выдачи № ${input.documentNo?.trim() || input.documentId}`;
  const r = await client.query<IssueActResult>(
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
       document_id::text AS "documentId",
       form_code AS "formCode",
       title,
       body_text AS "bodyText",
       created_at::text AS "createdAt"`,
    [
      siteId,
      input.documentId,
      ISSUE_ACT_FORM_CODE,
      title,
      bodyText,
      JSON.stringify({ input }),
    ]
  );
  return r.rows[0] ?? null;
}

export async function getIssueActForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<IssueActResult | null> {
  await ensureIssueActTables(client);
  const r = await client.query<IssueActResult>(
    `SELECT
       form_id::text AS "formId",
       document_id::text AS "documentId",
       form_code AS "formCode",
       title,
       body_text AS "bodyText",
       created_at::text AS "createdAt"
     FROM wms_document_forms
     WHERE site_id = $1 AND document_id = $2::bigint AND form_code = $3
     LIMIT 1`,
    [siteId, documentId, ISSUE_ACT_FORM_CODE]
  );
  return r.rows[0] ?? null;
}

export async function createIssueActForDocument(
  client: PoolClient,
  siteId: number,
  documentId: string
): Promise<IssueActResult> {
  await ensureIssueActTables(client);
  const r = await client.query<{
    documentId: string;
    documentNo: string | null;
    documentType: string;
    recipientName: string | null;
    lineName: string | null;
    sourceLocationCode: string | null;
    targetLocationCode: string | null;
    itemCode: string;
    itemName: string;
    qty: number;
    lotCode: string | null;
    manufacturedAt: string | null;
  }>(
    `SELECT
       d.document_id::text AS "documentId",
       d.document_no AS "documentNo",
       dt.code AS "documentType",
       COALESCE(oi.recipient_name, d.recipient_name) AS "recipientName",
       COALESCE(oi.line_name, d.line_name) AS "lineName",
       sl.location_code AS "sourceLocationCode",
       tl.location_code AS "targetLocationCode",
       i.item_code AS "itemCode",
       i.name AS "itemName",
       dl.confirmed_qty::float8 AS qty,
       wl.lot_code AS "lotCode",
       wl.manufactured_at::text AS "manufacturedAt"
     FROM wms_documents d
     JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
     JOIN wms_document_lines dl ON dl.document_id = d.document_id
     JOIN wms_items i ON i.item_id = dl.item_id
     LEFT JOIN wms_operator_issues oi ON oi.document_id = d.document_id
     LEFT JOIN wms_locations sl ON sl.location_id = d.source_location_id
     LEFT JOIN wms_locations tl ON tl.location_id = d.target_location_id
     LEFT JOIN wms_lots wl ON wl.lot_id = dl.lot_id
     WHERE d.site_id = $1 AND d.document_id = $2::bigint
     ORDER BY dl.line_no
     LIMIT 1`,
    [siteId, documentId]
  );
  const row = r.rows[0];
  if (!row || row.documentType !== "issue") {
    throw new Error("issue document not found");
  }
  const act = await createIssueActIfEnabled(client, siteId, {
    documentId: row.documentId,
    documentNo: row.documentNo,
    itemCode: row.itemCode,
    itemName: row.itemName,
    qty: row.qty,
    lotCode: row.lotCode,
    emissionDay: emissionDayKey(row.manufacturedAt),
    sourceLocationCode: row.sourceLocationCode ?? "-",
    targetLocationCode: row.targetLocationCode ?? "-",
    recipientName: row.recipientName ?? "-",
    lineName: row.lineName,
  });
  if (act) return act;

  const settings = await getIssueActSettings(client, siteId);
  const bodyText = renderTemplate(settings.template, {
    documentId: row.documentId,
    documentNo: row.documentNo,
    itemCode: row.itemCode,
    itemName: row.itemName,
    qty: row.qty,
    lotCode: row.lotCode,
    emissionDay: emissionDayKey(row.manufacturedAt),
    sourceLocationCode: row.sourceLocationCode ?? "-",
    targetLocationCode: row.targetLocationCode ?? "-",
    recipientName: row.recipientName ?? "-",
    lineName: row.lineName,
  });
  const saved = await client.query<IssueActResult>(
    `INSERT INTO wms_document_forms (
       site_id, document_id, form_code, title, body_text, payload_json, created_at
     ) VALUES ($1, $2::bigint, $3, $4, $5, '{}'::jsonb, now())
     ON CONFLICT (document_id, form_code)
     DO UPDATE SET title = EXCLUDED.title, body_text = EXCLUDED.body_text, created_at = now()
     RETURNING
       form_id::text AS "formId",
       document_id::text AS "documentId",
       form_code AS "formCode",
       title,
       body_text AS "bodyText",
       created_at::text AS "createdAt"`,
    [siteId, row.documentId, ISSUE_ACT_FORM_CODE, `Акт выдачи № ${row.documentNo || row.documentId}`, bodyText]
  );
  return saved.rows[0];
}
