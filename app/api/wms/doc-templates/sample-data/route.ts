import { NextResponse } from "next/server"
import { withDocTemplates } from "@/lib/doc-templates/http"
import { listWmsDocumentsForPreview, resolvePreviewData } from "@/lib/doc-templates/wms-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Данные предпросмотра: ?kind=&sample=<id> — тестовый набор, ?documentId= — документ WMS,
 * ?list=documents — последние документы WMS для выбора.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  return withDocTemplates(req, async ({ client, siteId, origin }) => {
    if (q.get("list") === "documents") {
      return NextResponse.json({ documents: await listWmsDocumentsForPreview(client, siteId) })
    }
    const data = await resolvePreviewData(client, siteId, q.get("kind") ?? "trade", { sampleId: q.get("sample"), documentId: q.get("documentId") }, origin)
    return NextResponse.json({ data })
  })
}
