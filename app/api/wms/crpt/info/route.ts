import { NextResponse } from "next/server";
import { getUpstreamCrptBearerToken } from "@/lib/wms/crpt-auth";
import { fetchCrptInfoFromUpstream, parseCrptCodes } from "@/lib/wms/crpt";
import { requireWmsActor } from "@/lib/wms/require-actor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Локальный handler на :3000 — читает `web/interface/.env` (не прокси на :3001). */
export async function POST(req: Request) {
  const actorGate = await requireWmsActor(req, { allowRegisteredDevice: true });
  if ("error" in actorGate) return actorGate.error;

  let body: { codes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const codes = parseCrptCodes(body.codes);
  if (codes.length === 0) {
    return NextResponse.json({ error: "codes is required (array or comma-separated string)" }, { status: 400 });
  }

  try {
    const upstreamToken = getUpstreamCrptBearerToken();
    const data = await fetchCrptInfoFromUpstream(codes, upstreamToken);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[POST /api/wms/crpt/info]", error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    const status = code === "crpt_not_found" ? 404 : 502;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "CRPT request failed",
        code: code || "crpt_upstream_failed",
      },
      { status }
    );
  }
}
