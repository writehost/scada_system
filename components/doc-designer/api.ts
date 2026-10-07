"use client"

import { authRequestHeaders } from "@/lib/auth/client-token"
import { getSiteCode } from "@/lib/wms-api"
import type { DataSchema } from "@/lib/doc-templates/schema"
import type { PageSettings } from "@/lib/doc-templates/page"

/** Клиент API шаблонов документов (/api/wms/doc-templates). */

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

export type TemplateVersionSummary = {
  versionId: string
  versionNo: number
  status: "draft" | "published" | "archived"
  dataSchemaVersion: number
  sampleId: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  createdBy: string | null
  updatedBy: string | null
}

export type TemplateVersion = TemplateVersionSummary & {
  page: PageSettings
  studioProject: unknown | null
  jinjaTemplate: string
}

export type KindInfo = {
  id: string
  label: string
  description: string
  schemaVersion: number
  wmsDocuments: boolean
  samples: { id: string; label: string }[]
}

export type SystemTemplateInfo = { id: string; name: string; docTypeLabel: string; docKind: string; description: string }

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const BASE = "/api/wms/doc-templates"

export function withSite(path: string, params: Record<string, string | null | undefined> = {}): string {
  const q = new URLSearchParams({ siteCode: getSiteCode() })
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") q.set(k, v)
  return `${BASE}${path}?${q.toString()}`
}

async function call<T>(path: string, init: RequestInit & { params?: Record<string, string | null | undefined> } = {}): Promise<T> {
  const { params, ...rest } = init
  const headers = new Headers(authRequestHeaders() as HeadersInit)
  if (rest.body) headers.set("Content-Type", "application/json")
  const r = await fetch(withSite(path, params), { ...rest, headers, credentials: "include", cache: "no-store" })
  const text = await r.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { error: text }
  }
  if (!r.ok) {
    const d = (data ?? {}) as { error?: string; code?: string }
    throw new ApiError(d.error || `HTTP ${r.status}`, r.status, d.code)
  }
  return data as T
}

export const docTemplatesApi = {
  list: (archived = false) =>
    call<{ templates: TemplateSummary[]; kinds: KindInfo[]; systemTemplates: SystemTemplateInfo[]; permissions: { editRawJinja: boolean } }>("", {
      params: { archived: archived ? "1" : null },
    }),
  create: (body: { name?: string; docKind?: string; docTypeLabel?: string; from: { type: "blank" | "system" | "template" | "jinja"; id?: string; jinja?: string } }) =>
    call<{ templateId: string; versionId: string }>("", { method: "POST", body: JSON.stringify(body) }),
  get: (id: string) =>
    call<{ template: TemplateSummary; versions: TemplateVersionSummary[]; working: TemplateVersion | null; permissions: { editRawJinja: boolean } }>(`/${id}`),
  patch: (id: string, body: { name?: string; docTypeLabel?: string; description?: string; archived?: boolean }) =>
    call<{ template: TemplateSummary }>(`/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  saveDraft: (
    id: string,
    body: { page: PageSettings; studioProject: unknown; jinjaTemplate: string; sampleId: string | null; name?: string; expectedDraftVersionId?: string | null }
  ) => call<{ version: TemplateVersionSummary; validation: { ok: boolean; error?: string } }>(`/${id}/draft`, { method: "PUT", body: JSON.stringify(body) }),
  discardDraft: (id: string) => call<{ ok: true }>(`/${id}/draft`, { method: "DELETE" }),
  publish: (id: string) => call<{ version: TemplateVersionSummary; versions: TemplateVersionSummary[] }>(`/${id}/publish`, { method: "POST" }),
  duplicate: (id: string) => call<{ templateId: string }>(`/${id}/duplicate`, { method: "POST" }),
  version: (id: string, versionId: string) => call<{ version: TemplateVersion }>(`/${id}/versions/${versionId}`),
  restoreVersion: (id: string, versionId: string) =>
    call<{ version: TemplateVersionSummary; versions: TemplateVersionSummary[] }>(`/${id}/versions/${versionId}`, {
      method: "POST",
      body: JSON.stringify({ action: "restore" }),
    }),
  schema: (kind: string) =>
    call<{ kind: string; label: string; schemaVersion: number; schema: DataSchema; samples: { id: string; label: string }[]; wmsDocuments: boolean }>(
      "/schema",
      { params: { kind } }
    ),
  sampleData: (kind: string, sampleId: string | null, documentId: string | null) =>
    call<{ data: Record<string, unknown> }>("/sample-data", { params: { kind, sample: sampleId, documentId } }),
  wmsDocuments: () => call<{ documents: { id: string; label: string }[] }>("/sample-data", { params: { list: "documents" } }),
  validate: (jinja: string) => call<{ ok: true }>("/render", { method: "POST", body: JSON.stringify({ jinja, format: "validate" }) }),
}

export function renderUrl(id: string, opts: { version?: string; sample?: string | null; documentId?: string | null; format: "html" | "pdf" }): string {
  return withSite(`/${id}/render`, { version: opts.version ?? "working", sample: opts.sample, documentId: opts.documentId, format: opts.format })
}
