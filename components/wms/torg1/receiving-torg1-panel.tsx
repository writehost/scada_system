"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import {
  Building2,
  ExternalLink,
  FilePenLine,
  FileSpreadsheet,
  Loader2,
  Lock,
  Printer,
  Save,
  Unlock,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Torg1Form } from "@/components/wms/torg1/torg1-form"
import { Torg1DocumentFieldsDialog } from "@/components/wms/torg1/torg1-document-fields-dialog"
import { Torg1GoodsScreenTable } from "@/components/wms/torg1/torg1-goods-screen-table"
import { Torg1PermanentDataDialog } from "@/components/wms/torg1/torg1-permanent-data-dialog"
import {
  fetchTorg1ExcelTemplateBytes,
  getDocumentTorg1,
  getSessionTorg1,
  getTorg1ExcelTemplateMeta,
  refreshReceivingTorg1Documents,
  saveDocumentTorg1,
  saveSessionTorg1,
  type WmsDocumentRow,
  type WmsTorg1Fields,
  type WmsTorg1FormRecord,
} from "@/lib/wms-api"
import { emptyTorg1Fields, type Torg1Fields } from "@/lib/wms/torg1"
import { downloadTorg1Excel, fillTorg1ExcelFromTemplateBytes } from "@/lib/wms/torg1-excel"
import { Torg1FieldsSummary } from "@/components/wms/torg1/torg1-fields-summary"
import { documentStatusLabelRU } from "@/lib/wms-labels"
import { cn } from "@/lib/utils"

const RECEIVING_SESSION_DOC_PREFIX = "receiving-session:"

function isSessionDoc(doc: WmsDocumentRow): boolean {
  return Boolean(doc.documentId?.startsWith(RECEIVING_SESSION_DOC_PREFIX))
}

function sessionIdOf(doc: WmsDocumentRow): string {
  return doc.documentId.slice(RECEIVING_SESSION_DOC_PREFIX.length)
}

function sessionHints(doc: WmsDocumentRow) {
  return {
    documentNo: doc.documentNo,
    composedAt: doc.receiptAt || doc.createdAt,
    locationCode: doc.targetLocationCode,
    comment: doc.comment,
    externalRef: doc.externalRef,
    warehouseCode: doc.targetWarehouseCode || doc.sourceWarehouseCode,
  }
}

function docRoute(doc: WmsDocumentRow): string {
  if (isSessionDoc(doc)) {
    return `/receiving/session/${encodeURIComponent(sessionIdOf(doc))}`
  }
  return `/documents/${encodeURIComponent(doc.documentId)}`
}

type Props = {
  doc: WmsDocumentRow
  className?: string
}

