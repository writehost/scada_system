"use client"

import "@grapesjs/studio-sdk/style-host-tailwind"
import "grapesjs/dist/css/grapes.min.css"
import "./designer.css"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import grapesjs, { type Editor } from "grapesjs"
import StudioEditor from "@grapesjs/studio-sdk/react"
import { ChevronLeft, Loader2 } from "lucide-react"
import { describePage, mmToPx, pageSizeMm } from "@/lib/doc-templates/page"
import { ApiError, docTemplatesApi, type TemplateVersion } from "./api"
import { createDesignerStore, useDesigner, type DesignerStore } from "./state"
import { CANVAS_CSS, docDesignerPlugin } from "./studio/plugin"
import { DOC_STYLE_SECTORS } from "./studio/style-sectors"
import { RU_LOCALE } from "./studio/i18n-ru"
import { ensureComponentRules, exportJinja, importJinjaIntoEditor } from "./studio/project"
import { LeftSidebar, RightSidebar } from "./panels/Sidebars"
import { DesignerToolbar } from "./toolbar/DesignerToolbar"
import { StatusBar } from "./toolbar/StatusBar"

/**
 * Редактор шаблонов документов на GrapesJS Studio SDK.
 * Studio — движок (холст, drag&drop, undo, страницы, структура, оформление);
 * документная логика — плагин docDesignerPlugin и панели этого каталога.
 */

const LICENSE_KEY = process.env.NEXT_PUBLIC_GRAPES_STUDIO_LICENSE_KEY || "DEV_LICENSE_KEY"
const AUTOSAVE_MS = 1500

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

type Loaded = {
  working: TemplateVersion
  store: DesignerStore
}

export default function DocumentDesigner({ templateId }: { templateId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const t = await docTemplatesApi.get(templateId)
        if (!t.working) throw new Error("У шаблона нет версий")
        const schema = await docTemplatesApi.schema(t.template.docKind)
        const sampleId = t.working.sampleId ?? schema.samples[0]?.id ?? null
        const sample = await docTemplatesApi.sampleData(t.template.docKind, sampleId, null)
        if (cancelled) return
        const store = createDesignerStore({
          template: t.template,
          page: t.working.page,
          schema: schema.schema,
          schemaVersion: schema.schemaVersion,
          samples: schema.samples,
          wmsDocuments: schema.wmsDocuments,
          sampleId,
          sampleData: sample.data,
          versions: t.versions,
          working: { versionId: t.working.versionId, versionNo: t.working.versionNo, status: t.working.status },
          canEditRaw: t.permissions.editRawJinja,
          saveStatus: "saved",
        })
        setLoaded({ working: t.working, store })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [templateId])

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-slate-100 text-slate-700">
        <div className="text-[15px] font-medium">Не удалось открыть шаблон</div>
        <div className="max-w-md text-center text-[13px] text-slate-500">{error}</div>
        <Link href="/doc-templates" className="text-[13px] text-slate-900 underline">
          К списку шаблонов
        </Link>
      </div>
    )
  }
  if (!loaded) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 bg-[#eceef1] text-[13px] text-slate-500">
        <Loader2 className="size-4 animate-spin" /> Открываем шаблон…
      </div>
    )
  }
  return <DesignerShell templateId={templateId} working={loaded.working} store={loaded.store} />
}

