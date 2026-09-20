import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { listCalendarRules, type WmsCalendarRuleRow } from "@/lib/wms/calendar-rules";

export type WmsCalendarEvent = {
  eventId: string;
  siteId: number;
  typeCode: string;
  title: string;
  description: string | null;
  startAt: string; // ISO
  endAt: string | null; // ISO
  allDay: boolean;
  statusCode: string;
  severityCode: string;
  tags: string[];
  refs: Record<string, unknown>;
  meta: Record<string, unknown>;
  createdByUserId: string | null;
  createdByDeviceUid: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type CreateCalendarEventInput = {
  typeCode: string;
  title: string;
  description?: string | null;
  startAt: string;
  endAt?: string | null;
  allDay?: boolean;
  statusCode?: string;
  severityCode?: string;
  tags?: string[];
  refs?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  createdByUserId?: string | null;
  createdByDeviceUid?: string | null;
};

export type UpdateCalendarEventInput = Partial<
  Omit<CreateCalendarEventInput, "startAt"> & { startAt?: string }
>;

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  const cleaned = tags
    .filter((x) => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
  return Array.from(new Set(cleaned));
}

function toJsonObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

function requireIso(value: unknown, name: string) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) throw new WmsHttpError(400, `${name} is required`, "bad_request");
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new WmsHttpError(400, `${name} must be an ISO date`, "bad_request");
  }
  return d.toISOString();
}

export async function listCalendarEvents(
  client: PoolClient,
  siteId: number,
  opts: { from?: string; to?: string; types?: string[]; includeDeleted?: boolean }
): Promise<{ events: WmsCalendarEvent[] }> {
  const fromIso = opts.from ? requireIso(opts.from, "from") : null;
  const toIso = opts.to ? requireIso(opts.to, "to") : null;
  const types = (opts.types || []).map((t) => t.trim()).filter(Boolean).slice(0, 50);
  const includeDeleted = Boolean(opts.includeDeleted);

  const params: unknown[] = [siteId, fromIso, toIso, types, includeDeleted];
  const where = `
    WHERE e.site_id = $1
      AND ($2::timestamptz IS NULL OR e.start_at >= $2::timestamptz)
      AND ($3::timestamptz IS NULL OR e.start_at < $3::timestamptz)
      AND (cardinality($4::text[]) = 0 OR e.type_code = ANY($4::text[]))
      AND ($5::bool OR e.deleted_at IS NULL)
  `;

  const r = await client.query(
    `
    SELECT
      e.event_id::text AS "eventId",
      e.site_id::int AS "siteId",
      e.type_code AS "typeCode",
      e.title AS "title",
      e.description AS "description",
      e.start_at AS "startAt",
      e.end_at AS "endAt",
      e.all_day AS "allDay",
      e.status_code AS "statusCode",
      e.severity_code AS "severityCode",
      COALESCE(e.tags, ARRAY[]::text[]) AS "tags",
      COALESCE(e.refs, '{}'::jsonb) AS "refs",
      COALESCE(e.meta, '{}'::jsonb) AS "meta",
      e.created_by_user_id::text AS "createdByUserId",
      e.created_by_device_uid AS "createdByDeviceUid",
      e.created_at AS "createdAt",
      e.updated_at AS "updatedAt",
      e.deleted_at AS "deletedAt"
    FROM wms_calendar_events e
    ${where}
    ORDER BY e.start_at ASC, e.event_id ASC
    LIMIT 2000
    `,
    params
  );
  const stored = r.rows as WmsCalendarEvent[];

  // Derived events (documents, lots/quarantine) are computed on the fly to keep the storage layer flexible.
  // They are readonly (cannot be updated/deleted via CRUD).
  const derived = includeDeleted
    ? []
    : await listDerivedEvents(client, siteId, {
        fromIso: fromIso ?? undefined,
        toIso: toIso ?? undefined,
        types,
      });

  const merged = [...stored, ...derived].sort((a, b) => {
    const da = new Date(a.startAt).getTime();
    const db = new Date(b.startAt).getTime();
    if (da !== db) return da - db;
    return a.eventId.localeCompare(b.eventId);
  });

  return { events: merged };
}

