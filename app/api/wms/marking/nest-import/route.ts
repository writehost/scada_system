import { NextResponse } from "next/server"
import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import { tryGetPool } from "@/lib/wms/pool"
import {
  buildNestImportPlan,
  importNestMarkingCodes,
  normalizeNestImportEntries,
  previewNestImportDocument,
} from "@/lib/wms/marking-nest-import"
import { fetchCrptProductName } from "@/lib/wms/crpt-product-name"
import { getSiteId } from "@/lib/wms/resolve"
import { resolveOrCreateFgPlanLocation } from "@/lib/wms/fg-plan-locations"
import { WMS_PERMISSION, requireWmsPermission } from "@/lib/wms/permissions"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

type Body = {
  siteCode?: string
  entries?: unknown
  /** Альтернатива entries: целиком документ ЧЗ { aggregationUnits, ... } */
  document?: unknown
  batchLabel?: string
  locationCode?: string
  createMissingItems?: boolean
  productItemCode?: string
  productName?: string
  productGtin?: string
  productionLineCode?: string
  dryRun?: boolean
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

async function resolveOptionalLocation(
  client: PoolClient,
  siteId: number,
  locationCode: string
): Promise<string | null> {
  const code = locationCode.trim()
  if (!code) return null
  const loc = await resolveOrCreateFgPlanLocation(client, siteId, code)
  return loc.locationId
}

export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  const pool = tryGetPool()
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const siteCode = asText(body.siteCode)
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 })
  }
  const nestEntries = normalizeNestImportEntries(body.entries ?? body.document)
  if (nestEntries.length === 0) {
    return NextResponse.json(
      {
        error:
          "entries[] (nest) или document.aggregationUnits (ЧЗ/СЕЗАКМ) обязательны и не должны быть пустыми",
      },
      { status: 400 }
    )
  }

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    }

    const { codes, preview } = buildNestImportPlan(nestEntries)
    if (body.dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, preview })
    }

    await requireWmsPermission(client, actorGate.actor.userId, WMS_PERMISSION.itemsWrite, actorGate.actor.session?.login)

    const locationId = await resolveOptionalLocation(client, siteId, asText(body.locationCode))

    let productName = asText(body.productName)
    const productGtin = asText(body.productGtin)
    if (!productName && productGtin) {
      productName = (await fetchCrptProductName(productGtin)) || ""
    }
    if (!productName) {
      const unitGtin =
        codes.find((c) => c.level === "unit" && c.gtin && !c.gtin.startsWith("00"))?.gtin ||
        codes.find((c) => c.gtin && !c.gtin.startsWith("00"))?.gtin
      if (unitGtin) {
        productName = (await fetchCrptProductName(unitGtin)) || ""
      }
    }

    await client.query("BEGIN")
    const result = await importNestMarkingCodes(client, siteId, codes, {
      batchLabel: asText(body.batchLabel) || undefined,
      locationId,
      createMissingItems: body.createMissingItems !== false,
      productItemCode: asText(body.productItemCode) || undefined,
      productName: productName || undefined,
      productGtin: productGtin || undefined,
      productionLineCode: asText(body.productionLineCode) || undefined,
      relinkStubs: false,
    })
    await client.query("COMMIT")

    return NextResponse.json({ ok: true, preview, result })
  } catch (e) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // ignore
    }
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    const err = e as { code?: string }
    if (err?.code === "42P01" || err?.code === "42703") {
      return NextResponse.json(
        {
          error: "Схема БД устарела — установите обновление WMS",
          code: "db_schema_outdated",
          detail: wmsDbErrorToUserMessage(e),
          pgCode: err.code,
        },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    client.release()
  }
}

export async function PUT(req: Request) {
  const actorGate = await requireWmsActor(req);
  if ("error" in actorGate) return actorGate.error;

  let body: { entries?: unknown; document?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }
  const preview = previewNestImportDocument(body.entries ?? body.document)
  return NextResponse.json({ ok: true, preview })
}
