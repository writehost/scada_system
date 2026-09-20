"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ExternalLink, Trash2 } from "lucide-react"
import { ReceivingItemName } from "@/components/wms/receiving-item-name"
import { MarkingCodeHover } from "@/components/wms/marking-code-hover"
import { formatEmissionDate } from "@/components/wms/sticker-status-badge"
import {
  isReceivingScanBlocked,
  ReceivingScanStatusCell,
} from "@/components/wms/receiving-scan-hint"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function formatScanDeviceUid(uid: string | null | undefined): string {
  const v = uid?.trim()
  if (!v) return "—"
  if (v.toLowerCase() === "web-operator") return "Веб"
  return v
}

export type ReceivingScanEventRow = {
  id: string
  createdAt: string
  scannedAtIso: string | null
  deviceUid: string | null
  code: string
  documentId: string | null
  itemCode: string | null
  itemName: string | null
  qty: number | null
  note: string | null
  stickerStatus: string | null
  itemStatus: string | null
  emissionAtIso: string | null
  expiryState: string | null
}

function fmtTs(v: string | null | undefined) {
  if (!v) return "—"
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "medium" })
}

const qtyFormatter = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 })

function fmtQtyCell(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return qtyFormatter.format(n)
}

function parseQtyDraft(raw: string): number | null {
  const normalized = raw.replace(/\s/g, "").replace(",", ".")
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  if (parsed > 99_999_999_999) return null
  return parsed
}

function rowTone(row: ReceivingScanEventRow): string {
  if (row.expiryState === "expired" || row.itemStatus === "просрочен") {
    return "bg-red-500/5"
  }
  if (row.expiryState === "warning" || row.itemStatus === "истекает") {
    return "bg-amber-500/5"
  }
  return ""
}

