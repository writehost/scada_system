import { NextResponse } from "next/server"
import { extractJsonObject, llmChat, llmGatewayConfigured } from "@/lib/wms/llm-gateway"
import { suggestPhysicalProfile } from "@/lib/wms/physical-suggest"
import { requireWmsSession } from "@/lib/wms/require-session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."))
  return Number.isFinite(n) && n > 0 ? n : null
}

export async function POST(req: Request) {
  const auth = await requireWmsSession(req)
  if ("error" in auth) return auth.error

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    itemTypeCode?: string
    itemGroupCode?: string
    useLlm?: boolean
  }
  const name = String(body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const base = suggestPhysicalProfile({
    name,
    itemTypeCode: body.itemTypeCode,
    itemGroupCode: body.itemGroupCode,
  })

  if (!body.useLlm || base.catalogHit || !llmGatewayConfigured()) {
    return NextResponse.json({
      ok: true,
      llm: false,
      suggestion: base,
    })
  }

  try {
    const llm = await llmChat(
      [
        {
          role: "system",
          content:
            "Ты складской классификатор. По названию товара верни JSON: " +
            '{"storageClass":"S1|S2|S3|S4|S5","lengthMm":number,"widthMm":number,"heightMm":number,"weightG":number,"note":string}. ' +
            "S1 мелкоштучный ручной, S2 средний тарный, S3 сырьё линии (картон, плёнка, преформа, мешок), S4 палета/ГП, S5 карантин. " +
            "Размеры — типичная складская единица, не лабораторный замер. Только JSON.",
        },
        { role: "user", content: name },
      ],
      { timeoutMs: 12_000, maxTokens: 300 }
    )
    const parsedRaw = extractJsonObject(llm.text)
    const parsed =
      parsedRaw && typeof parsedRaw === "object" && !Array.isArray(parsedRaw)
        ? (parsedRaw as Record<string, unknown>)
        : {}
    const lengthMm = num(parsed.lengthMm)
    const widthMm = num(parsed.widthMm)
    const heightMm = num(parsed.heightMm)
    const weightG = num(parsed.weightG)
    const refined = suggestPhysicalProfile({
      name,
      itemTypeCode: body.itemTypeCode,
      itemGroupCode: body.itemGroupCode,
      storageClass: typeof parsed.storageClass === "string" ? parsed.storageClass : undefined,
      lengthMm,
      widthMm,
      heightMm,
      weightG,
    })
    return NextResponse.json({
      ok: true,
      llm: true,
      suggestion: {
        ...refined,
        typicalLengthMm: lengthMm ?? refined.typicalLengthMm,
        typicalWidthMm: widthMm ?? refined.typicalWidthMm,
        typicalHeightMm: heightMm ?? refined.typicalHeightMm,
        typicalWeightG: weightG ?? refined.typicalWeightG,
        typicalWeightKg: (weightG ?? refined.typicalWeightG) != null
          ? (weightG ?? refined.typicalWeightG)! / 1000
          : refined.typicalWeightKg,
        hint: String(parsed.note || refined.hint),
        source: "catalog",
      },
    })
  } catch {
    return NextResponse.json({ ok: true, llm: false, suggestion: base })
  }
}
