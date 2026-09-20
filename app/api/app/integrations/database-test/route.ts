import { NextResponse } from "next/server";
import { readAuthTokenFromRequest } from "@/lib/auth/request-token";
import { verifySessionToken } from "@/lib/auth/session";
import { testDatabaseSettings, type EditableDatabaseSettings } from "@/lib/wms/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(roleCodes?: string[]) {
  return (roleCodes || []).some((r) => r === "admin");
}

export async function POST(req: Request) {
  const token = await readAuthTokenFromRequest(req);
  if (!token) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const session = await verifySessionToken(token);
  if (!session || !isAdmin(session.roleCodes)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as EditableDatabaseSettings;
  const result = await testDatabaseSettings({
    host: body.host || "",
    port: body.port || "5432",
    database: body.database || "",
    user: body.user || "",
    password: body.password || "",
    sslmode: body.sslmode,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
