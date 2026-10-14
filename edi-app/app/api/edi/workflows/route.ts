import { jsonBody, route } from "@/lib/http.ts"
import { listDefinitions, ROUTE_PRESETS, saveDefinition, type WorkflowDefinition } from "@/lib/edi/workflow.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => ({ definitions: await listDefinitions(client, actor.siteId), presets: ROUTE_PRESETS }))

export const POST = route(async ({ client, actor, req }) => {
  const b = await jsonBody<{ code: string; name: string; docTypes: string[]; priority?: number; isActive?: boolean; definition: WorkflowDefinition }>(req)
  return saveDefinition(client, actor, b)
}, { tx: true })
