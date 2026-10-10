import { NextResponse } from "next/server"
import { errorResponse, resolveUser } from "@/lib/server/http.ts"
import { withOrg, withSystem } from "@/lib/server/db.ts"
import { listUserOrgs, ROLE_PERMISSIONS } from "@/lib/services/org.ts"
import { getSubscription } from "@/lib/services/subscription.ts"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const auth = await resolveUser(req)
    if (!auth) return NextResponse.json({ error: "Нужен вход через SCADA ID", code: "auth_required" }, { status: 401 })
    const orgs = await withSystem((c) => listUserOrgs(c, auth.user.userId))
    const active = orgs.find((o) => o.orgId === auth.user.activeOrgId) ?? orgs[0] ?? null
    const subscription = active ? await withOrg(active.orgId, (c) => getSubscription(c, active.orgId)) : null
    return NextResponse.json({
      user: { userId: auth.user.userId, name: auth.user.displayName, email: auth.user.email, isPlatformAdmin: auth.user.isPlatformAdmin },
      org: active,
      orgs,
      permissions: active ? ROLE_PERMISSIONS[active.role] : [],
      subscription,
      session: { kind: auth.user.kind, expiresAt: auth.user.expiresAt },
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    return errorResponse(e)
  }
}
