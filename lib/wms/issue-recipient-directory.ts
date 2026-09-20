import type { PoolClient } from "pg";

export type IssueRecipientDirectoryRow = {
  code: string;
  displayName: string;
  position: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type IssueRecipientOption = {
  id: string;
  displayName: string;
  subtitle: string | null;
};

function rowToDto(r: {
  recipient_code: string;
  display_name: string;
  position: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): IssueRecipientDirectoryRow {
  return {
    code: r.recipient_code,
    displayName: r.display_name,
    position: r.position,
    sortOrder: r.sort_order,
    isActive: r.is_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function directoryRowToOption(row: IssueRecipientDirectoryRow): IssueRecipientOption {
  return {
    id: row.code,
    displayName: row.displayName,
    subtitle: row.position,
  };
}

export function recipientCodeFromDisplayName(displayName: string): string {
  const raw = displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-ЯЁ0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 56);
  if (!raw) return `RCPT_${Date.now().toString(36).toUpperCase()}`;
  if (/^[A-Z0-9_]+$/.test(raw)) return raw;
  let h = 0;
  for (let i = 0; i < displayName.length; i += 1) {
    h = (h * 31 + displayName.charCodeAt(i)) >>> 0;
  }
  return `RCPT_${h.toString(36).toUpperCase()}`;
}

export function normalizeRecipientCode(raw: string): string {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "_");
  if (!/^[A-Z0-9_]{1,64}$/.test(c)) {
    throw new Error("code: только A–Z, цифры и _, до 64 символов");
  }
  return c;
}

export async function listIssueRecipientDefs(
  client: PoolClient,
  siteId: number,
  opts?: { activeOnly?: boolean }
): Promise<IssueRecipientDirectoryRow[]> {
  const activeOnly = opts?.activeOnly ?? false;
  const result = await client.query<{
    recipient_code: string;
    display_name: string;
    position: string | null;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
    SELECT
      recipient_code,
      display_name,
      position,
      sort_order,
      is_active,
      created_at::text,
      updated_at::text
    FROM wms_issue_recipient_defs
    WHERE site_id = $1
      ${activeOnly ? "AND is_active = TRUE" : ""}
    ORDER BY sort_order, display_name
    `,
    [siteId]
  );
  return result.rows.map(rowToDto);
}

export async function listIssueRecipientOptions(
  client: PoolClient,
  siteId: number
): Promise<IssueRecipientOption[]> {
  const rows = await listIssueRecipientDefs(client, siteId, { activeOnly: true });
  return rows.map(directoryRowToOption);
}

export async function createIssueRecipientDef(
  client: PoolClient,
  siteId: number,
  input: {
    code?: string;
    displayName: string;
    position?: string | null;
    sortOrder?: number;
  }
): Promise<IssueRecipientDirectoryRow> {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("displayName is required");
  const code = input.code?.trim()
    ? normalizeRecipientCode(input.code)
    : recipientCodeFromDisplayName(displayName);
  const position =
    input.position == null ? null : String(input.position).trim() || null;
  const sortOrder =
    typeof input.sortOrder === "number" && Number.isFinite(input.sortOrder)
      ? Math.trunc(input.sortOrder)
      : 100;

  const result = await client.query<{
    recipient_code: string;
    display_name: string;
    position: string | null;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
    INSERT INTO wms_issue_recipient_defs (
      site_id, recipient_code, display_name, position, sort_order, is_active
    ) VALUES ($1, $2, $3, $4, $5, TRUE)
    ON CONFLICT (site_id, recipient_code) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      position = EXCLUDED.position,
      sort_order = EXCLUDED.sort_order,
      is_active = TRUE,
      updated_at = now()
    RETURNING
      recipient_code, display_name, position, sort_order, is_active,
      created_at::text, updated_at::text
    `,
    [siteId, code, displayName, position, sortOrder]
  );
  return rowToDto(result.rows[0]!);
}

export async function patchIssueRecipientDef(
  client: PoolClient,
  siteId: number,
  recipientCode: string,
  patch: Partial<{
    displayName: string;
    position: string | null;
    sortOrder: number;
    isActive: boolean;
  }>
): Promise<IssueRecipientDirectoryRow | null> {
  const code = recipientCode.trim().toUpperCase();
  const sets: string[] = [];
  const vals: unknown[] = [];
  const push = (sql: string, v: unknown) => {
    vals.push(v);
    sets.push(`${sql} = $${vals.length}`);
  };

  if (typeof patch.displayName === "string" && patch.displayName.trim()) {
    push("display_name", patch.displayName.trim());
  }
  if ("position" in patch) {
    const p = patch.position == null ? null : String(patch.position).trim() || null;
    push("position", p);
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
    recipient_code: string;
    display_name: string;
    position: string | null;
    sort_order: number;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
    UPDATE wms_issue_recipient_defs
    SET ${sets.join(", ")}
    WHERE site_id = $${pSite} AND UPPER(recipient_code) = $${pCode}
    RETURNING
      recipient_code, display_name, position, sort_order, is_active,
      created_at::text, updated_at::text
    `,
    [...vals, siteId, code]
  );
  const row = result.rows[0];
  return row ? rowToDto(row) : null;
}

export async function deleteIssueRecipientDef(
  client: PoolClient,
  siteId: number,
  recipientCode: string
): Promise<boolean> {
  const code = recipientCode.trim().toUpperCase();
  if (!code) return false;
  const result = await client.query(
    `DELETE FROM wms_issue_recipient_defs WHERE site_id = $1 AND UPPER(recipient_code) = $2`,
    [siteId, code]
  );
  return (result.rowCount ?? 0) > 0;
}
