import { NextRequest, NextResponse } from "next/server"
import { getLabelCodeOrder, labelCodeOrderCodesDownloadUrl } from "@/lib/wms/label-code-orders"
import { getLabelOrderWasteSettings, loadLabelOrderBundles } from "@/lib/wms/label-order-docs"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

/** Документ заказа, журнал событий и корректировки — открываются по кнопке, не в списке. */
async function loadDocBundle(orderId: string, siteCode: string) {
  const pool = tryGetPool()
  if (!pool) return null
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return null
    const settings = await getLabelOrderWasteSettings(client, siteId)
    const bundles = await loadLabelOrderBundles(client, siteId, [orderId])
    const bundle = bundles.get(orderId)
    return bundle ? { ...bundle, settings } : { settings }
  } finally {
    client.release()
  }
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { id } = await ctx.params
    const wantTxt = req.nextUrl.searchParams.get("download") === "1"
    if (wantTxt) {
      const url = labelCodeOrderCodesDownloadUrl(id)
      const res = await fetch(url, { cache: "no-store" })
      const text = await res.text()
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: text.slice(0, 200) }, { status: res.status })
      }
      return new NextResponse(text, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="codes-${id.slice(0, 8)}.txt"`,
        },
      })
    }
    const includeCodes = req.nextUrl.searchParams.get("includeCodes") !== "0"
    const wantDoc = req.nextUrl.searchParams.get("doc") === "1"
    const order = await getLabelCodeOrder(id, includeCodes)
    if (!wantDoc) return NextResponse.json({ ok: true, order })

    const siteCode = (req.nextUrl.searchParams.get("siteCode") || "DEFAULT").trim() || "DEFAULT"
    let bundle: Awaited<ReturnType<typeof loadDocBundle>> = null
    try {
      bundle = await loadDocBundle(id, siteCode)
    } catch (docError) {
      console.error("[label-code-orders/:id] doc bundle failed", docError)
    }
    return NextResponse.json({ ok: true, order, ...(bundle ?? {}) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}
