"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import {
  importSkitProductionPlans,
  listItems,
  resolveSkitProductLabels,
  type SkitLabelMatch,
  type SkitPlanImportResultRow,
} from "@/lib/wms-api"
import {
  parseSkitProductionWorkbook,
  type SkitImportMode,
  type SkitWorkbookParseResult,
  type SkitWorkbookPlanRow,
} from "@/lib/wms/skit-production-workbook"
import { formatApsPlanQty } from "@/lib/wms/production-gantt-mapper"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: () => void
  defaultMonthKey?: string
}

type LabelMappingState = Record<string, string>

function monthKeyFromSheetName(name: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(name.trim())
  if (!m) return null
  return `${m[3]}-${m[2]}`
}

function filterRowsForMonth(rows: SkitWorkbookPlanRow[], monthKey: string | undefined): SkitWorkbookPlanRow[] {
  if (!monthKey) return rows
  return rows.filter((r) => r.sheetMonth === monthKey)
}

export function SkitProductionImportDialog({ open, onOpenChange, onImported, defaultMonthKey }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<SkitImportMode>("daily")
  const [fileName, setFileName] = useState("")
  const [parseResult, setParseResult] = useState<SkitWorkbookParseResult | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<string | "all">(defaultMonthKey ?? "all")
  const [autoMatches, setAutoMatches] = useState<Record<string, SkitLabelMatch | null>>({})
  const [overrides, setOverrides] = useState<LabelMappingState>({})
  const [parsing, setParsing] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [importResults, setImportResults] = useState<SkitPlanImportResultRow[] | null>(null)

  const monthOptions = useMemo(() => {
    if (!parseResult) return []
    const keys = [...new Set(parseResult.sheetNames.map(monthKeyFromSheetName).filter(Boolean) as string[])].sort()
    return keys
  }, [parseResult])

  const activeRows = useMemo(() => {
    if (!parseResult) return []
    const monthKey = selectedMonth === "all" ? undefined : selectedMonth
    return filterRowsForMonth(parseResult.rows, monthKey)
  }, [parseResult, selectedMonth])

  const uniqueLabels = useMemo(() => {
    return [...new Set(activeRows.map((r) => r.productLabel))].sort((a, b) => a.localeCompare(b, "ru"))
  }, [activeRows])

  const previewStats = useMemo(() => {
    const qty = activeRows.reduce((s, r) => s + r.plannedQty, 0)
    const dates = new Set(activeRows.map((r) => r.planDate))
    return { rows: activeRows.length, qty, dates: dates.size, products: uniqueLabels.length }
  }, [activeRows, uniqueLabels.length])

  const reset = useCallback(() => {
    setFileName("")
    setParseResult(null)
    setAutoMatches({})
    setOverrides({})
    setError(null)
    setImportResults(null)
    setSelectedMonth(defaultMonthKey ?? "all")
    if (fileRef.current) fileRef.current.value = ""
  }, [defaultMonthKey])

  const handleClose = useCallback(
    (next: boolean) => {
      if (!next) reset()
      onOpenChange(next)
    },
    [onOpenChange, reset]
  )

  const resolveLabels = useCallback(async (labels: string[]) => {
    if (labels.length === 0) {
      setAutoMatches({})
      return
    }
    setResolving(true)
    setError(null)
    try {
      const res = await resolveSkitProductLabels(labels)
      setAutoMatches(res.matches)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сопоставить номенклатуру")
    } finally {
      setResolving(false)
    }
  }, [])

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      setParsing(true)
      setError(null)
      setImportResults(null)
      setFileName(file.name)
      try {
        const buffer = await file.arrayBuffer()
        const parsed = parseSkitProductionWorkbook(buffer, { mode })
        setParseResult(parsed)
        const monthKey = defaultMonthKey && parsed.rows.some((r) => r.sheetMonth === defaultMonthKey)
          ? defaultMonthKey
          : parsed.parsedSheets.length
            ? monthKeyFromSheetName(parsed.parsedSheets[0]!) ?? "all"
            : "all"
        setSelectedMonth(monthKey)
        const rowsForResolve =
          monthKey === "all" ? parsed.rows : parsed.rows.filter((r) => r.sheetMonth === monthKey)
        const labels = [...new Set(rowsForResolve.map((r) => r.productLabel))]
        await resolveLabels(labels)
      } catch (e) {
        setParseResult(null)
        setError(e instanceof Error ? e.message : "Не удалось прочитать файл")
      } finally {
        setParsing(false)
      }
    },
    [defaultMonthKey, mode, resolveLabels]
  )

  const handleModeChange = useCallback(
    async (next: SkitImportMode) => {
      setMode(next)
      if (!fileRef.current?.files?.[0]) return
      await handleFile(fileRef.current.files[0])
    },
    [handleFile]
  )

  const handleMonthChange = useCallback(
    async (month: string) => {
      setSelectedMonth(month)
      setImportResults(null)
      const labels =
        month === "all"
          ? [...new Set((parseResult?.rows ?? []).map((r) => r.productLabel))]
          : [...new Set((parseResult?.rows ?? []).filter((r) => r.sheetMonth === month).map((r) => r.productLabel))]
      await resolveLabels(labels)
    },
    [parseResult?.rows, resolveLabels]
  )

  const effectiveMapping = useMemo(() => {
    const out: Record<string, string> = {}
    for (const label of uniqueLabels) {
      const override = overrides[label]?.trim()
      if (override) out[label] = override
      else if (autoMatches[label]?.itemCode) out[label] = autoMatches[label]!.itemCode
    }
    return out
  }, [autoMatches, overrides, uniqueLabels])

  const unmappedCount = uniqueLabels.filter((l) => !effectiveMapping[l]).length

  const handleImport = useCallback(async () => {
    if (activeRows.length === 0) return
    setImporting(true)
    setError(null)
    try {
      const res = await importSkitProductionPlans({
        rows: activeRows.map((r) => ({
          externalId: r.externalId,
          planDate: r.planDate,
          planDateTo: r.planDateTo,
          productLabel: r.productLabel,
          lineCode: r.lineCode,
          plannedQty: r.plannedQty,
          note: `СКИТ · ${r.sheetName}`,
        })),
        itemMapping: overrides,
        autoMatches,
      })
      setImportResults(res.results)
      if (res.summary.errors === 0 && res.summary.skipped === 0) {
        onImported?.()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Импорт не выполнен")
    } finally {
      setImporting(false)
    }
  }, [activeRows, autoMatches, onImported, overrides])

  const lookupItemCode = useCallback(async (label: string, query: string) => {
    const q = query.trim()
    if (q.length < 2) return
    try {
      const res = await listItems({ query: q, limit: 1, isActive: true })
      const hit = res.items?.[0]
      if (hit) {
        setOverrides((prev) => ({ ...prev, [label]: hit.itemCode }))
      }
    } catch {
      /* ignore */
    }
  }, [])

  const importSummary = useMemo(() => {
    if (!importResults) return null
    return {
      created: importResults.filter((r) => r.status === "created").length,
      updated: importResults.filter((r) => r.status === "updated").length,
      skipped: importResults.filter((r) => r.status === "skipped").length,
      errors: importResults.filter((r) => r.status === "error").length,
    }
  }, [importResults])

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" />
            Импорт книги «Выпуск СКИТ»
          </DialogTitle>
          <DialogDescription>
            Листы с датами (01.06.2026) — план по дням или месячный «План» в APS
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1 space-y-2">
              <Label>Файл Excel (.xlsm, .xlsx)</Label>
              <Input
                ref={fileRef}
                type="file"
                accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={parsing || importing}
                onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Tabs value={mode} onValueChange={(v) => void handleModeChange(v as SkitImportMode)}>
              <TabsList>
                <TabsTrigger value="daily">По дням</TabsTrigger>
                <TabsTrigger value="monthly_plan">Месячный план</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {fileName ? (
            <p className="text-xs text-muted-foreground">
              Файл: <span className="font-medium text-foreground">{fileName}</span>
            </p>
          ) : null}

          {parseResult?.warnings.length ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
              {parseResult.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          ) : null}

          {parseResult ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Месяц:</span>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedMonth === "all" ? "default" : "outline"}
                  onClick={() => void handleMonthChange("all")}
                >
                  Все
                </Button>
                {monthOptions.map((m) => (
                  <Button
                    key={m}
                    type="button"
                    size="sm"
                    variant={selectedMonth === m ? "default" : "outline"}
                    onClick={() => void handleMonthChange(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          {parseResult ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatCard label="Строк" value={String(previewStats.rows)} />
              <StatCard label="Дней" value={String(previewStats.dates)} />
              <StatCard label="Продуктов" value={String(previewStats.products)} />
              <StatCard label="Σ шт" value={formatApsPlanQty(previewStats.qty)} />
            </div>
          ) : null}

          {uniqueLabels.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Сопоставление номенклатуры</Label>
                {resolving ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                {unmappedCount > 0 ? (
                  <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
                    Без кода: {unmappedCount}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-emerald-700 dark:text-emerald-300">
                    Все сопоставлены
                  </Badge>
                )}
              </div>
              <div className="max-h-48 overflow-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">Колонка СКИТ</th>
                      <th className="px-2 py-1.5 text-left font-medium">Код WMS</th>
                      <th className="px-2 py-1.5 text-left font-medium">Номенклатура</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uniqueLabels.map((label) => {
                      const auto = autoMatches[label]
                      const code = overrides[label] || auto?.itemCode || ""
                      const name = auto?.itemName || ""
                      const ok = Boolean(code)
                      return (
                        <tr key={label} className="border-t">
                          <td className="px-2 py-1.5 align-top">{label}</td>
                          <td className="px-2 py-1.5 align-top">
                            <Input
                              className={cn("h-7 text-xs", !ok && "border-amber-500/50")}
                              value={code}
                              placeholder="код"
                              onChange={(e) =>
                                setOverrides((prev) => ({ ...prev, [label]: e.target.value }))
                              }
                              onBlur={(e) => {
                                if (!e.target.value.trim() && label) {
                                  void lookupItemCode(label, label)
                                }
                              }}
                            />
                          </td>
                          <td className="px-2 py-1.5 align-top text-muted-foreground">{name || "—"}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {importSummary ? (
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex flex-wrap gap-3">
                <span className="text-emerald-700 dark:text-emerald-300">Создано: {importSummary.created}</span>
                <span>Обновлено: {importSummary.updated}</span>
                <span className="text-amber-700 dark:text-amber-300">Пропущено: {importSummary.skipped}</span>
                <span className="text-red-600 dark:text-red-400">Ошибок: {importSummary.errors}</span>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-800 dark:text-red-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={importing}>
            Закрыть
          </Button>
          <Button
            type="button"
            disabled={parsing || resolving || importing || activeRows.length === 0 || unmappedCount > 0}
            onClick={() => void handleImport()}
          >
            {importing ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : importSummary && importSummary.errors === 0 ? (
              <CheckCircle2 className="mr-1.5 size-4" />
            ) : (
              <Upload className="mr-1.5 size-4" />
            )}
            Импортировать в APS
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  )
}
