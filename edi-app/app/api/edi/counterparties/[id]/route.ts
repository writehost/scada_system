import { jsonBody, route } from "@/lib/http.ts"
import { counterpartyCard, updateCounterparty, type CounterpartyIn } from "@/lib/edi/counterparties.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params }) => counterpartyCard(client, actor, params.id))

export const PATCH = route(async ({ client, actor, params, req }) => ({ counterparty: await updateCounterparty(client, actor, params.id, await jsonBody<CounterpartyIn>(req)) }), { tx: true })
