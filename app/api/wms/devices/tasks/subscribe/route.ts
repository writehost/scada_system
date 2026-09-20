import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { listTasksForDevice } from "@/lib/wms/tasks";
import { WMS_TASK_EVENTS_CHANNEL, type WmsTaskEvent } from "@/lib/wms/events";
import { requireDeviceByUid, touchWmsDevice } from "@/lib/wms/devices";
import { WmsHttpError } from "@/lib/wms/errors";
import { guardDeviceRequest } from "@/lib/wms/device-auth";
import {
  filterTasksByRoleCodes,
  resolveDeviceOperatorAuth,
} from "@/lib/wms/device-operator-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseEvent(payload: string | null): WmsTaskEvent | null {
  if (!payload) return null;
  try {
    const j = JSON.parse(payload) as Partial<WmsTaskEvent>;
    if (!j || typeof j !== "object") return null;
    if (typeof j.siteId !== "number") return null;
    if (typeof j.taskId !== "string") return null;
    if (typeof j.eventType !== "string") return null;
    return {
      siteId: j.siteId,
      taskId: j.taskId,
      eventType: j.eventType as WmsTaskEvent["eventType"],
      deviceUid: typeof j.deviceUid === "string" ? j.deviceUid : null,
      message: typeof j.message === "string" ? j.message : null,
      atIso: typeof j.atIso === "string" ? j.atIso : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const deviceUid = (url.searchParams.get("deviceUid") ?? "").trim();
  if (!siteCode || !deviceUid) {
    return NextResponse.json({ error: "siteCode and deviceUid are required" }, { status: 400 });
  }
  const deviceAuthError = await guardDeviceRequest(req, { siteCode, deviceUid });
  if (deviceAuthError) return deviceAuthError;
  const timeoutSecRaw = Number(url.searchParams.get("timeout") ?? "30");
  const timeoutSec = Number.isFinite(timeoutSecRaw) ? Math.min(Math.max(Math.trunc(timeoutSecRaw), 1), 60) : 30;

  const probe = await pool.connect();
  let siteId: number;
  try {
    const sid = await getSiteId(probe, siteCode);
    if (sid == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    siteId = sid;
  } finally {
    probe.release();
  }

  const client = await pool.connect();
  try {
    await requireDeviceByUid(client, siteId, deviceUid);
    await touchWmsDevice(client, siteId, deviceUid);
    await client.query(`LISTEN ${WMS_TASK_EVENTS_CHANNEL}`);

    const event = await new Promise<WmsTaskEvent | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutSec * 1000);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(null);
      };
      const onNotify = (msg: { channel: string; payload?: string }) => {
        if (msg.channel !== WMS_TASK_EVENTS_CHANNEL) return;
        const ev = parseEvent(msg.payload ?? null);
        if (!ev) return;
        if (ev.siteId !== siteId) return;
        if (ev.deviceUid && ev.deviceUid !== deviceUid) return;
        clearTimeout(timer);
        req.signal.removeEventListener("abort", onAbort);
        client.removeListener("notification", onNotify);
        resolve(ev);
      };
      client.on("notification", onNotify);
      req.signal.addEventListener("abort", onAbort, { once: true });
    });

    const data = await listTasksForDevice(client, siteId, deviceUid, {
      cursor: url.searchParams.get("cursor"),
      limit: Number(url.searchParams.get("limit") ?? "100"),
      status: url.searchParams.get("status") ?? "open",
      type: url.searchParams.get("type") ?? "",
      query: url.searchParams.get("query") ?? "",
    });
    const operatorUserId = (url.searchParams.get("operatorUserId") ?? "").trim();
    const auth = await resolveDeviceOperatorAuth(client, siteId, deviceUid, operatorUserId || null);
    let tasks = data.tasks;
    if (auth.kind === "resolved") {
      if (auth.roleCodes.length === 0) {
        throw new WmsHttpError(403, "У оператора нет ролей WMS.", "no_roles");
      }
      tasks = filterTasksByRoleCodes(tasks, auth.roleCodes);
    }
    return NextResponse.json({
      ...data,
      tasks,
      trigger: event ?? { eventType: "timeout", atIso: new Date().toISOString() },
    });
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error(error);
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  } finally {
    client.release();
  }
}

