"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Archive, ArchiveRestore, Copy, FileCode2, FilePlus2, FileText, Loader2, MoreHorizontal, PenLine, Search, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { docTemplatesApi, renderUrl, type KindInfo, type SystemTemplateInfo, type TemplateSummary } from "@/components/doc-designer/api"

function fmtDate(ts: string): string {
  const d = new Date(ts.replace(" ", "T").replace(/\+00$/, "Z"))
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function StatusBadges({ t }: { t: TemplateSummary }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t.publishedVersionNo != null && (
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200">v{t.publishedVersionNo} · рабочая</span>
      )}
      {t.draftVersionNo != null && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">v{t.draftVersionNo} · черновик</span>
      )}
      {t.archived && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">в архиве</span>}
    </div>
  )
}

/** Мини-превью листа: только силуэт, без загрузки рендера в список. */
function SheetThumb({ label }: { label: string }) {
  return (
    <div className="relative mx-auto h-[112px] w-[80px] rounded-[3px] bg-white shadow-[0_1px_2px_rgba(15,23,42,.12),0_6px_16px_rgba(15,23,42,.08)]">
      <div className="absolute inset-x-[9px] top-[10px] space-y-[5px]">
        <div className="h-[5px] w-2/3 rounded-sm bg-slate-300" />
        <div className="h-[3px] w-full rounded-sm bg-slate-200" />
        <div className="h-[3px] w-5/6 rounded-sm bg-slate-200" />
        <div className="mt-[7px] grid grid-cols-3 gap-[2px]">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className={cn("h-[4px] rounded-[1px]", i < 3 ? "bg-slate-300" : "bg-slate-100")} />
          ))}
        </div>
        <div className="h-[3px] w-1/2 rounded-sm bg-slate-200" />
      </div>
      <div className="absolute bottom-[8px] left-[9px] right-[9px] truncate text-center text-[7.5px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
    </div>
  )
}

