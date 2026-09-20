import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function adapterBase(): string {
  return (process.env.VEKAS_ADAPTER_URL || "http://127.0.0.1:8792").trim().replace(/\/$/, "")
}

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString()
  const target = `${adapterBase()}/api/wms/vekas/batches${qs ? `?${qs}` : ""}`
  try {
    const res = await fetch(target, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as { error?: string }).error || `vekas adapter HTTP ${res.status}` },
        { status: res.status >= 500 ? 502 : res.status },
      )
    }
    return NextResponse.json(data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: `Vekas: ${msg}` }, { status: 502 })
  }
}
