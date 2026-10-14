"use client"

import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileWarning,
  Link2,
  Maximize2,
  PenLine,
  Printer,
  RefreshCw,
  Send,
  Share2,
  Star,
  Trash2,
  Upload,
  Warehouse,
  X,
} from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type ReactNode } from "react"
import { api, fmtDate, fmtDateTime, fmtMoney, fmtQty, relTime, useApi, useHotkeys, useLiveEvents } from "./api"
import { SignDialog } from "./sign-dialog"
import { Badge, Button, cn, ErrorLine, EXCHANGE_TONE, Field, IconButton, Input, Modal, Select, Spinner, STATUS_TONE, Tabs, Textarea, toast, WMS_TONE } from "./ui"
import { DIRECTION_LABEL, EXCHANGE_LABEL, STATUS_LABEL, WMS_STATUS_LABEL } from "@/lib/edi/doc-types.ts"
import type { DocTypeDef } from "@/lib/edi/doc-types.ts"

type Action = { key: string; label: string; taskId?: string; decisions?: Array<{ value: string; label: string }>; to?: string[] }
type FileRow = { fileId: string; versionNo: number | null; kind: string; fileName: string; mime: string; sizeBytes: number; sha256: string; createdAt: string }
type Line = { lineNo: number; name: string; supplierCode: string | null; gtin: string | null; uomName: string | null; qty: number; price: number | null; amountNet: number | null; vatRate: string | null; vatAmount: number | null; amountTotal: number | null; itemCode: string | null; itemName: string | null; matchSource: string | null; markingCodes: string[] }

export type Detail = {
  document: {
    documentId: string
    docType: string
    direction: string
    number: string | null
    docDate: string | null
    title: string
    currency: string
    amountNet: string | null
    amountVat: string | null
    amountTotal: string | null
    status: string
    exchangeStatus: string
    wmsStatus: string | null
    authorName: string | null
    responsibleName: string | null
    department: string | null
    confidential: boolean
    currentVersion: number
    signedVersion: number | null
    fields: Record<string, any>
    formatCode: string | null
    source: string
    dueDate: string | null
    basis: string | null
    archivedAt: string | null
    createdAt: string
    updatedAt: string
    favorite: boolean
  }
  type: DocTypeDef | null
  counterparty: { id: string; name: string; shortName: string | null; inn: string | null; kpp: string | null; addressLegal: string | null; bankName: string | null; bankBik: string | null; bankAccount: string | null; wmsSupplierCode: string | null } | null
  lines: Line[]
  files: FileRow[]
  versions: Array<{ versionNo: number; contentHash: string; reason: string | null; createdBy: string | null; createdAt: string; locked: boolean; lockedReason: string | null }>
  history: Array<{ id: string; action: string; label: string; actorName: string | null; details: Record<string, any>; createdAt: string }>
  workflow: Array<{ instanceId: string; status: string; defVersion: number; documentVersion: number; startedAt: string; finishedAt: string | null; steps: Array<{ id: string; name: string; kind: string; stage: number; index: number }> }>
  tasks: Array<{ taskId: string; instanceId: string; stepIndex: number; stepName: string; kind: string; status: string; decision: string | null; comment: string | null; dueAt: string | null; escalatedAt: string | null; createdAt: string; completedAt: string | null; assigneeName: string | null; completedByName: string | null; onBehalfOfName: string | null }>
  signatures: Array<{ signatureId: string; versionNo: number; kind: string; source: string; side: string; signerName: string | null; signerInn: string | null; signerTitle: string | null; certSerial: string | null; certIssuer: string | null; certValidFrom: string | null; certValidTo: string | null; poaNumber: string | null; signedAt: string | null; verificationStatus: string; signedFileId: string; signatureFileId: string; lastCheck: { verifier: string; status: string; details: Record<string, any>; checkedAt: string } | null }>
  exchanges: Array<{ exchangeId: string; direction: string; status: string; provider: string | null; error: string | null; createdAt: string; receipts: Array<{ kind: string; at: string; fileId: string | null }> }>
  relations: Array<{ kind: string; dir: string; documentId: string; title: string; status: string; docType: string }>
  links: Array<{ id: string; system: string; objectType: string; objectId: string; url: string | null; status: string | null; payload: Record<string, any>; syncedAt: string | null; syncError: string | null }>
  comments: Array<{ id: string; authorName: string | null; body: string; createdAt: string }>
  issues: Array<{ level: string; message: string }>
  actions: Action[]
}

const FILE_KIND: Record<string, string> = { original: "Оригинал", attachment: "Вложение", signature: "Подпись", version: "Файл версии", print: "Печатная форма", receipt: "Квитанция" }
const SIG_STATUS: Record<string, { label: string; tone: "success" | "danger" | "warning" | "neutral" }> = {
  valid: { label: "Действительна", tone: "success" },
  invalid: { label: "Недействительна", tone: "danger" },
  not_verified: { label: "Не проверена", tone: "warning" },
  error: { label: "Ошибка проверки", tone: "danger" },
}
const RELATION: Record<string, string> = { basis: "Основание", correction: "Корректировка", reply: "Ответ", related: "Связан", contract: "Договор" }

type Tab = "doc" | "file" | "flow" | "sign" | "files" | "history" | "links" | "comments"

