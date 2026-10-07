import { NextResponse } from "next/server"
import { WmsHttpError } from "@/lib/wms/errors"
import { readJson, withDocTemplates } from "@/lib/doc-templates/http"
import { DEFAULT_PAGE } from "@/lib/doc-templates/page"
import { getDocumentKind, listDocumentKinds } from "@/lib/doc-templates/schema"
import { createTemplate, getWorkingVersion, getTemplateSummary, listTemplates } from "@/lib/doc-templates/store"
import { SYSTEM_TEMPLATES, getSystemTemplate } from "@/lib/doc-templates/system-templates"
import { importJinjaTemplate } from "@/lib/doc-templates/jinja/importer"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Список шаблонов документов площадки + справочники для создания. */
export async function GET(req: Request) {
  const includeArchived = new URL(req.url).searchParams.get("archived") === "1"
  return withDocTemplates(req, async ({ client, siteId, canEditRaw }) => {
    const templates = await listTemplates(client, siteId, { includeArchived })
    return NextResponse.json({
      templates,
      kinds: listDocumentKinds(),
      systemTemplates: SYSTEM_TEMPLATES.map((t) => ({
        id: t.id,
        name: t.name,
        docTypeLabel: t.docTypeLabel,
        docKind: t.docKind,
        description: t.description,
      })),
      permissions: { editRawJinja: canEditRaw },
    })
  })
}

type CreateBody = {
  name?: string
  docKind?: string
  docTypeLabel?: string
  from?: { type: "blank" | "system" | "template" | "jinja"; id?: string; jinja?: string }
}

/**
 * Новый шаблон: пустой лист, копия существующего или системный шаблон.
 * Проект Studio для системных шаблонов строит редактор при первом открытии (импорт Jinja).
 */
export async function POST(req: Request) {
  return withDocTemplates(req, async ({ client, siteId, user, canEditRaw }) => {
    const body = await readJson<CreateBody>(req)
    const from = body.from ?? { type: "blank" }
    if (from.type === "template") {
      if (!from.id) throw new WmsHttpError(400, "from.id is required")
      const src = await getTemplateSummary(client, siteId, from.id)
      const working = await getWorkingVersion(client, from.id)
      if (!working) throw new WmsHttpError(404, "У шаблона нет версий")
      const created = await createTemplate(
        client,
        siteId,
        {
          name: body.name?.trim() || `${src.name} (копия)`,
          docKind: src.docKind,
          docTypeLabel: body.docTypeLabel ?? src.docTypeLabel,
          description: src.description,
          content: { page: working.page, studioProject: working.studioProject, jinjaTemplate: working.jinjaTemplate, sampleId: working.sampleId },
        },
        user
      )
      return NextResponse.json(created, { status: 201 })
    }
    if (from.type === "jinja") {
      if (!canEditRaw) throw new WmsHttpError(403, "Импорт Jinja-шаблонов доступен администратору", "raw_jinja_forbidden")
      // Импорт существующего Jinja HTML: проект Studio построит importer при открытии.
      const source = String(from.jinja ?? "")
      if (!source.trim()) throw new WmsHttpError(400, "Вставьте Jinja HTML шаблона")
      const kind = getDocumentKind(body.docKind)
      const guess = importJinjaTemplate(source).page
      const created = await createTemplate(
        client,
        siteId,
        {
          name: body.name?.trim() || "Импортированный шаблон",
          docKind: kind.id,
          docTypeLabel: body.docTypeLabel ?? "",
          content: { page: { ...DEFAULT_PAGE, ...(guess ?? {}) }, studioProject: null, jinjaTemplate: source, sampleId: kind.samples[0]?.id },
        },
        user
      )
      return NextResponse.json(created, { status: 201 })
    }
    const sys = getSystemTemplate(from.type === "system" ? from.id ?? "" : "blank")
    if (!sys) throw new WmsHttpError(404, "Системный шаблон не найден")
    const kind = getDocumentKind(body.docKind ?? sys.docKind)
    const created = await createTemplate(
      client,
      siteId,
      {
        name: body.name?.trim() || sys.name,
        docKind: kind.id,
        docTypeLabel: body.docTypeLabel ?? sys.docTypeLabel,
        description: sys.description,
        content: { page: from.type === "blank" ? DEFAULT_PAGE : sys.page, studioProject: null, jinjaTemplate: sys.jinja, sampleId: sys.docKind === kind.id ? sys.sampleId : kind.samples[0]?.id },
      },
      user
    )
    return NextResponse.json(created, { status: 201 })
  })
}
