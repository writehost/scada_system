import type { PoolClient } from "pg";
import { WmsHttpError } from "@/lib/wms/errors";

export type WmsCalendarRuleRow = {
  ruleId: string;
  siteId: number;
  name: string;
  kind: string;
  isActive: boolean;
  priority: number;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

function toJsonObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  return v as Record<string, unknown>;
}

export async function listCalendarRules(
  client: PoolClient,
  siteId: number,
  opts?: { includeDeleted?: boolean }
): Promise<{ rules: WmsCalendarRuleRow[] }> {
  const includeDeleted = Boolean(opts?.includeDeleted);
  const r = await client.query(
    `
    SELECT
      rule_id::text AS "ruleId",
      site_id::int AS "siteId",
      name,
      kind,
      is_active AS "isActive",
      priority,
      COALESCE(config, '{}'::jsonb) AS "config",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      deleted_at AS "deletedAt"
    FROM wms_calendar_rules
    WHERE site_id = $1
      AND ($2::bool OR deleted_at IS NULL)
    ORDER BY is_active DESC, priority ASC, rule_id ASC
    LIMIT 500
    `,
    [siteId, includeDeleted]
  );
  return { rules: r.rows };
}

export async function createCalendarRule(
  client: PoolClient,
  siteId: number,
  input: {
    name: string;
    kind: string;
    isActive?: boolean;
    priority?: number;
    config?: Record<string, unknown>;
  }
): Promise<{ rule: WmsCalendarRuleRow }> {
  const name = (input.name || "").trim();
  const kind = (input.kind || "").trim();
  if (!name) throw new WmsHttpError(400, "name is required", "bad_request");
  if (!kind) throw new WmsHttpError(400, "kind is required", "bad_request");
  const isActive = input.isActive !== false;
  const priority = Number.isFinite(input.priority) ? Math.trunc(input.priority ?? 100) : 100;
  const config = toJsonObject(input.config);

  const r = await client.query(
    `
    INSERT INTO wms_calendar_rules (site_id, name, kind, is_active, priority, config)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    RETURNING rule_id::text AS "ruleId"
    `,
    [siteId, name, kind, isActive, priority, JSON.stringify(config)]
  );
  const ruleId = r.rows[0]?.ruleId as string | undefined;
  if (!ruleId) throw new WmsHttpError(500, "failed to create rule", "internal_error");
  const out = await client.query(
    `
    SELECT
      rule_id::text AS "ruleId",
      site_id::int AS "siteId",
      name,
      kind,
      is_active AS "isActive",
      priority,
      COALESCE(config, '{}'::jsonb) AS "config",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      deleted_at AS "deletedAt"
    FROM wms_calendar_rules
    WHERE site_id = $1 AND rule_id = $2::bigint
    `,
    [siteId, ruleId]
  );
  return { rule: out.rows[0] as WmsCalendarRuleRow };
}

export async function updateCalendarRule(
  client: PoolClient,
  siteId: number,
  ruleId: string,
  patch: Partial<{
    name: string;
    kind: string;
    isActive: boolean;
    priority: number;
    config: Record<string, unknown>;
  }>
): Promise<{ rule: WmsCalendarRuleRow }> {
  const id = Number(ruleId);
  if (!Number.isFinite(id) || id <= 0) throw new WmsHttpError(400, "invalid ruleId", "bad_request");

  const fields: string[] = [];
  const values: unknown[] = [siteId, id];
  function add(col: string, v: unknown) {
    values.push(v);
    fields.push(`${col} = $${values.length}`);
  }

  if (typeof patch.name === "string") add("name", patch.name.trim());
  if (typeof patch.kind === "string") add("kind", patch.kind.trim());
  if (typeof patch.isActive === "boolean") add("is_active", patch.isActive);
  if (typeof patch.priority === "number" && Number.isFinite(patch.priority)) add("priority", Math.trunc(patch.priority));
  if ("config" in patch) add("config", JSON.stringify(toJsonObject(patch.config)));

  if (fields.length === 0) throw new WmsHttpError(400, "empty patch", "bad_request");

  const r = await client.query(
    `
    UPDATE wms_calendar_rules
    SET ${fields.join(", ")}, updated_at = now()
    WHERE site_id = $1 AND rule_id = $2::bigint AND deleted_at IS NULL
    RETURNING rule_id::text AS "ruleId"
    `,
    values
  );
  const updatedId = r.rows[0]?.ruleId as string | undefined;
  if (!updatedId) throw new WmsHttpError(404, "rule not found", "not_found");

  const out = await client.query(
    `
    SELECT
      rule_id::text AS "ruleId",
      site_id::int AS "siteId",
      name,
      kind,
      is_active AS "isActive",
      priority,
      COALESCE(config, '{}'::jsonb) AS "config",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      deleted_at AS "deletedAt"
    FROM wms_calendar_rules
    WHERE site_id = $1 AND rule_id = $2::bigint
    `,
    [siteId, updatedId]
  );
  return { rule: out.rows[0] as WmsCalendarRuleRow };
}

export async function deleteCalendarRule(
  client: PoolClient,
  siteId: number,
  ruleId: string
): Promise<{ ok: true }> {
  const id = Number(ruleId);
  if (!Number.isFinite(id) || id <= 0) throw new WmsHttpError(400, "invalid ruleId", "bad_request");
  const r = await client.query(
    `UPDATE wms_calendar_rules SET deleted_at = now(), updated_at = now()
     WHERE site_id = $1 AND rule_id = $2::bigint AND deleted_at IS NULL`,
    [siteId, id]
  );
  if (r.rowCount === 0) throw new WmsHttpError(404, "rule not found", "not_found");
  return { ok: true };
}

