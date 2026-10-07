import type { PoolClient } from "pg"
import { WmsHttpError } from "@/lib/wms/errors"
import { rawBlocksFromJinja } from "./raw-blocks.ts"
import { sanitizeTemplateHtml } from "./jinja/sanitize.ts"
import { normalizePage, type PageSettings } from "./page.ts"
import { getDocumentKind } from "./schema.ts"
import { TemplateError, validateTemplate } from "./render.ts"

/**
 * Шаблоны документов с версиями.
 * Опубликованная версия — то, что печатает production; правки всегда идут в черновик,
 * публикация переводит черновик в published, прежнюю published — в archived.
 */

export type VersionStatus = "draft" | "published" | "archived"

export type TemplateVersion = {
  versionId: string
  versionNo: number
  status: VersionStatus
  page: PageSettings
  studioProject: unknown | null
  jinjaTemplate: string
  dataSchemaVersion: number
  sampleId: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

export type TemplateVersionSummary = Omit<TemplateVersion, "studioProject" | "jinjaTemplate" | "page">

export type TemplateSummary = {
  templateId: string
  name: string
  docKind: string
  docTypeLabel: string
  description: string
  archived: boolean
  createdAt: string
  updatedAt: string
  publishedVersionNo: number | null
  draftVersionNo: number | null
  latestVersionNo: number
}

export async function ensureDocTemplateTables(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_doc_templates (
      template_id BIGSERIAL PRIMARY KEY,
      site_id INT NOT NULL REFERENCES wms_sites(site_id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      doc_kind TEXT NOT NULL DEFAULT 'trade',
      doc_type_label TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      archived_at TIMESTAMPTZ NULL,
      created_by TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  await client.query(`
    CREATE TABLE IF NOT EXISTS wms_doc_template_versions (
      version_id BIGSERIAL PRIMARY KEY,
      template_id BIGINT NOT NULL REFERENCES wms_doc_templates(template_id) ON DELETE CASCADE,
      version_no INT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      page_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      studio_project JSONB NULL,
      jinja_template TEXT NOT NULL DEFAULT '',
      data_schema_version INT NOT NULL DEFAULT 1,
      sample_id TEXT NULL,
      created_by TEXT NULL,
      updated_by TEXT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ NULL,
      UNIQUE (template_id, version_no)
    )`)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_doc_template_versions_draft
      ON wms_doc_template_versions(template_id) WHERE status = 'draft'`)
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_wms_doc_template_versions_published
      ON wms_doc_template_versions(template_id) WHERE status = 'published'`)
  await client.query(`
    CREATE INDEX IF NOT EXISTS ix_wms_doc_templates_site
      ON wms_doc_templates(site_id, updated_at DESC)`)
}

const VERSION_COLUMNS = `
  v.version_id::text AS "versionId",
  v.version_no AS "versionNo",
  v.status,
  v.data_schema_version AS "dataSchemaVersion",
  v.sample_id AS "sampleId",
  v.created_at::text AS "createdAt",
  v.updated_at::text AS "updatedAt",
  v.published_at::text AS "publishedAt",
  v.created_by AS "createdBy",
  v.updated_by AS "updatedBy"`

const FULL_VERSION_COLUMNS = `${VERSION_COLUMNS},
  v.page_json AS "page",
  v.studio_project AS "studioProject",
  v.jinja_template AS "jinjaTemplate"`

function mapFull(row: Record<string, unknown>): TemplateVersion {
  return { ...(row as unknown as TemplateVersion), page: normalizePage(row.page) }
}

async function lockTemplate(client: PoolClient, siteId: number, templateId: string) {
  const r = await client.query(
    `SELECT template_id FROM wms_doc_templates WHERE site_id = $1 AND template_id = $2::bigint FOR UPDATE`,
    [siteId, templateId]
  )
  if (!r.rowCount) throw new WmsHttpError(404, "Шаблон не найден", "template_not_found")
}

export async function listTemplates(client: PoolClient, siteId: number, opts: { includeArchived?: boolean } = {}): Promise<TemplateSummary[]> {
  await ensureDocTemplateTables(client)
  const r = await client.query(
    `SELECT
       t.template_id::text AS "templateId",
       t.name,
       t.doc_kind AS "docKind",
       t.doc_type_label AS "docTypeLabel",
       t.description,
       (t.archived_at IS NOT NULL) AS archived,
       t.created_at::text AS "createdAt",
       GREATEST(t.updated_at, COALESCE(MAX(v.updated_at), t.updated_at))::text AS "updatedAt",
       MAX(v.version_no) FILTER (WHERE v.status = 'published') AS "publishedVersionNo",
       MAX(v.version_no) FILTER (WHERE v.status = 'draft') AS "draftVersionNo",
       COALESCE(MAX(v.version_no), 0) AS "latestVersionNo"
     FROM wms_doc_templates t
     LEFT JOIN wms_doc_template_versions v ON v.template_id = t.template_id
     WHERE t.site_id = $1 AND ($2::boolean OR t.archived_at IS NULL)
     GROUP BY t.template_id
     ORDER BY 8 DESC`,
    [siteId, !!opts.includeArchived]
  )
  return r.rows as TemplateSummary[]
}

export async function getTemplateSummary(client: PoolClient, siteId: number, templateId: string): Promise<TemplateSummary> {
  const all = await listTemplates(client, siteId, { includeArchived: true })
  const t = all.find((x) => x.templateId === templateId)
  if (!t) throw new WmsHttpError(404, "Шаблон не найден", "template_not_found")
  return t
}

export async function listVersions(client: PoolClient, templateId: string): Promise<TemplateVersionSummary[]> {
  const r = await client.query(
    `SELECT ${VERSION_COLUMNS} FROM wms_doc_template_versions v WHERE v.template_id = $1::bigint ORDER BY v.version_no DESC`,
    [templateId]
  )
  return r.rows as TemplateVersionSummary[]
}

export async function getVersion(client: PoolClient, siteId: number, templateId: string, versionId: string): Promise<TemplateVersion> {
  const r = await client.query(
    `SELECT ${FULL_VERSION_COLUMNS}
     FROM wms_doc_template_versions v
     JOIN wms_doc_templates t ON t.template_id = v.template_id
     WHERE t.site_id = $1 AND v.template_id = $2::bigint AND v.version_id = $3::bigint`,
    [siteId, templateId, versionId]
  )
  if (!r.rowCount) throw new WmsHttpError(404, "Версия не найдена", "version_not_found")
  return mapFull(r.rows[0])
}

/** Версия для редактора: черновик, если он есть, иначе опубликованная, иначе последняя. */
export async function getWorkingVersion(client: PoolClient, templateId: string): Promise<TemplateVersion | null> {
  const r = await client.query(
    `SELECT ${FULL_VERSION_COLUMNS}
     FROM wms_doc_template_versions v
     WHERE v.template_id = $1::bigint
     ORDER BY CASE v.status WHEN 'draft' THEN 0 WHEN 'published' THEN 1 ELSE 2 END, v.version_no DESC
     LIMIT 1`,
    [templateId]
  )
  return r.rowCount ? mapFull(r.rows[0]) : null
}

export async function getPublishedVersion(client: PoolClient, siteId: number, templateId: string): Promise<TemplateVersion | null> {
  const r = await client.query(
    `SELECT ${FULL_VERSION_COLUMNS}
     FROM wms_doc_template_versions v
     JOIN wms_doc_templates t ON t.template_id = v.template_id
     WHERE t.site_id = $1 AND v.template_id = $2::bigint AND v.status = 'published'`,
    [siteId, templateId]
  )
  return r.rowCount ? mapFull(r.rows[0]) : null
}

export type VersionContent = {
  page: unknown
  studioProject: unknown | null
  jinjaTemplate: string
  sampleId?: string | null
}

function cleanContent(input: VersionContent, docKind: string) {
  const jinja = sanitizeTemplateHtml(String(input.jinjaTemplate ?? "")).html
  const projectJson = input.studioProject == null ? null : JSON.stringify(input.studioProject)
  if (projectJson && projectJson.length > 8_000_000) throw new WmsHttpError(413, "Проект шаблона слишком большой (больше 8 МБ)")
  if (jinja.length > 4_000_000) throw new WmsHttpError(413, "Шаблон слишком большой (больше 4 МБ)")
  return {
    page: normalizePage(input.page),
    projectJson,
    jinja,
    schemaVersion: getDocumentKind(docKind).schemaVersion,
    sampleId: typeof input.sampleId === "string" && input.sampleId.trim() ? input.sampleId.trim().slice(0, 120) : null,
  }
}

export async function createTemplate(
  client: PoolClient,
  siteId: number,
  input: { name: string; docKind: string; docTypeLabel: string; description?: string; content: VersionContent },
  user: string | null
): Promise<{ templateId: string; versionId: string }> {
  await ensureDocTemplateTables(client)
  const name = input.name.trim().slice(0, 200) || "Новый шаблон"
  const kind = getDocumentKind(input.docKind).id
  const c = cleanContent(input.content, kind)
  await client.query("BEGIN")
  try {
    const t = await client.query(
      `INSERT INTO wms_doc_templates (site_id, name, doc_kind, doc_type_label, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING template_id::text AS id`,
      [siteId, name, kind, input.docTypeLabel.trim().slice(0, 80), (input.description ?? "").trim().slice(0, 500), user]
    )
    const templateId = t.rows[0].id as string
    const v = await client.query(
      `INSERT INTO wms_doc_template_versions
         (template_id, version_no, status, page_json, studio_project, jinja_template, data_schema_version, sample_id, created_by, updated_by)
       VALUES ($1::bigint, 1, 'draft', $2::jsonb, $3::jsonb, $4, $5, $6, $7, $7)
       RETURNING version_id::text AS id`,
      [templateId, JSON.stringify(c.page), c.projectJson, c.jinja, c.schemaVersion, c.sampleId, user]
    )
    await client.query("COMMIT")
    return { templateId, versionId: v.rows[0].id as string }
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  }
}

/** Значения data-jinja-raw в проекте Studio — для контроля прав на Advanced Jinja. */
export function collectRawBlocks(project: unknown): string[] {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    const rec = node as Record<string, unknown>
    const attrs = rec.attributes as Record<string, unknown> | undefined
    if (attrs && typeof attrs["data-jinja-raw"] === "string") out.push(attrs["data-jinja-raw"] as string)
    for (const v of Object.values(rec)) if (v && typeof v === "object") walk(v)
  }
  walk(project)
  return out.sort()
}

/**
 * Автосохранение. Если черновика нет (шаблон опубликован) — создаётся новый черновик
 * со следующим номером версии; опубликованная версия не меняется.
 */
export async function saveDraft(
  client: PoolClient,
  siteId: number,
  templateId: string,
  input: VersionContent & { name?: string; expectedDraftVersionId?: string | null },
  user: string | null,
  opts: { canEditRaw: boolean }
): Promise<TemplateVersionSummary> {
  await ensureDocTemplateTables(client)
  await client.query("BEGIN")
  try {
    await lockTemplate(client, siteId, templateId)
    const meta = await client.query(`SELECT doc_kind FROM wms_doc_templates WHERE template_id = $1::bigint`, [templateId])
    const c = cleanContent(input, meta.rows[0].doc_kind as string)
    const current = await getWorkingVersion(client, templateId)
    if (!opts.canEditRaw) {
      // Если версия ещё не открывалась в редакторе, её блоки Advanced Jinja — из импорта исходника.
      const before = new Set(current?.studioProject ? collectRawBlocks(current.studioProject) : rawBlocksFromJinja(current?.jinjaTemplate ?? ""))
      const added = collectRawBlocks(input.studioProject).filter((x) => !before.has(x))
      if (added.length) {
        throw new WmsHttpError(403, "Изменять блоки Advanced Jinja может только администратор", "raw_jinja_forbidden")
      }
    }
    if (input.name?.trim()) {
      await client.query(`UPDATE wms_doc_templates SET name = $2, updated_at = now() WHERE template_id = $1::bigint`, [
        templateId,
        input.name.trim().slice(0, 200),
      ])
    }
    let versionId: string
    if (current?.status === "draft") {
      if (input.expectedDraftVersionId && input.expectedDraftVersionId !== current.versionId) {
        throw new WmsHttpError(409, "Черновик уже изменён в другом окне. Обновите страницу.", "draft_conflict")
      }
      versionId = current.versionId
      await client.query(
        `UPDATE wms_doc_template_versions
         SET page_json = $2::jsonb, studio_project = $3::jsonb, jinja_template = $4,
             data_schema_version = $5, sample_id = $6, updated_by = $7, updated_at = now()
         WHERE version_id = $1::bigint`,
        [versionId, JSON.stringify(c.page), c.projectJson, c.jinja, c.schemaVersion, c.sampleId, user]
      )
    } else {
      const next = await client.query(
        `SELECT COALESCE(MAX(version_no), 0) + 1 AS n FROM wms_doc_template_versions WHERE template_id = $1::bigint`,
        [templateId]
      )
      const v = await client.query(
        `INSERT INTO wms_doc_template_versions
           (template_id, version_no, status, page_json, studio_project, jinja_template, data_schema_version, sample_id, created_by, updated_by)
         VALUES ($1::bigint, $2, 'draft', $3::jsonb, $4::jsonb, $5, $6, $7, $8, $8)
         RETURNING version_id::text AS id`,
        [templateId, next.rows[0].n, JSON.stringify(c.page), c.projectJson, c.jinja, c.schemaVersion, c.sampleId, user]
      )
      versionId = v.rows[0].id as string
    }
    await client.query(`UPDATE wms_doc_templates SET updated_at = now() WHERE template_id = $1::bigint`, [templateId])
    await client.query("COMMIT")
    const r = await client.query(`SELECT ${VERSION_COLUMNS} FROM wms_doc_template_versions v WHERE v.version_id = $1::bigint`, [versionId])
    return r.rows[0] as TemplateVersionSummary
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  }
}

export async function publishDraft(client: PoolClient, siteId: number, templateId: string, user: string | null): Promise<TemplateVersionSummary> {
  await ensureDocTemplateTables(client)
  await client.query("BEGIN")
  try {
    await lockTemplate(client, siteId, templateId)
    const draft = await client.query(
      `SELECT version_id::text AS id, jinja_template FROM wms_doc_template_versions WHERE template_id = $1::bigint AND status = 'draft'`,
      [templateId]
    )
    if (!draft.rowCount) throw new WmsHttpError(409, "Нет черновика для публикации", "no_draft")
    try {
      validateTemplate(draft.rows[0].jinja_template as string)
    } catch (e) {
      if (e instanceof TemplateError) throw new WmsHttpError(422, `Шаблон не прошёл проверку: ${e.message}`, "template_invalid")
      throw e
    }
    await client.query(
      `UPDATE wms_doc_template_versions SET status = 'archived', updated_at = now()
       WHERE template_id = $1::bigint AND status = 'published'`,
      [templateId]
    )
    await client.query(
      `UPDATE wms_doc_template_versions SET status = 'published', published_at = now(), updated_by = $2, updated_at = now()
       WHERE version_id = $1::bigint`,
      [draft.rows[0].id, user]
    )
    await client.query(`UPDATE wms_doc_templates SET updated_at = now() WHERE template_id = $1::bigint`, [templateId])
    await client.query("COMMIT")
    const r = await client.query(`SELECT ${VERSION_COLUMNS} FROM wms_doc_template_versions v WHERE v.version_id = $1::bigint`, [draft.rows[0].id])
    return r.rows[0] as TemplateVersionSummary
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  }
}

export async function discardDraft(client: PoolClient, siteId: number, templateId: string) {
  await ensureDocTemplateTables(client)
  await client.query("BEGIN")
  try {
    await lockTemplate(client, siteId, templateId)
    const others = await client.query(
      `SELECT COUNT(*)::int AS n FROM wms_doc_template_versions WHERE template_id = $1::bigint AND status <> 'draft'`,
      [templateId]
    )
    if (!others.rows[0].n) throw new WmsHttpError(409, "Это единственная версия шаблона — удалите шаблон целиком", "only_version")
    await client.query(`DELETE FROM wms_doc_template_versions WHERE template_id = $1::bigint AND status = 'draft'`, [templateId])
    await client.query("COMMIT")
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  }
}

/** Копирует старую версию в черновик (заменяя текущий черновик). */
export async function restoreVersionToDraft(
  client: PoolClient,
  siteId: number,
  templateId: string,
  versionId: string,
  user: string | null
): Promise<TemplateVersionSummary> {
  const v = await getVersion(client, siteId, templateId, versionId)
  return saveDraft(
    client,
    siteId,
    templateId,
    { page: v.page, studioProject: v.studioProject, jinjaTemplate: v.jinjaTemplate, sampleId: v.sampleId },
    user,
    { canEditRaw: true }
  )
}

export async function updateTemplateMeta(
  client: PoolClient,
  siteId: number,
  templateId: string,
  input: { name?: string; docTypeLabel?: string; description?: string; archived?: boolean }
) {
  await ensureDocTemplateTables(client)
  const r = await client.query(
    `UPDATE wms_doc_templates SET
       name = COALESCE(NULLIF($3, ''), name),
       doc_type_label = COALESCE($4, doc_type_label),
       description = COALESCE($5, description),
       archived_at = CASE WHEN $6::boolean IS NULL THEN archived_at WHEN $6 THEN COALESCE(archived_at, now()) ELSE NULL END,
       updated_at = now()
     WHERE site_id = $1 AND template_id = $2::bigint`,
    [
      siteId,
      templateId,
      input.name?.trim().slice(0, 200) ?? "",
      input.docTypeLabel == null ? null : input.docTypeLabel.trim().slice(0, 80),
      input.description == null ? null : input.description.trim().slice(0, 500),
      input.archived == null ? null : input.archived,
    ]
  )
  if (!r.rowCount) throw new WmsHttpError(404, "Шаблон не найден", "template_not_found")
}

export async function duplicateTemplate(client: PoolClient, siteId: number, templateId: string, user: string | null) {
  const summary = await getTemplateSummary(client, siteId, templateId)
  const working = await getWorkingVersion(client, templateId)
  if (!working) throw new WmsHttpError(404, "У шаблона нет версий")
  return createTemplate(
    client,
    siteId,
    {
      name: `${summary.name} (копия)`,
      docKind: summary.docKind,
      docTypeLabel: summary.docTypeLabel,
      description: summary.description,
      content: { page: working.page, studioProject: working.studioProject, jinjaTemplate: working.jinjaTemplate, sampleId: working.sampleId },
    },
    user
  )
}
