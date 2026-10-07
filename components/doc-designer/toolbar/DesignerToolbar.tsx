"use client"

import { useEffect, useState } from "react"
import type { Editor } from "grapesjs"
import { AlertCircle, Check, Eye, FileDown, History, Loader2, Minus, PenLine, Plus, Redo2, Undo2, UploadCloud, Database, Maximize } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { docTemplatesApi } from "../api"
import { useDesigner, type DesignerStore } from "../state"
import { HistoryDialog } from "./HistoryDialog"
import { PreviewDialog } from "./PreviewDialog"

const ZOOMS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200]

function IconBtn({ title, onClick, disabled, children, active }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35",
        active && "bg-slate-900 text-white hover:bg-slate-800 hover:text-white"
      )}
    >
      {children}
    </button>
  )
}

function SaveIndicator({ store }: { store: DesignerStore }) {
  const status = useDesigner(store, (s) => s.saveStatus)
  const error = useDesigner(store, (s) => s.saveError)
  if (status === "saving")
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-slate-500">
        <Loader2 className="size-3.5 animate-spin" /> Сохранение…
      </span>
    )
  if (status === "dirty") return <span className="whitespace-nowrap text-[12px] text-slate-400">Есть изменения</span>
  if (status === "error")
    return (
      <span className="flex items-center gap-1.5 text-[12px] text-red-600" title={error ?? ""}>
        <AlertCircle className="size-3.5" /> Ошибка сохранения
      </span>
    )
  return (
    <span className="flex items-center gap-1.5 text-[12px] text-emerald-700">
      <Check className="size-3.5" /> Сохранено
    </span>
  )
}

