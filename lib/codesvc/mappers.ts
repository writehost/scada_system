import type { MarkingCodeRow } from "@/lib/types";
import { formatProtoTimestamp } from "@/lib/codesvc/proto-time";
import { STATUS_LABEL_RU, statusIdToUi } from "@/lib/codesvc/status-ref";

function rawToDisplay(raw: Buffer | Uint8Array | undefined): string {
  if (!raw || raw.length === 0) return "";
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  return buf.toString("utf8");
}

export function rawHashToString(h: unknown): string {
  if (h == null || h === "") return "";
  if (typeof h === "string" || typeof h === "number") return String(h);
  if (typeof h === "object" && h !== null && "low" in (h as object)) {
    const o = h as { low?: number; high?: number };
    const lo = Number(o.low ?? 0);
    const hi = Number(o.high ?? 0);
    if (hi === 0 && lo >= 0) return String(lo);
    return `${hi}:${lo}`;
  }
  return String(h);
}

function attrValueString(o: Record<string, unknown>): string {
  if (o.v_text != null) return String(o.v_text);
  if (o.v_int != null) return String(o.v_int);
  if (o.v_num != null) return String(o.v_num);
  if (o.v_bool != null) return String(o.v_bool);
  return "…";
}

/** Текст атрибута по `attr_id` (после UpsertAttributes / из БД). */
export function attrTextById(attrs: unknown, attrId: number): string | undefined {
  if (!Array.isArray(attrs)) return undefined;
  for (const a of attrs) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const id = Number(o.attr_id ?? o.attrId);
    if (id !== attrId) continue;
    return attrValueString(o);
  }
  return undefined;
}

function formatAttrsFromProfile(p: Record<string, unknown>): string | undefined {
  const attrs = p.attrs;
  if (!Array.isArray(attrs) || attrs.length === 0) return undefined;
  const parts: string[] = [];
  for (const a of attrs) {
    if (!a || typeof a !== "object") continue;
    const o = a as Record<string, unknown>;
    const id = o.attr_id ?? o.attrId;
    parts.push(`${id}:${attrValueString(o)}`);
  }
  return parts.length > 0 ? parts.join("; ") : undefined;
}

function formatLastEvents(p: Record<string, unknown>): string | undefined {
  const evs = p.last_events;
  if (!Array.isArray(evs) || evs.length === 0) return undefined;
  const parts: string[] = [];
  for (const e of evs) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const et = Number(o.event_type_id ?? o.eventTypeId ?? 0);
    const label = STATUS_LABEL_RU[et] ?? `тип ${et}`;
    const eat = o.event_at ?? o.eventAt;
    const t = formatProtoTimestamp(eat);
    parts.push(t ? `${label} @ ${t}` : label);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function bytesToHexPreview(
  b: Buffer | Uint8Array | undefined,
  maxChars = 48
): string | undefined {
  if (!b || b.length === 0) return undefined;
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const hex = buf.toString("hex");
  return hex.length > maxChars ? `${hex.slice(0, maxChars)}…` : hex;
}

function optionalU32(v: unknown): string | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return String(Math.trunc(n));
}

function optionalU32Site(v: unknown): string | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (n === 0) return undefined;
  return String(Math.trunc(n));
}

/** Ответ gRPC (proto-loader, keepCase). */
export function profileToRow(p: Record<string, unknown>, index: number): MarkingCodeRow {
  const core = (p.core as Record<string, unknown>) ?? {};
  const state = (p.state as Record<string, unknown>) ?? {};
  const pool = (p.pool as Record<string, unknown>) ?? {};
  const pTop = p as Record<string, unknown>;

  const rawStatus =
    state.status_id ??
    state.statusId ??
    pTop.status_id ??
    pTop.statusId;
  let sid = Number(rawStatus ?? 1);
  if (!Number.isFinite(sid)) sid = 1;

  const { label, ui } = statusIdToUi(sid);

  const raw = core.raw as Buffer | Uint8Array | undefined;
  const rawStr = rawToDisplay(raw);
  const ai93Tail = core.ai93_tail as Buffer | Uint8Array | undefined;
  const ai93TailHex = bytesToHexPreview(ai93Tail);

  const rhStr = rawHashToString(core.raw_hash);

  const codeLine =
    rawStr.length > 0
      ? rawStr
      : [core.gtin, core.serial].filter(Boolean).join(" · ") ||
        rhStr ||
        `#${index}`;

  const attrs = p.attrs;
  const attrsText = formatAttrsFromProfile(p);
  const batchFromAttr = attrTextById(attrs, 1);

  const batchFromPool = pool.batch_label as string | undefined;
  const batchLabel =
    batchFromPool && batchFromPool.length > 0
      ? batchFromPool
      : batchFromAttr && batchFromAttr.length > 0
        ? batchFromAttr
        : undefined;

  const poolIdRaw = pool.pool_id;
  const poolId =
    poolIdRaw != null && poolIdRaw !== ""
      ? rawHashToString(poolIdRaw)
      : undefined;

  const poolSiteRaw = pool.site_id ?? pool.siteId;
  const poolSiteId = optionalU32Site(poolSiteRaw);

  const eventsSummary = formatLastEvents(p);

  const siteIdState = optionalU32Site(state.site_id ?? state.siteId);
  const locationId = optionalU32(state.location_id ?? state.locationId);
  const lineId = optionalU32(state.line_id ?? state.lineId);

  const coreCreatedAt = formatProtoTimestamp(core.created_at ?? core.createdAt);
  const stateUpdatedAt = formatProtoTimestamp(state.updated_at ?? state.updatedAt);
  const emittedAt = formatProtoTimestamp(state.emitted_at ?? state.emittedAt);
  const printedAt = formatProtoTimestamp(state.printed_at ?? state.printedAt);
  const appliedAt = formatProtoTimestamp(state.applied_at ?? state.appliedAt);
  const introducedAt = formatProtoTimestamp(state.introduced_at ?? state.introducedAt);
  const retiredAt = formatProtoTimestamp(state.retired_at ?? state.retiredAt);

  return {
    id: `db-${rhStr || index}-${index}`,
    rawHash: rhStr || undefined,
    statusIdNum: Number.isFinite(sid) && sid >= 1 ? Math.trunc(sid) : undefined,
    codeLine,
    gtin: (core.gtin as string) || undefined,
    serial: (core.serial as string) || undefined,
    ai93TailHex,
    status: ui,
    statusLabel: label,
    poolId,
    poolSiteId,
    batchLabel,
    attrsText,
    siteIdState,
    locationId,
    lineId,
    coreCreatedAt,
    stateUpdatedAt,
    emittedAt,
    printedAt,
    appliedAt,
    introducedAt,
    retiredAt,
    eventsSummary,
    note: undefined,
  };
}
