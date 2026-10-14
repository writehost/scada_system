import { jsonBody, route } from "@/lib/http.ts"
import { documentDetail } from "@/lib/edi/detail.ts"
import { updateDocument, type DocumentPatch } from "@/lib/edi/documents.ts"
import { signalDocument } from "@/lib/edi/notify.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params }) => documentDetail(client, actor, params.id))

export const PATCH = route(async ({ client, actor, params, req }) => {
  const patch = await jsonBody<DocumentPatch>(req)
  const document = await updateDocument(client, actor, params.id, patch)
  await signalDocument(client, actor.siteId, params.id)
  return { document }
}, { tx: true })
