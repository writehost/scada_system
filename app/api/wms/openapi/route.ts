import { NextResponse } from "next/server";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveOpenApiPath(): Promise<string | null> {
  const candidates = [
    join(process.cwd(), "openapi", "wms.openapi.json"),
    join(process.cwd(), "..", "openapi", "wms.openapi.json"),
    join(process.cwd(), "..", "web", "openapi", "wms.openapi.json"),
  ];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      /* try next */
    }
  }
  return null;
}

export async function GET(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  try {
    const path = await resolveOpenApiPath();
    if (!path) {
      return NextResponse.json(
        { error: "OpenAPI spec not found (wms.openapi.json)" },
        { status: 404 }
      );
    }
    const json = await readFile(path, "utf-8");
    return new NextResponse(json, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/wms/openapi]", error);
    const message = error instanceof Error ? error.message : "internal error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