export function ReceivingTorg1Panel({ doc, className }: Props) {
  const [form, setForm] = useState<WmsTorg1FormRecord | null>(null)
  const [fields, setFields] = useState<Torg1Fields>(emptyTorg1Fields())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [locked, setLocked] = useState(true)
  const [permanentOpen, setPermanentOpen] = useState(false)
  const [allFieldsOpen, setAllFieldsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [hasCustomExcel, setHasCustomExcel] = useState(false)

  useEffect(() => {
    void getTorg1ExcelTemplateMeta()
      .then((m) => setHasCustomExcel(m.hasCustomTemplate))
      .catch(() => setHasCustomExcel(false))
  }, [])

  const loadFreshForm = useCallback(async (): Promise<Torg1Fields> => {
    const res = isSessionDoc(doc)
      ? await getSessionTorg1(sessionIdOf(doc), sessionHints(doc))
      : await getDocumentTorg1(doc.documentId)
    setForm(res.form)
    const next = res.form.fields as Torg1Fields
    setFields(next)
    setDirty(false)
    return next
  }, [doc])
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setSaveOk(null)
    setLocked(true)
    try {
      await loadFreshForm()
    } catch (e) {
      setForm(null)
      setError(e instanceof Error ? e.message : "Не удалось загрузить ТОРГ-1")
    } finally {
      setLoading(false)
    }
  }, [loadFreshForm])

  useEffect(() => {
    void load()
  }, [load])

  function onChange(next: Torg1Fields) {
    if (locked) return
    setFields(next)
    setDirty(true)
    setSaveOk(null)
  }

  function onResetField(key: keyof Torg1Fields) {
    if (locked || !form) return
    const auto = form.auto as Torg1Fields
    if (key === "lines") {
      onChange({ ...fields, lines: auto.lines.map((l) => ({ ...l })) })
      return
    }
    onChange({ ...fields, [key]: auto[key] })
  }

  async function onSave() {
    if (locked) return
    setSaving(true)
    setError(null)
    setSaveOk(null)
    try {
      const res = isSessionDoc(doc)
        ? await saveSessionTorg1(sessionIdOf(doc), fields as WmsTorg1Fields, sessionHints(doc))
        : await saveDocumentTorg1(doc.documentId, fields as WmsTorg1Fields, form?.title)
      setForm(res.form)
      setFields(res.form.fields as Torg1Fields)
      setDirty(false)
      setLocked(true)
      setSaveOk("Сохранено и закрыто")
      window.setTimeout(() => setSaveOk(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function onSaveAllFields(nextFields: Torg1Fields) {
    setSaving(true)
    setError(null)
    setSaveOk(null)
    try {
      const res = isSessionDoc(doc)
        ? await saveSessionTorg1(
            sessionIdOf(doc),
            nextFields as WmsTorg1Fields,
            sessionHints(doc)
          )
        : await saveDocumentTorg1(
            doc.documentId,
            nextFields as WmsTorg1Fields,
            form?.title
          )
      setForm(res.form)
      setFields(res.form.fields as Torg1Fields)
      setDirty(false)
      setLocked(true)
      setSaveOk("Все поля документа сохранены")
      window.setTimeout(() => setSaveOk(null), 5000)
    } catch (cause) {
      const saveError =
        cause instanceof Error ? cause : new Error("Не удалось сохранить поля документа")
      setError(saveError.message)
      throw saveError
    } finally {
      setSaving(false)
    }
  }

  function onPrint() {
    if (typeof document === "undefined") return
    const root = document.documentElement
    const cleanup = () => {
      root.classList.remove("torg1-printing")
      window.removeEventListener("afterprint", cleanup)
    }
    root.classList.add("torg1-printing")
    window.addEventListener("afterprint", cleanup, { once: true })
    window.setTimeout(cleanup, 60_000)
    requestAnimationFrame(() => window.print())
  }

  function toggleLock() {
    setLocked((prev) => !prev)
    setSaveOk(null)
  }

  async function exportExcelWithFields(nextFields: Torg1Fields) {
    const name = `TORG-1_${doc.documentNo || doc.documentId || "document"}`
    const bytes = await fetchTorg1ExcelTemplateBytes({ documentType: "receiving" })
    if (bytes) {
      await fillTorg1ExcelFromTemplateBytes(bytes, nextFields, name)
    } else {
      downloadTorg1Excel(nextFields, name)
    }
  }

  /** Главное действие: пересчитать поля + скачать Excel с вашим шаблоном. */
  async function onApplyTemplateExcel() {
    setRefreshing(true)
    setError(null)
    setSaveOk(null)
    try {
      const refreshResult = await refreshReceivingTorg1Documents(
        isSessionDoc(doc)
          ? {
              mode: "full_reset",
              sessions: [{ sessionId: sessionIdOf(doc), hints: sessionHints(doc) }],
            }
          : { mode: "full_reset", documentIds: [doc.documentId] }
      )
      if (refreshResult.errors.length > 0) {
        const first = refreshResult.errors[0]
        throw new Error(`Не удалось обновить документ: ${first.message}`)
      }
      if (refreshResult.totalUpdated !== 1) {
        throw new Error("Документ не был обновлён")
      }
      const fresh = await loadFreshForm()
      await exportExcelWithFields(fresh)
      setSaveOk(
        hasCustomExcel
          ? `Готово: в Excel добавлено ${fresh.lines.length} наименований`
          : `Готово: добавлено ${fresh.lines.length} наименований (использован стартовый шаблон)`
      )
      window.setTimeout(() => setSaveOk(null), 8000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось применить шаблон")
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <aside
      id="torg1-print-area"
      className={cn(
        "flex max-h-[min(78vh,900px)] flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm",
        className
      )}
    >
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 print:hidden">
        <div className="min-w-0 truncate font-semibold">ТОРГ-1 · {doc.documentNo || doc.documentId}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className={cn(
              "rounded-lg border",
              locked
                ? "border-amber-500/30 bg-amber-500/10 text-amber-900"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-900"
            )}
          >
            {locked ? (
              <>
                <Lock className="mr-1 h-3 w-3" />
                Закрыт
              </>
            ) : (
              <>
                <Unlock className="mr-1 h-3 w-3" />
                Открыт
              </>
            )}
          </Badge>
          <Badge variant="secondary" className="rounded-lg border">
            {documentStatusLabelRU(doc.documentStatus)}
          </Badge>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 print:hidden">
        <Button
          type="button"
          size="sm"
          className="rounded-xl"
          onClick={() => setAllFieldsOpen(true)}
          disabled={loading || !form}
        >
          <FilePenLine className="mr-1.5 h-4 w-4" />
          Все поля документа
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-xl"
          onClick={() => setPermanentOpen(true)}
          disabled={loading}
        >
          <Building2 className="mr-1.5 h-4 w-4" />
          Постоянные данные
        </Button>
        <Button
          type="button"
          size="sm"
          variant={locked ? "default" : "outline"}
          className="rounded-xl px-2.5"
          onClick={toggleLock}
          disabled={loading}
          title={locked ? "Разблокировать переменные" : "Заблокировать"}
          aria-label={locked ? "Разблокировать переменные" : "Заблокировать"}
        >
          {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-xl"
          onClick={() => void onSave()}
          disabled={locked || saving || loading || !dirty}
        >
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          Сохранить
        </Button>
        <Button
          type="button"
          size="sm"
          className="rounded-xl"
          onClick={() => void onApplyTemplateExcel()}
          disabled={loading || refreshing}
        >
          {refreshing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-1.5 h-4 w-4" />
          )}
          Сформировать Excel
        </Button>
        <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={onPrint} disabled={loading}>
          <Printer className="mr-1.5 h-4 w-4" />
          Печать
        </Button>
        <Button type="button" size="sm" variant="outline" className="rounded-xl" asChild>
          <Link href={docRoute(doc)}>
            <ExternalLink className="mr-1.5 h-4 w-4" />
            {isSessionDoc(doc) ? "Сессия" : "Карточка"}
          </Link>
        </Button>
      </div>

      {dirty && !locked ? (
        <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 print:hidden">
          Есть несохранённые изменения
        </div>
      ) : null}
      {saveOk ? (
        <div className="shrink-0 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-xs font-medium text-emerald-900 print:hidden">
          {saveOk}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto p-3 print:overflow-visible print:p-0">
        {loading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка бланка ТОРГ-1…
          </div>
        ) : error ? (
          <div className="space-y-2 p-3">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
            <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={() => void load()}>
              Повторить
            </Button>
          </div>
        ) : form ? (
          <>
            {!hasCustomExcel ? (
              <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-950 print:hidden">
                Excel-шаблон не загружен.{" "}
                <Link href="/settings" className="font-medium underline">
                  Настройки → ТОРГ-1
                </Link>
              </div>
            ) : null}
            <Torg1FieldsSummary fields={fields} />
            <Torg1GoodsScreenTable
              fields={fields}
              readOnly={locked}
              onChange={onChange}
              onReset={locked ? undefined : () => onResetField("lines")}
            />
            <Torg1Form
              fields={fields}
              auto={form.auto as Torg1Fields}
              readOnly={locked}
              lockPermanentFields
              blankMode="always"
              className="hidden print:block"
              onChange={onChange}
              onResetField={locked ? undefined : onResetField}
            />
          </>
        ) : null}
      </div>

      <Torg1PermanentDataDialog
        open={permanentOpen}
        onOpenChange={setPermanentOpen}
        onSaved={() => void load()}
      />
      {form ? (
        <Torg1DocumentFieldsDialog
          open={allFieldsOpen}
          onOpenChange={setAllFieldsOpen}
          documentLabel={doc.documentNo || doc.documentId}
          fields={fields}
          auto={form.auto as Torg1Fields}
          onSave={onSaveAllFields}
        />
      ) : null}
    </aside>
  )
}
