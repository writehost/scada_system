"use client"

import { useState } from "react"
import { Eye, RotateCcw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { docTemplatesApi, renderUrl } from "../api"
import { useDesigner, type DesignerStore } from "../state"

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Черновик", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  published: { label: "Рабочая", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
  archived: { label: "Архив", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
}

function fmt(ts: string | null): string {
  if (!ts) return ""
  const d = new Date(ts.replace(" ", "T").replace(/\+00$/, "Z"))
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

/** История версий: Draft → Published → Archived; любую версию можно открыть или вернуть в черновик. */
export function HistoryDialog({ open, onOpenChange, templateId, store, flushSave }: { open: boolean; onOpenChange: (v: boolean) => void; templateId: string; store: DesignerStore; flushSave: () => Promise<void> }) {
  const versions = useDesigner(store, (s) => s.versions)
  const sampleId = useDesigner(store, (s) => s.sampleId)
  const [busy, setBusy] = useState(false)

  const restore = async (versionId: string, no: number) => {
    if (!window.confirm(`Скопировать версию ${no} в черновик? Текущий черновик будет заменён.`)) return
    setBusy(true)
    try {
      await flushSave()
      await docTemplatesApi.restoreVersion(templateId, versionId)
      window.location.reload()
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }

  const discard = async () => {
    if (!window.confirm("Удалить черновик и вернуться к опубликованной версии?")) return
    setBusy(true)
    try {
      await docTemplatesApi.discardDraft(templateId)
      window.location.reload()
    } catch (e) {
      toast.error((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-[15px]">История версий</DialogTitle>
          <DialogDescription className="text-[12px]">
            Печать в production всегда идёт по рабочей (опубликованной) версии. Правки копятся в черновике до публикации.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
          {versions.map((v) => {
            const st = STATUS[v.status]
            return (
              <div key={v.versionId} className="flex items-center gap-3 px-3 py-2.5">
                <div className="w-10 text-[13px] font-semibold tabular-nums text-slate-800">v{v.versionNo}</div>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1", st.cls)}>{st.label}</span>
                <div className="min-w-0 flex-1 text-[11.5px] text-slate-500">
                  <div className="truncate">
                    {v.status === "published" || v.status === "archived" ? `опубликована ${fmt(v.publishedAt)}` : `изменена ${fmt(v.updatedAt)}`}
                  </div>
                  {(v.updatedBy || v.createdBy) && <div className="truncate text-slate-400">{v.updatedBy || v.createdBy}</div>}
                </div>
                <a
                  href={renderUrl(templateId, { version: v.versionId, sample: sampleId, format: "pdf" })}
                  target="_blank"
                  rel="noreferrer"
                  title="PDF этой версии"
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                >
                  <Eye className="size-4" />
                </a>
                {v.status !== "draft" && (
                  <button type="button" disabled={busy} title="Вернуть в черновик" onClick={() => void restore(v.versionId, v.versionNo)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-800">
                    <RotateCcw className="size-4" />
                  </button>
                )}
                {v.status === "draft" && versions.length > 1 && (
                  <button type="button" disabled={busy} title="Удалить черновик" onClick={() => void discard()} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
