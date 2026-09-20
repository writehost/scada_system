import { NextResponse } from "next/server"
import { tryGetPool } from "@/lib/wms/pool"
import { getSiteId } from "@/lib/wms/resolve"
import {
  deleteTorg1ExcelTemplate,
  listTorg1ExcelTemplates,
  readTorg1ExcelTemplate,
  resolveTorg1ExcelTemplate,
  writeTorg1ExcelTemplate,
} from "@/lib/wms/torg1-excel-template-storage"
import { TORG1_EXCEL_VARIABLE_KEYS } from "@/lib/wms/torg1-excel"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function isRealXlsx(bytes: Buffer): boolean {
  if (bytes.length < 4) return false
  return [0x04034b50, 0x06054b50, 0x08074b50].includes(bytes.readUInt32LE(0))
}

function isLegacyXls(bytes: Buffer): boolean {
  return (
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  )
}

async function resolveSiteId(siteCode: string) {
  const pool = tryGetPool()
  if (!pool) return { error: NextResponse.json({ error: "database not configured" }, { status: 503 }) }
  if (!siteCode.trim()) return { error: NextResponse.json({ error: "siteCode is required" }, { status: 400 }) }
  const client = await pool.connect()
  try {
    const siteId = await getSiteId(client, siteCode)
    if (siteId == null) return { error: NextResponse.json({ error: "unknown siteCode" }, { status: 404 }) }
    return { siteId }
  } finally {
    client.release()
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? ""
  const resolved = await resolveSiteId(siteCode)
  if ("error" in resolved && resolved.error) return resolved.error
  const { siteId } = resolved as { siteId: number }

  if (url.searchParams.get("meta") === "1") {
    const templates = await listTorg1ExcelTemplates(siteId)
    return NextResponse.json({
      hasCustomTemplate: templates.length > 0,
      templates,
      variables: TORG1_EXCEL_VARIABLE_KEYS,
      placeholderStyle: "{{variable}}",
    })
  }

  const slot = url.searchParams.get("slot")?.trim() || ""
  const documentType = url.searchParams.get("documentType")?.trim() || ""
  const categoryCode = url.searchParams.get("categoryCode")?.trim() || ""

  const resolvedTemplate = await resolveTorg1ExcelTemplate(siteId, {
    slot: slot || null,
    documentType: documentType || null,
    categoryCode: categoryCode || null,
  })

  if (!resolvedTemplate) {
    return NextResponse.json(
      { error: "no custom template", starter: true, hasCustomTemplate: false },
      { status: 404 }
    )
  }

  return new NextResponse(new Uint8Array(resolvedTemplate.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="TORG-1-${resolvedTemplate.slot}.xlsx"`,
      "Cache-Control": "no-store",
      "X-Wms-Torg1-Template": resolvedTemplate.slot,
    },
  })
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || ""
  let siteCode = ""
  let bytes: Buffer | null = null
  let slot = "default"
  let label = ""
  let documentType = "receiving"
  let categoryCode: string | null = null
  let originalName = "template.xlsx"

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData()
    siteCode = String(form.get("siteCode") ?? "").trim()
    slot = String(form.get("slot") ?? "default").trim() || "default"
    label = String(form.get("label") ?? "").trim()
    documentType = String(form.get("documentType") ?? "receiving").trim() || "receiving"
    const categoryRaw = String(form.get("categoryCode") ?? "").trim()
    categoryCode = categoryRaw || null
    const file = form.get("file")
    if (file && typeof file === "object" && "arrayBuffer" in file) {
      const uploaded = file as File
      originalName = uploaded.name || originalName
      bytes = Buffer.from(await uploaded.arrayBuffer())
    }
  } else {
    let body: {
      siteCode?: string
      fileBase64?: string
      slot?: string
      label?: string
      documentType?: string
      categoryCode?: string | null
      originalName?: string
    }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return NextResponse.json({ error: "invalid json" }, { status: 400 })
    }
    siteCode = String(body.siteCode ?? "").trim()
    slot = String(body.slot ?? "default").trim() || "default"
    label = String(body.label ?? "").trim()
    documentType = String(body.documentType ?? "receiving").trim() || "receiving"
    categoryCode = body.categoryCode?.trim() || null
    originalName = String(body.originalName ?? originalName).trim() || originalName
    const b64 = String(body.fileBase64 ?? "").replace(/^data:[^;]+;base64,/, "")
    if (b64) bytes = Buffer.from(b64, "base64")
  }

  if (!bytes || bytes.length < 32) {
    return NextResponse.json({ error: "file is required (.xlsx)" }, { status: 400 })
  }
  if (bytes.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "file too large (max 8MB)" }, { status: 400 })
  }
  if (isLegacyXls(bytes)) {
    return NextResponse.json(
      {
        error:
          "Файл внутри имеет старый формат Excel 97–2003 (.xls), хотя назван .xlsx. Откройте его в Excel и выберите «Сохранить как → Книга Excel (*.xlsx)», затем загрузите заново.",
      },
      { status: 400 }
    )
  }
  if (!isRealXlsx(bytes)) {
    return NextResponse.json(
      { error: "Файл не является корректной книгой Excel .xlsx" },
      { status: 400 }
    )
  }

  const resolved = await resolveSiteId(siteCode)
  if ("error" in resolved && resolved.error) return resolved.error
  const { siteId } = resolved as { siteId: number }

  const template = await writeTorg1ExcelTemplate(siteId, bytes, {
    slot,
    label,
    documentType,
    categoryCode,
    originalName,
  })
  const templates = await listTorg1ExcelTemplates(siteId)

  return NextResponse.json({
    ok: true,
    hasCustomTemplate: templates.length > 0,
    template,
    templates,
    variables: TORG1_EXCEL_VARIABLE_KEYS,
  })
}

export async function DELETE(req: Request) {
  const url = new URL(req.url)
  const siteCode = url.searchParams.get("siteCode")?.trim() ?? ""
  const slot = url.searchParams.get("slot")?.trim() || "default"
  const resolved = await resolveSiteId(siteCode)
  if ("error" in resolved && resolved.error) return resolved.error
  const { siteId } = resolved as { siteId: number }
  await deleteTorg1ExcelTemplate(siteId, slot)
  const templates = await listTorg1ExcelTemplates(siteId)
  return NextResponse.json({
    ok: true,
    hasCustomTemplate: templates.length > 0,
    templates,
  })
}
