import { NextResponse } from "next/server"
import { readWmsItemImageFile } from "@/lib/wms/serve-item-image"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await ctx.params
  const img = await readWmsItemImageFile(segments.join("/"))
  if (!img) {
    return new NextResponse("Not found", { status: 404 })
  }
  return new NextResponse(img.bytes, {
    headers: {
      "Content-Type": img.contentType,
      "Cache-Control": "public, max-age=86400, immutable",
    },
  })
}
