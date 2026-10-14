"use client"

import { ArrowDown, ArrowUp, Bookmark, Check, ChevronLeft, ChevronRight, Download, Filter, FolderPlus, Layers, PanelLeft, PanelRight, Plus, Star, X } from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { api, fmtDate, fmtMoney, relTime, useApi, useHotkeys, useLiveEvents } from "@/components/api"
import { DocumentCard } from "@/components/document-card"
import { can, useCounts, useMe } from "@/components/shell"
import { Badge, Button, cn, EXCHANGE_TONE, Field, IconButton, Input, Modal, Select, Spinner, STATUS_TONE, toast, WMS_TONE } from "@/components/ui"
import { ACTION_LABEL } from "@/lib/edi/audit.ts"
import { CATEGORY_LABEL, DOC_TYPES, docType, EXCHANGE_LABEL, STATUS_LABEL, WMS_STATUS_LABEL } from "@/lib/edi/doc-types.ts"

type Row = {
  documentId: string
  docType: string
  direction: string
  number: string | null
  docDate: string | null
  title: string
  currency: string
  amountTotal: number | null
  status: string
  exchangeStatus: string
  wmsStatus: string | null
  counterpartyId: string | null
  counterpartyName: string | null
  counterpartyInn: string | null
  responsibleName: string | null
  lastAction: string | null
  lastActionAt: string | null
  updatedAt: string
  confidential: boolean
  favorite: boolean
  myTaskId: string | null
}

const FOLDERS = [
  { key: "all", label: "Все документы" },
  { key: "tasks", label: "Мои задачи" },
  { key: "incoming", label: "Входящие" },
  { key: "outgoing", label: "Исходящие" },
  { key: "drafts", label: "Черновики" },
  { key: "in_review", label: "На согласовании" },
  { key: "signing", label: "На подписи" },
  { key: "rejected", label: "Отклонённые" },
  { key: "completed", label: "Завершённые" },
  { key: "archive", label: "Архив" },
  { key: "favorites", label: "Избранное" },
]

const COLUMNS: Array<{ key: string; label: string; sort?: string; className?: string; secondary?: boolean }> = [
  { key: "title", label: "Документ", sort: "number", className: "w-[34%] min-w-[200px]" },
  { key: "type", label: "Тип", sort: "type", className: "hidden 2xl:table-cell", secondary: true },
  { key: "cp", label: "Контрагент", sort: "counterparty", className: "hidden md:table-cell w-[18%]", secondary: true },
  { key: "amount", label: "Сумма", sort: "amount", className: "text-right" },
  { key: "date", label: "Дата", sort: "date", className: "hidden sm:table-cell", secondary: true },
  { key: "status", label: "Статус", sort: "status" },
  { key: "resp", label: "Ответственный", className: "hidden xl:table-cell", secondary: true },
  { key: "last", label: "Последнее действие", sort: "updated", className: "hidden 2xl:table-cell", secondary: true },
]

