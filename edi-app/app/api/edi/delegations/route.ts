import { jsonBody, route } from "@/lib/http.ts"
import { createDelegation, listDelegations, revokeDelegation } from "@/lib/edi/workflow.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => ({ delegations: await listDelegations(client, actor) }))

export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ fromUserId?: string; toUserId: string; scope?: string; startsAt?: string; endsAt?: string; reason?: string }>(req)
  return createDelegation(client, actor, b)
}, { tx: true })

export const DELETE = route(async ({ client, actor, req }) => {
  await revokeDelegation(client, actor, String(new URL(req.url).searchParams.get("id") ?? ""))
  return { ok: true }
}, { tx: true })
