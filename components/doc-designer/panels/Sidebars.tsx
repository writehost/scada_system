"use client"

import { useState, type ReactNode } from "react"
import type { Editor } from "grapesjs"
import { StudioPanelBlocks, StudioPanelLayers, StudioPanelPages, StudioPanelStyles } from "@grapesjs/studio-sdk/react"
import { cn } from "@/lib/utils"
import type { DesignerStore } from "../state"
import { useDesigner } from "../state"
import { ContextPanel } from "./ContextPanel"

/**
 * Боковые панели — наши React-компоненты в layout Studio (type: "custom"),
 * внутри — штатные панели Studio: блоки, структура, страницы, оформление.
 */

function TabBar<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: readonly { id: T; label: string }[] }) {
  return (
    <div className="doc-ui flex shrink-0 gap-4 border-b border-slate-200 px-3.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "-mb-px border-b-2 py-2.5 text-[12.5px] transition",
            value === t.id ? "border-slate-900 font-semibold text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function Pane({ active, children, native }: { active: boolean; children: ReactNode; native?: boolean }) {
  // Панели не размонтируются: Studio держит в них подписки на редактор.
  // native — внутри штатная панель Studio, её стили не откатываем.
  return <div className={cn("min-h-0 flex-1 overflow-hidden", native && "doc-native", !active && "hidden")}>{children}</div>
}

export function LeftSidebar(_: { editor: Editor; store?: DesignerStore }) {
  const [tab, setTab] = useState<"blocks" | "layers" | "pages">("blocks")
  return (
    <div className="doc-ui doc-left flex h-full w-[264px] flex-col border-r border-slate-200 bg-white">
      <TabBar<"blocks" | "layers" | "pages">
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "blocks", label: "Блоки" },
          { id: "layers", label: "Структура" },
          { id: "pages", label: "Страницы" },
        ]}
      />
      <Pane active={tab === "blocks"} native>
        <StudioPanelBlocks
          className="doc-blocks h-full"
          symbols={false}
          search
          blocks={({ blocks }) => blocks.filter((b) => String(b.getId()).startsWith("doc-"))}
        />
      </Pane>
      <Pane active={tab === "layers"} native>
        <StudioPanelLayers className="doc-layers h-full" />
      </Pane>
      <Pane active={tab === "pages"}>
        <div className="doc-ui flex h-full flex-col">
          <div className="doc-ui border-b border-slate-100 px-3.5 py-2 text-[11px] leading-snug text-slate-400">
            Страницы дизайна. При печати длинные таблицы продолжаются на следующих листах PDF автоматически.
          </div>
          <div className="doc-native min-h-0 flex-1">
            <StudioPanelPages className="doc-pages h-full" />
          </div>
        </div>
      </Pane>
    </div>
  )
}

export function RightSidebar({ editor, store }: { editor: Editor; store: DesignerStore }) {
  const [tab, setTab] = useState<"props" | "style">("props")
  const selectionTick = useDesigner(store, (s) => s.selectionTick)
  const hasSelection = !!editor?.getSelected() && editor.getSelected() !== editor.getWrapper()
  void selectionTick
  return (
    <div className="doc-ui doc-right flex h-full w-[320px] flex-col border-l border-slate-200 bg-white">
      <TabBar<"props" | "style">
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "props", label: "Свойства" },
          { id: "style", label: "Оформление" },
        ]}
      />
      <Pane active={tab === "props"}>
        <ContextPanel editor={editor} store={store} />
      </Pane>
      <Pane active={tab === "style"}>
        {hasSelection ? (
          <div className="doc-native h-full">
            <StudioPanelStyles className="doc-styles h-full" />
          </div>
        ) : (
          <div className="doc-ui px-4 py-8 text-center text-[12px] text-slate-400">Выберите элемент на листе, чтобы изменить шрифт, отступы, рамки и фон.</div>
        )}
      </Pane>
    </div>
  )
}
