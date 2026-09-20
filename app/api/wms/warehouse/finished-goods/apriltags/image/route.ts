import { NextResponse } from "next/server"
import {
  printInputFromSearchParams,
  renderTag36h11Pdf,
  renderTag36h11Png,
  resolveFamily,
  tagFileName,
} from "@/lib/wms/apriltag-generate"
import { withFgSite } from "@/lib/wms/finished-goods-route"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  return withFgSite(req, async () => {
    const url = new URL(req.url)
    let family
    try {
      family = resolveFamily(url.searchParams.get("family"))
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "семья" }, { status: 400 })
    }
    const id = Number(url.searchParams.get("id"))
    if (!Number.isInteger(id) || id < 0 || id > family.maxId) {
      return NextResponse.json({ error: `${family.id}: id должен быть 0…${family.maxId}` }, { status: 400 })
    }
    const input = { ...printInputFromSearchParams(url.searchParams), family: family.id }
    const format = (url.searchParams.get("format") || "png").trim().toLowerCase()
    if (format === "pdf") {
      const pdf = renderTag36h11Pdf(id, { ...input, preview: false })
      return new NextResponse(Uint8Array.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${tagFileName(id, "pdf", family.id)}"`,
          "Cache-Control": "private, max-age=3600",
        },
      })
    }
    const png = renderTag36h11Png(id, input)
    const disposition = input.preview ? "inline" : "attachment"
    return new NextResponse(Uint8Array.from(png), {
      headers: {
        "Content-Type": "image/png",
        "Content-Disposition": `${disposition}; filename="${tagFileName(id, "png", family.id)}"`,
        "Cache-Control": input.preview ? "public, max-age=86400" : "private, max-age=3600",
      },
    })
  })
}
