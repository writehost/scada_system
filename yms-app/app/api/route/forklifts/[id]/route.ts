import { actorLabel } from "@/lib/route/auth"
import { getForklift, upsertForkliftProfile } from "@/lib/route/fleet"
import { fail, num, str, withRouteTx } from "@/lib/route/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Профиль погрузчика в Route: тип, габариты, автоназначение (отключается диспетчером). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withRouteTx(req, "route.dispatch", async (ctx) => {
    const kara = await getForklift(ctx.client, ctx.siteId, id)
    if (!kara) fail(404, "погрузчик не найден во флоте WMS", "kara_not_found")
    const b = ctx.body
    const patch: Parameters<typeof upsertForkliftProfile>[3] = {}
    if (typeof b.autoAssign === "boolean") patch.autoAssign = b.autoAssign
    if (str(b, "forkliftType", 40)) patch.forkliftType = str(b, "forkliftType", 40)
    if (str(b, "status", 20)) patch.status = str(b, "status", 20)
    if ("widthM" in b) patch.widthM = num(b, "widthM")
    if ("heightM" in b) patch.heightM = num(b, "heightM")
    if ("capacityKg" in b) patch.capacityKg = num(b, "capacityKg")
    await upsertForkliftProfile(ctx.client, ctx.siteId, id, patch, actorLabel(ctx.actor))
    return { forklift: await getForklift(ctx.client, ctx.siteId, id) }
  })
}
