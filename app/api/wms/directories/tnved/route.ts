import { NextResponse } from "next/server"
import { getTnvedChildren, searchTnved, TNVED_SECTIONS } from "@/lib/tnved/catalog"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const url = new URL(req.url)
  const query = url.searchParams.get("query") ?? ""
  const parent = url.searchParams.get("parent") ?? ""

  if (query.trim()) {
    return NextResponse.json({ nodes: searchTnved(query) })
  }

  if (parent.trim()) {
    return NextResponse.json({ nodes: getTnvedChildren(parent.trim()) })
  }

  return NextResponse.json({ nodes: TNVED_SECTIONS })
}
