import { jsonBody, route } from "@/lib/http.ts"
import { listTemplates, saveTemplate, type TemplateRow } from "@/lib/edi/templates.ts"
import { DOC_TYPES } from "@/lib/edi/doc-types.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => {
  const org = await client.query(`SELECT legal_name AS "legalName", inn, kpp, address, bank_name AS "bankName", bank_bik AS "bankBik",
     bank_account AS "bankAccount", corr_account AS "corrAccount", director, accountant, logo_file_id::text AS "logoFileId"
     FROM edi_org_settings WHERE site_id = $1`, [actor.siteId])
  return { templates: await listTemplates(client, actor), types: DOC_TYPES, org: org.rows[0] ?? null }
})

export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ code: string; name: string; docType: string; schema: TemplateRow["schema"]; layout: TemplateRow["layout"]; numbering: TemplateRow["numbering"]; allowedRoles?: string[]; isActive?: boolean }>(req)
  return saveTemplate(client, actor, b)
}, { tx: true })
