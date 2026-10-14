import { jsonBody, route } from "@/lib/http.ts"
import { qp } from "@/lib/params.ts"
import { createDocument, type DocumentIn } from "@/lib/edi/documents.ts"
import { listDocuments } from "@/lib/edi/journal.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, req }) => {
  const q = qp(req)
  return listDocuments(client, actor, {
    folder: q.str("folder"),
    q: q.str("q"),
    types: q.list("type"),
    statuses: q.list("status"),
    direction: q.str("direction"),
    counterpartyId: q.str("counterpartyId"),
    dateFrom: q.str("dateFrom"),
    dateTo: q.str("dateTo"),
    amountMin: q.num("amountMin"),
    amountMax: q.num("amountMax"),
    authorId: q.str("authorId"),
    responsibleId: q.str("responsibleId"),
    wmsStatus: q.str("wmsStatus"),
    viewId: q.str("viewId"),
    sort: q.str("sort"),
    dir: q.str("dir") === "asc" ? "asc" : "desc",
    page: q.num("page") ?? 1,
    pageSize: q.num("pageSize") ?? 50,
  })
})

export const POST = route(async ({ client, actor, req }) => {
  const body = await jsonBody<DocumentIn>(req)
  return { document: await createDocument(client, actor, { ...body, source: "manual", status: undefined }) }
}, { tx: true })
