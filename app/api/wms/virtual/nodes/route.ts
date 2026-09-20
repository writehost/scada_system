import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createVirtualNode } from "@/lib/wms/virtual";
import { WmsHttpError } from "@/lib/wms/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    layoutId?: string;
    parentNodeId?: string | null;
    nodeType?: "room" | "rack" | "shelf" | "box" | "bin" | "container" | "pallet_slot";
    code?: string;
    label?: string;
    posX?: number;
    posY?: number;
    posZ?: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    sizeX?: number;
    sizeY?: number;
    sizeZ?: number;
    sortOrder?: number;
    props?: Record<string, unknown> | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const siteCode = typeof body.siteCode === "string" ? body.siteCode.trim() : "";
  if (!siteCode) {
    return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) {
      return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    }
    const data = await createVirtualNode(client, siteId, {
      layoutId: typeof body.layoutId === "string" ? body.layoutId : "",
      parentNodeId: typeof body.parentNodeId === "string" ? body.parentNodeId : null,
      nodeType: body.nodeType ?? "box",
      code: typeof body.code === "string" ? body.code : undefined,
      label: typeof body.label === "string" ? body.label : "",
      posX: body.posX,
      posY: body.posY,
      posZ: body.posZ,
      rotX: body.rotX,
      rotY: body.rotY,
      rotZ: body.rotZ,
      sizeX: body.sizeX,
      sizeY: body.sizeY,
      sizeZ: body.sizeZ,
      sortOrder: body.sortOrder,
      props: body.props ?? null,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof WmsHttpError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    throw error;
  } finally {
    client.release();
  }
}
