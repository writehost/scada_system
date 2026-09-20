import { NextResponse } from "next/server"
import { WmsHttpError } from "@/lib/wms/errors"
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message"
import { tryGetPool } from "@/lib/wms/pool"
import {
  relinkStubMarkingCodesToProduct,
  resolveFinishedGoodsProductItem,
} from "@/lib/wms/marking-product-resolve"
import { getSiteId } from "@/lib/wms/resolve"
import { requireWmsActor } from "@/lib/wms/require-actor"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Body = {
  siteCode?: string
  productItemCode?: string
  productName?: string
  productGtin?: string
  unitGtin?: string
  blockGtin?: string
  palletGtinPrefix?: string
}

function asText(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
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

  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 })
    }

    await client.query("BEGIN")

    const product = await resolveFinishedGoodsProductItem(client, siteId, {
      productItemCode: asText(body.productItemCode) || undefined,
      productName: asText(body.productName) || undefined,
      productGtin: asText(body.productGtin) || undefined,
      sampleUnitGtin: asText(body.unitGtin) || "04607017161487",
      packaging: {
        unitGtin: asText(body.unitGtin) || "04607017161487",
        blockGtin: asText(body.blockGtin) || "04607017162354",
        palletGtinPrefix: asText(body.palletGtinPrefix) || "00346070171611",
        productGtin: asText(body.productGtin) || "04607017163993",
      },
      createMissing: true,
    })

    if (!product) {
      throw new WmsHttpError(400, "product not found", "bad_product")
    }

    const rel = await relinkStubMarkingCodesToProduct(client, siteId, product.itemId, product.packaging)

    await client.query("COMMIT")
    return NextResponse.json({
      ok: true,
      productItemId: product.itemId,
      relinked: rel.relinked,
      stubsDeactivated: rel.stubsDeactivated,
    })
  } catch (e) {
    try {
      await client.query("ROLLBACK")
    } catch {
      // ignore
    }
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
    }
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 })
  } finally {
    client.release()
  }
}
