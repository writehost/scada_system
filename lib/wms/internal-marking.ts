import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";
import { getSiteId } from "@/lib/wms/resolve";

const GS = "\x1d";
const INTERNAL_GTIN_PREFIX = "90";
const INTERNAL_SERIAL_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-.%";

export type InternalMarkingCode = {
  codeId: string;
  itemCode: string;
  itemName: string;
  gtin: string;
  serial: string;
  cryptoTail: string;
  raw: string;
  display: string;
  datamatrixUrl: string;
  statusId: number;
};

export type InternalMarkingResolveResult = {
  found: boolean;
  source: "internal_wms";
  codeId?: string;
  itemCode?: string;
  itemName?: string;
  gtin?: string;
  serial?: string;
  cryptoTail?: string | null;
  statusId?: number;
  statusName?: string;
  siteCode?: string;
  locationCode?: string | null;
  linkedAt?: string | null;
};

function cleanDigits(value: unknown): string {
  return String(value ?? "").replace(/\D+/g, "");
}

function normalizeGtin(value: unknown): string | null {
  const digits = cleanDigits(value);
  if (digits.length === 14) return digits;
  if (digits.length === 13) return `0${digits}`;
  if (digits.length > 0 && digits.length < 14) return digits.padStart(14, "0");
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function bigintHash(value: string): string {
  const buf = crypto.createHash("sha256").update(value, "utf8").digest();
  return buf.readBigInt64BE(0).toString();
}

function randomText(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (const b of bytes) out += INTERNAL_SERIAL_ALPHABET[b % INTERNAL_SERIAL_ALPHABET.length];
  return out;
}

function makeSerial(itemId: string, sequence: number): string {
  const seq = Math.max(0, Math.trunc(sequence)).toString(36).toUpperCase().padStart(6, "0");
  const suffix = randomText(8);
  return `I${String(itemId).padStart(8, "0").slice(-8)}${seq}${suffix}`.slice(0, 20);
}

function makeCryptoTail(): string {
  return randomText(16);
}

function buildRaw(gtin: string, serial: string, cryptoTail: string): string {
  return `01${gtin}21${serial}${GS}93${cryptoTail}`;
}

function parseInternalCode(rawInput: string): { gtin: string; serial: string; cryptoTail: string | null } | null {
  const raw = rawInput.trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;

  const paren = raw.match(/^\(01\)(\d{14})\(21\)([\s\S]+?)(?:\u001d?\(93\)([\s\S]+))?$/);
  if (paren) {
    return { gtin: paren[1], serial: paren[2].replace(/\u001d$/, ""), cryptoTail: paren[3] ?? null };
  }

  const compact = raw.match(/^01(\d{14})21([\s\S]+?)(?:\u001d93([\s\S]+)|93([\s\S]+))?$/);
  if (compact) {
    return { gtin: compact[1], serial: compact[2].replace(/\u001d$/, ""), cryptoTail: compact[3] ?? compact[4] ?? null };
  }

  return null;
}

async function getOrAssignInternalGtin(
  client: PoolClient,
  siteId: number,
  item: { item_id: string; item_code: string; item_attrs_json: unknown; sku: string | null }
): Promise<string> {
  const attrs = asRecord(item.item_attrs_json);
  const existing = normalizeGtin(attrs.internalGtin ?? attrs.gtin ?? item.item_code ?? item.sku);
  if (existing) {
    if (attrs.internalGtin !== existing) {
      await client.query(
        `UPDATE wms_items
         SET item_attrs_json = COALESCE(item_attrs_json, '{}'::jsonb) || $3::jsonb,
             updated_at = now()
         WHERE site_id = $1 AND item_id = $2::bigint`,
        [siteId, item.item_id, JSON.stringify({ internalGtin: existing })]
      );
    }
    return existing;
  }

  const generated = `${INTERNAL_GTIN_PREFIX}${String(item.item_id).padStart(12, "0").slice(-12)}`;
  await client.query(
    `UPDATE wms_items
     SET item_attrs_json = COALESCE(item_attrs_json, '{}'::jsonb) || $3::jsonb,
         updated_at = now()
     WHERE site_id = $1 AND item_id = $2::bigint`,
    [siteId, item.item_id, JSON.stringify({ internalGtin: generated, internalMarking: true })]
  );
  return generated;
}

async function resolveItemForInternalCode(
  client: PoolClient,
  siteId: number,
  itemCode: string
): Promise<{ item_id: string; item_code: string; name: string; sku: string | null; item_attrs_json: unknown } | null> {
  const r = await client.query<{
    item_id: string;
    item_code: string;
    name: string;
    sku: string | null;
    item_attrs_json: unknown;
  }>(
    `SELECT item_id::text, item_code, name, sku, item_attrs_json
     FROM wms_items
     WHERE site_id = $1 AND item_code = $2`,
    [siteId, itemCode.trim()]
  );
  return r.rows[0] ?? null;
}

export async function resolveItemGtinForMarking(
  client: PoolClient,
  input: { siteCode: string; itemCode: string; assignIfMissing?: boolean }
): Promise<{
  itemCode: string
  itemName: string
  gtin: string
  article: string
  source: string
}> {
  const siteId = await getSiteId(client, input.siteCode)
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found")

  const item = await resolveItemForInternalCode(client, siteId, input.itemCode)
  if (!item) throw new WmsHttpError(404, "item not found", "item_not_found")

  const attrs = asRecord(item.item_attrs_json)
  const existing = normalizeGtin(attrs.internalGtin ?? attrs.gtin ?? item.sku)
  const assign = input.assignIfMissing !== false

  if (!existing && !assign) {
    throw new WmsHttpError(404, "gtin not assigned", "gtin_missing")
  }

  const gtin = await getOrAssignInternalGtin(client, siteId, item)
  const source = existing
    ? attrs.internalGtin
      ? "internal"
      : attrs.gtin
        ? "gtin"
        : "sku"
    : "assigned"

  return {
    itemCode: item.item_code,
    itemName: item.name,
    gtin,
    article: (item.sku ?? "").trim() || item.item_code,
    source,
  }
}

export async function generateInternalMarkingCodes(
  client: PoolClient,
  input: { siteCode: string; itemCode: string; qty: number; markPrinted?: boolean }
): Promise<{ codes: InternalMarkingCode[]; gtin: string; article: string; batchCode: string }> {
  const siteId = await getSiteId(client, input.siteCode);
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found");

  const item = await resolveItemForInternalCode(client, siteId, input.itemCode);
  if (!item) throw new WmsHttpError(404, "item not found", "item_not_found");

  const qty = Math.min(Math.max(Math.trunc(Number(input.qty) || 0), 1), 500);
  const gtin = await getOrAssignInternalGtin(client, siteId, item);
  const statusId = input.markPrinted ? 3 : 2;

  const product = await client.query<{ product_id: number }>(
    `INSERT INTO marking_products (gtin)
     VALUES ($1)
     ON CONFLICT (gtin) DO UPDATE SET gtin = EXCLUDED.gtin
     RETURNING product_id`,
    [gtin]
  );
  const productId = product.rows[0]!.product_id;

  const result: InternalMarkingCode[] = [];
  for (let i = 0; i < qty; i += 1) {
    const serial = makeSerial(item.item_id, Date.now() + i);
    const cryptoTail = makeCryptoTail();
    const raw = buildRaw(gtin, serial, cryptoTail);
    const rawHash = bigintHash(raw);
    const baseHash = bigintHash(`01${gtin}21${serial}`);

    const code = await client.query<{ code_id: string }>(
      `INSERT INTO codes (ai01_gtin, ai21_serial, ai93_tail, raw, raw_hash, product_id, base_hash, flags)
       VALUES ($1, $2, $3, $4, $5::bigint, $6, $7::bigint, 0)
       ON CONFLICT (raw_hash) DO UPDATE SET raw = EXCLUDED.raw
       RETURNING code_id::text`,
      [gtin, serial, Buffer.from(cryptoTail, "utf8"), Buffer.from(raw, "utf8"), rawHash, productId, baseHash]
    );
    const codeId = code.rows[0]!.code_id;

    await client.query(
      `INSERT INTO code_state (code_id, site_id, status_id, feature_flags, emitted_at, printed_at, updated_at)
       VALUES ($1::bigint, $2, $3, $4, now(), $5, now())
       ON CONFLICT (code_id) DO UPDATE SET
         site_id = EXCLUDED.site_id,
         status_id = EXCLUDED.status_id,
         feature_flags = code_state.feature_flags | EXCLUDED.feature_flags,
         emitted_at = COALESCE(code_state.emitted_at, EXCLUDED.emitted_at),
         printed_at = COALESCE(code_state.printed_at, EXCLUDED.printed_at),
         updated_at = now()`,
      [codeId, siteId, statusId, input.markPrinted ? 1 : 0, input.markPrinted ? new Date() : null]
    );

    await client.query(
      `INSERT INTO wms_item_codes (item_id, code_id, current_site_id, note)
       VALUES ($1::bigint, $2::bigint, $3, $4)
       ON CONFLICT (code_id) DO UPDATE SET
         item_id = EXCLUDED.item_id,
         current_site_id = EXCLUDED.current_site_id,
         unlinked_at = NULL,
         note = EXCLUDED.note`,
      [item.item_id, codeId, siteId, "internal_wms_datamatrix"]
    );

    result.push({
      codeId,
      itemCode: item.item_code,
      itemName: item.name,
      gtin,
      serial,
      cryptoTail,
      raw,
      display: `01${gtin}21${serial} 93${cryptoTail}`,
      datamatrixUrl: `/api/wms/marking/datamatrix?text=${encodeURIComponent(raw)}`,
      statusId,
    });
  }

  return {
    codes: result,
    gtin,
    article: (item.sku ?? "").trim() || item.item_code,
    batchCode: "",
  }
}

export async function resolveInternalMarkingCode(
  client: PoolClient,
  input: { siteCode: string; code: string }
): Promise<InternalMarkingResolveResult> {
  const siteId = await getSiteId(client, input.siteCode);
  if (siteId == null) throw new WmsHttpError(404, "unknown siteCode", "site_not_found");

  const parsed = parseInternalCode(input.code);
  const raw = input.code.trim().replace(/^["']|["']$/g, "");
  const rawHash = raw ? bigintHash(raw) : null;

  const r = await client.query<{
    code_id: string;
    item_code: string;
    item_name: string;
    ai01_gtin: string;
    ai21_serial: string;
    crypto_tail: Buffer | null;
    status_id: number;
    status_name: string;
    site_code: string;
    location_code: string | null;
    linked_at: string | null;
  }>(
    `SELECT
       c.code_id::text,
       i.item_code,
       i.name AS item_name,
       c.ai01_gtin,
       c.ai21_serial,
       c.ai93_tail AS crypto_tail,
       cs.status_id,
       rs.name AS status_name,
       ws.site_code,
       l.location_code,
       wc.linked_at::text
     FROM codes c
     JOIN code_state cs ON cs.code_id = c.code_id AND cs.site_id = $1
     JOIN ref_status rs ON rs.status_id = cs.status_id
     JOIN wms_item_codes wc ON wc.code_id = c.code_id AND wc.current_site_id = cs.site_id AND wc.unlinked_at IS NULL
     JOIN wms_items i ON i.item_id = wc.item_id AND i.site_id = wc.current_site_id
     JOIN wms_sites ws ON ws.site_id = wc.current_site_id
     LEFT JOIN wms_locations l ON l.location_id = wc.current_location_id
     WHERE
       ($2::bigint IS NOT NULL AND c.raw_hash = $2::bigint)
       OR ($3::text IS NOT NULL AND c.ai01_gtin = $3 AND c.ai21_serial = $4)
     ORDER BY c.code_id DESC
     LIMIT 1`,
    [siteId, rawHash, parsed?.gtin ?? null, parsed?.serial ?? null]
  );

  const row = r.rows[0];
  if (!row) return { found: false, source: "internal_wms" };
  return {
    found: true,
    source: "internal_wms",
    codeId: row.code_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    gtin: row.ai01_gtin,
    serial: row.ai21_serial,
    cryptoTail: row.crypto_tail ? row.crypto_tail.toString("utf8") : null,
    statusId: row.status_id,
    statusName: row.status_name,
    siteCode: row.site_code,
    locationCode: row.location_code,
    linkedAt: row.linked_at,
  };
}