function ReceivingQtyCell({
  row,
  editable,
  saving,
  onSave,
}: {
  row: ReceivingScanEventRow
  editable: boolean
  saving: boolean
  onSave?: (row: ReceivingScanEventRow, qty: number) => void | Promise<void>
}) {
  const [draft, setDraft] = useState(fmtQtyCell(row.qty ?? 1))
  const [pendingQty, setPendingQty] = useState<number | null>(null)

  useEffect(() => {
    setDraft(fmtQtyCell(row.qty ?? 1))
  }, [row.id, row.qty])

  if (!editable || !onSave) {
    return <span className="tabular-nums">{fmtQtyCell(row.qty ?? 1)}</span>
  }

  function parseDraft(): number | null {
    return parseQtyDraft(draft)
  }

  function requestCommit() {
    const parsed = parseDraft()
    if (parsed == null) {
      setDraft(fmtQtyCell(row.qty ?? 1))
      return
    }
    if (parsed === (row.qty ?? 1)) return
    setPendingQty(parsed)
  }

  async function confirmQtyChange() {
    if (pendingQty == null || !onSave) return
    await onSave(row, pendingQty)
    setPendingQty(null)
  }

  function cancelQtyChange() {
    setPendingQty(null)
    setDraft(fmtQtyCell(row.qty ?? 1))
  }

  const inputWidthCh = Math.min(14, Math.max(7, draft.replace(/\s/g, "").length + 1))

  return (
    <>
      <Input
        type="text"
        inputMode="numeric"
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => requestCommit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            requestCommit()
          }
          if (e.key === "Escape") {
            setDraft(fmtQtyCell(row.qty ?? 1))
          }
        }}
        className="h-8 min-w-[5.5rem] max-w-[12rem] rounded-lg tabular-nums"
        style={{ width: `${inputWidthCh}ch` }}
        aria-label="Количество"
        title="Количество (можно вводить миллионы, пробелы необязательны)"
      />
      <AlertDialog
        open={pendingQty != null}
        onOpenChange={(open) => {
          if (!open) cancelQtyChange()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Изменить количество?</AlertDialogTitle>
            <AlertDialogDescription>
              Скорректировать кол-во с <strong>{fmtQtyCell(row.qty ?? 1)}</strong> на{" "}
              <strong>{fmtQtyCell(pendingQty)}</strong>?
              {row.itemName ? (
                <>
                  {" "}
                  Позиция: {row.itemName}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelQtyChange}>Отмена</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void confirmQtyChange()}>
              {saving ? "Сохранение…" : "Подтвердить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function ReceivingScanEventsTable({
  rows,
  loading,
  emptyText = "Пока нет входящих сканов",
  onDelete,
  deletingId,
  editableQty = false,
  onQtySave,
  savingQtyId,
  hideDocumentColumn = false,
  hideDeviceColumn = false,
  hideEmissionColumn = false,
  hideCodeColumn = false,
  variant = "full",
  bare = false,
}: {
  rows: ReceivingScanEventRow[]
  loading?: boolean
  emptyText?: string
  onDelete?: (row: ReceivingScanEventRow) => void | Promise<void>
  deletingId?: string | null
  editableQty?: boolean
  onQtySave?: (row: ReceivingScanEventRow, qty: number) => void | Promise<void>
  savingQtyId?: string | null
  /** На странице сессии колонка «Документ» не нужна — id уже в заголовке */
  hideDocumentColumn?: boolean
  hideDeviceColumn?: boolean
  hideEmissionColumn?: boolean
  hideCodeColumn?: boolean
  /** full — все колонки; compact — для списка проблем на приёмке */
  variant?: "full" | "compact"
  /** Таблица вставлена в готовую панель — своя рамка не нужна. */
  bare?: boolean
}) {
  const [confirmRow, setConfirmRow] = useState<ReceivingScanEventRow | null>(null)

  async function confirmDelete() {
    if (!confirmRow || !onDelete) return
    await onDelete(confirmRow)
    setConfirmRow(null)
  }

  const compact = variant === "compact"
  const showDevice = !hideDeviceColumn && !compact
  const showCode = !hideCodeColumn && !compact
  const showEmission = !hideEmissionColumn && !compact
  const showDocument = !hideDocumentColumn

  const colSpan =
    3 +
    (showDevice ? 1 : 0) +
    (showCode ? 1 : 0) +
    (showEmission ? 1 : 0) +
    1 +
    (showDocument ? 1 : 0) +
    (onDelete ? 1 : 0)

  return (
    <>
      <div className={cn("overflow-auto", bare ? "" : "rounded-xl border border-border/60")}>
        <table
          className={cn(
            "w-full text-sm",
            compact ? "min-w-[720px]" : "min-w-[800px]"
          )}
        >
          <thead className="bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-medium">Время</th>
              {showDevice ? <th className="px-3 py-2.5 font-medium">ТСД</th> : null}
              {showCode ? <th className="px-3 py-2.5 font-medium">Код</th> : null}
              <th className="min-w-[min(280px,40vw)] px-3 py-2.5 font-medium">Номенклатура</th>
              <th className="min-w-[5.5rem] px-3 py-2.5 font-medium">Кол-во</th>
              {showEmission ? <th className="whitespace-nowrap px-3 py-2.5 font-medium">Эмиссия</th> : null}
              <th className="min-w-[120px] px-3 py-2.5 font-medium">Статус</th>
              {showDocument ? <th className="px-3 py-2.5 font-medium">Документ</th> : null}
              {onDelete ? <th className="w-10 px-2 py-2.5" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const blocked = isReceivingScanBlocked(r)
              return (
                <tr key={r.id} className={cn("border-t border-border/60 group align-top", rowTone(r))}>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {fmtTs(r.scannedAtIso || r.createdAt)}
                  </td>
                  {showDevice ? (
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatScanDeviceUid(r.deviceUid)}</td>
                  ) : null}
                  {showCode ? (
                    <td className="px-3 py-2.5">
                      <MarkingCodeHover code={r.code} />
                    </td>
                  ) : null}
                  <td className="min-w-[min(280px,40vw)] px-3 py-2.5">
                    <ReceivingItemName name={r.itemName} className="font-medium text-foreground" />
                    {r.itemCode ? (
                      <div className="mt-1 text-xs text-muted-foreground">GTIN {r.itemCode}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5">
                    <ReceivingQtyCell
                      row={r}
                      editable={editableQty}
                      saving={savingQtyId === r.id}
                      onSave={onQtySave}
                    />
                  </td>
                  {showEmission ? (
                    <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                      {formatEmissionDate(r.emissionAtIso)}
                    </td>
                  ) : null}
                  <td className="px-3 py-2.5">
                    <ReceivingScanStatusCell row={r} />
                  </td>
                  {showDocument ? (
                    <td className="px-3 py-2.5">
                      {r.documentId ? (
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className={cn(
                            "h-8 rounded-lg px-2.5 text-xs font-mono font-semibold",
                            blocked && "border-red-500/50 text-red-700 hover:bg-red-500/5"
                          )}
                        >
                          <Link href={`/receiving/session/${encodeURIComponent(r.documentId)}`}>
                            {compact ? r.documentId.toUpperCase() : r.documentId}
                            {!compact ? <ExternalLink className="ml-1.5 h-3 w-3 opacity-60" /> : null}
                          </Link>
                        </Button>
                    ) : (
                      "—"
                    )}
                  </td>
                  ) : null}
                  {onDelete ? (
                    <td className="px-2 py-2.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-lg text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                        disabled={deletingId === r.id}
                        onClick={() => setConfirmRow(r)}
                        title="Удалить скан"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-3 py-6 text-center text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <AlertDialog open={confirmRow != null} onOpenChange={(open) => !open && setConfirmRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить скан?</AlertDialogTitle>
            <AlertDialogDescription>
              Код{" "}
              <span className="font-mono text-xs">{confirmRow?.code.slice(0, 48)}</span>
              {confirmRow?.code && confirmRow.code.length > 48 ? "…" : ""} будет убран из потока приёмки.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void confirmDelete()}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
