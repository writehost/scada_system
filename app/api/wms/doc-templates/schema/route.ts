import { NextResponse } from "next/server"
import { getDocumentKind, listDocumentKinds } from "@/lib/doc-templates/schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Схема данных шаблона: GET ?kind=trade.
 * Редактор строит выбор переменных только по ней — поля в UI не зашиты.
 */
export async function GET(req: Request) {
  const kindId = new URL(req.url).searchParams.get("kind")
  const kind = getDocumentKind(kindId)
  return NextResponse.json({
    kind: kind.id,
    label: kind.label,
    schemaVersion: kind.schemaVersion,
    schema: kind.schema,
    samples: kind.samples.map((s) => ({ id: s.id, label: s.label })),
    wmsDocuments: !!kind.wmsDocuments,
    kinds: listDocumentKinds(),
  })
}
