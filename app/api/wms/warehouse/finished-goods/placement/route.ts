import { NextResponse } from "next/server"
import { resolveLabelOrderAuthor } from "@/lib/wms/label-order-author"
import { withPlacementSite } from "@/lib/wms/fg-placement-http"
import {
  allocateForTask,
  applyToRows,
  checkPlacement,
  deletePlacementRule,
  getPlacementTask,
  listPlacementAudit,
  listPlacementPallets,
  listPlacementRules,
  listPlacementTasks,
  loadPolicy,
  loadRowDraft,
  mapTints,
  placeAnyway,
  recommendPlacement,
  resetRowDraft,
  resolveAllRowSettings,
  resolveRowSettings,
  savePolicy,
  saveProductionPlanPreview,
  saveRowDraft,
  saveZonePlacement,
  seedPlacementDemo,
  upsertPlacementRule,
  verifyPlacementDemo,
} from "@/lib/wms/fg-placement"
import { DEFAULT_WAREHOUSE_POLICY, type MapViewMode, type PlacementRule, type RowPlacementDraft, type WarehousePlacementPolicy } from "@/lib/wms/fg-placement-types"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function actorName(author: { login: string; fio: string }) {
  return author.fio || author.login || "admin"
}

export async function GET(req: Request) {
  return withPlacementSite(req, async (client, siteId) => {
    const url = new URL(req.url)
    const view = url.searchParams.get("view") || "overview"
    if (view === "row") {
      const id = url.searchParams.get("id") || ""
      const settings = await resolveRowSettings(client, siteId, id)
      const draft = await loadRowDraft(client, siteId, settings.locationId)
      return NextResponse.json({ settings, draft })
    }
    if (view === "rules") {
      return NextResponse.json({ rules: await listPlacementRules(client, siteId) })
    }
    if (view === "policy") {
      return NextResponse.json({ policy: await loadPolicy(client, siteId) })
    }
    if (view === "audit") {
      return NextResponse.json({ audit: await listPlacementAudit(client, siteId) })
    }
    if (view === "tasks") {
      return NextResponse.json({ tasks: await listPlacementTasks(client, siteId) })
    }
    if (view === "task") {
      const taskId = url.searchParams.get("taskId") || ""
      return NextResponse.json({ allocation: await getPlacementTask(client, siteId, taskId) })
    }
    if (view === "map") {
      const mode = (url.searchParams.get("mode") || "normal") as MapViewMode
      const taskId = url.searchParams.get("taskId") || undefined
      return NextResponse.json({ tints: await mapTints(client, siteId, mode, taskId) })
    }
    if (view === "pallets") {
      return NextResponse.json({ pallets: await listPlacementPallets(client, siteId) })
    }
    const [policy, rules, rows, tasks, audit] = await Promise.all([
      loadPolicy(client, siteId),
      listPlacementRules(client, siteId),
      resolveAllRowSettings(client, siteId),
      listPlacementTasks(client, siteId),
      listPlacementAudit(client, siteId, 12),
    ])
    return NextResponse.json({
      policy,
      rules,
      rows: rows.map((r) => ({
        locationId: r.locationId,
        locationCode: r.locationCode,
        planRowId: r.planRowId,
        zone: r.zone,
        label: r.label,
        capacity: r.capacity,
        palletCount: r.palletCount,
        fillPercent: r.fillPercent,
        storageStrategy: r.storageStrategy,
        allocationStrategy: r.allocationStrategy,
        placementPriority: r.placementPriority,
        allowedMode: r.allowedMode,
        allowedProducts: r.allowedProducts,
        isBlocked: r.isBlocked,
        ruleCode: r.ruleCode,
      })),
      tasks,
      audit,
    })
  })
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const author = await resolveLabelOrderAuthor(req)
  const actor = actorName(author)
  return withPlacementSite(req, async (client, siteId, body) => {
    const action = String(body.action || "")
    if (action === "save-policy") {
      const policy = body.policy as WarehousePlacementPolicy
      return NextResponse.json({ policy: await savePolicy(client, siteId, policy || DEFAULT_WAREHOUSE_POLICY, actor) })
    }
    if (action === "save-rule") {
      const rule = await upsertPlacementRule(client, siteId, body.rule as PlacementRule, actor)
      return NextResponse.json({ rule })
    }
    if (action === "delete-rule") {
      await deletePlacementRule(client, siteId, String(body.ruleId || ""), actor)
      return NextResponse.json({ ok: true })
    }
    if (action === "save-zone") {
      await saveZonePlacement(client, siteId, String(body.zoneCode || ""), body.patch as never, actor)
      return NextResponse.json({ ok: true })
    }
    if (action === "save-row") {
      const settings = await saveRowDraft(
        client,
        siteId,
        String(body.locationId || ""),
        body.draft as RowPlacementDraft,
        actor
      )
      return NextResponse.json({ settings })
    }
    if (action === "reset-row") {
      const settings = await resetRowDraft(client, siteId, String(body.locationId || ""), actor)
      return NextResponse.json({ settings })
    }
    if (action === "apply-to-rows") {
      const result = await applyToRows(
        client,
        siteId,
        String(body.selector || ""),
        body.draft as RowPlacementDraft,
        actor
      )
      return NextResponse.json(result)
    }
    if (action === "recommend") {
      const result = await recommendPlacement(client, siteId, {
        query: String(body.query || ""),
        itemCode: body.itemCode ? String(body.itemCode) : undefined,
        lotCode: body.lotCode ? String(body.lotCode) : undefined,
      })
      return NextResponse.json(result)
    }
    if (action === "check") {
      const result = await checkPlacement(client, siteId, {
        query: String(body.query || ""),
        planRowId: String(body.planRowId || ""),
        position: body.position != null ? Number(body.position) : undefined,
        lotCode: body.lotCode ? String(body.lotCode) : undefined,
      })
      return NextResponse.json(result)
    }
    if (action === "place-anyway") {
      const result = await placeAnyway(client, siteId, {
        query: String(body.query || ""),
        chosenPlanRowId: String(body.planRowId || ""),
        chosenPosition: body.position != null ? Number(body.position) : undefined,
        reason: String(body.reason || "ручное исключение"),
        actor,
      })
      return NextResponse.json(result)
    }
    if (action === "allocate") {
      const result = await allocateForTask(client, siteId, {
        query: String(body.query || ""),
        qty: Number(body.qty || 1),
        taskId: body.taskId ? String(body.taskId) : undefined,
        persist: body.persist !== false,
        actor,
      })
      return NextResponse.json(result)
    }
    if (action === "production-plan") {
      await saveProductionPlanPreview(client, siteId, Array.isArray(body.items) ? body.items : [], actor)
      return NextResponse.json({ ok: true })
    }
    if (action === "seed") {
      const result = await seedPlacementDemo(client, siteId, actor)
      return NextResponse.json(result)
    }
    if (action === "verify") {
      const result = await verifyPlacementDemo(client, siteId)
      return NextResponse.json(result)
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 })
  })
}