function DesignerShell({ templateId, working, store }: { templateId: string; working: TemplateVersion; store: DesignerStore }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saving = useRef<Promise<void> | null>(null)
  const pendingSave = useRef(false)
  const ready = useRef(false)
  const template = useDesigner(store, (s) => s.template)
  const page = useDesigner(store, (s) => s.page)

  const saveNow = useCallback(async (): Promise<void> => {
    const ed = editorRef.current
    if (!ed || !ready.current) return
    if (saving.current) {
      pendingSave.current = true
      return saving.current
    }
    const run = (async () => {
      const s = store.get()
      store.set({ saveStatus: "saving", saveError: null })
      try {
        const project = ed.getProjectData()
        const jinja = exportJinja(ed, s.template?.name ?? "Документ", s.page)
        const r = await docTemplatesApi.saveDraft(templateId, {
          page: s.page,
          studioProject: project,
          jinjaTemplate: jinja,
          sampleId: s.sampleId,
          expectedDraftVersionId: s.working?.status === "draft" ? s.working.versionId : null,
        })
        const createdDraft = s.working?.versionId !== r.version.versionId
        store.set({
          saveStatus: store.get().saveStatus === "dirty" ? "dirty" : "saved",
          lastSavedAt: Date.now(),
          working: { versionId: r.version.versionId, versionNo: r.version.versionNo, status: r.version.status },
          validation: r.validation,
        })
        if (createdDraft) {
          const t = await docTemplatesApi.get(templateId)
          store.set({ versions: t.versions, template: t.template })
        }
      } catch (e) {
        store.set({ saveStatus: "error", saveError: e instanceof ApiError || e instanceof Error ? e.message : String(e) })
      }
    })()
    saving.current = run
    await run
    saving.current = null
    if (pendingSave.current) {
      pendingSave.current = false
      await saveNow()
    }
  }, [store, templateId])

  const scheduleSave = useCallback(() => {
    if (!ready.current) return
    store.set({ saveStatus: "dirty" })
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null
      void saveNow()
    }, AUTOSAVE_MS)
  }, [saveNow, store])

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (store.get().saveStatus === "dirty" || store.get().saveStatus === "error") await saveNow()
    else if (saving.current) await saving.current
  }, [saveNow, store])

  // Настройки листа и выбор тестовых данных — тоже изменения шаблона.
  useEffect(() => {
    let prevPage = store.get().page
    let prevSample = store.get().sampleId
    return store.subscribe(() => {
      const s = store.get()
      if (s.page !== prevPage || s.sampleId !== prevSample) {
        prevPage = s.page
        prevSample = s.sampleId
        scheduleSave()
      }
    })
  }, [store, scheduleSave])

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const st = store.get().saveStatus
      if (st === "dirty" || st === "saving" || st === "error") {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void flushSave()
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("keydown", onKey)
    }
  }, [store, flushSave])

  const options = useMemo(() => {
    const sheetWidth = `${mmToPx(pageSizeMm(working.page).width)}px`
    return {
      licenseKey: LICENSE_KEY,
      gjsScript: grapesjs,
      gjsStyle: "",
      theme: "light",
      customTheme: {
        default: {
          colors: {
            global: { background1: "#f6f7f9", background2: "#ffffff", background3: "#ffffff", backgroundHover: "#eef0f3", text: "#1f2937", border: "#e3e6eb", focus: "#64748b", placeholder: "#9aa3af" },
            primary: { background1: "#1f2937", background2: "#eef0f3", background3: "#111827", backgroundHover: "#374151", text: "#ffffff" },
            component: { background1: "#4f46e5", background2: "#6366f1", background3: "#eef2ff", text: "#ffffff" },
            selector: { background1: "#475569", background2: "#e2e8f0", text: "#ffffff" },
            symbol: { background1: "#0d9488", background2: "#14b8a6", background3: "#ccfbf1", text: "#ffffff" },
          },
        },
      },
      settingsMenu: false,
      project: { type: "document", id: `doc-template-${templateId}` },
      plugins: ({ plugins }: { plugins: unknown[] }) => [
        // Плагины Studio из CDN (blocks-basic, export, postcss) документам не нужны — работаем офлайн.
        ...plugins.filter((p) => typeof p === "function"),
        docDesignerPlugin({ store }),
      ],
      storage: {
        type: "self",
        project: (working.studioProject as never) ?? { pages: [{ name: "Страница 1", component: "" }] },
        autosaveChanges: 1_000_000,
        onSave: async () => {
          await saveNow()
        },
      },
      assets: {
        storageType: "self",
        // Изображения встраиваются в шаблон: PDF печатается без доступа к сети.
        onUpload: async ({ files }: { files: File[] }) =>
          Promise.all(files.map(async (f) => ({ src: await fileToDataUrl(f), name: f.name, mimeType: f.type }))),
        onLoad: async () => [],
        onDelete: async () => {},
      },
      pages: {
        add: ({ editor: ed, addPage }: { editor: Editor; addPage: (p: Record<string, unknown>) => unknown }) =>
          addPage({ name: `Страница ${ed.Pages.getAll().length + 1}`, component: '<p>Новая страница документа</p>' }),
        settings: false,
      },
      devices: { default: [{ id: "doc-sheet", name: "Лист", width: sheetWidth }], selected: "doc-sheet" },
      i18n: { locales: { ru: RU_LOCALE } },
      layout: {
        default: {
          type: "row",
          style: { height: "100%" },
          children: [
            { type: "custom", component: LeftSidebar, componentProps: { store }, style: { height: "100%" } },
            { type: "canvas", grow: true, className: "doc-canvas" },
            { type: "custom", component: RightSidebar, componentProps: { store }, style: { height: "100%" } },
          ],
        },
      },
      gjsOptions: {
        i18n: { locale: "ru", localeFallback: "en", detectLocale: false },
        canvasCss: CANVAS_CSS,
        jsInHtml: false,
        undoManager: { trackSelection: false },
        styleManager: { sectors: DOC_STYLE_SECTORS },
        parser: { optionsHtml: { allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false } },
        richTextEditor: { actions: ["bold", "italic", "underline", "strikethrough"] },
      },
      onReady: (ed: Editor) => {
        editorRef.current = ed
        setEditor(ed)
        // Для отладки и e2e-проверок в dev-сборке.
        if (process.env.NODE_ENV !== "production") (window as unknown as { docDesignerEditor?: Editor }).docDesignerEditor = ed
        const needsImport = !working.studioProject
        // Шаблон без проекта Studio (системный или импортированный Jinja) разбирается importer-ом.
        if (needsImport) importJinjaIntoEditor(ed, working.jinjaTemplate)
        ensureComponentRules(ed)
        ed.UndoManager.clear()
        ed.runCommand("doc:apply-sheet")
        ed.runCommand("doc:refresh")
        setTimeout(() => ed.runCommand("doc:fit-zoom"), 100)
        store.set({ pageCount: ed.Pages.getAll().length })
        ed.on("page", () => store.set({ pageCount: ed.Pages.getAll().length, pageIndex: Math.max(0, ed.Pages.getAll().indexOf(ed.Pages.getSelected()!)) }))
        ed.on("update", () => scheduleSave())
        ready.current = true
        if (needsImport) scheduleSave()
      },
    }
    // Опции Studio задаются один раз — дальше работаем через API редактора.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="doc-designer flex h-screen flex-col overflow-hidden bg-[#eceef1] text-slate-900">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3">
        <Link href="/doc-templates" className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-slate-500 hover:bg-slate-100 hover:text-slate-900" onClick={() => void flushSave()}>
          <ChevronLeft className="size-4" /> Шаблоны
        </Link>
        <div className="h-5 w-px bg-slate-200" />
        <DesignerToolbar templateId={templateId} store={store} editor={editor} flushSave={flushSave} />
      </header>
      <div className="relative min-h-0 flex-1">
        <StudioEditor options={options as never} className="doc-studio h-full w-full" />
      </div>
      <StatusBar store={store} editor={editor} pageLabel={describePage(page)} templateName={template?.name ?? ""} />
    </div>
  )
}
