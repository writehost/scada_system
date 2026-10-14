import type { PoolClient } from "pg"
import { HttpError } from "../db.ts"
import { requirePermission, type Actor } from "./actor.ts"
import { actorEvent, recordEvent } from "./audit.ts"
import { docType } from "./doc-types.ts"
import { requireFeature } from "./saas.ts"

export type TemplateRow = {
  templateId: string
  siteId: number | null
  code: string
  name: string
  docType: string
  version: number
  isActive: boolean
  schema: { defaults?: Record<string, unknown>; required?: string[]; body?: string; customFields?: Array<{ key: string; label: string; type: string; required?: boolean; showIf?: { field: string; equals: string | boolean } }> }
  layout: { showLogo?: boolean; signatures?: string[]; header?: string; footer?: string; accent?: string }
  numbering: { prefix?: string; pattern?: string; reset?: string }
  allowedRoles: string[]
  system: boolean
}

/** Активные шаблоны: системные (site_id NULL) и собственные — последняя версия каждого кода, с учётом прав на использование. */
export async function listTemplates(client: PoolClient, actor: Actor): Promise<TemplateRow[]> {
  const r = await client.query<TemplateRow>(
    `SELECT DISTINCT ON (COALESCE(site_id, 0), code) template_id::text AS "templateId", site_id AS "siteId", code, name, doc_type AS "docType", version,
            is_active AS "isActive", schema, layout, numbering, allowed_roles AS "allowedRoles", site_id IS NULL AS system
     FROM edi_templates WHERE (site_id IS NULL OR site_id = $1)
     ORDER BY COALESCE(site_id, 0), code, version DESC`,
    [actor.siteId]
  )
  return r.rows.filter((t) => t.isActive && (t.allowedRoles.length === 0 || t.allowedRoles.some((x) => actor.roles.includes(x))))
}

/** Изменение шаблона = новая версия. Документы хранят template_id своей версии и не меняются задним числом. */
export async function saveTemplate(
  client: PoolClient,
  actor: Actor,
  input: { code: string; name: string; docType: string; schema: TemplateRow["schema"]; layout: TemplateRow["layout"]; numbering: TemplateRow["numbering"]; allowedRoles?: string[]; isActive?: boolean }
) {
  requirePermission(actor, "edi.template.admin")
  await requireFeature(client, actor.siteId, "templatesCustom", "Собственные шаблоны")
  if (!docType(input.docType)) throw new HttpError(400, "Неизвестный тип документа", "bad_type")
  const code = String(input.code || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 60)
  if (!code || !input.name?.trim()) throw new HttpError(400, "Укажите код и название шаблона", "bad_template")
  for (const f of input.schema.customFields ?? []) {
    if (!/^custom[A-Za-z0-9_]{1,30}$/.test(f.key)) throw new HttpError(400, `Ключ собственного поля должен начинаться с custom: ${f.key}`, "bad_field")
  }
  const pattern = input.numbering.pattern ?? "{prefix}{seq}"
  if (!pattern.includes("{seq")) throw new HttpError(400, "Шаблон номера должен содержать {seq}", "bad_numbering")
  const v = await client.query<{ v: number }>(`SELECT COALESCE(max(version), 0)::int + 1 AS v FROM edi_templates WHERE site_id = $1 AND code = $2`, [actor.siteId, code])
  await client.query(`UPDATE edi_templates SET is_active = FALSE WHERE site_id = $1 AND code = $2`, [actor.siteId, code])
  const r = await client.query<{ template_id: string }>(
    `INSERT INTO edi_templates (site_id, code, name, doc_type, version, is_active, schema, layout, numbering, allowed_roles, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10, $11::bigint) RETURNING template_id::text`,
    [actor.siteId, code, input.name.trim(), input.docType, v.rows[0].v, input.isActive !== false, JSON.stringify(input.schema), JSON.stringify(input.layout), JSON.stringify({ ...input.numbering, pattern }), input.allowedRoles ?? [], actor.userId]
  )
  await recordEvent(client, actorEvent(actor, "admin.template", null, { code, version: v.rows[0].v }))
  return { templateId: r.rows[0].template_id, version: v.rows[0].v }
}
