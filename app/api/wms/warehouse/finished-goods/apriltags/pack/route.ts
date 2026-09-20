import { NextResponse } from "next/server"
import {
  packTagZip,
  printInputFromSearchParams,
  renderTagMosaicPng,
  resolveFamily,
  resolvePrintSpec,
} from "@/lib/wms/apriltag-generate"
import { withFgSite } from "@/lib/wms/finished-goods-route"
import { readFgPlanAprilTags } from "@/lib/wms/fg-plan-apriltags-storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function parseIds(raw: string | null, fallback: number[], maxId: number): number[] {
  if (!raw?.trim()) return fallback.filter((n) => n >= 0 && n <= maxId)
  const ids = raw
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= maxId)
  return [...new Set(ids)]
}

export async function GET(req: Request) {
  return withFgSite(req, async (_client, siteId) => {
    const url = new URL(req.url)
    let family
    try {
      family = resolveFamily(url.searchParams.get("family"))
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "семья" }, { status: 400 })
    }
    const snapshot = await readFgPlanAprilTags(siteId)
    const planIds = snapshot.tags
      .map((t) => t.tagId)
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= family.maxId)
    const scope = (url.searchParams.get("scope") || "plan").trim()
    const ids =
      scope === "all"
        ? Array.from({ length: family.count }, (_, i) => i)
        : parseIds(url.searchParams.get("ids"), planIds, family.maxId)
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Нет номеров для архива — на плане нет тегов этой семьи или укажите ids" },
        { status: 400 }
      )
    }
    const input = { ...printInputFromSearchParams(url.searchParams), family: family.id }
    const spec = resolvePrintSpec(input)
    const kind = (url.searchParams.get("kind") || "zip").trim()
    if (kind === "mosaic") {
      if (ids.length > 80) {
        return NextResponse.json({ error: "Мозаика — до 80 тегов." }, { status: 400 })
      }
      const png = renderTagMosaicPng(ids, input)
      return new NextResponse(Uint8Array.from(png), {
        headers: {
          "Content-Type": "image/png",
          "Content-Disposition": `attachment; filename="${family.id}-mosaic-${ids.length}.png"`,
        },
      })
    }
    if (scope === "all" && family.count > 80) {
      return NextResponse.json(
        { error: `${family.id}: ${family.count} кодов. Всю семью целиком — только tag16h5 и tag25h9.` },
        { status: 400 }
      )
    }
    if (ids.length > 40 && spec.sizeCm >= 40) {
      return NextResponse.json({ error: "Для меток от 40 см — не больше 40 штук за раз." }, { status: 400 })
    }
    const zipKind = kind === "pdf" ? "pdf" : "png"
    const zip = packTagZip(ids, { ...input, preview: false }, zipKind)
    return new NextResponse(Uint8Array.from(zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${family.id}-${ids.length}-${spec.sizeCm}cm.${zipKind}.zip"`,
      },
    })
  })
}
