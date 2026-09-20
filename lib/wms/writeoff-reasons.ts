import type { PoolClient } from "pg";

export type WriteoffReasonRow = {
  code: string;
  displayName: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

const SEEDED_EXPIRED: WriteoffReasonRow = {
  code: "EXPIRED",
  displayName: "По истечению срока годности",
  sortOrder: 10,
  isActive: true,
  createdAt: "",
  updatedAt: "",
};

function rowToDto(r: {
  reason_code: string;
  display_name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): WriteoffReasonRow {
  return {
    code: r.reason_code,
    displayName: r.display_name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function reasonCodeFromDisplayName(displayName: string): string {
  const raw = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!raw) return `WO_${Date.now().toString(36).toUpperCase()}`;
  if (/^[A-Z0-9_]+$/.test(raw)) return raw;
  let h = 0;
  for (let i = 0; i < displayName.length; i += 1) {
    h = (h * 31 + displayName.charCodeAt(i)) >>> 0;
  }
  return `WO_${h.toString(36).toUpperCase()}`;
}

export function normalizeReasonCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_]{1,64}$/.test(c)) {
    throw new Error("code: только A–Z, цифры и _, до 64 символов");
  }
  return c;
}

export async function ensureWriteoffReasonTable(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_writeoff_reason_defs (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      reason_code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, reason_code)
    )`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_writeoff_reason_defs_site_sort
      ON wms_writeoff_reason_defs(site_id, sort_order, display_name)`);
}

export async function seedDefaultWriteoffReasons(client: PoolClient, siteId: number) {
  await ensureWriteoffReasonTable(client);
  await client.query(
    `INSERT INTO wms_writeoff_reason_defs (
       site_id, reason_code, display_name, sort_order, is_active
     ) VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (site_id, reason_code) DO NOTHING`,
    [siteId, SEEDED_EXPIRED.code, SEEDED_EXPIRED.displayName, SEEDED_EXPIRED.sortOrder]
  );
}

export async function listWriteoffReasonDefs(
  client: PoolClient,
  siteId: number,
  opts?: { activeOnly?: boolean }
): Promise<WriteoffReasonRow[]> {
  await seedDefaultWriteoffReasons(client, siteId);
  const activeOnly = opts?.activeOnly ?? false;
  const result = await client.query<{
    reason_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       reason_code,
       display_name,
       sort_order,
       is_active,
       created_at::text,
       updated_at::text
     FROM wms_writeoff_reason_defs
     WHERE site_id = $1
       ${activeOnly ? "AND is_active = TRUE" : ""}
     ORDER BY sort_order, display_name`,
    [siteId]
  );
  return result.rows.map(rowToDto);
}

export async function getWriteoffReasonDef(
  client: PoolClient,
  siteId: number,
  reasonCode: string
): Promise<WriteoffReasonRow | null> {
  await seedDefaultWriteoffReasons(client, siteId);
  const code = reasonCode.trim().toUpperCase();
  const result = await client.query<{
    reason_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT
       reason_code,
       display_name,
       sort_order,
       is_active,
       created_at::text,
       updated_at::text
     FROM wms_writeoff_reason_defs
     WHERE site_id = $1 AND UPPER(reason_code) = $2
     LIMIT 1`,
    [siteId, code]
  );
  return result.rows[0] ? rowToDto(result.rows[0]) : null;
}

export async function createWriteoffReasonDef(
  client: PoolClient,
  siteId: number,
  input: { code?: string; displayName: string; sortOrder?: number }
): Promise<WriteoffReasonRow> {
  await seedDefaultWriteoffReasons(client, siteId);
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("displayName is required");
  const code = input.code?.trim()
    ? normalizeReasonCode(input.code)
    : reasonCodeFromDisplayName(displayName);
  const sortOrder =
    typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
      ? Math.trunc(input.sortOrder)
      : 100;

  const result = await client.query<{
    reason_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO wms_writeoff_reason_defs (
       site_id, reason_code, display_name, sort_order, is_active
     ) VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (site_id, reason_code) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       sort_order = EXCLUDED.sort_order,
       is_active = TRUE,
       updated_at = now()
     RETURNING
       reason_code, display_name, sort_order, is_active,
       created_at::text, updated_at::text`,
    [siteId, code, displayName, sortOrder]
  );
  return rowToDto(result.rows[0]!);
}

export async function patchWriteoffReasonDef(
  client: PoolClient,
  siteId: number,
  reasonCode: string,
  patch: Partial<{ displayName: string; sortOrder: number; isActive: boolean }>
): Promise<WriteoffReasonRow | null> {
  await seedDefaultWriteoffReasons(client, siteId);
  const code = reasonCode.trim().toUpperCase();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (sql: string, v: unknown) => {
    vals.push(v);
    sets.push(`${sql} = $${vals.length}`);
  };

  if (typeof patch.displayName === "string" && patch.displayName.trim()) {
    push("display_name", patch.displayName.trim());
  }
  if (typeof patch.sortOrder === "number" && Number.isFinite(patch.sortOrder)) {
    push("sort_order", Math.trunc(patch.sortOrder));
  }
  if (typeof patch.isActive === "boolean") push("is_active", patch.isActive);

  if (sets.length === 0) return null;
  sets.push("updated_at = now()");
  const pSite = vals.length + 1;
  const pCode = vals.length + 2;
  const result = await client.query<{
    reason_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE wms_writeoff_reason_defs
     SET ${sets.join(", ")}
     WHERE site_id = $${pSite} AND UPPER(reason_code) = $${pCode}
     RETURNING
       reason_code, display_name, sort_order, is_active,
       created_at::text, updated_at::text`,
    [...vals, siteId, code]
  );
  return result.rows[0] ? rowToDto(result.rows[0]) : null;
}

export async function deleteWriteoffReasonDef(
  client: PoolClient,
  siteId: number,
  reasonCode: string
): Promise<boolean> {
  await seedDefaultWriteoffReasons(client, siteId);
  const code = reasonCode.trim().toUpperCase();
  if (!code) return false;
  const result = await client.query(
    `DELETE FROM wms_writeoff_reason_defs WHERE site_id = $1 AND UPPER(reason_code) = $2`,
    [siteId, code]
  );
  return (result.rowCount ?? 0) > 0;
}
