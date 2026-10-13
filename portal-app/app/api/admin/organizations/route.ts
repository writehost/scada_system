import { NextResponse } from "next/server"
import { fail } from "@/lib/http"
import { provisioningConfigured } from "@/lib/scada-id/config"
import { listOrganizations } from "@/lib/scada-id/provisioning"
import { requireOwner } from "@/lib/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    await requireOwner()
    const organizations = await listOrganizations()
    return NextResponse.json({ organizations, provisioning: provisioningConfigured() })
  } catch (error) {
    return fail(error)
  }
}
