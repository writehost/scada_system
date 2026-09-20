import { NextResponse } from "next/server"
import { readAuthTokenFromRequest } from "@/lib/auth/request-token"
import { verifySessionToken } from "@/lib/auth/session"
import { tryGetPool } from "@/lib/wms/pool"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const KEY_RE = /^[a-zA-Z0-9:._-]{3,80}$/

async function ownerKeyFromRequest(req: Request): Promise<string | null> {
  const token = await readAuthTokenFromRequest(req)
  if (!token) return null
  const session = await verifySessionToken(token)
  if (!session) return null
  if (session.userId && /^\d+$/.test(String(session.userId))) return `user:${session.userId}`
  return `login:${session.login}`
}

async function ensurePrefsTable(client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_user_ui_prefs (
      owner_key TEXT NOT NULL,
      pref_key TEXT NOT NULL,
      pref_json JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (owner_key, pref_key)
    )
  `)
}

export async function GET(req: Request) {
  const ownerKey = await ownerKeyFromRequest(req)
  if (!ownerKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const key = new URL(req.url).searchParams.get("key") || ""
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "invalid key" }, { status: 400 })

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ value: null, persisted: false })

  const client = await pool.connect()
  try {
    await ensurePrefsTable(client)
    const res = await client.query<{ pref_json: unknown }>(
      `SELECT pref_json FROM wms_user_ui_prefs WHERE owner_key = $1 AND pref_key = $2`,
      [ownerKey, key]
    )
    return NextResponse.json({ value: res.rows[0]?.pref_json ?? null, persisted: true })
  } finally {
    client.release()
  }
}

export async function PUT(req: Request) {
  const ownerKey = await ownerKeyFromRequest(req)
  if (!ownerKey) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { key?: string; value?: unknown } | null
  const key = String(body?.key || "")
  if (!KEY_RE.test(key)) return NextResponse.json({ error: "invalid key" }, { status: 400 })
  if (body?.value == null || typeof body.value !== "object") {
    return NextResponse.json({ error: "value is required" }, { status: 400 })
  }

  const pool = tryGetPool()
  if (!pool) return NextResponse.json({ ok: true, persisted: false })

  const client = await pool.connect()
  try {
    await ensurePrefsTable(client)
    await client.query(
      `
      INSERT INTO wms_user_ui_prefs (owner_key, pref_key, pref_json, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (owner_key, pref_key)
      DO UPDATE SET pref_json = EXCLUDED.pref_json, updated_at = now()
      `,
      [ownerKey, key, JSON.stringify(body.value)]
    )
    return NextResponse.json({ ok: true, persisted: true })
  } finally {
    client.release()
  }
}
