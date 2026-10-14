import { HttpError } from "@/lib/db.ts"
import { jsonBody, route } from "@/lib/http.ts"
import * as admin from "@/lib/edi/admin.ts"
import type { IntegrationKind } from "@/lib/edi/integrations/config.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor, params, req }) => {
  const u = new URL(req.url).searchParams
  switch (params.section) {
    case "org":
      return admin.getOrgSettings(client, actor)
    case "users":
      return admin.listOrgUsers(client, actor)
    case "integrations":
      return admin.integrationsView(client, actor)
    case "subscription":
      return admin.subscriptionView(client, actor)
    case "formats":
      return admin.formatsView(client)
    case "audit":
      return admin.auditView(client, actor, { action: u.get("action") ?? "", userId: u.get("userId") ?? "", before: u.get("before") ?? "" })
    case "webhooks":
      return admin.webhooksView(client, actor)
    case "retention":
      return admin.retentionView(client, actor)
    default:
      throw new HttpError(404, "Раздел не найден", "not_found")
  }
})

export const POST = route(async ({ client, actor, params, req }) => {
  const b = await jsonBody<Record<string, any>>(req)
  switch (params.section) {
    case "org":
      return admin.saveOrgSettings(client, actor, b)
    case "users":
      return admin.setUserRoles(client, actor, b as { userId: string; roles: string[]; department?: string })
    case "integrations":
      if (b.check) return admin.checkIntegration(client, actor, b.check as IntegrationKind)
      return admin.saveIntegrationSettings(client, actor, b as { kind: IntegrationKind; config: Record<string, string>; secret?: string; isEnabled: boolean })
    case "subscription":
      if (b.plan) return admin.savePlan(client, actor, b.plan)
      return admin.setSubscription(client, actor, b as { planCode: string })
    case "formats":
      return admin.saveFormat(client, actor, b as { code: string })
    case "webhooks":
      return admin.saveWebhook(client, actor, b)
    case "retention":
      if (Array.isArray(b.purge)) return admin.purgeExpired(client, actor, b.purge.map(String))
      return admin.saveRetention(client, actor, b as { docType: string; years: number })
    default:
      throw new HttpError(404, "Раздел не найден", "not_found")
  }
}, { tx: true })
