import { route } from "@/lib/http.ts"
import { getDocument } from "@/lib/edi/documents.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Снимки версий для сравнения: ?v=1&v=3 */
export const GET = route(async ({ client, actor, params, req }) => {
  await getDocument(client, actor, params.id)
  const vs = new URL(req.url).searchParams.getAll("v").map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 2)
  const r = await client.query(
    `SELECT version_no AS "versionNo", snapshot, content_hash AS "contentHash", reason, created_by_name AS "createdBy", created_at AS "createdAt", locked
     FROM edi_document_versions WHERE document_id = $1::bigint AND version_no = ANY($2::int[]) ORDER BY version_no`,
    [params.id, vs]
  )
  return { versions: r.rows }
})