function wantsType(types: string[], code: string) {
  if (types.length === 0) return true;
  return types.includes(code);
}

async function listDerivedEvents(
  client: PoolClient,
  siteId: number,
  opts: { fromIso?: string; toIso?: string; types: string[] }
): Promise<WmsCalendarEvent[]> {
  const out: WmsCalendarEvent[] = [];
  const fromIso = opts.fromIso ?? null;
  const toIso = opts.toIso ?? null;
  const types = opts.types;

  const rules = await listCalendarRules(client, siteId).then((r) => r.rules).catch(() => []);
  const active = rules.filter((r) => r.isActive && !r.deletedAt);

  // If rules exist, derived events are controlled by them.
  // If there are no rules yet, keep backwards-compatible defaults.
  if (active.length === 0) {
    if (
      wantsType(types, "receiving") ||
      wantsType(types, "shipping") ||
      wantsType(types, "movement") ||
      wantsType(types, "revision")
    ) {
      out.push(...(await deriveFromDocuments(client, siteId, { fromIso, toIso, types })));
    }
    if (wantsType(types, "quarantine")) {
      out.push(...(await deriveFromQuarantineLots(client, siteId, { fromIso, toIso })));
    }
    return out;
  }

  const ordered = [...active].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  for (const rule of ordered) {
    out.push(...(await deriveByRule(client, siteId, rule, { fromIso, toIso, types })));
  }
  return out;
}

async function deriveByRule(
  client: PoolClient,
  siteId: number,
  rule: WmsCalendarRuleRow,
  ctx: { fromIso: string | null; toIso: string | null; types: string[] }
): Promise<WmsCalendarEvent[]> {
  const kind = (rule.kind || "").toLowerCase().trim();
  if (kind === "document") {
    return deriveFromDocumentsByRule(client, siteId, rule, ctx);
  }
  if (kind === "quarantine") {
    return deriveFromQuarantineByRule(client, siteId, rule, ctx);
  }
  if (kind === "expiry" || kind === "best_before") {
    return deriveFromExpiryByRule(client, siteId, rule, ctx);
  }
  return [];
}

