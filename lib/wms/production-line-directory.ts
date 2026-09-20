import type { PoolClient } from "pg";

export type ProductionLineDirectoryRow = {
  code: string;
  displayName: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export const DEFAULT_PRODUCTION_LINES: Array<{
  code: string;
  displayName: string;
  sortOrder: number;
}> = [
  { code: "SIPA", displayName: "Sipa", sortOrder: 10 },
  { code: "JR", displayName: "JR", sortOrder: 20 },
  { code: "DEVIN", displayName: "Devin", sortOrder: 30 },
  { code: "L5", displayName: "Линия 5 литров", sortOrder: 40 },
  { code: "L19", displayName: "Линия 19 литров", sortOrder: 50 },
];

function rowToDto(r: {
  line_code: string;
  display_name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): ProductionLineDirectoryRow {
  return {
    code: r.line_code,
    displayName: r.display_name,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function lineCodeFromDisplayName(displayName: string): string {
  const raw = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!raw) return `LINE_${Date.now().toString(36).toUpperCase()}`;
  if (/^[A-Z0-9_]+$/.test(raw)) return raw;
  let h = 0;
  for (let i = 0; i < displayName.length; i += 1) {
    h = (h * 31 + displayName.charCodeAt(i)) >>> 0;
  }
  return `LINE_${h.toString(36).toUpperCase()}`;
}

export function normalizeProductionLineCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_]{1,64}$/.test(c)) {
    throw new Error("code: только A–Z, цифры и _, до 64 символов");
  }
  return c;
}

/** Справочник линий читается на каждой загрузке календаря: DDL и посев значений
 * достаточно выполнить один раз за жизнь процесса. */
const lineDefsReady = new Set<number>();

export async function ensureProductionLineDefs(
  client: PoolClient,
  siteId: number
): Promise<void> {
  if (lineDefsReady.has(siteId)) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_production_line_defs (
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      line_code TEXT NOT NULL,
      display_name TEXT NOT NULL,
      sort_order INT NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, line_code)
    )
  `);

  const count = await client.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM wms_production_line_defs WHERE site_id = $1`,
    [siteId]
  );
  if (Number(count.rows[0]?.n || 0) > 0) {
    lineDefsReady.add(siteId);
    return;
  }

  await client.query(
    `INSERT INTO wms_production_line_defs (
       site_id, line_code, display_name, sort_order, is_active
     )
     SELECT $1, code, display_name, sort_order, TRUE
     FROM unnest($2::text[], $3::text[], $4::int[]) AS t(code, display_name, sort_order)
     ON CONFLICT (site_id, line_code) DO NOTHING`,
    [
      siteId,
      DEFAULT_PRODUCTION_LINES.map((row) => row.code),
      DEFAULT_PRODUCTION_LINES.map((row) => row.displayName),
      DEFAULT_PRODUCTION_LINES.map((row) => row.sortOrder),
    ]
  );
  lineDefsReady.add(siteId);
}

export async function listProductionLineDefs(
  client: PoolClient,
  siteId: number,
  opts?: { activeOnly?: boolean }
): Promise<ProductionLineDirectoryRow[]> {
  await ensureProductionLineDefs(client, siteId);
  const activeOnly = opts?.activeOnly ?? false;
  const result = await client.query<{
    line_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT
      line_code,
      display_name,
      sort_order,
      is_active,
      created_at::text,
      updated_at::text
    FROM wms_production_line_defs
    WHERE site_id = $1
      ${activeOnly ? "AND is_active = TRUE" : ""}
    ORDER BY sort_order, display_name
    `,
    [siteId]
  );
  return result.rows.map(rowToDto);
}

export async function createProductionLineDef(
  client: PoolClient,
  siteId: number,
  input: {
    code?: string;
    displayName: string;
    sortOrder?: number;
  }
): Promise<ProductionLineDirectoryRow> {
  await ensureProductionLineDefs(client, siteId);
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("displayName is required");
  const code = input.code?.trim()
    ? normalizeProductionLineCode(input.code)
    : lineCodeFromDisplayName(displayName);
  const sortOrder =
    typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
      ? Math.trunc(input.sortOrder)
      : 100;

  const result = await client.query<{
    line_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
    INSERT INTO wms_production_line_defs (
      site_id, line_code, display_name, sort_order, is_active
    ) VALUES ($1, $2, $3, $4, TRUE)
    ON CONFLICT (site_id, line_code) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE,
      updated_at = now()
    RETURNING
      line_code, display_name, sort_order, is_active,
      created_at::text, updated_at::text
    `,
    [siteId, code, displayName, sortOrder]
  );
  return rowToDto(result.rows[0]!);
}

export async function patchProductionLineDef(
  client: PoolClient,
  siteId: number,
  lineCode: string,
  patch: Partial<{
    displayName: string;
    sortOrder: number;
    isActive: boolean;
  }>
): Promise<ProductionLineDirectoryRow | null> {
  await ensureProductionLineDefs(client, siteId);
  const code = lineCode.trim().toUpperCase();
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
    line_code: string;
    display_name: string;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
    UPDATE wms_production_line_defs
    SET ${sets.join(", ")}
    WHERE site_id = $${pSite} AND UPPER(line_code) = $${pCode}
    RETURNING
      line_code, display_name, sort_order, is_active,
      created_at::text, updated_at::text
    `,
    [...vals, siteId, code]
  );
  const row = result.rows[0];
  return row ? rowToDto(row) : null;
}

export async function deleteProductionLineDef(
  client: PoolClient,
  siteId: number,
  lineCode: string
): Promise<boolean> {
  const code = lineCode.trim().toUpperCase();
  if (!code) return false;
  await ensureProductionLineDefs(client, siteId);
  const result = await client.query(
    `DELETE FROM wms_production_line_defs WHERE site_id = $1 AND UPPER(line_code) = $2`,
    [siteId, code]
  );
  return (result.rowCount ?? 0) > 0;
}
