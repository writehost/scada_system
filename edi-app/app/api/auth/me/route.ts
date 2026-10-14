import { route } from "@/lib/http.ts"
import { EDI_ROLES } from "@/lib/edi/permissions.ts"
import { loadSubscription } from "@/lib/edi/saas.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const GET = route(async ({ client, actor }) => {
  const sub = await loadSubscription(client, actor.siteId)
  return {
    userId: actor.userId,
    login: actor.login,
    fio: actor.fio,
    siteId: actor.siteId,
    siteCode: actor.siteCode,
    orgName: actor.orgName,
    orgs: actor.orgs.map((o) => ({ siteId: o.siteId, siteCode: o.siteCode, name: o.name })),
    roles: actor.roles.map((r) => ({ code: r, name: EDI_ROLES[r]?.name ?? r })),
    permissions: [...actor.permissions],
    department: actor.department,
    plan: { code: sub.planCode, name: sub.planName, features: sub.features, status: sub.status, validTo: sub.validTo },
  }
})