function getStringArray(obj: Record<string, unknown>, key: string): string[] {
  const v = obj[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}

function getString(obj: Record<string, unknown>, key: string, fallback = ""): string {
  const v = obj[key];
  return typeof v === "string" ? v.trim() : fallback;
}

function getNumber(obj: Record<string, unknown>, key: string, fallback: number): number {
  const v = obj[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function deriveFromDocumentsByRule(
  client: PoolClient,
  siteId: number,
  rule: WmsCalendarRuleRow,
  ctx: { fromIso: string | null; toIso: string | null; types: string[] }
): Promise<WmsCalendarEvent[]> {
  const cfg = rule.config || {};
  const targetType = getString(cfg, "eventTypeCode", "receiving");
  if (ctx.types.length > 0 && !ctx.types.includes(targetType)) return [];

  const docTypes = getStringArray(cfg, "documentTypes");
  const docStatuses = getStringArray(cfg, "documentStatuses");
  const dateField = getString(cfg, "dateField", "bestEffort"); // receiptAtIso | releasedAt | createdAt | bestEffort
  const severityCode = getString(cfg, "severityCode", "info");
  const defaultStatusCode = getString(cfg, "statusCode", "planned");
  const tags = ["derived", "rule", "document", ...(getStringArray(cfg, "tags") || [])].slice(0, 20);

  const dateExpr =
    dateField === "receiptAtIso"
      ? `COALESCE(NULLIF(trim(d.payload_json->>'receiptAtIso'), '')::timestamptz, d.created_at)`
      : dateField === "releasedAt"
        ? `COALESCE(d.released_at, d.created_at)`
        : dateField === "createdAt"
          ? `d.created_at`
          : `COALESCE(NULLIF(trim(d.payload_json->>'receiptAtIso'), '')::timestamptz, d.released_at, d.created_at)`;

  const params: unknown[] = [siteId, ctx.fromIso, ctx.toIso, docTypes, docStatuses];
  const r = await client.query<{
    documentId: string;
    documentType: string;
    documentStatus: string;
    documentNo: string | null;
    title: string;
    startAt: string;
    createdAt: string;
    updatedAt: string;
  }>(
    `
    SELECT
      d.document_id::text AS "documentId",
      dt.code AS "documentType",
      ds.code AS "documentStatus",
      d.document_no AS "documentNo",
      (dt.code || ' ' || COALESCE(d.document_no, ('#' || d.document_id::text))) AS "title",
      (${dateExpr})::timestamptz AS "startAt",
      d.created_at AS "createdAt",
      COALESCE(d.released_at, d.created_at) AS "updatedAt"
    FROM wms_documents d
    JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
    JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
    WHERE d.site_id = $1
      AND ($2::timestamptz IS NULL OR (${dateExpr}) >= $2::timestamptz)
      AND ($3::timestamptz IS NULL OR (${dateExpr}) < $3::timestamptz)
      AND (cardinality($4::text[]) = 0 OR dt.code = ANY($4::text[]))
      AND (cardinality($5::text[]) = 0 OR ds.code = ANY($5::text[]))
    ORDER BY "startAt" ASC
    LIMIT 400
    `,
    params
  );

  const out: WmsCalendarEvent[] = [];
  for (const row of r.rows) {
    const startAt = new Date(row.startAt).toISOString();
    out.push({
      eventId: `derived:rule:${rule.ruleId}:doc:${row.documentId}`,
      siteId,
      typeCode: targetType,
      title: row.title,
      description: row.documentStatus || null,
      startAt,
      endAt: null,
      allDay: true,
      statusCode: defaultStatusCode,
      severityCode,
      tags,
      refs: {
        kind: "document",
        ruleId: rule.ruleId,
        documentId: row.documentId,
        documentType: row.documentType,
        documentNo: row.documentNo,
      },
      meta: { ruleName: rule.name, ruleKind: rule.kind },
      createdByUserId: null,
      createdByDeviceUid: null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      deletedAt: null,
    });
  }
  return out;
}

async function deriveFromQuarantineByRule(
  client: PoolClient,
  siteId: number,
  rule: WmsCalendarRuleRow,
  ctx: { fromIso: string | null; toIso: string | null; types: string[] }
): Promise<WmsCalendarEvent[]> {
  const cfg = rule.config || {};
  const targetType = getString(cfg, "eventTypeCode", "quarantine");
  if (ctx.types.length > 0 && !ctx.types.includes(targetType)) return [];

  const minQty = getNumber(cfg, "minQty", 0);
  const severityCode = getString(cfg, "severityCode", "warn");
  const statusCode = getString(cfg, "statusCode", "in_progress");
  const tags = ["derived", "rule", "quarantine", ...(getStringArray(cfg, "tags") || [])].slice(0, 20);

  // Only show when requested range intersects "today"
  const today = new Date();
  const eventAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0, 0);
  const from = ctx.fromIso ? new Date(ctx.fromIso) : null;
  const to = ctx.toIso ? new Date(ctx.toIso) : null;
  if (from && eventAt < from) return [];
  if (to && eventAt >= to) return [];

  const r = await client.query<{
    itemCode: string;
    itemName: string;
    lotCode: string | null;
    batchLabel: string | null;
    locationCode: string;
    quarantineQty: number;
  }>(
    `
    SELECT
      i.item_code AS "itemCode",
      i.name AS "itemName",
      wl.lot_code AS "lotCode",
      wl.batch_label AS "batchLabel",
      l.location_code AS "locationCode",
      SUM(sl.quarantine_qty)::float8 AS "quarantineQty"
    FROM wms_stock_lots sl
    JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
    JOIN wms_items i ON i.item_id = sb.item_id
    JOIN wms_locations l ON l.location_id = sb.location_id
    JOIN wms_lots wl ON wl.lot_id = sl.lot_id
    WHERE sb.site_id = $1
      AND sl.quarantine_qty > $2::float8
    GROUP BY i.item_code, i.name, wl.lot_code, wl.batch_label, l.location_code
    ORDER BY SUM(sl.quarantine_qty) DESC
    LIMIT 120
    `,
    [siteId, minQty]
  );

  const isoEventAt = eventAt.toISOString();
  const out: WmsCalendarEvent[] = [];
  for (const row of r.rows) {
    const title = `Карантин: ${row.itemCode}${row.lotCode ? ` · ${row.lotCode}` : ""} · ${row.locationCode}`;
    out.push({
      eventId: `derived:rule:${rule.ruleId}:quarantine:${row.itemCode}:${row.lotCode ?? "—"}:${row.locationCode}`,
      siteId,
      typeCode: targetType,
      title,
      description: `${row.itemName} · qty ${Math.round(row.quarantineQty)}`,
      startAt: isoEventAt,
      endAt: null,
      allDay: true,
      statusCode,
      severityCode,
      tags,
      refs: {
        kind: "quarantine",
        ruleId: rule.ruleId,
        itemCode: row.itemCode,
        lotCode: row.lotCode,
        batchLabel: row.batchLabel,
        locationCode: row.locationCode,
      },
      meta: { ruleName: rule.name, ruleKind: rule.kind, quarantineQty: row.quarantineQty },
      createdByUserId: null,
      createdByDeviceUid: null,
      createdAt: isoEventAt,
      updatedAt: isoEventAt,
      deletedAt: null,
    });
  }
  return out;
}

async function deriveFromExpiryByRule(
  client: PoolClient,
  siteId: number,
  rule: WmsCalendarRuleRow,
  ctx: { fromIso: string | null; toIso: string | null; types: string[] }
): Promise<WmsCalendarEvent[]> {
  const cfg = rule.config || {};
  const targetType = getString(cfg, "eventTypeCode", "expiry_warning");
  if (ctx.types.length > 0 && !ctx.types.includes(targetType)) return [];

  // Config
  // - dateField: expiryAt | bestBeforeAt | both
  // - warnDays: number (how many days before to show)
  // - criticalDays: number (<= becomes severity=critical)
  // - minQty: number (ignore lots with total qty <= minQty)
  // - includeBlocked: boolean (default false)
  const dateField = getString(cfg, "dateField", (rule.kind || "").toLowerCase().includes("best") ? "bestBeforeAt" : "expiryAt");
  const warnDays = Math.max(0, Math.trunc(getNumber(cfg, "warnDays", 7)));
  const criticalDays = Math.max(0, Math.trunc(getNumber(cfg, "criticalDays", 2)));
  const minQty = getNumber(cfg, "minQty", 0);
  const includeBlocked = Boolean((cfg as Record<string, unknown>).includeBlocked);
  const statusCode = getString(cfg, "statusCode", "planned");
  const baseSeverity = getString(cfg, "severityCode", "warn");
  const tags = ["derived", "rule", "expiry", ...(getStringArray(cfg, "tags") || [])].slice(0, 20);

  const from = ctx.fromIso ? new Date(ctx.fromIso) : null;
  const to = ctx.toIso ? new Date(ctx.toIso) : null;
  if (from && Number.isNaN(from.getTime())) return [];
  if (to && Number.isNaN(to.getTime())) return [];

  // We compute "event date" = lot_date - warnDays. We want events whose event date falls into [from,to).
  // We'll fetch candidate lots within a padded range: lot_date in [from - warnDays, to + warnDays].
  const fromPad = from ? new Date(from.getTime() + -warnDays * 86400000) : null;
  const toPad = to ? new Date(to.getTime() + warnDays * 86400000) : null;

  const pickExpr =
    dateField === "bestBeforeAt"
      ? `wl.best_before_at`
      : dateField === "expiryAt"
        ? `wl.expiry_at`
        : `COALESCE(wl.expiry_at, wl.best_before_at)`;

  const params: unknown[] = [siteId, fromPad ? fromPad.toISOString() : null, toPad ? toPad.toISOString() : null, minQty, includeBlocked];
  const r = await client.query<{
    itemCode: string;
    itemName: string;
    lotId: string;
    lotCode: string;
    batchLabel: string | null;
    lotDate: string | null;
    isBlocked: boolean;
    qtyTotal: number;
  }>(
    `
    SELECT
      i.item_code AS "itemCode",
      i.name AS "itemName",
      wl.lot_id::text AS "lotId",
      wl.lot_code AS "lotCode",
      wl.batch_label AS "batchLabel",
      (${pickExpr})::timestamptz AS "lotDate",
      wl.is_blocked AS "isBlocked",
      SUM(sl.available_qty + sl.quarantine_qty + sl.reserved_qty + sl.in_transit_qty)::float8 AS "qtyTotal"
    FROM wms_lots wl
    JOIN wms_items i ON i.item_id = wl.item_id
    JOIN wms_stock_lots sl ON sl.lot_code = wl.lot_code
    JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id AND sb.site_id = wl.site_id AND sb.item_id = wl.item_id
    WHERE wl.site_id = $1
      AND (${pickExpr}) IS NOT NULL
      AND ($2::timestamptz IS NULL OR (${pickExpr}) >= $2::timestamptz)
      AND ($3::timestamptz IS NULL OR (${pickExpr}) < $3::timestamptz)
      AND ($5::bool OR NOT wl.is_blocked)
    GROUP BY i.item_code, i.name, wl.lot_id, wl.lot_code, wl.batch_label, wl.is_blocked, (${pickExpr})
    HAVING SUM(sl.available_qty + sl.quarantine_qty + sl.reserved_qty + sl.in_transit_qty)::float8 > $4::float8
    ORDER BY (${pickExpr}) ASC
    LIMIT 300
    `,
    params
  );

  const out: WmsCalendarEvent[] = [];
  for (const row of r.rows) {
    if (!row.lotDate) continue;
    const lotDate = new Date(row.lotDate);
    if (Number.isNaN(lotDate.getTime())) continue;
    const eventDate = new Date(lotDate.getTime() - warnDays * 86400000);
    // normalize to 09:00 local-like
    const eventAt = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate(), 9, 0, 0, 0);
    if (from && eventAt < from) continue;
    if (to && eventAt >= to) continue;

    const daysLeft = Math.round((lotDate.getTime() - new Date().getTime()) / 86400000);
    const severityCode = daysLeft <= criticalDays ? "critical" : baseSeverity;
    const title = `Сроки: ${row.itemCode} · ${row.lotCode}`;
    const description = `${row.itemName} · ${dateField === "bestBeforeAt" ? "best-before" : "expiry"} ${lotDate.toLocaleDateString("ru-RU")} · qty ${Math.round(row.qtyTotal)}`;

    out.push({
      eventId: `derived:rule:${rule.ruleId}:lot:${row.lotId}:warn:${eventAt.toISOString().slice(0, 10)}`,
      siteId,
      typeCode: targetType,
      title,
      description,
      startAt: eventAt.toISOString(),
      endAt: null,
      allDay: true,
      statusCode,
      severityCode,
      tags,
      refs: {
        kind: "lot",
        ruleId: rule.ruleId,
        lotId: row.lotId,
        lotCode: row.lotCode,
        batchLabel: row.batchLabel,
        itemCode: row.itemCode,
      },
      meta: {
        ruleName: rule.name,
        ruleKind: rule.kind,
        lotDate: lotDate.toISOString(),
        warnDays,
        criticalDays,
        qtyTotal: row.qtyTotal,
        isBlocked: row.isBlocked,
      },
      createdByUserId: null,
      createdByDeviceUid: null,
      createdAt: eventAt.toISOString(),
      updatedAt: eventAt.toISOString(),
      deletedAt: null,
    });
  }
  return out;
}

async function deriveFromDocuments(
  client: PoolClient,
  siteId: number,
  opts: { fromIso: string | null; toIso: string | null; types: string[] }
): Promise<WmsCalendarEvent[]> {
  const fromIso = opts.fromIso;
  const toIso = opts.toIso;
  const filterTypes = opts.types;

  const r = await client.query<{
    documentId: string;
    documentType: string;
    documentStatus: string;
    documentNo: string | null;
    title: string;
    startAt: string;
    createdAt: string;
    updatedAt: string;
  }>(
    `
    SELECT
      d.document_id::text AS "documentId",
      dt.code AS "documentType",
      ds.code AS "documentStatus",
      d.document_no AS "documentNo",
      (dt.code || ' ' || COALESCE(d.document_no, ('#' || d.document_id::text))) AS "title",
      COALESCE(
        NULLIF(trim(d.payload_json->>'receiptAtIso'), '')::timestamptz,
        d.released_at,
        d.created_at
      )::timestamptz AS "startAt",
      d.created_at AS "createdAt",
      COALESCE(d.released_at, d.created_at) AS "updatedAt"
    FROM wms_documents d
    JOIN ref_wms_document_type dt ON dt.document_type_id = d.document_type_id
    JOIN ref_wms_document_status ds ON ds.document_status_id = d.document_status_id
    WHERE d.site_id = $1
      AND ($2::timestamptz IS NULL OR COALESCE(NULLIF(trim(d.payload_json->>'receiptAtIso'), '')::timestamptz, d.released_at, d.created_at) >= $2::timestamptz)
      AND ($3::timestamptz IS NULL OR COALESCE(NULLIF(trim(d.payload_json->>'receiptAtIso'), '')::timestamptz, d.released_at, d.created_at) < $3::timestamptz)
    ORDER BY "startAt" ASC
    LIMIT 300
    `,
    [siteId, fromIso, toIso]
  );

  const mapType = (docType: string) => {
    const v = (docType || "").toLowerCase();
    if (v.includes("receiv") || v.includes("receipt")) return "receiving";
    if (v.includes("ship") || v.includes("issue")) return "shipping";
    if (v.includes("revision") || v.includes("count")) return "revision";
    return "movement";
  };

  const statusMap = (s: string) => {
    const v = (s || "").toLowerCase();
    if (v.includes("complete") || v.includes("applied") || v.includes("done")) return "completed";
    if (v.includes("progress") || v.includes("started") || v.includes("released")) return "in_progress";
    if (v.includes("cancel")) return "cancelled";
    return "planned";
  };

  const out: WmsCalendarEvent[] = [];
  for (const row of r.rows) {
    const typeCode = mapType(row.documentType);
    if (filterTypes.length > 0 && !filterTypes.includes(typeCode)) continue;
    const startAt = new Date(row.startAt).toISOString();
    out.push({
      eventId: `derived:doc:${row.documentId}`,
      siteId,
      typeCode,
      title: row.title,
      description: row.documentStatus || null,
      startAt,
      endAt: null,
      allDay: true,
      statusCode: statusMap(row.documentStatus),
      severityCode: "info",
      tags: ["derived", "document"],
      refs: {
        kind: "document",
        documentId: row.documentId,
        documentType: row.documentType,
        documentNo: row.documentNo,
      },
      meta: {},
      createdByUserId: null,
      createdByDeviceUid: null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      deletedAt: null,
    });
  }
  return out;
}

async function deriveFromQuarantineLots(
  client: PoolClient,
  siteId: number,
  opts: { fromIso: string | null; toIso: string | null }
): Promise<WmsCalendarEvent[]> {
  // Quarantine is "current state"; we only show it when the requested range intersects "today".
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
  const eventAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0, 0, 0);

  const from = opts.fromIso ? new Date(opts.fromIso) : null;
  const to = opts.toIso ? new Date(opts.toIso) : null;
  if (from && eventAt < from) return [];
  if (to && eventAt >= to) return [];
  if (Number.isNaN(eventAt.getTime())) return [];

  const r = await client.query<{
    itemCode: string;
    itemName: string;
    lotCode: string | null;
    batchLabel: string | null;
    locationCode: string;
    quarantineQty: number;
  }>(
    `
    SELECT
      i.item_code AS "itemCode",
      i.name AS "itemName",
      wl.lot_code AS "lotCode",
      wl.batch_label AS "batchLabel",
      l.location_code AS "locationCode",
      SUM(sl.quarantine_qty)::float8 AS "quarantineQty"
    FROM wms_stock_lots sl
    JOIN wms_stock_balances sb ON sb.balance_id = sl.balance_id
    JOIN wms_items i ON i.item_id = sb.item_id
    JOIN wms_locations l ON l.location_id = sb.location_id
    JOIN wms_lots wl ON wl.lot_id = sl.lot_id
    WHERE sb.site_id = $1
      AND sl.quarantine_qty > 0
    GROUP BY i.item_code, i.name, wl.lot_code, wl.batch_label, l.location_code
    ORDER BY SUM(sl.quarantine_qty) DESC
    LIMIT 80
    `,
    [siteId]
  );

  const isoEventAt = eventAt.toISOString();
  const out: WmsCalendarEvent[] = [];
  for (const row of r.rows) {
    const title = `Карантин: ${row.itemCode}${row.lotCode ? ` · ${row.lotCode}` : ""} · ${row.locationCode}`;
    out.push({
      eventId: `derived:quarantine:${row.itemCode}:${row.lotCode ?? "—"}:${row.locationCode}`,
      siteId,
      typeCode: "quarantine",
      title,
      description: `${row.itemName} · qty ${Math.round(row.quarantineQty)}`,
      startAt: isoEventAt,
      endAt: null,
      allDay: true,
      statusCode: "in_progress",
      severityCode: "warn",
      tags: ["derived", "quarantine", "lot"],
      refs: {
        kind: "quarantine",
        itemCode: row.itemCode,
        lotCode: row.lotCode,
        batchLabel: row.batchLabel,
        locationCode: row.locationCode,
      },
      meta: { quarantineQty: row.quarantineQty },
      createdByUserId: null,
      createdByDeviceUid: null,
      createdAt: isoEventAt,
      updatedAt: isoEventAt,
      deletedAt: null,
    });
  }
  return out;
}

