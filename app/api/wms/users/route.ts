import { NextResponse } from "next/server";
import { tryGetPool } from "@/lib/wms/pool";
import { getSiteId } from "@/lib/wms/resolve";
import { createWmsUser, deleteWmsUser, updateWmsUser } from "@/lib/wms/users-admin";
import { WmsHttpError } from "@/lib/wms/errors";
import { requireWmsSession } from "@/lib/wms/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = url.searchParams.get("siteCode") ?? "";
  const query = (url.searchParams.get("query") ?? "").trim();
  const includeInactive = url.searchParams.get("includeInactive") === "1";
  if (!siteCode.trim()) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });

    const result = await client.query(
      `
      SELECT
        u.user_id::text AS "userId",
        u.login,
        u.display_name AS "displayName",
        u.external_code AS "externalCode",
        u.phone,
        u.position,
        u.rfid_uid AS "rfidUid",
        u.is_active AS "isActive",
        (u.password_hash IS NOT NULL) AS "hasPassword",
        (u.pin_hash IS NOT NULL) AS "hasPin",
        COALESCE(array_agg(r.code ORDER BY r.code) FILTER (WHERE r.code IS NOT NULL), '{}') AS roles
      FROM wms_users u
      LEFT JOIN wms_user_roles ur ON ur.user_id = u.user_id
      LEFT JOIN wms_roles r ON r.role_id = ur.role_id
      WHERE u.site_id = $1
        AND ($4::boolean OR u.is_active)
        AND ($2::text = '' OR u.login ILIKE $3 OR u.display_name ILIKE $3 OR COALESCE(u.external_code, '') ILIKE $3)
      GROUP BY u.user_id
      ORDER BY u.display_name, u.login
      LIMIT 200
      `,
      [siteId, query, `%${query}%`, includeInactive]
    );

    return NextResponse.json({ users: result.rows });
  } finally {
    client.release();
  }
}

export async function DELETE(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  const url = new URL(req.url);
  const siteCode = (url.searchParams.get("siteCode") ?? "").trim();
  const userId = (url.searchParams.get("userId") ?? "").trim();
  if (!siteCode) return NextResponse.json({ error: "siteCode is required" }, { status: 400 });
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const client = await pool.connect();
  try {
    const siteId = await getSiteId(client, siteCode);
    if (siteId == null) return NextResponse.json({ error: "unknown siteCode" }, { status: 404 });
    const result = await deleteWmsUser(client, siteId, userId);
    return NextResponse.json(result);
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

export async function POST(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    login?: string;
    displayName?: string;
    password?: string;
    position?: string | null;
    externalCode?: string | null;
    phone?: string | null;
    rfidUid?: string | null;
    pin?: string | null;
    roleCodes?: string[];
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
    const user = await createWmsUser(client, siteId, {
      login: typeof body.login === "string" ? body.login : "",
      displayName: typeof body.displayName === "string" ? body.displayName : "",
      password: typeof body.password === "string" ? body.password : "",
      position: typeof body.position === "string" ? body.position : body.position ?? null,
      externalCode: typeof body.externalCode === "string" ? body.externalCode : body.externalCode ?? null,
      phone: typeof body.phone === "string" ? body.phone : body.phone ?? null,
      rfidUid: typeof body.rfidUid === "string" ? body.rfidUid : body.rfidUid ?? null,
      pin: typeof body.pin === "string" ? body.pin : body.pin ?? null,
      roleCodes: Array.isArray(body.roleCodes) ? body.roleCodes.filter((c): c is string => typeof c === "string") : undefined,
    });
    return NextResponse.json({ user });
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

export async function PATCH(req: Request) {
  const auth = await requireWmsSession(req);
  if ("error" in auth) return auth.error;

  const pool = tryGetPool();
  if (!pool) {
    return NextResponse.json(
      { error: "database not configured (set DATABASE_URL or PG_URL)" },
      { status: 503 }
    );
  }

  let body: {
    siteCode?: string;
    userId?: string;
    displayName?: string;
    position?: string | null;
    externalCode?: string | null;
    phone?: string | null;
    rfidUid?: string | null;
    pin?: string | null;
    password?: string;
    isActive?: boolean;
    roleCodes?: string[];
  };
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
    const user = await updateWmsUser(client, siteId, {
      userId: typeof body.userId === "string" ? body.userId : "",
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      position: body.position === undefined ? undefined : typeof body.position === "string" ? body.position : null,
      externalCode: body.externalCode === undefined ? undefined : typeof body.externalCode === "string" ? body.externalCode : null,
      phone: body.phone === undefined ? undefined : typeof body.phone === "string" ? body.phone : null,
      rfidUid: body.rfidUid === undefined ? undefined : typeof body.rfidUid === "string" ? body.rfidUid : null,
      pin: typeof body.pin === "string" ? body.pin : undefined,
      password: typeof body.password === "string" ? body.password : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      roleCodes: Array.isArray(body.roleCodes) ? body.roleCodes.filter((c): c is string => typeof c === "string") : undefined,
    });
    return NextResponse.json({ user });
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