export function DocumentCard({ id, compact, onClose, onChanged }: { id: string; compact?: boolean; onClose?: () => void; onChanged?: () => void }) {
  const { data, error, reload, loading } = useApi<Detail>(`/api/edi/documents/${id}`, [id])
  const [tab, setTab] = useState<Tab>("doc")
  const [dialog, setDialog] = useState<null | { kind: string; action?: Action; decision?: string }>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const router = useRouter()
  useLiveEvents((e) => e.documentId === id && reload())
  useEffect(() => setTab("doc"), [id])

  const run = async (action: string, body: Record<string, unknown> = {}, ok?: string) => {
    setBusy(action)
    try {
      const r = await api(`/api/edi/documents/${id}/action`, { method: "POST", json: { action, ...body } })
      if (ok) toast(ok)
      await reload()
      onChanged?.()
      return r
    } catch (e) {
      toast((e as Error).message, "error")
      throw e
    } finally {
      setBusy(null)
    }
  }
  const decide = async (taskId: string, decision: string, comment?: string) => {
    setBusy("decide")
    try {
      const r = await api<{ state: string }>(`/api/edi/tasks/${taskId}/decide`, { method: "POST", json: { decision, comment } })
      toast(r.state === "approved" ? "Маршрут завершён" : "Решение принято")
      await reload()
      onChanged?.()
    } catch (e) {
      toast((e as Error).message, "error")
    } finally {
      setBusy(null)
    }
  }

  const task = data?.actions.find((a) => a.key === "decide")
  useHotkeys(
    {
      a: () => task?.decisions?.some((d) => d.value === "approve") && decide(task.taskId!, "approve"),
      r: () => task?.decisions?.some((d) => d.value === "rework") && setDialog({ kind: "decide", action: task, decision: "rework" }),
      e: () => data?.actions.some((a) => a.key === "edit") && router.push(`/documents/new?edit=${id}`),
      f: () => data && run("favorite", { on: !data.document.favorite }),
      Escape: () => onClose?.(),
    },
    Boolean(data) && !dialog
  )

  if (error) return <div className="p-4"><ErrorLine error={error} /></div>
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>
  const d = data.document
  const has = (k: string) => data.actions.find((a) => a.key === k)
  const pendingTasks = data.tasks.filter((t) => t.status === "pending").length

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="border-b border-border px-3 pb-2 pt-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">{data.type?.name ?? d.docType}</span>
              <span>·</span>
              <span>{DIRECTION_LABEL[d.direction]}</span>
              {d.formatCode && <Badge title="Структурированный формат">{d.formatCode.replace("fns_upd_", "ФНС ").replace("_", ".")}</Badge>}
              {d.confidential && <Badge tone="warning">Конфиденциально</Badge>}
              {d.archivedAt && <Badge>В архиве</Badge>}
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold leading-snug">{d.title}</h2>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone={STATUS_TONE[d.status]} title="Статус документа">{STATUS_LABEL[d.status] ?? d.status}</Badge>
              {d.wmsStatus && <Badge tone={WMS_TONE[d.wmsStatus]} title="Приёмка в WMS"><Warehouse className="size-3" />{WMS_STATUS_LABEL[d.wmsStatus]}</Badge>}
              {d.exchangeStatus !== "none" && <Badge tone={EXCHANGE_TONE[d.exchangeStatus]} title="Юридически значимый обмен">ЭДО: {EXCHANGE_LABEL[d.exchangeStatus]}</Badge>}
              {d.signedVersion != null && <Badge tone="success">Подписана версия {d.signedVersion}</Badge>}
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            <IconButton label={d.favorite ? "Убрать из избранного (f)" : "В избранное (f)"} onClick={() => run("favorite", { on: !d.favorite })}>
              <Star className={cn("size-4", d.favorite && "fill-[var(--warning)] text-[var(--warning)]")} />
            </IconButton>
            <IconButton
              label="Скопировать ссылку"
              onClick={() => {
                void navigator.clipboard?.writeText(`${location.origin}/documents?id=${d.documentId}`)
                toast("Ссылка скопирована")
              }}
            >
              <Copy className="size-4" />
            </IconButton>
            {compact && (
              <IconButton label="Открыть на весь экран (Enter)" onClick={() => router.push(`/documents/${d.documentId}`)}>
                <Maximize2 className="size-4" />
              </IconButton>
            )}
            {onClose && (
              <IconButton label="Закрыть (Esc)" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            )}
          </div>
        </div>
        <ActionBar data={data} busy={busy} run={run} decide={decide} setDialog={setDialog} onEdit={() => router.push(`/documents/new?edit=${id}`)} />
        {data.issues.filter((i) => i.level === "error").length > 0 && ["draft", "rework", "received"].includes(d.status) && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[color-mix(in_oklch,var(--warning)_14%,transparent)] px-2 py-1.5 text-xs">
            <FileWarning className="mt-0.5 size-3.5 shrink-0" />
            <span>Для согласования не хватает: {data.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}</span>
          </div>
        )}
      </div>
      <div className="px-3">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "doc", label: "Документ" },
            { value: "file", label: "Просмотр" },
            { value: "flow", label: "Маршрут", count: pendingTasks },
            { value: "sign", label: "Подписи", count: data.signatures.length },
            { value: "files", label: "Файлы", count: data.files.length },
            { value: "history", label: "История" },
            { value: "links", label: "Связи", count: data.relations.length + data.links.length },
            { value: "comments", label: "Обсуждение", count: data.comments.length },
          ]}
        />
      </div>
      <div className={cn("min-h-0 flex-1 overflow-auto p-3", loading && "opacity-70")}>
        {tab === "doc" && <DocTab data={data} />}
        {tab === "file" && <PreviewTab data={data} />}
        {tab === "flow" && <FlowTab data={data} />}
        {tab === "sign" && <SignTab data={data} onSign={() => setDialog({ kind: "sign" })} reload={reload} />}
        {tab === "files" && <FilesTab data={data} reload={reload} />}
        {tab === "history" && <HistoryTab data={data} />}
        {tab === "links" && <LinksTab data={data} run={run} busy={busy} />}
        {tab === "comments" && <CommentsTab data={data} run={run} />}
      </div>
      {dialog?.kind === "decide" && dialog.action?.taskId && (
        <DecisionDialog decision={dialog.decision!} label={dialog.action.decisions?.find((x) => x.value === dialog.decision)?.label ?? ""} onClose={() => setDialog(null)} onSubmit={async (c) => { await decide(dialog.action!.taskId!, dialog.decision!, c); setDialog(null) }} />
      )}
      {dialog?.kind === "sign" && <SignDialog detail={data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void reload(); onChanged?.() }} />}
      {dialog?.kind === "relate" && <RelateDialog documentId={id} onClose={() => setDialog(null)} onDone={() => { setDialog(null); void reload() }} />}
      {dialog?.kind === "share" && <ShareDialog documentId={id} onClose={() => setDialog(null)} />}
      {dialog?.kind === "cancel_workflow" && (
        <ReasonDialog title="Отозвать с согласования" onClose={() => setDialog(null)} onSubmit={async (reason) => { await run("cancel_workflow", { reason }, "Согласование отозвано"); setDialog(null) }} />
      )}
      {dialog?.kind === "status" && (
        <StatusDialog to={dialog.action?.to ?? []} onClose={() => setDialog(null)} onSubmit={async (to, comment) => { await run("status", { to, comment }, "Статус изменён"); setDialog(null) }} />
      )}
    </div>
  )
}