export async function createCalendarEvent(
  client: PoolClient,
  siteId: number,
  input: CreateCalendarEventInput
): Promise<{ event: WmsCalendarEvent }> {
  const typeCode = typeof input.typeCode === "string" ? input.typeCode.trim() : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!typeCode) throw new WmsHttpError(400, "typeCode is required", "bad_request");
  if (!title) throw new WmsHttpError(400, "title is required", "bad_request");

  const startAt = requireIso(input.startAt, "startAt");
  const endAt = input.endAt ? requireIso(input.endAt, "endAt") : null;
  const allDay = Boolean(input.allDay);
  const statusCode =
    typeof input.statusCode === "string" && input.statusCode.trim()
      ? input.statusCode.trim()
      : "planned";
  const severityCode =
    typeof input.severityCode === "string" && input.severityCode.trim()
      ? input.severityCode.trim()
      : "info";
  const tags = normalizeTags(input.tags);
  const refs = toJsonObject(input.refs);
  const meta = toJsonObject(input.meta);
  const createdByUserId =
    typeof input.createdByUserId === "string" && input.createdByUserId.trim()
      ? Number(input.createdByUserId.trim())
      : null;
  const createdByDeviceUid =
    typeof input.createdByDeviceUid === "string" && input.createdByDeviceUid.trim()
      ? input.createdByDeviceUid.trim()
      : null;

  const r = await client.query(
    `
    INSERT INTO wms_calendar_events
      (site_id, type_code, title, description, start_at, end_at, all_day,
       status_code, severity_code, tags, refs, meta, created_by_user_id, created_by_device_uid)
    VALUES
      ($1, $2, $3, NULLIF($4::text, ''), $5::timestamptz, $6::timestamptz, $7,
       $8, $9, $10::text[], $11::jsonb, $12::jsonb, $13::bigint, $14)
    RETURNING event_id::text AS "eventId"
    `,
    [
      siteId,
      typeCode,
      title,
      input.description ?? "",
      startAt,
      endAt,
      allDay,
      statusCode,
      severityCode,
      tags,
      JSON.stringify(refs),
      JSON.stringify(meta),
      createdByUserId,
      createdByDeviceUid,
    ]
  );
  const eventId = r.rows[0]?.eventId as string | undefined;
  if (!eventId) throw new WmsHttpError(500, "failed to create event", "internal_error");
  const data = await client.query(
    `SELECT
       e.event_id::text AS "eventId",
       e.site_id::int AS "siteId",
       e.type_code AS "typeCode",
       e.title,
       e.description,
       e.start_at AS "startAt",
       e.end_at AS "endAt",
       e.all_day AS "allDay",
       e.status_code AS "statusCode",
       e.severity_code AS "severityCode",
       COALESCE(e.tags, ARRAY[]::text[]) AS "tags",
       COALESCE(e.refs, '{}'::jsonb) AS "refs",
       COALESCE(e.meta, '{}'::jsonb) AS "meta",
       e.created_by_user_id::text AS "createdByUserId",
       e.created_by_device_uid AS "createdByDeviceUid",
       e.created_at AS "createdAt",
       e.updated_at AS "updatedAt",
       e.deleted_at AS "deletedAt"
     FROM wms_calendar_events e
     WHERE e.site_id = $1 AND e.event_id = $2::bigint`,
    [siteId, eventId]
  );
  return { event: data.rows[0] as WmsCalendarEvent };
}

