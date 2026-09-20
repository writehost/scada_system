import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";
import {
  createCalendarRule,
  deleteCalendarRule,
  listCalendarRules,
  updateCalendarRule,
} from "@/lib/wms/calendar-rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  const includeDeleted = (url.searchParams.get("includeDeleted") ?? "") === "1";

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await listCalendarRules(client, siteId, { includeDeleted });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  let body: { siteCode?: string; name?: string; kind?: string; isActive?: boolean; priority?: number; config?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await createCalendarRule(client, siteId, {
      name: String(body.name ?? ""),
      kind: String(body.kind ?? ""),
      isActive: body.isActive,
      priority: typeof body.priority === "number" ? body.priority : undefined,
      config: (body.config && typeof body.config === "object" && !Array.isArray(body.config)) ? (body.config as Record<string, unknown>) : {},
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  let body: { siteCode?: string; ruleId?: string } & Record<string, unknown>;
  try {
    body = (await req.json()) as { siteCode?: string; ruleId?: string } & Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const ruleId = typeof body.ruleId === "string" ? body.ruleId.trim() : "";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!ruleId) return NextResponse.json({ error: "ruleId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const patch: Record<string, unknown> = { ...body };
    delete patch.siteCode;
    delete patch.ruleId;
    const data = await updateCalendarRule(client, siteId, ruleId, {
      name: typeof patch.name === "string" ? patch.name : undefined,
      kind: typeof patch.kind === "string" ? patch.kind : undefined,
      isActive: typeof patch.isActive === "boolean" ? patch.isActive : undefined,
      priority: typeof patch.priority === "number" ? patch.priority : undefined,
      config: (patch.config && typeof patch.config === "object" && !Array.isArray(patch.config)) ? (patch.config as Record<string, unknown>) : undefined,
    });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }
  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const ruleId = (url.searchParams.get("ruleId") ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!ruleId) return NextResponse.json({ error: "ruleId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await deleteCalendarRule(client, siteId, ruleId);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: wmsDbErrorToUserMessage(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