export default function DocTemplatesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null)
  const [kinds, setKinds] = useState<KindInfo[]>([])
  const [systemTemplates, setSystemTemplates] = useState<SystemTemplateInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await docTemplatesApi.list(showArchived)
      setTemplates(r.templates)
      setKinds(r.kinds)
      setSystemTemplates(r.systemTemplates)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
      setTemplates([])
    }
  }, [showArchived])
  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (templates ?? []).filter((t) => !s || t.name.toLowerCase().includes(s) || t.docTypeLabel.toLowerCase().includes(s))
  }, [templates, q])

  const kindLabel = (id: string) => kinds.find((k) => k.id === id)?.label ?? id

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Шаблоны документов</h1>
          <p className="text-sm text-muted-foreground">УПД, накладные, акты, сертификаты, паспорта — визуальный редактор с данными и печатью в PDF.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2">
          <FilePlus2 className="size-4" /> Новый шаблон
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти шаблон" className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Показать архив
        </label>
      </div>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</div>}
      {templates === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Загрузка…
        </div>
      ) : filtered.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <div className="mt-3 font-medium">Шаблонов пока нет</div>
          <div className="mt-1 text-sm text-muted-foreground">Начните с готового УПД, накладной или пустого листа A4.</div>
          <Button className="mt-4" onClick={() => setCreateOpen(true)}>
            Создать шаблон
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {filtered.map((t) => (
            <div key={t.templateId} className={cn("group flex flex-col rounded-2xl border border-border bg-card transition hover:shadow-md", t.archived && "opacity-60")}>
              <button type="button" onClick={() => router.push(`/doc-designer/${t.templateId}`)} className="rounded-t-2xl bg-[#eceef1] py-5">
                <SheetThumb label={t.docTypeLabel || "Документ"} />
              </button>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium" title={t.name}>
                      {t.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.docTypeLabel || "Документ"} · {kindLabel(t.docKind)}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" aria-label="Действия">
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {t.publishedVersionNo != null && (
                        <DropdownMenuItem asChild>
                          <a href={renderUrl(t.templateId, { version: "published", format: "pdf" })} target="_blank" rel="noreferrer">
                            <FileText className="size-4" /> PDF рабочей версии
                          </a>
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        onClick={async () => {
                          const r = await docTemplatesApi.duplicate(t.templateId)
                          router.push(`/doc-designer/${r.templateId}`)
                        }}
                      >
                        <Copy className="size-4" /> Дублировать
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={async () => {
                          await docTemplatesApi.patch(t.templateId, { archived: !t.archived })
                          void load()
                        }}
                      >
                        {t.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} {t.archived ? "Вернуть из архива" : "В архив"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <StatusBadges t={t} />
                <div className="mt-auto flex items-center justify-between gap-2 pt-2">
                  <span className="whitespace-nowrap text-[11px] text-muted-foreground">{fmtDate(t.updatedAt)}</span>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={async () => {
                        const r = await docTemplatesApi.duplicate(t.templateId)
                        router.push(`/doc-designer/${r.templateId}`)
                      }}
                    >
                      <Copy className="size-3.5" />
                    </Button>
                    <Button size="sm" className="h-8 gap-1.5" asChild>
                      <Link href={`/doc-designer/${t.templateId}`}>
                        <PenLine className="size-3.5" /> Редактировать
                      </Link>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        kinds={kinds}
        systemTemplates={systemTemplates}
        templates={templates ?? []}
        onCreated={(id) => router.push(`/doc-designer/${id}`)}
      />
    </div>
  )
}

type Mode = "blank" | "system" | "template" | "jinja"

function CreateTemplateDialog({
  open,
  onOpenChange,
  kinds,
  systemTemplates,
  templates,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  kinds: KindInfo[]
  systemTemplates: SystemTemplateInfo[]
  templates: TemplateSummary[]
  onCreated: (id: string) => void
}) {
  const [mode, setMode] = useState<Mode>("system")
  const [systemId, setSystemId] = useState("upd-demo")
  const [baseId, setBaseId] = useState("")
  const [jinja, setJinja] = useState("")
  const [name, setName] = useState("")
  const [docTypeLabel, setDocTypeLabel] = useState("")
  const [docKind, setDocKind] = useState("trade")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setErr(null)
      setBusy(false)
    }
  }, [open])

  const create = async () => {
    setBusy(true)
    setErr(null)
    try {
      const from =
        mode === "system" ? { type: "system" as const, id: systemId } : mode === "template" ? { type: "template" as const, id: baseId } : mode === "jinja" ? { type: "jinja" as const, jinja } : { type: "blank" as const }
      const r = await docTemplatesApi.create({
        name: name.trim() || undefined,
        docTypeLabel: docTypeLabel.trim() || (mode === "blank" ? "Документ" : undefined),
        docKind: mode === "system" ? undefined : docKind,
        from,
      })
      onCreated(r.templateId)
    } catch (e) {
      setErr((e as Error).message)
      setBusy(false)
    }
  }

  const options: { id: Mode; title: string; text: string; icon: typeof FileText }[] = [
    { id: "system", title: "Из готового шаблона", text: "УПД, счёт, акт, сертификат, паспорт…", icon: Sparkles },
    { id: "blank", title: "Пустой A4", text: "Чистый лист с полями", icon: FilePlus2 },
    { id: "template", title: "На основе существующего", text: "Копия вашего шаблона", icon: Copy },
    { id: "jinja", title: "Импорт Jinja HTML", text: "Перенос существующего шаблона", icon: FileCode2 },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Новый шаблон документа</DialogTitle>
          <DialogDescription>После создания сразу откроется редактор.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setMode(o.id)}
              className={cn("rounded-xl border p-3 text-left transition", mode === o.id ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30")}
            >
              <o.icon className="size-4 text-muted-foreground" />
              <div className="mt-2 text-[13px] font-medium leading-tight">{o.title}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{o.text}</div>
            </button>
          ))}
        </div>

        {mode === "system" && (
          <div className="grid max-h-[260px] grid-cols-2 gap-2 overflow-y-auto pr-1">
            {systemTemplates.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSystemId(s.id)}
                className={cn("rounded-lg border px-3 py-2 text-left", systemId === s.id ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30")}
              >
                <div className="text-[13px] font-medium">{s.name}</div>
                <div className="text-[11px] text-muted-foreground">{s.description}</div>
              </button>
            ))}
          </div>
        )}
        {mode === "template" && (
          <select className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
            <option value="">Выберите шаблон…</option>
            {templates.map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.name}
              </option>
            ))}
          </select>
        )}
        {mode === "jinja" && (
          <div className="space-y-1.5">
            <textarea
              value={jinja}
              onChange={(e) => setJinja(e.target.value)}
              placeholder={'<h1>УПД № {{ document.number }}</h1>\n{% for item in document.items %}…{% endfor %}'}
              className="h-40 w-full resize-y rounded-md border border-border bg-background px-3 py-2 font-mono text-[12px]"
              spellCheck={false}
            />
            <div className="text-[11.5px] text-muted-foreground">
              Переменные, условия и циклы станут блоками редактора. Сложные конструкции сохранятся как «Advanced Jinja» без изменений; скрипты и обработчики событий будут удалены.
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="text-[12px] text-muted-foreground">Название</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={mode === "system" ? systemTemplates.find((s) => s.id === systemId)?.name : "УПД основной"} />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] text-muted-foreground">Тип документа</span>
            <Input value={docTypeLabel} onChange={(e) => setDocTypeLabel(e.target.value)} placeholder="УПД" />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] text-muted-foreground">Данные</span>
            <select
              className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm disabled:opacity-50"
              value={mode === "system" ? systemTemplates.find((s) => s.id === systemId)?.docKind ?? docKind : docKind}
              disabled={mode === "system" || mode === "template"}
              onChange={(e) => setDocKind(e.target.value)}
            >
              {kinds.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {err && <div className="text-sm text-destructive">{err}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={() => void create()} disabled={busy || (mode === "template" && !baseId) || (mode === "jinja" && !jinja.trim())}>
            {busy && <Loader2 className="size-4 animate-spin" />} Создать и открыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