export async function updateCalendarEvent(
  client: PoolClient,
  siteId: number,
  eventId: string,
  patch: UpdateCalendarEventInput
): Promise<{ event: WmsCalendarEvent }> {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new WmsHttpError(400, "invalid eventId", "bad_request");
  }

  const fields: string[] = [];
  const values: unknown[] = [siteId, id];
  function add(sql: string, v: unknown) {
    values.push(v);
    fields.push(`${sql} = $${values.length}`);
  }

  if (typeof patch.typeCode === "string") add("type_code", patch.typeCode.trim() || "note");
  if (typeof patch.title === "string") add("title", patch.title.trim());
  if ("description" in patch) add("description", (patch.description ?? "") as string);
  if ("startAt" in patch && patch.startAt != null) add("start_at", requireIso(patch.startAt, "startAt"));
  if ("endAt" in patch) add("end_at", patch.endAt ? requireIso(patch.endAt, "endAt") : null);
  if (typeof patch.allDay === "boolean") add("all_day", patch.allDay);
  if (typeof patch.statusCode === "string") add("status_code", patch.statusCode.trim() || "planned");
  if (typeof patch.severityCode === "string") add("severity_code", patch.severityCode.trim() || "info");
  if ("tags" in patch) add("tags", normalizeTags(patch.tags));
  if ("refs" in patch) add("refs", JSON.stringify(toJsonObject(patch.refs)));
  if ("meta" in patch) add("meta", JSON.stringify(toJsonObject(patch.meta)));

  if (fields.length === 0) {
    throw new WmsHttpError(400, "empty patch", "bad_request");
  }

  const r = await client.query(
    `
    UPDATE wms_calendar_events
    SET ${fields.join(", ")}, updated_at = now()
    WHERE site_id = $1 AND event_id = $2::bigint AND deleted_at IS NULL
    RETURNING event_id::text AS "eventId"
    `,
    values
  );
  const updatedId = r.rows[0]?.eventId as string | undefined;
  if (!updatedId) throw new WmsHttpError(404, "event not found", "not_found");
  const data = await client.query(
    `SELECT
       e.event_id::text AS "eventId",
       e.site_id::int AS "siteId",
       e.type_code AS "typeCode",
       e.title,
       e.description,
       e.start_at AS "startAt",
       e.end_at AS "endAt",
       e.all_day AS "allDay",
       e.status_code AS "statusCode",
       e.severity_code AS "severityCode",
       COALESCE(e.tags, ARRAY[]::text[]) AS "tags",
       COALESCE(e.refs, '{}'::jsonb) AS "refs",
       COALESCE(e.meta, '{}'::jsonb) AS "meta",
       e.created_by_user_id::text AS "createdByUserId",
       e.created_by_device_uid AS "createdByDeviceUid",
       e.created_at AS "createdAt",
       e.updated_at AS "updatedAt",
       e.deleted_at AS "deletedAt"
     FROM wms_calendar_events e
     WHERE e.site_id = $1 AND e.event_id = $2::bigint`,
    [siteId, updatedId]
  );
  return { event: data.rows[0] as WmsCalendarEvent };
}

export async function deleteCalendarEvent(
  client: PoolClient,
  siteId: number,
  eventId: string
): Promise<{ ok: true }> {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new WmsHttpError(400, "invalid eventId", "bad_request");
  }
  const r = await client.query(
    `UPDATE wms_calendar_events
     SET deleted_at = now(), updated_at = now()
     WHERE site_id = $1 AND event_id = $2::bigint AND deleted_at IS NULL`,
    [siteId, id]
  );
  if (r.rowCount === 0) throw new WmsHttpError(404, "event not found", "not_found");
  return { ok: true };
}

