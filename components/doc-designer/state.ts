"use client"

import { useSyncExternalStore } from "react"
import type { DataSchema } from "@/lib/doc-templates/schema"
import type { PageSettings } from "@/lib/doc-templates/page"
import { DEFAULT_PAGE } from "@/lib/doc-templates/page"
import type { TemplateSummary, TemplateVersionSummary } from "./api"

/**
 * Состояние редактора вне React-дерева Studio: его читают и панели (React),
 * и представления компонентов на холсте (GrapesJS views).
 */

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error"
export type CanvasMode = "design" | "data"

export type DesignerState = {
  template: TemplateSummary | null
  page: PageSettings
  schema: DataSchema
  schemaVersion: number
  samples: { id: string; label: string }[]
  wmsDocuments: boolean
  sampleId: string | null
  documentId: string | null
  sampleData: Record<string, unknown>
  mode: CanvasMode
  zoom: number
  saveStatus: SaveStatus
  saveError: string | null
  lastSavedAt: number | null
  versions: TemplateVersionSummary[]
  working: { versionId: string; versionNo: number; status: string } | null
  validation: { ok: boolean; error?: string }
  canEditRaw: boolean
  pageIndex: number
  pageCount: number
  /** Счётчик выбора на холсте — панели перерисовываются при смене выделения. */
  selectionTick: number
}

type Listener = () => void

export function createDesignerStore(initial?: Partial<DesignerState>) {
  let state: DesignerState = {
    template: null,
    page: DEFAULT_PAGE,
    schema: {},
    schemaVersion: 1,
    samples: [],
    wmsDocuments: false,
    sampleId: null,
    documentId: null,
    sampleData: {},
    mode: "design",
    zoom: 100,
    saveStatus: "idle",
    saveError: null,
    lastSavedAt: null,
    versions: [],
    working: null,
    validation: { ok: true },
    canEditRaw: false,
    pageIndex: 0,
    pageCount: 1,
    selectionTick: 0,
    ...initial,
  }
  const listeners = new Set<Listener>()
  return {
    get: () => state,
    set(patch: Partial<DesignerState> | ((s: DesignerState) => Partial<DesignerState>)) {
      const next = typeof patch === "function" ? patch(state) : patch
      state = { ...state, ...next }
      listeners.forEach((l) => l())
    },
    subscribe(l: Listener): () => void {
      listeners.add(l)
      return () => {
        listeners.delete(l)
      }
    },
  }
}

export type DesignerStore = ReturnType<typeof createDesignerStore>

export function useDesigner<T>(store: DesignerStore, select: (s: DesignerState) => T): T {
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.get()),
    () => select(store.get())
  )
}