function Journal() {
  const me = useMe()
  const sp = useSearchParams()
  const router = useRouter()
  const path = usePathname()
  const { counts, reload: reloadCounts } = useCounts()
  const folder = sp.get("folder") || "all"
  const selectedId = sp.get("id")
  const viewId = sp.get("viewId")
  const q = sp.get("q") || ""
  const types = sp.getAll("type")
  const statuses = sp.getAll("status")
  const sort = sp.get("sort") || "updated"
  const dir = (sp.get("dir") as "asc" | "desc") || "desc"
  const page = Number(sp.get("page") || 1)
  const [group, setGroup] = useState<"" | "type" | "status" | "counterparty">("")
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [left, setLeft] = useState(true)
  const [right, setRight] = useState(true)
  const [cursor, setCursor] = useState(0)
  const [dialog, setDialog] = useState<null | "saveView" | "newFolder" | "addToFolder">(null)

  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("edi:journal") || "{}")
      if (typeof s.left === "boolean") setLeft(s.left)
      if (typeof s.right === "boolean") setRight(s.right)
      if (s.group) setGroup(s.group)
    } catch {
      /* без сохранённых настроек */
    }
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem("edi:journal", JSON.stringify({ left, right, group }))
    } catch {
      /* приватный режим */
    }
  }, [left, right, group])

  const listUrl = useMemo(() => {
    const u = new URLSearchParams()
    u.set("folder", folder)
    for (const k of ["q", "direction", "counterpartyId", "dateFrom", "dateTo", "amountMin", "amountMax", "wmsStatus", "viewId", "sort", "dir"]) {
      const v = sp.get(k)
      if (v) u.set(k, v)
    }
    types.forEach((t) => u.append("type", t))
    statuses.forEach((s) => u.append("status", s))
    u.set("page", String(page))
    u.set("pageSize", "50")
    return `/api/edi/documents?${u}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()])
  const { data, loading, reload } = useApi<{ rows: Row[]; total: number; page: number; pageSize: number }>(listUrl)
  const { data: views, reload: reloadViews } = useApi<{ views: Array<{ id: string; name: string; kind: string; query: Record<string, string>; count: number }> }>("/api/edi/views")
  const rows = data?.rows ?? []

  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useLiveEvents(() => {
    if (liveTimer.current) clearTimeout(liveTimer.current)
    liveTimer.current = setTimeout(() => void reload(), 500)
  })

  const setParams = useCallback(
    (patch: Record<string, string | string[] | null>, keepId = true) => {
      const u = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(patch)) {
        u.delete(k)
        if (Array.isArray(v)) v.forEach((x) => u.append(k, x))
        else if (v) u.set(k, v)
      }
      if (!keepId) u.delete("id")
      if (!("page" in patch)) u.delete("page")
      router.replace(`${path}?${u}`, { scroll: false })
    },
    [sp, router, path]
  )
  const select = useCallback((id: string | null) => setParams({ id, page: sp.get("page") }), [setParams, sp])

  useEffect(() => {
    const i = rows.findIndex((r) => r.documentId === selectedId)
    if (i >= 0) setCursor(i)
  }, [rows, selectedId])
  useEffect(() => setChecked(new Set()), [listUrl])

  const move = (delta: number) => {
    if (!rows.length) return
    const i = Math.min(rows.length - 1, Math.max(0, cursor + delta))
    setCursor(i)
    select(rows[i].documentId)
    document.getElementById(`row-${rows[i].documentId}`)?.scrollIntoView({ block: "nearest" })
  }
  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    x: () => rows[cursor] && toggle(rows[cursor].documentId),
    Enter: () => rows[cursor] && router.push(`/documents/${rows[cursor].documentId}`),
    "[": () => setLeft((v) => !v),
    "]": () => setRight((v) => !v),
    Escape: () => (checked.size ? setChecked(new Set()) : select(null)),
  })

  const toggle = (id: string) =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const bulk = async (action: string) => {
    const ids = [...checked]
    try {
      const r = await api<{ ok: number; failed: number; results: Array<{ ok: boolean; error?: string }> }>("/api/edi/documents/bulk", { method: "POST", json: { ids, action } })
      toast(r.failed ? `Выполнено: ${r.ok}, с ошибкой: ${r.failed} (${r.results.find((x) => !x.ok)?.error})` : `Выполнено: ${r.ok}`, r.failed ? "error" : "ok")
      setChecked(new Set())
      reload()
      reloadCounts()
    } catch (e) {
      toast((e as Error).message, "error")
    }
  }
  const exportZip = async () => {
    const res = await fetch("/api/edi/archive/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...checked] }) })
    if (!res.ok) return toast((await res.json().catch(() => ({}))).error || "Ошибка выгрузки", "error")
    const blob = await res.blob()
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `edi-archive-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const grouped = useMemo(() => {
    if (!group) return [{ key: "", label: "", rows }]
    const m = new Map<string, Row[]>()
    for (const r of rows) {
      const k = group === "type" ? r.docType : group === "status" ? r.status : r.counterpartyName ?? "Без контрагента"
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()].map(([k, rs]) => ({ key: k, label: group === "type" ? docType(k)?.name ?? k : group === "status" ? STATUS_LABEL[k] ?? k : k, rows: rs }))
  }, [rows, group])

  const activeFilters = types.length + statuses.length + ["direction", "dateFrom", "dateTo", "amountMin", "amountMax", "counterpartyId", "wmsStatus"].filter((k) => sp.get(k)).length
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const compact = Boolean(selectedId && right)
  const cols = COLUMNS.filter((c) => !compact || !c.secondary)
  const showCol = (k: string) => cols.some((c) => c.key === k)
  const folderLabel = viewId ? views?.views.find((v) => v.id === viewId)?.name ?? "Папка" : FOLDERS.find((f) => f.key === folder)?.label

  return (
    <div className="flex h-full min-h-0">
      {/* Левая панель: папки, сохранённые фильтры */}
      <aside className={cn("no-print w-52 shrink-0 flex-col overflow-auto border-r border-border bg-card", left ? "hidden md:flex" : "hidden", selectedId && "max-md:hidden")}>
        <nav className="space-y-0.5 p-2">
          {FOLDERS.map((f) => (
            <button
              key={f.key}
              onClick={() => router.replace(`/documents?folder=${f.key}`)}
              className={cn("flex h-7 w-full items-center rounded-lg px-2 text-[13px]", folder === f.key && !viewId ? "bg-sidebar-accent font-semibold" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground")}
            >
              {f.label}
              {counts[f.key] ? <span className={cn("ml-auto text-[11px] tabular-nums", f.key === "tasks" && "rounded bg-primary px-1 font-semibold text-primary-foreground")}>{counts[f.key]}</span> : null}
            </button>
          ))}
        </nav>
        <div className="border-t border-border p-2">
          <div className="mb-1 flex items-center justify-between px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Мои папки и фильтры
            <span className="flex">
              <IconButton label="Сохранить текущий фильтр" className="size-6" onClick={() => setDialog("saveView")}><Bookmark className="size-3.5" /></IconButton>
              <IconButton label="Новая папка" className="size-6" onClick={() => setDialog("newFolder")}><FolderPlus className="size-3.5" /></IconButton>
            </span>
          </div>
          {views?.views.map((v) => (
            <div key={v.id} className="group flex items-center">
              <button
                className={cn("flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-[13px]", viewId === v.id ? "bg-sidebar-accent font-semibold" : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground")}
                onClick={() => {
                  if (v.kind === "folder") router.replace(`/documents?folder=all&viewId=${v.id}`)
                  else router.replace(`/documents?${new URLSearchParams(v.query as Record<string, string>)}`)
                }}
              >
                {v.kind === "folder" ? <FolderPlus className="size-3.5 shrink-0" /> : <Bookmark className="size-3.5 shrink-0" />}
                <span className="truncate">{v.name}</span>
                {v.kind === "folder" && v.count > 0 && <span className="ml-auto text-[11px]">{v.count}</span>}
              </button>
              <IconButton label={`Удалить «${v.name}»`} className="size-6 opacity-0 group-hover:opacity-100" onClick={async () => { await api(`/api/edi/views?id=${v.id}`, { method: "DELETE" }); reloadViews() }}>
                <X className="size-3" />
              </IconButton>
            </div>
          ))}
        </div>
      </aside>

      {/* Центр: таблица */}
      <section className={cn("flex min-w-0 flex-1 flex-col", selectedId && right && "max-lg:hidden")}>
        <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-border bg-card px-2 py-1.5">
          <IconButton label="Левая панель ([)" className="hidden md:inline-flex" onClick={() => setLeft((v) => !v)}><PanelLeft className="size-4" /></IconButton>
          <Select className="w-auto md:hidden" value={folder} onChange={(e) => router.replace(`/documents?folder=${e.target.value}`)} aria-label="Папка">
            {FOLDERS.map((f) => <option key={f.key} value={f.key}>{f.label}{counts[f.key] ? ` (${counts[f.key]})` : ""}</option>)}
          </Select>
          <h1 className="hidden text-sm font-semibold md:block">{folderLabel}</h1>
          {data && <span className="text-xs text-muted-foreground">{data.total}</span>}
          {q && <Badge tone="primary">«{q}» <button aria-label="Сбросить поиск" onClick={() => setParams({ q: null })}><X className="size-3" /></button></Badge>}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant={activeFilters ? "subtle" : "ghost"} icon={<Filter className="size-3.5" />} onClick={() => setFiltersOpen(true)}>
              Фильтры{activeFilters ? ` · ${activeFilters}` : ""}
            </Button>
            <Select className="h-7 w-auto text-xs" value={group} onChange={(e) => setGroup(e.target.value as typeof group)} aria-label="Группировка">
              <option value="">Без группировки</option>
              <option value="type">По типу</option>
              <option value="status">По статусу</option>
              <option value="counterparty">По контрагенту</option>
            </Select>
            {can(me, "edi.doc.create") && <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => router.push("/documents/new")}>Создать</Button>}
            {selectedId && <IconButton label="Карточка (])" className="hidden lg:inline-flex" onClick={() => setRight((v) => !v)}><PanelRight className="size-4" /></IconButton>}
          </div>
        </div>
        {checked.size > 0 && (
          <div className="no-print flex flex-wrap items-center gap-1.5 border-b border-border bg-[color-mix(in_oklch,var(--primary)_15%,var(--card))] px-2 py-1.5 text-[13px]">
            <b>Выбрано: {checked.size}</b>
            <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => bulk("approve")}>Согласовать</Button>
            {can(me, "edi.doc.archive") && <Button size="sm" onClick={() => bulk("archive")}>В архив</Button>}
            <Button size="sm" icon={<Star className="size-3.5" />} onClick={() => bulk("favorite")}>В избранное</Button>
            {views?.views.some((v) => v.kind === "folder") && <Button size="sm" onClick={() => setDialog("addToFolder")}>В папку</Button>}
            <Button size="sm" icon={<Download className="size-3.5" />} onClick={exportZip}>Выгрузить архив</Button>
            <Button size="sm" variant="ghost" onClick={() => setChecked(new Set())}>Снять выбор</Button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-[13px]">
            <thead className="sticky top-0 z-10 bg-card text-left text-[11px] text-muted-foreground">
              <tr>
                <th className="w-8 border-b border-border px-2 py-1.5">
                  <input type="checkbox" aria-label="Выбрать все" checked={rows.length > 0 && checked.size === rows.length} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.documentId)) : new Set())} />
                </th>
                {cols.map((c) => (
                  <th key={c.key} className={cn("border-b border-border px-2 py-1.5 font-medium", c.className)}>
                    {c.sort ? (
                      <button className="inline-flex items-center gap-0.5 hover:text-foreground" onClick={() => setParams({ sort: c.sort!, dir: sort === c.sort && dir === "desc" ? "asc" : "desc" })}>
                        {c.label}
                        {sort === c.sort && (dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <GroupRows key={g.key} label={g.label} count={g.rows.length} span={cols.length + 1}>
                  {g.rows.map((r) => {
                    const i = rows.indexOf(r)
                    const active = r.documentId === selectedId
                    return (
                      <tr
                        id={`row-${r.documentId}`}
                        key={r.documentId}
                        onClick={() => (setCursor(i), select(r.documentId))}
                        onDoubleClick={() => router.push(`/documents/${r.documentId}`)}
                        className={cn("cursor-pointer", active ? "bg-row-active" : i === cursor ? "bg-row-hover" : "hover:bg-row-hover")}
                      >
                        <td className="border-b border-border px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label="Выбрать" checked={checked.has(r.documentId)} onChange={() => toggle(r.documentId)} />
                        </td>
                        <td className="max-w-0 border-b border-border px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            {r.myTaskId && <span className="size-1.5 shrink-0 rounded-full bg-[var(--warning)]" title="Ваша задача" />}
                            {r.favorite && <Star className="size-3 shrink-0 fill-[var(--warning)] text-[var(--warning)]" />}
                            <span className="line-clamp-2 font-medium" title={r.title}>{r.title}</span>
                          </div>
                          <div className={cn("truncate text-[11px] text-muted-foreground", !compact && "2xl:hidden")}>
                            {docType(r.docType)?.short} · {r.direction === "incoming" ? "вх." : r.direction === "outgoing" ? "исх." : "внутр."}
                            {r.counterpartyName ? <span className={compact ? "" : "md:hidden"}> · {r.counterpartyName}</span> : null}
                            <span className={compact ? "" : "sm:hidden"}> · {fmtDate(r.docDate)}</span>
                          </div>
                        </td>
                        {showCol("type") && <td className="hidden whitespace-nowrap border-b border-border px-2 py-1.5 text-muted-foreground 2xl:table-cell">{docType(r.docType)?.short}</td>}
                        {showCol("cp") && <td className="hidden max-w-48 truncate border-b border-border px-2 py-1.5 md:table-cell" title={r.counterpartyInn ? `ИНН ${r.counterpartyInn}` : undefined}>{r.counterpartyName ?? "—"}</td>}
                        <td className="whitespace-nowrap border-b border-border px-2 py-1.5 text-right tabular-nums">{r.amountTotal != null ? fmtMoney(r.amountTotal, r.currency) : "—"}</td>
                        {showCol("date") && <td className="hidden whitespace-nowrap border-b border-border px-2 py-1.5 tabular-nums text-muted-foreground sm:table-cell">{fmtDate(r.docDate)}</td>}
                        <td className="border-b border-border px-2 py-1.5">
                          <div className="flex flex-wrap gap-1">
                            <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                            {r.wmsStatus && <Badge tone={WMS_TONE[r.wmsStatus]} title={WMS_STATUS_LABEL[r.wmsStatus]} className="hidden xl:inline-flex">WMS</Badge>}
                            {r.exchangeStatus !== "none" && <Badge tone={EXCHANGE_TONE[r.exchangeStatus]} title={EXCHANGE_LABEL[r.exchangeStatus]} className="hidden xl:inline-flex">ЭДО</Badge>}
                          </div>
                        </td>
                        {showCol("resp") && <td className="hidden max-w-40 truncate border-b border-border px-2 py-1.5 text-muted-foreground xl:table-cell">{r.responsibleName ?? "—"}</td>}
                        {showCol("last") && <td className="hidden whitespace-nowrap border-b border-border px-2 py-1.5 text-xs text-muted-foreground 2xl:table-cell">{ACTION_LABEL[r.lastAction ?? ""] ?? r.lastAction} · {relTime(r.lastActionAt ?? r.updatedAt)}</td>}
                      </tr>
                    )
                  })}
                </GroupRows>
              ))}
            </tbody>
          </table>
          {!loading && rows.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">{q || activeFilters ? "Ничего не найдено. Измените поиск или фильтры." : "В этой папке нет документов."}</p>}
          {loading && !data && <div className="grid h-32 place-items-center"><Spinner /></div>}
        </div>
        {data && totalPages > 1 && (
          <div className="no-print flex items-center justify-end gap-2 border-t border-border bg-card px-2 py-1 text-xs">
            <span className="text-muted-foreground">{(page - 1) * data.pageSize + 1}–{Math.min(page * data.pageSize, data.total)} из {data.total}</span>
            <IconButton label="Предыдущая страница" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}><ChevronLeft className="size-4" /></IconButton>
            <IconButton label="Следующая страница" disabled={page >= totalPages} onClick={() => setParams({ page: String(page + 1) })}><ChevronRight className="size-4" /></IconButton>
          </div>
        )}
      </section>

      {/* Правая панель: карточка */}
      {selectedId && right && (
        <aside className="w-full min-w-0 border-l border-border lg:w-[min(560px,45vw)] lg:shrink-0">
          <DocumentCard key={selectedId} id={selectedId} compact onClose={() => select(null)} onChanged={() => (reload(), reloadCounts())} />
        </aside>
      )}

      {filtersOpen && <FiltersDialog sp={sp} onClose={() => setFiltersOpen(false)} apply={(p) => (setParams(p), setFiltersOpen(false))} />}
      {dialog === "saveView" && (
        <NameDialog
          title="Сохранить фильтр"
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const query = Object.fromEntries([...new URLSearchParams(sp.toString())].filter(([k]) => !["id", "page"].includes(k)))
            await api("/api/edi/views", { method: "POST", json: { name, kind: "filter", query } })
            reloadViews()
            setDialog(null)
          }}
        />
      )}
      {dialog === "newFolder" && (
        <NameDialog title="Новая папка" onClose={() => setDialog(null)} onSubmit={async (name) => { await api("/api/edi/views", { method: "POST", json: { name, kind: "folder" } }); reloadViews(); setDialog(null) }} />
      )}
      {dialog === "addToFolder" && (
        <Modal title="Добавить в папку" onClose={() => setDialog(null)}>
          {views?.views.filter((v) => v.kind === "folder").map((v) => (
            <button key={v.id} className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted" onClick={async () => { await api("/api/edi/views", { method: "POST", json: { addTo: v.id, documentIds: [...checked] } }); toast(`Добавлено в «${v.name}»`); reloadViews(); setDialog(null) }}>
              {v.name}
            </button>
          ))}
        </Modal>
      )}
    </div>
  )
}

function GroupRows({ label, count, span, children }: { label: string; count: number; span: number; children: React.ReactNode }) {
  if (!label) return <>{children}</>
  return (
    <>
      <tr>
        <td colSpan={span} className="border-b border-border bg-muted px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Layers className="mr-1 inline size-3" />
          {label} · {count}
        </td>
      </tr>
      {children}
    </>
  )
}

function NameDialog({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (name: string) => Promise<void> }) {
  const [name, setName] = useState("")
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!name.trim()} onClick={() => void onSubmit(name.trim())}>Сохранить</Button></>}>
      <Field label="Название"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && void onSubmit(name.trim())} /></Field>
    </Modal>
  )
}

