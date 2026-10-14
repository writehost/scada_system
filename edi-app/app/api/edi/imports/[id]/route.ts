import { jsonBody, route } from "@/lib/http.ts"
import { confirmImport, discardImport, getImport, updateImport, type ImportEdits } from "@/lib/edi/import.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params }) => getImport(client, actor, params.id))

export const PATCH = route(async ({ client, actor, params, req }) => updateImport(client, actor, params.id, await jsonBody<ImportEdits>(req)), { tx: true })

export const POST = route(async ({ client, actor, params, req }) => {
  const b = await jsonBody<{ saveMappings?: boolean; createWmsReceipt?: boolean; responsibleUserId?: string; edits?: ImportEdits }>(req)
  return confirmImport(client, actor, params.id, b)
}, { tx: true })

export const DELETE = route(async ({ client, actor, params }) => {
  await discardImport(client, actor, params.id)
  return { ok: true }
}, { tx: true })
