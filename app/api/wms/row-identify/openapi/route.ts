import { NextResponse } from "next/server"
import { access, readFile } from "node:fs/promises"
import { join } from "node:path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function resolveSpecPath(): Promise<string | null> {
  const candidates = [
    join(process.cwd(), "openapi", "row-identify.openapi.json"),
    join(process.cwd(), "public", "docs", "row-identify.openapi.json"),
  ]
  for (const path of candidates) {
    try {
      await access(path)
      return path
    } catch {
      /* next */
    }
  }
  return null
}

export async function GET() {
  const path = await resolveSpecPath()
  if (!path) {
    return NextResponse.json({ error: "row-identify OpenAPI spec not found" }, { status: 404 })
  }
  const json = await readFile(path, "utf8")
  return new NextResponse(json, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'inline; filename="row-identify.openapi.json"',
      "Cache-Control": "no-store",
    },
  })
}
