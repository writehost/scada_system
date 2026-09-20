"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Ban,
  Check,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  ShieldAlert,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  getCurrentAuthUser,
  listLocations,
  listRevisionExpiryCandidates,
  postRevisionCount,
  postStockTransfer,
  type RevisionExpiryCandidateRow,
  type WmsLocationRow,
} from "@/lib/wms-api"
import { cn } from "@/lib/utils"

type Priority = RevisionExpiryCandidateRow["revisionPriority"]
type MoveKind = "quarantine" | "defect"
type DialogMode = MoveKind | "count" | null

function fmtQty(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—"
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(n)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "нет даты"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "нет даты"
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })
}

function priorityLabel(p: Priority) {
  if (p === "expired") return "Просрочено"
  if (p === "critical") return "До 7 дней"
  if (p === "warning") return "В горизонте"
  if (p === "no_date") return "Нет даты"
  return "Контроль"
}

function isSpecialZone(code: string | undefined, kind: MoveKind) {
  const z = (code ?? "").trim().toUpperCase()
  if (kind === "quarantine") return z === "QUARANTINE"
  return z === "DEFECT"
}

function pickDefaultCell(cells: WmsLocationRow[]): string {
  if (cells.length === 0) return ""
  const empty = cells.find((c) => Number(c.availableQty || 0) <= 0 && Number(c.skuCount || 0) <= 0)
  return (empty ?? cells[0]).locationCode
}

function actorName(user: { fio?: string; displayName?: string; login?: string } | null): string {
  return (user?.fio || user?.displayName || user?.login || "ревизия").trim()
}

