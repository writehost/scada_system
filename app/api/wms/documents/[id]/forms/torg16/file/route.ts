import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { loadTorg16ForDocument } from "@/lib/wms/writeoff";
import {
  buildTorg16StarterXlsx,
  fillTorg16Template,
  readTorg16TemplateBytes,
  torg16DownloadName,
} from "@/lib/wms/torg16-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  const { id } = await ctx.params;

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const form = await loadTorg16ForDocument(client, siteId, id);
    if (!form) return NextResponse.json({ error: "document not found" }, { status: 404 });
    const stored = await readTorg16TemplateBytes(siteId);
    if (!stored) {
      const starter = buildTorg16StarterXlsx(form.fields);
      return new NextResponse(new Uint8Array(starter), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${torg16DownloadName(form.fields, "xlsx")}"`,
        },
      });
    }
    const filled = fillTorg16Template(stored.bytes, stored.meta.kind, form.fields);
    return new NextResponse(new Uint8Array(filled), {
      headers: {
        "Content-Type": stored.meta.mimeType,
        "Content-Disposition": `attachment; filename="${torg16DownloadName(form.fields, stored.meta.kind)}"`,
      },
    });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
