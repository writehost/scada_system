import { HttpError } from "@/lib/db.ts"
import { jsonBody, route } from "@/lib/http.ts"
import {
  addComment,
  archiveDocument,
  deleteDraft,
  freezeVersionFile,
  grantAccess,
  relateDocuments,
  setStatus,
  toggleFavorite,
} from "@/lib/edi/documents.ts"
import { sendViaEdo } from "@/lib/edi/edo.ts"
import { signalDocument } from "@/lib/edi/notify.ts"
import { cancelWorkflow, startWorkflow } from "@/lib/edi/workflow.ts"
import { createDiscrepancyAct, createReceiptDraft, syncOneReceipt } from "@/lib/edi/wms-receipt.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = {
  action: string
  to?: string
  comment?: string
  on?: boolean
  body?: string
  targetId?: string
  kind?: string
  userId?: string
  access?: "read" | "edit"
  defId?: string
  reason?: string
}

export const POST = route(async ({ client, actor, params, req }) => {
  const b = await jsonBody<Body>(req)
  const id = params.id
  let result: unknown = { ok: true }
  switch (b.action) {
    case "status":
      result = { document: await setStatus(client, actor, id, String(b.to), b.comment) }
      break
    case "archive":
      await archiveDocument(client, actor, id)
      break
    case "restore":
      await archiveDocument(client, actor, id, true)
      break
    case "delete":
      await deleteDraft(client, actor, id)
      break
    case "favorite":
      await toggleFavorite(client, actor, id, b.on !== false)
      break
    case "comment":
      await addComment(client, actor, id, String(b.body ?? ""))
      break
    case "relate":
      await relateDocuments(client, actor, id, String(b.targetId), String(b.kind ?? "related"))
      break
    case "share":
      await grantAccess(client, actor, id, String(b.userId), b.access === "edit" ? "edit" : "read")
      break
    case "start_workflow":
      result = await startWorkflow(client, actor, id, b.defId)
      break
    case "cancel_workflow":
      await cancelWorkflow(client, actor, id, String(b.reason || "Отозван автором"))
      break
    case "wms_receipt":
      result = await createReceiptDraft(client, actor, id)
      break
    case "wms_sync":
      result = await syncOneReceipt(client, actor, id)
      break
    case "discrepancy_act":
      result = await createDiscrepancyAct(client, actor, id)
      break
    case "freeze_version":
      result = await freezeVersionFile(client, actor, id)
      break
    case "send_edo":
      result = await sendViaEdo(client, actor, id)
      break
    default:
      throw new HttpError(400, "Неизвестное действие", "bad_action")
  }
  await signalDocument(client, actor.siteId, id)
  return result
}, { tx: true })
