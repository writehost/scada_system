import { jsonBody, route } from "@/lib/http.ts"
import { qp } from "@/lib/params.ts"
import { createCounterparty, listCounterparties, type CounterpartyIn } from "@/lib/edi/counterparties.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, req }) => {
  const q = qp(req)
  return listCounterparties(client, actor, { search: q.str("q"), status: q.str("status"), role: q.str("role"), limit: q.num("limit") ?? 50, offset: q.num("offset") ?? 0 })
})

export const POST = route(async ({ client, actor, req }) => ({ counterparty: await createCounterparty(client, actor, await jsonBody<CounterpartyIn>(req)) }), { tx: true })
