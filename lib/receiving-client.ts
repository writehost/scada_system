import { getSiteCode, getWmsClientErrorMeta, postJson } from "@/lib/wms-api"

export { receivingScanMatchesGroup, itemMatchesReceivingGroup } from "@/lib/receiving-product-groups"
export { getWmsClientErrorMeta }

/** Поле `details` из JSON-ответа WMS API. */
export function getWmsClientErrorDetails(e: unknown): unknown {
  if (!e || typeof e !== "object") return undefined
  if ("details" in e) return (e as { details?: unknown }).details
  return undefined
}

export async function dismissEmptyReceivingSession(input: {
  documentId: string
  deviceUid?: string
}): Promise<{
  ok: true
  documentId: string
  alreadyDismissed?: boolean
  dismissedAtIso?: string | null
}> {
  return postJson("/api/wms/receiving/dismiss-session", {
    siteCode: getSiteCode(),
    documentId: input.documentId.trim().toUpperCase(),
    deviceUid: (input.deviceUid?.trim() || "web-operator").replace(/^веб-интерфейс$/i, "web-operator"),
  })
}