export default function RevisionPage() {
  const [rows, setRows] = useState<RevisionExpiryCandidateRow[]>([])
  const [query, setQuery] = useState("")
  const [horizonDays, setHorizonDays] = useState(45)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [quarantineCells, setQuarantineCells] = useState<WmsLocationRow[]>([])
  const [defectCells, setDefectCells] = useState<WmsLocationRow[]>([])
  const [checkedBy, setCheckedBy] = useState("ревизия")

  const [dialog, setDialog] = useState<DialogMode>(null)
  const [active, setActive] = useState<RevisionExpiryCandidateRow | null>(null)
  const [targetCode, setTargetCode] = useState("")
  const [qty, setQty] = useState("")
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)

  async function load(nextQuery = query, nextHorizon = horizonDays) {
    setLoading(true)
    setError(null)
    try {
      const data = await listRevisionExpiryCandidates({
        query: nextQuery,
        horizonDays: nextHorizon,
      })
      setRows(data.rows ?? [])
    } catch (e) {
      setRows([])
      setError(e instanceof Error ? e.message : "Не удалось загрузить ревизию")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load("", horizonDays)
    void listLocations({ zoneCode: "QUARANTINE", limit: 50, lite: true })
      .then((res) => setQuarantineCells(res.locations ?? []))
      .catch(() => setQuarantineCells([]))
    void listLocations({ zoneCode: "DEFECT", limit: 50, lite: true })
      .then((res) => setDefectCells(res.locations ?? []))
      .catch(() => setDefectCells([]))
    void getCurrentAuthUser()
      .then((res) => setCheckedBy(actorName(res.user)))
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grouped = useMemo(() => {
    const order: Priority[] = ["expired", "critical", "warning", "no_date", "ok"]
    return order
      .map((key) => ({ key, rows: rows.filter((row) => row.revisionPriority === key) }))
      .filter((g) => g.rows.length > 0)
  }, [rows])

  const cellsFor = dialog === "defect" ? defectCells : quarantineCells
  const fallbackTarget = dialog === "defect" ? "DEF-01" : "QUAR-01"

  function openMove(row: RevisionExpiryCandidateRow, kind: MoveKind) {
    const cells = kind === "defect" ? defectCells : quarantineCells
    setActive(row)
    setDialog(kind)
    setQty(String(row.availableQty || ""))
    setTargetCode(pickDefaultCell(cells) || (kind === "defect" ? "DEF-01" : "QUAR-01"))
    setComment(kind === "defect" ? "Ревизия: выявлен брак" : "Ревизия: перемещение в карантин")
    setDialogError(null)
    setNotice(null)
  }

  function openCount(row: RevisionExpiryCandidateRow) {
    setActive(row)
    setDialog("count")
    setQty(String(row.availableQty || ""))
    setComment("")
    setDialogError(null)
    setNotice(null)
  }

  function closeDialog() {
    if (busy) return
    setDialog(null)
    setActive(null)
    setDialogError(null)
  }

  async function submitMove() {
    if (!active || (dialog !== "quarantine" && dialog !== "defect")) return
    const amount = Number(qty)
    const to = targetCode.trim() || fallbackTarget
    if (!Number.isFinite(amount) || amount <= 0) {
      setDialogError("Укажите количество")
      return
    }
    if (amount - active.availableQty > 1e-9) {
      setDialogError(`Нельзя переместить больше ${fmtQty(active.availableQty)}`)
      return
    }
    if (!to || to === active.locationCode) {
      setDialogError("Выберите другую ячейку назначения")
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      const result = await postStockTransfer({
        itemCode: active.itemCode,
        fromLocationCode: active.locationCode,
        toLocationCode: to,
        qty: amount,
        lotCode: active.lotCode || undefined,
      })
      const label = dialog === "defect" ? "брака" : "карантина"
      setNotice(
        `${active.itemName} · ${fmtQty(amount)} → ${to} (${label})${
          result.documentId ? ` · док. ${result.documentId}` : ""
        }`
      )
      setDialog(null)
      setActive(null)
      await load()
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : "Не удалось переместить")
    } finally {
      setBusy(false)
    }
  }

  async function submitCount() {
    if (!active || dialog !== "count") return
    const amount = Number(qty)
    if (!Number.isFinite(amount) || amount < 0) {
      setDialogError("Укажите фактическое количество")
      return
    }
    setBusy(true)
    setDialogError(null)
    try {
      const result = await postRevisionCount({
        locationCode: active.locationCode,
        checkedBy,
        comment: comment || `Ревизия партии ${active.lotCode}`,
        lines: [{ itemCode: active.itemCode, actualQty: amount }],
      })
      setNotice(
        `Остаток зафиксирован · ${active.locationCode} · факт ${fmtQty(amount)}${
          result.documentId ? ` · док. ${result.documentId}` : ""
        }`
      )
      setDialog(null)
      setActive(null)
      await load()
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : "Не удалось зафиксировать ревизию")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-foreground">Ревизия</h1>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
            Перемещение в карантин или брак, фиксация фактического остатка.
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 rounded-lg" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
          Обновить
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load()
            }}
            placeholder="Номенклатура, партия или ячейка"
            className="h-9 rounded-lg pl-8"
          />
        </div>
        <Input
          value={horizonDays}
          onChange={(e) => setHorizonDays(Number(e.target.value) || 45)}
          type="number"
          min={1}
          max={365}
          className="h-9 w-full rounded-lg sm:w-28"
          aria-label="Горизонт дней"
        />
        <Button className="h-9 rounded-lg" onClick={() => void load()} disabled={loading}>
          Показать
        </Button>
      </div>

      {notice ? (
        <div className="rounded-lg border border-emerald-600/20 bg-emerald-50/80 px-3 py-2 text-[13px] text-emerald-900">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-600/20 bg-red-50/80 px-3 py-2 text-[13px] text-red-900">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-6 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загружаю позиции на ревизию…
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-10 text-center">
          <div className="text-[15px] font-semibold">Нет партий на ревизию</div>
          <p className="mt-1 text-[13px] text-muted-foreground">
            В выбранном горизонте нет скоропорта или FEFO с остатком.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map((group) => (
            <section key={group.key}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {priorityLabel(group.key)}
                </h2>
                <span className="text-[12px] text-muted-foreground">{group.rows.length}</span>
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                {group.rows.map((row) => {
                  const inQuarantine = isSpecialZone(row.zoneCode, "quarantine")
                  const inDefect = isSpecialZone(row.zoneCode, "defect")
                  const expired = row.revisionPriority === "expired"
                  return (
                    <article
                      key={`${row.locationCode}-${row.lotId}`}
                      className={cn(
                        "grid gap-2 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start",
                        expired && "bg-red-50/40"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold leading-snug text-foreground">
                          {row.itemName}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] leading-5 text-muted-foreground">
                          <span className="font-mono text-foreground/80">{row.itemCode}</span>
                          <span>{row.groupName}</span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {row.locationCode}
                          </span>
                          <span className="break-all font-mono">{row.lotCode}</span>
                          <span>остаток {fmtQty(row.availableQty)}</span>
                          <span className={cn(expired && "font-semibold text-red-800")}>
                            {expired && row.daysLeft != null
                              ? `просрочен ${Math.abs(row.daysLeft)} дн.`
                              : row.daysLeft == null
                                ? "срок не указан"
                                : `${row.daysLeft} дн. · до ${fmtDate(row.expiryAt)}`}
                            {expired ? ` · до ${fmtDate(row.expiryAt)}` : ""}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end lg:pt-0.5">
                        {!inQuarantine ? (
                          <Button
                            size="sm"
                            variant={expired ? "outline" : "default"}
                            className="h-8 rounded-lg"
                            onClick={() => openMove(row, "quarantine")}
                          >
                            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                            В карантин
                          </Button>
                        ) : (
                          <span className="px-1 text-[11px] text-amber-800">уже в карантине</span>
                        )}
                        {!inDefect ? (
                          <Button
                            size="sm"
                            variant={expired ? "destructive" : "outline"}
                            className="h-8 rounded-lg"
                            onClick={() => openMove(row, "defect")}
                          >
                            <Ban className="mr-1.5 h-3.5 w-3.5" />
                            В брак
                          </Button>
                        ) : (
                          <span className="px-1 text-[11px] text-red-800">уже в браке</span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 rounded-lg"
                          onClick={() => openCount(row)}
                        >
                          <Check className="mr-1.5 h-3.5 w-3.5" />
                          Факт
                        </Button>
                        <Button asChild size="sm" variant="ghost" className="h-8 rounded-lg text-muted-foreground">
                          <Link href={`/nomenclature/${encodeURIComponent(row.itemCode)}`}>Карточка</Link>
                        </Button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={dialog != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="gap-0 overflow-hidden rounded-[10px] p-0 sm:max-w-[480px]">
          <DialogHeader className="space-y-1 border-b border-border px-5 py-3">
            <DialogTitle className="text-[16px] font-semibold">
              {dialog === "defect"
                ? "В ячейку брака"
                : dialog === "quarantine"
                  ? "В ячейку карантина"
                  : "Зафиксировать остаток"}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              {active ? `${active.itemName} · ${active.locationCode}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 px-5 py-3">
            {dialogError ? (
              <div className="rounded-lg border border-red-600/20 bg-red-50/80 px-3 py-2 text-[13px] text-red-900">
                {dialogError}
              </div>
            ) : null}

            {dialog === "count" ? (
              <>
                <p className="text-[13px] text-muted-foreground">
                  Учтено {fmtQty(active?.availableQty)} · партия {active?.lotCode || "—"}
                </p>
                <div>
                  <Label className="text-[12px] text-muted-foreground">Фактическое количество</Label>
                  <Input
                    className="mt-1 h-9 rounded-lg"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label className="text-[12px] text-muted-foreground">Комментарий</Label>
                  <Input
                    className="mt-1 h-9 rounded-lg"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Расхождение, осмотр, замечание"
                  />
                </div>
              </>
            ) : (
              <>
                {dialog === "defect" ? (
                  <p className="rounded-lg border border-red-600/15 bg-red-50/70 px-3 py-2 text-[13px] text-red-900">
                    Партия уйдёт в зону DEFECT и больше не будет доступна к выдаче.
                  </p>
                ) : (
                  <p className="rounded-lg border border-amber-500/20 bg-amber-50/70 px-3 py-2 text-[13px] text-amber-950">
                    Партия уйдёт в зону QUARANTINE на проверку качества.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div>
                    <div className="text-[12px] text-muted-foreground">Откуда</div>
                    <div className="font-mono">{active?.locationCode}</div>
                  </div>
                  <div>
                    <div className="text-[12px] text-muted-foreground">Партия</div>
                    <div className="truncate font-mono">{active?.lotCode}</div>
                  </div>
                </div>
                <div>
                  <Label className="text-[12px] text-muted-foreground">Ячейка назначения</Label>
                  {cellsFor.length > 0 ? (
                    <Select value={targetCode} onValueChange={setTargetCode}>
                      <SelectTrigger className="mt-1 h-9 rounded-lg">
                        <SelectValue placeholder="Выберите ячейку" />
                      </SelectTrigger>
                      <SelectContent>
                        {cellsFor.map((cell) => (
                          <SelectItem key={cell.locationCode} value={cell.locationCode}>
                            {cell.locationCode}
                            {cell.displayName ? ` · ${cell.displayName}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="mt-1 h-9 rounded-lg font-mono"
                      value={targetCode}
                      onChange={(e) => setTargetCode(e.target.value)}
                    />
                  )}
                </div>
                <div>
                  <Label className="text-[12px] text-muted-foreground">Количество</Label>
                  <Input
                    className="mt-1 h-9 rounded-lg"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    inputMode="decimal"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="border-t border-border px-5 py-2.5 sm:space-x-2">
            <Button variant="outline" className="h-8 rounded-lg" onClick={closeDialog} disabled={busy}>
              Отмена
            </Button>
            <Button
              className="h-8 rounded-lg"
              variant={dialog === "defect" ? "destructive" : "default"}
              onClick={() => void (dialog === "count" ? submitCount() : submitMove())}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {dialog === "count" ? "Зафиксировать" : "Переместить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
