import { NextResponse } from "next/server";
import bwipjs from "bwip-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get("text")?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const png = await bwipjs.toBuffer({
      bcid: "datamatrix",
      text,
      scale: 3,
      paddingwidth: 2,
      paddingheight: 2,
      includetext: false,
    });

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[GET /api/wms/marking/datamatrix]", error);
    return NextResponse.json({ error: "Failed to render Data Matrix" }, { status: 400 });
  }
}
