import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { wmsErrorResponse } from "@/lib/wms/errors";
import { TORG16_VARIABLE_KEYS } from "@/lib/wms/torg16";
import {
  buildTorg16StarterXlsx,
  deleteTorg16Template,
  getTorg16TemplateMeta,
  readTorg16TemplateBytes,
  saveTorg16Template,
} from "@/lib/wms/torg16-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const metaOnly = url.searchParams.get("meta") === "1";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const meta = await getTorg16TemplateMeta(siteId);
    if (metaOnly) {
      return NextResponse.json({
        hasCustomTemplate: Boolean(meta),
        template: meta,
        variables: TORG16_VARIABLE_KEYS,
        placeholderStyle: "{{variable}}",
      });
    }
    const stored = await readTorg16TemplateBytes(siteId);
    if (!stored) {
      const starter = buildTorg16StarterXlsx();
      return new NextResponse(new Uint8Array(starter), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="TORG-16-shablon.xlsx"',
        },
      });
    }
    return new NextResponse(new Uint8Array(stored.bytes), {
      headers: {
        "Content-Type": stored.meta.mimeType,
        "Content-Disposition": `attachment; filename="${stored.meta.originalName.replace(/"/g, "")}"`,
      },
    });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const form = await req.formData();
  const siteCode = String(form.get("siteCode") ?? "").trim();
  const file = form.get("file");
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const bytes = Buffer.from(await file.arrayBuffer());
    const template = await saveTorg16Template(siteId, {
      name: file.name,
      type: file.type,
      bytes,
    });
    return NextResponse.json({
      ok: true,
      hasCustomTemplate: true,
      template,
      variables: TORG16_VARIABLE_KEYS,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("docx") || msg.includes(".doc")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const pool = tryGetPool();
  if (!pool) return NextResponse.json({ error: "database not configured" }, { status: 503 });
  const siteCode = new URL(req.url).searchParams.get("siteCode") ?? "";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    await deleteTorg16Template(siteId);
    return NextResponse.json({ ok: true, hasCustomTemplate: false });
  } catch (e) {
    return wmsErrorResponse(e);
  } finally {
    client.release();
  }
}