function ActionBar({
  data,
  busy,
  run,
  decide,
  setDialog,
  onEdit,
}: {
  data: Detail
  busy: string | null
  run: (a: string, b?: Record<string, unknown>, ok?: string) => Promise<unknown>
  decide: (taskId: string, decision: string, comment?: string) => Promise<void>
  setDialog: (d: { kind: string; action?: Action; decision?: string }) => void
  onEdit: () => void
}) {
  const [more, setMore] = useState(false)
  const id = data.document.documentId
  const primary: ReactNode[] = []
  const secondary: Array<{ label: string; icon: ReactNode; onClick: () => void; danger?: boolean }> = []
  for (const a of data.actions) {
    switch (a.key) {
      case "decide":
        for (const dec of a.decisions ?? []) {
          const isPos = dec.value === "approve" || dec.value === "sign"
          primary.push(
            <Button
              key={`${a.taskId}-${dec.value}`}
              size="sm"
              variant={isPos ? "primary" : dec.value === "reject" ? "danger" : "outline"}
              busy={busy === "decide"}
              icon={isPos ? <Check className="size-3.5" /> : undefined}
              title={dec.value === "approve" ? `${a.label} (a)` : dec.value === "rework" ? "r" : undefined}
              onClick={() => (isPos ? void decide(a.taskId!, dec.value) : setDialog({ kind: "decide", action: a, decision: dec.value }))}
            >
              {dec.label}
            </Button>
          )
        }
        break
      case "sign":
        primary.push(<Button key="sign" size="sm" variant="primary" icon={<PenLine className="size-3.5" />} onClick={() => setDialog({ kind: "sign" })}>{a.label}</Button>)
        break
      case "start_workflow":
        primary.push(<Button key="wf" size="sm" variant="primary" busy={busy === "start_workflow"} icon={<Send className="size-3.5" />} onClick={() => void run("start_workflow", {}, "Отправлено на согласование")}>{a.label}</Button>)
        break
      case "edit":
        primary.push(<Button key="edit" size="sm" title="e" onClick={onEdit}>Редактировать</Button>)
        break
      case "wms_receipt":
        primary.push(<Button key="wms" size="sm" busy={busy === "wms_receipt"} icon={<Warehouse className="size-3.5" />} onClick={() => void run("wms_receipt", {}, "Заказ на приход создан в WMS")}>{a.label}</Button>)
        break
      case "wms_sync":
        secondary.push({ label: a.label, icon: <RefreshCw className="size-3.5" />, onClick: () => void run("wms_sync", {}, "Статус приёмки обновлён") })
        break
      case "discrepancy_act":
        primary.push(
          <Button key="act" size="sm" busy={busy === "discrepancy_act"} onClick={async () => { const r = (await run("discrepancy_act", {}, "Акт расхождений создан")) as { documentId: string }; window.location.href = `/documents?id=${r.documentId}` }}>
            {a.label}
          </Button>
        )
        break
      case "send_edo":
        primary.push(<Button key="edo" size="sm" variant="primary" icon={<Send className="size-3.5" />} onClick={() => void run("send_edo", {}, "Поставлено в очередь оператору ЭДО")}>{a.label}</Button>)
        break
      case "cancel_workflow":
        secondary.push({ label: a.label, icon: <X className="size-3.5" />, onClick: () => setDialog({ kind: "cancel_workflow" }) })
        break
      case "status":
        secondary.push({ label: a.label, icon: <ChevronDown className="size-3.5" />, onClick: () => setDialog({ kind: "status", action: a }) })
        break
      case "archive":
        secondary.push({ label: a.label, icon: <Archive className="size-3.5" />, onClick: () => void run("archive", {}, "Перемещён в архив") })
        break
      case "restore":
        secondary.push({ label: a.label, icon: <ArchiveRestore className="size-3.5" />, onClick: () => void run("restore", {}, "Возвращён из архива") })
        break
      case "delete":
        secondary.push({ label: a.label, icon: <Trash2 className="size-3.5" />, danger: true, onClick: () => confirm("Удалить черновик?") && void run("delete", {}, "Черновик удалён").then(() => (window.location.href = "/documents")) })
        break
      case "related":
        secondary.push({ label: a.label, icon: <Link2 className="size-3.5" />, onClick: () => setDialog({ kind: "relate" }) })
        break
      case "share":
        secondary.push({ label: a.label, icon: <Share2 className="size-3.5" />, onClick: () => setDialog({ kind: "share" }) })
        break
      case "print":
        secondary.push({ label: a.label, icon: <Printer className="size-3.5" />, onClick: () => window.open(`/documents/${id}/print`, "_blank") })
        break
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {primary}
      {secondary.length > 0 && (
        <div className="relative">
          <Button size="sm" variant="ghost" onClick={() => setMore((m) => !m)} icon={<ChevronDown className="size-3.5" />}>
            Ещё
          </Button>
          {more && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMore(false)} />
              <div className="absolute left-0 z-40 mt-1 w-60 rounded-xl border border-border bg-popover p-1 shadow-xl">
                {secondary.map((s) => (
                  <button key={s.label} className={cn("flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-muted", s.danger && "text-destructive")} onClick={() => (setMore(false), s.onClick())}>
                    {s.icon}
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Req({ label, children }: { label: string; children: ReactNode }) {
  if (children == null || children === "" || children === "—") return null
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-[13px]" title={typeof children === "string" ? children : undefined}>{children}</dd>
    </div>
  )
}

function DocTab({ data }: { data: Detail }) {
  const d = data.document
  const cp = data.counterparty
  const fieldDefs = data.type?.fields ?? []
  const custom = Object.entries(d.fields).filter(([k]) => k.startsWith("custom"))
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        <Req label="Номер">{d.number ?? "—"}</Req>
        <Req label="Дата">{fmtDate(d.docDate)}</Req>
        {d.amountTotal != null && <Req label="Сумма">{fmtMoney(d.amountTotal, d.currency)}</Req>}
        {d.amountVat != null && <Req label="В т.ч. НДС">{fmtMoney(d.amountVat, d.currency)}</Req>}
        <Req label="Ответственный">{d.responsibleName ?? "—"}</Req>
        <Req label="Автор">{d.authorName ?? "—"}</Req>
        <Req label="Подразделение">{d.department ?? "—"}</Req>
        <Req label="Срок">{d.dueDate ? fmtDate(d.dueDate) : "—"}</Req>
        <Req label="Основание">{d.basis ?? "—"}</Req>
        <Req label="Версия">{`${d.currentVersion}`}</Req>
        {fieldDefs.map((f) => {
          const v = d.fields[f.key]
          if (v == null || v === "" || f.key === "basis") return null
          const shown = f.type === "date" ? fmtDate(String(v)) : f.type === "boolean" ? (v ? "Да" : "Нет") : f.type === "money" ? fmtMoney(Number(v)) : f.options ? f.options.find((o) => o.value === v)?.label ?? String(v) : String(v)
          return f.type === "textarea" ? null : <Req key={f.key} label={f.label}>{shown}</Req>
        })}
        {custom.map(([k, v]) => (
          <Req key={k} label={k.replace(/^custom/, "")}>{String(v)}</Req>
        ))}
      </dl>
      {fieldDefs.filter((f) => f.type === "textarea" && d.fields[f.key]).map((f) => (
        <div key={f.key}>
          <div className="text-[11px] text-muted-foreground">{f.label}</div>
          <p className="whitespace-pre-wrap text-[13px]">{String(d.fields[f.key])}</p>
        </div>
      ))}
      {cp && (
        <div className="rounded-lg border border-border p-2.5">
          <div className="flex items-center justify-between">
            <Link href={`/counterparties?id=${cp.id}`} className="text-[13px] font-semibold hover:underline">{cp.name}</Link>
            {cp.wmsSupplierCode && <Badge title="Связан со справочником поставщиков WMS">WMS: {cp.wmsSupplierCode}</Badge>}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            ИНН {cp.inn ?? "—"}
            {cp.kpp ? ` · КПП ${cp.kpp}` : ""}
            {cp.addressLegal ? ` · ${cp.addressLegal}` : ""}
          </div>
          {cp.bankAccount && <div className="text-xs text-muted-foreground">р/с {cp.bankAccount} · {cp.bankName} · БИК {cp.bankBik}</div>}
        </div>
      )}
      {data.lines.length > 0 && <LinesTable lines={data.lines} currency={d.currency} totals={d} />}
    </div>
  )
}

const MATCH_LABEL: Record<string, string> = { mapping: "сохранённое соответствие", gtin: "по GTIN", alias_sku: "алиас WMS по коду", alias_name: "алиас WMS по названию", item_code: "код номенклатуры", manual: "выбрано вручную" }

export function LinesTable({ lines, currency, totals }: { lines: Line[]; currency: string; totals?: { amountNet: string | null; amountVat: string | null; amountTotal: string | null } }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[540px] text-xs">
        <thead className="bg-muted text-left text-[11px] text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 font-medium">№</th>
            <th className="px-2 py-1.5 font-medium">Наименование</th>
            <th className="px-2 py-1.5 font-medium">Номенклатура WMS</th>
            <th className="px-2 py-1.5 text-right font-medium">Кол-во</th>
            <th className="px-2 py-1.5 text-right font-medium">Цена</th>
            <th className="px-2 py-1.5 text-right font-medium">НДС</th>
            <th className="px-2 py-1.5 text-right font-medium">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.lineNo} className="border-t border-border align-top">
              <td className="px-2 py-1.5 text-muted-foreground">{l.lineNo}</td>
              <td className="px-2 py-1.5">
                <div>{l.name}</div>
                <div className="text-[11px] text-muted-foreground">
                  {[l.supplierCode && `код ${l.supplierCode}`, l.gtin && `GTIN ${l.gtin}`, l.markingCodes?.length ? `КИЗ: ${l.markingCodes.length}` : ""].filter(Boolean).join(" · ")}
                </div>
              </td>
              <td className="px-2 py-1.5">
                {l.itemCode ? (
                  <>
                    <div className="font-mono text-[11px]">{l.itemCode}</div>
                    <div className="text-[11px] text-muted-foreground" title={MATCH_LABEL[l.matchSource ?? ""]}>{l.itemName ?? MATCH_LABEL[l.matchSource ?? ""]}</div>
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtQty(l.qty)} {l.uomName}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{l.price != null ? fmtMoney(l.price, currency) : "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{l.vatRate ?? "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(l.amountTotal, currency)}</td>
            </tr>
          ))}
        </tbody>
        {totals?.amountTotal != null && (
          <tfoot className="border-t border-border font-medium">
            <tr>
              <td colSpan={5} className="px-2 py-1.5 text-right text-muted-foreground">
                Без НДС {fmtMoney(totals.amountNet, currency)} · НДС {fmtMoney(totals.amountVat, currency)}
              </td>
              <td colSpan={2} className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(totals.amountTotal, currency)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

function decodeXml(buf: ArrayBuffer): string {
  const head = new TextDecoder("latin1").decode(buf.slice(0, 200))
  const enc = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() || "utf-8"
  try {
    return new TextDecoder(enc === "cp1251" ? "windows-1251" : enc).decode(buf)
  } catch {
    return new TextDecoder().decode(buf)
  }
}

function prettyXml(s: string): string {
  let depth = 0
  return s
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((line) => {
      if (/^<\//.test(line)) depth = Math.max(0, depth - 1)
      const out = "  ".repeat(depth) + line
      if (/^<[^!?/][^>]*[^/]>$/.test(line) && !/<\/[^>]+>$/.test(line)) depth++
      return out
    })
    .join("\n")
}

function PreviewTab({ data }: { data: Detail }) {
  const viewable = data.files.filter((f) => f.kind !== "signature")
  const [fileId, setFileId] = useState(viewable.find((f) => f.kind === "original")?.fileId ?? viewable[0]?.fileId ?? "")
  const file = viewable.find((f) => f.fileId === fileId)
  const [text, setText] = useState<string | null>(null)
  const [raw, setRaw] = useState(false)
  useEffect(() => {
    setText(null)
    if (!file) return
    if (file.mime.includes("xml") || file.mime === "application/json") {
      fetch(`/api/edi/files/${file.fileId}`).then((r) => r.arrayBuffer()).then((b) => setText(decodeXml(b))).catch(() => setText(""))
    } else if (!file.mime.startsWith("image/") && file.mime !== "application/pdf") {
      api<{ text: string }>(`/api/edi/files/${file.fileId}?text=1`).then((r) => setText(r.text)).catch(() => setText(""))
    }
  }, [file])
  if (!file) {
    return <p className="text-[13px] text-muted-foreground">Файлов нет — документ создан в системе. Печатная форма: «Ещё → Печатная форма».</p>
  }
  const parsed = data.document.fields.parsed as { seller?: any; buyer?: any } | undefined
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {viewable.length > 1 && (
          <Select className="w-auto max-w-xs" value={fileId} onChange={(e) => setFileId(e.target.value)} aria-label="Файл">
            {viewable.map((f) => (
              <option key={f.fileId} value={f.fileId}>{FILE_KIND[f.kind] ?? f.kind}: {f.fileName}</option>
            ))}
          </Select>
        )}
        <a href={`/api/edi/files/${file.fileId}`} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Download className="size-3.5" /> Скачать
        </a>
        <span className="font-mono text-[10px] text-muted-foreground" title="SHA-256 оригинала">{file.sha256.slice(0, 16)}…</span>
      </div>
      {file.mime === "application/pdf" && <iframe title={file.fileName} src={`/api/edi/files/${file.fileId}?inline=1`} className="h-[70vh] w-full rounded-lg border border-border bg-white" />}
      {file.mime.startsWith("image/") && <img src={`/api/edi/files/${file.fileId}?inline=1`} alt={file.fileName} className="max-w-full rounded-lg border border-border" />}
      {file.mime.includes("xml") && (
        <>
          {parsed && !raw && (
            <div className="grid gap-2 sm:grid-cols-2">
              {[["Продавец", parsed.seller], ["Покупатель", parsed.buyer]].map(([label, p]) =>
                p ? (
                  <div key={label as string} className="rounded-lg border border-border p-2 text-xs">
                    <div className="text-[11px] text-muted-foreground">{label as string}</div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-muted-foreground">ИНН {p.inn}{p.kpp ? ` · КПП ${p.kpp}` : ""}</div>
                    {p.address && <div className="text-muted-foreground">{p.address}</div>}
                  </div>
                ) : null
              )}
              <div className="sm:col-span-2"><LinesTable lines={data.lines} currency={data.document.currency} totals={data.document} /></div>
            </div>
          )}
          <button className="text-xs text-muted-foreground underline" onClick={() => setRaw((r) => !r)}>{raw || !parsed ? "Скрыть XML" : "Показать исходный XML"}</button>
          {(raw || !parsed) && text != null && <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-2 font-mono text-[11px] leading-relaxed">{prettyXml(text)}</pre>}
        </>
      )}
      {file.mime === "application/json" && text != null && <pre className="max-h-[60vh] overflow-auto rounded-lg bg-muted p-2 font-mono text-[11px]">{text}</pre>}
      {!file.mime.includes("xml") && !file.mime.startsWith("image/") && file.mime !== "application/pdf" && file.mime !== "application/json" && (
        text ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-[13px]">{text}</pre> : text === "" ? <p className="text-xs text-muted-foreground">Предпросмотр этого формата недоступен — скачайте файл.</p> : <Spinner />
      )}
    </div>
  )
}

const TASK_STATUS: Record<string, string> = { pending: "Ожидает", done: "Выполнено", skipped: "Пропущен по условию", cancelled: "Снято" }
const DECISION: Record<string, string> = { approve: "Согласовано", reject: "Отклонено", rework: "На доработку", sign: "Подписано" }
const INSTANCE: Record<string, string> = { running: "Идёт", approved: "Завершён", rejected: "Отклонён", rework: "Возвращён", cancelled: "Отозван" }

function FlowTab({ data }: { data: Detail }) {
  if (!data.workflow.length) return <p className="text-[13px] text-muted-foreground">Документ не отправлялся на согласование. Внутреннее согласование фиксирует решение сотрудника и не является электронной подписью.</p>
  return (
    <div className="space-y-4">
      {data.workflow.map((w) => (
        <section key={w.instanceId}>
          <div className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge tone={w.status === "running" ? "warning" : w.status === "approved" ? "success" : "danger"}>{INSTANCE[w.status]}</Badge>
            маршрут v{w.defVersion} · версия документа {w.documentVersion} · {fmtDateTime(w.startedAt)}
          </div>
          <ol className="space-y-1 border-l-2 border-border pl-3">
            {[...new Set(w.steps.map((s) => s.stage))].map((stage) => (
              <li key={stage}>
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Этап {stage}</div>
                {w.steps.filter((s) => s.stage === stage).map((s) => {
                  const ts = data.tasks.filter((t) => t.instanceId === w.instanceId && t.stepIndex === s.index)
                  return (
                    <div key={s.id} className="mb-1.5">
                      <div className="text-[13px] font-medium">{s.name}</div>
                      {ts.length === 0 && <div className="text-xs text-muted-foreground">Ещё не начат</div>}
                      {ts.map((t) => {
                        const overdue = t.status === "pending" && t.dueAt && new Date(t.dueAt) < new Date()
                        return (
                          <div key={t.taskId} className="text-xs">
                            <span className={cn(t.status === "done" && t.decision !== "approve" && t.decision !== "sign" && "text-destructive")}>
                              {t.assigneeName ?? "—"}: {t.decision ? DECISION[t.decision] : TASK_STATUS[t.status]}
                            </span>
                            {t.completedByName && t.onBehalfOfName && <span className="text-muted-foreground"> · {t.completedByName} за {t.onBehalfOfName}</span>}
                            {t.completedAt && <span className="text-muted-foreground"> · {fmtDateTime(t.completedAt)}</span>}
                            {t.status === "pending" && t.dueAt && <span className={cn("ml-1", overdue ? "font-semibold text-destructive" : "text-muted-foreground")}>· срок {fmtDateTime(t.dueAt)}</span>}
                            {t.escalatedAt && <Badge tone="danger" className="ml-1">эскалация</Badge>}
                            {t.comment && <div className="text-muted-foreground">«{t.comment}»</div>}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function SignTab({ data, onSign, reload }: { data: Detail; onSign: () => void; reload: () => void }) {
  const canSign = data.actions.some((a) => a.key === "sign")
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Электронная подпись создаётся сертифицированным криптографическим ПО (КриптоПро ЭЦП Browser plug-in) или приходит от оператора ЭДО. Печатная форма и подписанный оригинал — разные представления документа.
      </p>
      {canSign && <Button variant="primary" size="sm" icon={<PenLine className="size-3.5" />} onClick={onSign}>Подписать ЭП</Button>}
      {data.signatures.length === 0 && <p className="text-[13px] text-muted-foreground">Подписей нет.</p>}
      {data.signatures.map((s) => {
        const st = SIG_STATUS[s.verificationStatus] ?? SIG_STATUS.not_verified
        return (
          <div key={s.signatureId} className="rounded-lg border border-border p-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">{s.signerName ?? "Подписант не определён"}</span>
              <Badge tone={st.tone}>{st.label}</Badge>
              <Badge>{s.side === "own" ? "Наша сторона" : "Контрагент"}</Badge>
              <span className="text-muted-foreground">версия {s.versionNo}</span>
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-x-3 text-muted-foreground sm:grid-cols-3">
              {s.signerTitle && <div>Должность: {s.signerTitle}</div>}
              {s.signerInn && <div>ИНН: {s.signerInn}</div>}
              {s.signedAt && <div>Подписано: {fmtDateTime(s.signedAt)}</div>}
              {s.certIssuer && <div className="truncate" title={s.certIssuer}>УЦ: {s.certIssuer}</div>}
              {s.certSerial && <div className="truncate font-mono" title={s.certSerial}>Серт.: {s.certSerial.slice(0, 16)}…</div>}
              {s.certValidTo && <div>Действует до {fmtDate(s.certValidTo)}</div>}
              {s.poaNumber && <div>МЧД: {s.poaNumber}</div>}
            </dl>
            {s.lastCheck?.details?.message && <p className="mt-1 text-muted-foreground">{String(s.lastCheck.details.message)}</p>}
            <div className="mt-1.5 flex gap-3">
              <a className="text-muted-foreground underline" href={`/api/edi/files/${s.signatureFileId}`}>Файл подписи</a>
              <a className="text-muted-foreground underline" href={`/api/edi/files/${s.signedFileId}`}>Подписанный файл</a>
              <button
                className="text-muted-foreground underline"
                onClick={async () => {
                  try {
                    const r = await api<{ check: { status: string } }>(`/api/edi/documents/${data.document.documentId}/signatures`, { method: "POST", json: { recheck: s.signatureId } })
                    toast(`Проверка: ${SIG_STATUS[r.check.status]?.label ?? r.check.status}`)
                    reload()
                  } catch (e) {
                    toast((e as Error).message, "error")
                  }
                }}
              >
                Проверить снова
              </button>
            </div>
          </div>
        )
      })}
      {data.exchanges.length > 0 && (
        <section>
          <h3 className="mb-1 text-[13px] font-semibold">Журнал обмена с оператором</h3>
          {data.exchanges.map((x) => (
            <div key={x.exchangeId} className="text-xs">
              {fmtDateTime(x.createdAt)} · {x.provider} · {x.status}
              {x.error && <span className="text-destructive"> · {x.error}</span>}
              {x.receipts.map((r) => (
                <div key={r.at} className="pl-3 text-muted-foreground">квитанция {r.kind} · {fmtDateTime(r.at)}</div>
              ))}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

function FilesTab({ data, reload }: { data: Detail; reload: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const canAdd = data.actions.some((a) => a.key === "edit" || a.key === "decide") || !data.document.archivedAt
  return (
    <div className="space-y-2">
      {canAdd && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])]
              if (!files.length) return
              const fd = new FormData()
              files.forEach((f) => fd.append("file", f))
              setBusy(true)
              try {
                await api(`/api/edi/documents/${data.document.documentId}/files`, { method: "POST", body: fd })
                toast("Вложения добавлены")
                reload()
              } catch (err) {
                toast((err as Error).message, "error")
              } finally {
                setBusy(false)
                e.target.value = ""
              }
            }}
          />
          <Button size="sm" busy={busy} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>Добавить вложение</Button>
        </>
      )}
      <table className="w-full text-xs">
        <tbody>
          {data.files.map((f) => (
            <tr key={f.fileId} className="border-b border-border last:border-0">
              <td className="py-1.5 pr-2"><Badge>{FILE_KIND[f.kind] ?? f.kind}</Badge></td>
              <td className="py-1.5 pr-2"><a className="hover:underline" href={`/api/edi/files/${f.fileId}`}>{f.fileName}</a></td>
              <td className="py-1.5 pr-2 text-muted-foreground">v{f.versionNo ?? "—"}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{(f.sizeBytes / 1024).toFixed(1)} КБ</td>
              <td className="py-1.5 font-mono text-[10px] text-muted-foreground" title={f.sha256}>{f.sha256.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function HistoryTab({ data }: { data: Detail }) {
  const [a, setA] = useState<number | null>(null)
  const [b, setB] = useState<number | null>(null)
  const [diff, setDiff] = useState<Array<{ field: string; before: string; after: string }> | null>(null)
  const compare = async () => {
    if (a == null || b == null) return
    const r = await api<{ versions: Array<{ versionNo: number; snapshot: any }> }>(`/api/edi/documents/${data.document.documentId}/versions?v=${a}&v=${b}`)
    const [x, y] = r.versions
    const out: Array<{ field: string; before: string; after: string }> = []
    const flat = (o: any, p = ""): Record<string, string> =>
      Object.entries(o ?? {}).reduce((acc, [k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? { ...acc, ...flat(v, `${p}${k}.`) } : { ...acc, [`${p}${k}`]: JSON.stringify(v) }), {} as Record<string, string>)
    const fx = flat(x?.snapshot.header)
    const fy = flat(y?.snapshot.header)
    for (const k of new Set([...Object.keys(fx), ...Object.keys(fy)])) if (fx[k] !== fy[k]) out.push({ field: k, before: fx[k] ?? "—", after: fy[k] ?? "—" })
    const lx = x?.snapshot.lines ?? []
    const ly = y?.snapshot.lines ?? []
    for (let i = 0; i < Math.max(lx.length, ly.length); i++) {
      const s1 = lx[i] ? `${lx[i].name} × ${lx[i].qty} = ${lx[i].amountTotal}` : "—"
      const s2 = ly[i] ? `${ly[i].name} × ${ly[i].qty} = ${ly[i].amountTotal}` : "—"
      if (s1 !== s2) out.push({ field: `строка ${i + 1}`, before: s1, after: s2 })
    }
    setDiff(out)
  }
  return (
    <div className="space-y-4">
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Версии</h3>
        <table className="w-full text-xs">
          <tbody>
            {data.versions.map((v) => (
              <tr key={v.versionNo} className="border-b border-border last:border-0">
                <td className="py-1 pr-2">
                  <input type="checkbox" aria-label={`Сравнить версию ${v.versionNo}`} checked={a === v.versionNo || b === v.versionNo} onChange={(e) => (e.target.checked ? (a == null ? setA(v.versionNo) : setB(v.versionNo)) : a === v.versionNo ? setA(null) : setB(null))} />
                </td>
                <td className="py-1 pr-2 font-medium">v{v.versionNo}{v.locked && <Badge tone="success" className="ml-1">{v.lockedReason ?? "зафиксирована"}</Badge>}</td>
                <td className="py-1 pr-2">{v.reason ?? "—"}</td>
                <td className="py-1 pr-2 text-muted-foreground">{v.createdBy}</td>
                <td className="py-1 pr-2 text-muted-foreground">{fmtDateTime(v.createdAt)}</td>
                <td className="py-1 font-mono text-[10px] text-muted-foreground" title={`SHA-256 содержимого ${v.contentHash}`}>{v.contentHash.slice(0, 8)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.versions.length > 1 && <Button size="sm" className="mt-1" disabled={a == null || b == null} onClick={compare}>Сравнить выбранные</Button>}
        {diff && (
          <table className="mt-2 w-full text-xs">
            <tbody>
              {diff.length === 0 && <tr><td className="text-muted-foreground">Различий нет</td></tr>}
              {diff.map((r) => (
                <tr key={r.field} className="border-b border-border align-top">
                  <td className="py-1 pr-2 text-muted-foreground">{r.field}</td>
                  <td className="py-1 pr-2 line-through decoration-destructive/60">{r.before}</td>
                  <td className="py-1">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h3 className="mb-1 text-[13px] font-semibold">Журнал операций</h3>
        <ol className="space-y-1">
          {data.history.map((h) => (
            <li key={h.id} className="flex gap-2 text-xs">
              <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{fmtDateTime(h.createdAt)}</span>
              <span>
                <b className="font-medium">{h.label}</b>
                {h.actorName && <span className="text-muted-foreground"> · {h.actorName}</span>}
                {h.details?.comment && <span className="text-muted-foreground"> · «{h.details.comment}»</span>}
                {h.details?.to && h.action === "document.status" && <span className="text-muted-foreground"> → {STATUS_LABEL[h.details.to] ?? h.details.to}</span>}
                {h.details?.reason && <span className="text-muted-foreground"> · {h.details.reason}</span>}
                {h.details?.decision && <span className="text-muted-foreground"> · {h.details.step}: {DECISION[h.details.decision]}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function LinksTab({ data, run, busy }: { data: Detail; run: (a: string, b?: Record<string, unknown>, ok?: string) => Promise<unknown>; busy: string | null }) {
  return (
    <div className="space-y-4">
      {data.links.map((l) => (
        <section key={l.id} className="rounded-lg border border-border p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Warehouse className="size-4" />
            <span className="text-[13px] font-semibold">{l.system === "wms" ? "SCADA WMS" : l.system.toUpperCase()} · заказ на приход {l.objectId}</span>
            {l.status && <Badge tone={WMS_TONE[l.status] ?? "neutral"}>{WMS_STATUS_LABEL[l.status] ?? l.status}</Badge>}
            {l.url && <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ExternalLink className="size-3" /> Открыть в WMS</a>}
            {data.actions.some((a) => a.key === "wms_sync") && <Button size="sm" variant="ghost" busy={busy === "wms_sync"} icon={<RefreshCw className="size-3.5" />} onClick={() => void run("wms_sync", {}, "Статус обновлён")}>Обновить</Button>}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            Синхронизация: {l.syncedAt ? relTime(l.syncedAt) : "—"}
            {l.payload.postedAt && <> · проведено {fmtDateTime(l.payload.postedAt)}{l.payload.locationCode ? ` в ${l.payload.locationCode}` : ""}</>}
            {l.syncError && <span className="text-destructive"> · {l.syncError}</span>}
          </div>
          {Array.isArray(l.payload.comparison) && (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr><th className="font-medium">Номенклатура</th><th className="text-right font-medium">По документу</th><th className="text-right font-medium">Принято</th><th className="text-right font-medium">Разница</th></tr>
              </thead>
              <tbody>
                {l.payload.comparison.map((c: { itemCode: string; itemName: string; expected: number; received: number; diff: number }) => (
                  <tr key={c.itemCode} className="border-t border-border">
                    <td className="py-1"><span className="font-mono">{c.itemCode}</span> {c.itemName}</td>
                    <td className="py-1 text-right tabular-nums">{fmtQty(c.expected)}</td>
                    <td className="py-1 text-right tabular-nums">{fmtQty(c.received)}</td>
                    <td className={cn("py-1 text-right font-semibold tabular-nums", c.diff < 0 ? "text-destructive" : c.diff > 0 ? "text-[var(--warning)]" : "text-muted-foreground")}>{c.diff > 0 ? "+" : ""}{fmtQty(c.diff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!l.payload.comparison && l.status === "draft_created" && <p className="mt-1 text-xs text-muted-foreground">Ожидается приёмка складом на ТСД. Остатки WMS не меняются, пока склад не проведёт приёмку.</p>}
        </section>
      ))}
      {data.relations.length > 0 && (
        <section>
          <h3 className="mb-1 text-[13px] font-semibold">Связанные документы</h3>
          {data.relations.map((r) => (
            <Link key={`${r.kind}-${r.documentId}`} href={`/documents?id=${r.documentId}`} className="flex items-center gap-2 border-b border-border py-1.5 text-xs last:border-0 hover:underline">
              <Badge>{RELATION[r.kind] ?? r.kind}{r.dir === "in" ? " ←" : " →"}</Badge>
              <span className="truncate">{r.title}</span>
              <Badge tone={STATUS_TONE[r.status]} className="ml-auto">{STATUS_LABEL[r.status]}</Badge>
            </Link>
          ))}
        </section>
      )}
      {!data.links.length && !data.relations.length && <p className="text-[13px] text-muted-foreground">Связей нет. «Ещё → Связать документ» добавит основание или ответ.</p>}
    </div>
  )
}

function CommentsTab({ data, run }: { data: Detail; run: (a: string, b?: Record<string, unknown>, ok?: string) => Promise<unknown> }) {
  const [text, setText] = useState("")
  return (
    <div className="space-y-2">
      {data.comments.map((c) => (
        <div key={c.id} className="rounded-lg bg-muted px-2.5 py-1.5">
          <div className="text-[11px] text-muted-foreground">{c.authorName} · {fmtDateTime(c.createdAt)}</div>
          <p className="whitespace-pre-wrap text-[13px]">{c.body}</p>
        </div>
      ))}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          await run("comment", { body: text })
          setText("")
        }}
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Комментарий…" aria-label="Комментарий" />
        <Button type="submit" disabled={!text.trim()}>Отправить</Button>
      </form>
    </div>
  )
}

function DecisionDialog({ decision, label, onClose, onSubmit }: { decision: string; label: string; onClose: () => void; onSubmit: (comment: string) => Promise<void> }) {
  const [c, setC] = useState("")
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      title={label}
      onClose={onClose}
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant={decision === "reject" ? "danger" : "primary"} busy={busy} disabled={!c.trim()} onClick={async () => { setBusy(true); await onSubmit(c).finally(() => setBusy(false)) }}>{label}</Button></>}
    >
      <Field label="Причина" required>
        <Textarea autoFocus value={c} onChange={(e) => setC(e.target.value)} rows={4} onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && c.trim() && void onSubmit(c)} />
      </Field>
      <p className="mt-2 text-xs text-muted-foreground">Ctrl+Enter — отправить. Автор получит уведомление с этим комментарием.</p>
    </Modal>
  )
}

function ReasonDialog({ title, onClose, onSubmit }: { title: string; onClose: () => void; onSubmit: (r: string) => Promise<void> }) {
  const [r, setR] = useState("")
  return (
    <Modal title={title} onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" disabled={!r.trim()} onClick={() => void onSubmit(r)}>Подтвердить</Button></>}>
      <Field label="Причина" required><Input value={r} onChange={(e) => setR(e.target.value)} /></Field>
    </Modal>
  )
}

function StatusDialog({ to, onClose, onSubmit }: { to: string[]; onClose: () => void; onSubmit: (to: string, comment: string) => Promise<void> }) {
  const [v, setV] = useState(to[0] ?? "")
  const [c, setC] = useState("")
  return (
    <Modal title="Сменить статус" onClose={onClose} footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={() => void onSubmit(v, c)}>Сменить</Button></>}>
      <div className="space-y-3">
        <Field label="Новый статус">
          <Select value={v} onChange={(e) => setV(e.target.value)}>
            {to.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
          </Select>
        </Field>
        <Field label="Комментарий"><Input value={c} onChange={(e) => setC(e.target.value)} /></Field>
      </div>
    </Modal>
  )
}

function RelateDialog({ documentId, onClose, onDone }: { documentId: string; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("")
  const [kind, setKind] = useState("related")
  const { data } = useApi<{ rows: Array<{ documentId: string; title: string; status: string }> }>(q.trim().length >= 2 ? `/api/edi/documents?q=${encodeURIComponent(q)}&pageSize=10` : null, [q])
  return (
    <Modal title="Связать с документом" onClose={onClose}>
      <div className="space-y-2">
        <div className="flex gap-2">
          <Input autoFocus placeholder="Номер или название…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select className="w-44" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Вид связи">
            {Object.entries(RELATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        {data?.rows.filter((r) => r.documentId !== documentId).map((r) => (
          <button
            key={r.documentId}
            className="block w-full rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted"
            onClick={async () => {
              try {
                await api(`/api/edi/documents/${documentId}/action`, { method: "POST", json: { action: "relate", targetId: r.documentId, kind } })
                toast("Связь добавлена")
                onDone()
              } catch (e) {
                toast((e as Error).message, "error")
              }
            }}
          >
            {r.title} <span className="text-xs text-muted-foreground">· {STATUS_LABEL[r.status]}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function ShareDialog({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const { data } = useApi<{ users: Array<{ userId: string; name: string }> }>("/api/edi/users")
  const [userId, setUserId] = useState("")
  return (
    <Modal
      title="Дать доступ к документу"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!userId}
            onClick={async () => {
              try {
                await api(`/api/edi/documents/${documentId}/action`, { method: "POST", json: { action: "share", userId, access: "read" } })
                toast("Доступ выдан")
                onClose()
              } catch (e) {
                toast((e as Error).message, "error")
              }
            }}
          >
            Дать доступ
          </Button>
        </>
      }
    >
      <Field label="Сотрудник (доступ на просмотр, в т.ч. конфиденциального документа)">
        <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">—</option>
          {data?.users.map((u) => <option key={u.userId} value={u.userId}>{u.name}</option>)}
        </Select>
      </Field>
      <p className="mt-2 text-xs text-muted-foreground">Внешние получатели доступа не получают: обмен с контрагентами идёт только через оператора ЭДО.</p>
    </Modal>
  )
}