export function DesignerToolbar({ templateId, store, editor, flushSave }: { templateId: string; store: DesignerStore; editor: Editor | null; flushSave: () => Promise<void> }) {
  const template = useDesigner(store, (s) => s.template)
  const working = useDesigner(store, (s) => s.working)
  const mode = useDesigner(store, (s) => s.mode)
  const zoom = useDesigner(store, (s) => s.zoom)
  const samples = useDesigner(store, (s) => s.samples)
  const sampleId = useDesigner(store, (s) => s.sampleId)
  const documentId = useDesigner(store, (s) => s.documentId)
  const wmsDocuments = useDesigner(store, (s) => s.wmsDocuments)
  const validation = useDesigner(store, (s) => s.validation)
  useDesigner(store, (s) => s.selectionTick)
  const [name, setName] = useState(template?.name ?? "")
  const [preview, setPreview] = useState<false | "html" | "pdf">(false)
  const [history, setHistory] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [clean, setClean] = useState(false)
  const [wmsDocs, setWmsDocs] = useState<{ id: string; label: string }[]>([])
  useEffect(() => setName(template?.name ?? ""), [template?.name])
  useEffect(() => {
    if (wmsDocuments) docTemplatesApi.wmsDocuments().then((r) => setWmsDocs(r.documents)).catch(() => setWmsDocs([]))
  }, [wmsDocuments])

  const um = editor?.UndoManager
  const setZoom = (z: number) => {
    const next = Math.min(200, Math.max(50, z))
    // fitViewport с фиксированным масштабом заодно центрирует лист.
    editor?.Canvas.fitViewport({ ignoreHeight: true, gap: 32, zoom: next })
    store.set({ zoom: next })
  }

  const changeSource = async (value: string) => {
    const [kind, id] = value.split(":")
    const s = store.get()
    if (!s.template) return
    try {
      const data = await docTemplatesApi.sampleData(s.template.docKind, kind === "sample" ? id : s.sampleId, kind === "doc" ? id : null)
      store.set({ sampleData: data.data, ...(kind === "sample" ? { sampleId: id, documentId: null } : { documentId: id }) })
    } catch (e) {
      toast.error(`Не удалось загрузить данные: ${(e as Error).message}`)
    }
  }

  const publish = async () => {
    setPublishing(true)
    try {
      await flushSave()
      const r = await docTemplatesApi.publish(templateId)
      const t = await docTemplatesApi.get(templateId)
      store.set({ versions: r.versions, template: t.template, working: { versionId: r.version.versionId, versionNo: r.version.versionNo, status: r.version.status } })
      toast.success(`Версия ${r.version.versionNo} опубликована`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPublishing(false)
    }
  }

  const toggleClean = () => {
    const doc = editor?.Canvas.getDocument()
    const next = !clean
    setClean(next)
    doc?.documentElement.toggleAttribute("data-doc-clean", next)
    if (next) editor?.select(undefined as never)
  }

  const statusLabel = working?.status === "published" ? "Опубликована" : working?.status === "draft" ? "Черновик" : "Архив"
  const isDraft = working?.status === "draft"

  return (
    <>
      <div className="flex min-w-0 shrink items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={async () => {
            const v = name.trim()
            if (!v || v === template?.name) return setName(template?.name ?? "")
            try {
              const r = await docTemplatesApi.patch(templateId, { name: v })
              store.set({ template: r.template })
            } catch (e) {
              toast.error((e as Error).message)
            }
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className="h-8 w-[220px] min-w-[140px] shrink truncate rounded-md border border-transparent px-2 text-[14px] font-semibold text-slate-900 outline-none hover:border-slate-200 focus:border-slate-300"
          title="Название шаблона"
        />
        {template?.docTypeLabel && <span className="hidden shrink-0 text-[12px] text-slate-400 xl:inline">{template.docTypeLabel}</span>}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            isDraft ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200" : working?.status === "published" ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200" : "bg-slate-100 text-slate-600"
          )}
          title={template?.publishedVersionNo ? `Опубликована версия ${template.publishedVersionNo}` : "Ещё не опубликован"}
        >
          v{working?.versionNo} · {statusLabel}
        </span>
        <SaveIndicator store={store} />
      </div>

      <div className="mx-auto flex items-center gap-0.5">
        <IconBtn title="Отменить (Ctrl+Z)" onClick={() => um?.undo()} disabled={!um?.hasUndo()}>
          <Undo2 className="size-4" />
        </IconBtn>
        <IconBtn title="Повторить (Ctrl+Shift+Z)" onClick={() => um?.redo()} disabled={!um?.hasRedo()}>
          <Redo2 className="size-4" />
        </IconBtn>
        <div className="mx-1.5 h-5 w-px bg-slate-200" />
        <IconBtn title="Уменьшить" onClick={() => setZoom(ZOOMS.filter((z) => z < zoom).pop() ?? 50)} disabled={zoom <= 50}>
          <Minus className="size-4" />
        </IconBtn>
        <button type="button" onClick={() => setZoom(100)} title="Масштаб 100%" className="h-8 w-12 rounded-md text-[12px] tabular-nums text-slate-700 hover:bg-slate-100">
          {zoom}%
        </button>
        <IconBtn title="Увеличить" onClick={() => setZoom(ZOOMS.find((z) => z > zoom) ?? 200)} disabled={zoom >= 200}>
          <Plus className="size-4" />
        </IconBtn>
        <IconBtn title="Чистовой вид листа (без рамок и подсказок)" onClick={toggleClean} active={clean}>
          <Maximize className="size-4" />
        </IconBtn>
        <div className="mx-1.5 h-5 w-px bg-slate-200" />
        <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Режим холста">
          <button
            type="button"
            onClick={() => store.set({ mode: "design" })}
            className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px]", mode === "design" ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900")}
          >
            <PenLine className="size-3.5" /> Дизайн
          </button>
          <button
            type="button"
            onClick={() => store.set({ mode: "data" })}
            className={cn("flex h-7 items-center gap-1.5 rounded px-2.5 text-[12px]", mode === "data" ? "bg-white font-medium text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900")}
          >
            <Database className="size-3.5" /> Данные
          </button>
        </div>
        <select
          className="ml-1 h-8 max-w-[200px] truncate rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-700 outline-none"
          value={documentId ? `doc:${documentId}` : `sample:${sampleId ?? ""}`}
          onChange={(e) => void changeSource(e.target.value)}
          title="Данные для предпросмотра"
        >
          <optgroup label="Тестовые данные">
            {samples.map((s) => (
              <option key={s.id} value={`sample:${s.id}`}>
                {s.label}
              </option>
            ))}
          </optgroup>
          {wmsDocs.length > 0 && (
            <optgroup label="Документы WMS">
              {wmsDocs.map((d) => (
                <option key={d.id} value={`doc:${d.id}`}>
                  {d.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      <div className="flex items-center gap-1.5">
        {!validation.ok && (
          <span className="flex items-center gap-1 whitespace-nowrap rounded-md bg-red-50 px-2 py-1 text-[11.5px] text-red-700" title={validation.error}>
            <AlertCircle className="size-3.5 shrink-0" /> Ошибка в шаблоне
          </span>
        )}
        <IconBtn title="История версий" onClick={() => setHistory(true)}>
          <History className="size-4" />
        </IconBtn>
        <button
          type="button"
          onClick={async () => {
            await flushSave()
            setPreview("html")
          }}
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <Eye className="size-4" /> Предпросмотр
        </button>
        <button
          type="button"
          onClick={async () => {
            await flushSave()
            setPreview("pdf")
          }}
          className="flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12.5px] font-medium text-slate-700 hover:bg-slate-50"
        >
          <FileDown className="size-4" /> PDF
        </button>
        <button
          type="button"
          onClick={() => void publish()}
          disabled={publishing || !isDraft || !validation.ok}
          title={isDraft ? "Сделать черновик рабочей версией для печати" : "Нет изменений для публикации"}
          className="flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-3 text-[12.5px] font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {publishing ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />} Опубликовать
        </button>
      </div>
      <PreviewDialog open={!!preview} format={preview || "html"} onOpenChange={(o) => !o && setPreview(false)} templateId={templateId} store={store} />
      <HistoryDialog open={history} onOpenChange={setHistory} templateId={templateId} store={store} flushSave={flushSave} />
    </>
  )
}
