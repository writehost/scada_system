import { NextResponse } from "next/server"
import { readLocalBuildMeta } from "@/lib/app-version"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const meta = readLocalBuildMeta()
  return NextResponse.json(meta, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  })
}
