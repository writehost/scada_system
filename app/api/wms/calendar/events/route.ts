import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { WmsHttpError } from "@/lib/wms/errors";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
  type CreateCalendarEventInput,
  type UpdateCalendarEventInput,
} from "@/lib/wms/calendar-events";
import { wmsDbErrorToUserMessage } from "@/lib/wms/pg-user-message";

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

  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const types = (url.searchParams.get("types") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const includeDeleted = (url.searchParams.get("includeDeleted") ?? "") === "1";

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await listCalendarEvents(client, siteId, { from, to, types, includeDeleted });
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = wmsDbErrorToUserMessage(e);
    return NextResponse.json({ error: msg }, { status: 500 });
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
  let body: CreateCalendarEventInput & { siteCode?: string };
  try {
    body = (await req.json()) as CreateCalendarEventInput & { siteCode?: string };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const { siteCode: _omit, ...input } = body;
    const data = await createCalendarEvent(client, siteId, input);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = wmsDbErrorToUserMessage(e);
    return NextResponse.json({ error: msg }, { status: 500 });
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
  let body: { siteCode?: string; eventId?: string } & UpdateCalendarEventInput;
  try {
    body = (await req.json()) as { siteCode?: string; eventId?: string } & UpdateCalendarEventInput;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const { siteCode: _s, eventId: _e, ...patch } = body;
    const data = await updateCalendarEvent(client, siteId, eventId, patch);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = wmsDbErrorToUserMessage(e);
    return NextResponse.json({ error: msg }, { status: 500 });
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
  const eventId = (url.searchParams.get("eventId") ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!eventId) return NextResponse.json({ error: "eventId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const data = await deleteCalendarEvent(client, siteId, eventId);
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof WmsHttpError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    }
    const msg = wmsDbErrorToUserMessage(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}

