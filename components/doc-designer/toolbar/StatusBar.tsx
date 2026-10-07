"use client"

import type { Editor } from "grapesjs"
import { useDesigner, type DesignerStore } from "../state"

/** Нижняя строка: страница дизайна, масштаб, формат листа, выбранный элемент. */
export function StatusBar({ store, editor, pageLabel }: { store: DesignerStore; editor: Editor | null; pageLabel: string; templateName: string }) {
  const pageIndex = useDesigner(store, (s) => s.pageIndex)
  const pageCount = useDesigner(store, (s) => s.pageCount)
  const zoom = useDesigner(store, (s) => s.zoom)
  const mode = useDesigner(store, (s) => s.mode)
  const validation = useDesigner(store, (s) => s.validation)
  useDesigner(store, (s) => s.selectionTick)
  const selected = editor?.getSelected()
  const path: string[] = []
  let cur = selected
  while (cur && cur.parent()) {
    path.unshift(cur.getName())
    cur = cur.parent()
  }
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-slate-200 bg-white px-3 text-[11.5px] text-slate-500">
      <span>
        Страница дизайна {pageIndex + 1} / {pageCount}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-400">{path.length ? path.join(" › ") : "Документ"}</span>
      {!validation.ok && (
        <span className="min-w-0 max-w-[45%] truncate text-red-600" title={validation.error}>
          {validation.error}
        </span>
      )}
      <span>{mode === "data" ? "Данные предпросмотра" : "Дизайн"}</span>
      <span className="tabular-nums">{zoom}%</span>
      <span>{pageLabel}</span>
    </footer>
  )
}
