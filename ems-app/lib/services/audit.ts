import type { Db } from "../server/db.ts"

export type Actor = { kind: "user" | "gateway" | "system" | "api_token" | "device"; id: string | null; ip?: string | null }

export const SYSTEM_ACTOR: Actor = { kind: "system", id: null }

export async function audit(
  c: Db,
  orgId: string | null,
  actor: Actor,
  action: string,
  entity?: { type: string; id: string | number | null },
  details: Record<string, unknown> = {},
): Promise<void> {
  await c.query(
    `INSERT INTO ems_audit_log (org_id, actor_id, actor_kind, action, entity_type, entity_id, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [orgId, actor.kind === "user" || actor.kind === "gateway" ? actor.id : null, actor.kind, action, entity?.type ?? null, entity?.id == null ? null : String(entity.id), JSON.stringify(details), actor.ip ?? null],
  )
}