function FiltersDialog({ sp, onClose, apply }: { sp: URLSearchParams; onClose: () => void; apply: (p: Record<string, string | string[] | null>) => void }) {
  const [types, setTypes] = useState<string[]>(sp.getAll("type"))
  const [statuses, setStatuses] = useState<string[]>(sp.getAll("status"))
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(["direction", "dateFrom", "dateTo", "amountMin", "amountMax", "wmsStatus", "counterpartyId"].map((k) => [k, sp.get(k) ?? ""])))
  const { data: cps } = useApi<{ rows: Array<{ id: string; name: string; inn: string | null }> }>("/api/edi/counterparties?limit=200")
  const tog = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  return (
    <Modal
      title="Фильтры"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => apply({ type: [], status: [], direction: null, dateFrom: null, dateTo: null, amountMin: null, amountMax: null, wmsStatus: null, counterpartyId: null })}>Сбросить</Button>
          <Button variant="primary" onClick={() => apply({ type: types, status: statuses, ...f })}>Применить</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Направление">
            <Select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
              <option value="">Любое</option>
              <option value="incoming">Входящие</option>
              <option value="outgoing">Исходящие</option>
              <option value="internal">Внутренние</option>
            </Select>
          </Field>
          <Field label="Дата с"><Input type="date" value={f.dateFrom} onChange={(e) => setF({ ...f, dateFrom: e.target.value })} /></Field>
          <Field label="по"><Input type="date" value={f.dateTo} onChange={(e) => setF({ ...f, dateTo: e.target.value })} /></Field>
          <Field label="Сумма от"><Input inputMode="decimal" value={f.amountMin} onChange={(e) => setF({ ...f, amountMin: e.target.value })} /></Field>
          <Field label="до"><Input inputMode="decimal" value={f.amountMax} onChange={(e) => setF({ ...f, amountMax: e.target.value })} /></Field>
          <Field label="Приёмка WMS">
            <Select value={f.wmsStatus} onChange={(e) => setF({ ...f, wmsStatus: e.target.value })}>
              <option value="">Любая</option>
              {Object.entries(WMS_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          </Field>
          <Field label="Контрагент" className="sm:col-span-3">
            <Select value={f.counterpartyId} onChange={(e) => setF({ ...f, counterpartyId: e.target.value })}>
              <option value="">Любой</option>
              {cps?.rows.map((c) => <option key={c.id} value={c.id}>{c.name}{c.inn ? ` · ${c.inn}` : ""}</option>)}
            </Select>
          </Field>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Статус</div>
          <div className="flex flex-wrap gap-1">
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <button key={k} onClick={() => setStatuses(tog(statuses, k))} className={cn("h-7 rounded-lg border px-2 text-xs", statuses.includes(k) ? "border-ring bg-row-active" : "border-border")}>{v}</button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Тип документа</div>
          {Object.entries(CATEGORY_LABEL).map(([cat, label]) => (
            <div key={cat} className="mb-1.5 flex flex-wrap items-center gap-1">
              <span className="w-28 text-xs text-muted-foreground">{label}</span>
              {DOC_TYPES.filter((t) => t.category === cat).map((t) => (
                <button key={t.code} onClick={() => setTypes(tog(types, t.code))} className={cn("h-7 rounded-lg border px-2 text-xs", types.includes(t.code) ? "border-ring bg-row-active" : "border-border")}>{t.short}</button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={<div className="grid h-40 place-items-center"><Spinner /></div>}>
      <Journal />
    </Suspense>
  )
}
