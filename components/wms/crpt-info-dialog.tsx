"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Check, ChevronDown, Copy, Loader2, RotateCcw, TriangleAlert, X } from "lucide-react"
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { fetchCrptInfo, type CrptInfoResponseItem } from "@/lib/wms-api"
import { splitCrptCodeList } from "@/lib/wms/crpt"
import {
  russifyCrptPackageType,
  russifyCrptProductGroup,
} from "@/lib/wms/crpt-product-groups"

const STATUS_LABELS: Record<string, string> = {
  INTRODUCED: "В обороте",
  VALID: "Действителен",
  APPLIED: "Нанесён",
  EMITTED: "Эмитирован",
  WRITTEN_OFF: "Выбыл",
  RETIRED: "Выбыл",
  WITHDRAWN: "Выбыл",
  DISAGGREGATION: "Расформирован",
  DISAGGREGATED: "Расформирован",
  BLOCKED: "Заблокирован",
  EXPIRED: "Просрочен",
}

const EMISSION_LABELS: Record<string, string> = {
  LOCAL: "Произведён в РФ",
  FOREIGN: "Ввезён в РФ",
  REAPPLY: "Перемаркировка",
  REMAINS: "Остатки",
  COMMISSION: "Комиссия",
}

type StatusTone = "ok" | "warn" | "bad" | "neutral"

function statusLabel(code: string | undefined): string {
  if (!code) return "Неизвестно"
  return STATUS_LABELS[code.trim().toUpperCase()] ?? code
}

function classifyStatus(code: string | undefined): StatusTone {
  const raw = (code ?? "").trim()
  if (!raw) return "neutral"
  const key = raw.toUpperCase()
  const ru = raw.toLowerCase()
  if (
    key === "INTRODUCED" ||
    key === "VALID" ||
    ru.includes("в обороте") ||
    ru.includes("действител")
  ) {
    return "ok"
  }
  if (
    key === "APPLIED" ||
    key === "EMITTED" ||
    ru.includes("ожид") ||
    ru.includes("огранич") ||
    ru.includes("нанес") ||
    ru.includes("эмитир")
  ) {
    return "warn"
  }
  if (
    key === "WRITTEN_OFF" ||
    key === "RETIRED" ||
    key === "WITHDRAWN" ||
    key === "DISAGGREGATION" ||
    key === "DISAGGREGATED" ||
    key === "BLOCKED" ||
    key === "EXPIRED" ||
    ru.includes("выб") ||
    ru.includes("изъят") ||
    ru.includes("списан") ||
    ru.includes("блок") ||
    ru.includes("просроч") ||
    ru.includes("ошиб") ||
    ru.includes("не найден")
  ) {
    return "bad"
  }
  return "neutral"
}

function russifyEmissionType(value: string): string {
  if (!value) return ""
  return EMISSION_LABELS[value.trim().toUpperCase()] ?? value
}

function textOrEmpty(value: unknown): string {
  if (value == null) return ""
  const text = String(value).trim()
  return text
}

function formatDate(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" })
}

function formatDateOnly(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" })
}

function expiryTone(value: unknown): StatusTone | null {
  if (typeof value !== "string" || !value.trim()) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const days = Math.floor((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return "bad"
  if (days <= 90) return "warn"
  return "ok"
}

function codesEqual(a: string, b: string): boolean {
  return a.replace(/\s+/g, "") === b.replace(/\s+/g, "")
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

function KvRow({
  label,
  value,
  mono,
  strong,
}: {
  label: string
  value: ReactNode
  mono?: boolean
  strong?: boolean
}) {
  if (value == null || value === "") return null
  return (
    <div className="grid grid-cols-1 gap-0.5 py-1 sm:grid-cols-[132px_minmax(0,1fr)] sm:items-baseline sm:gap-x-4">
      <div className="text-[12px] leading-5 text-muted-foreground">{label}</div>
      <div
        className={cn(
          "min-w-0 text-[13px] leading-5 text-foreground",
          strong && "font-semibold",
          mono && "font-mono text-[12px]"
        )}
      >
        {value}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  )
}

function StatusBadge({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold uppercase tracking-wide",
        tone === "ok" && "border-emerald-600/25 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
        tone === "warn" && "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        tone === "bad" && "border-red-600/25 bg-red-600/10 text-red-800 dark:text-red-300",
        tone === "neutral" && "border-border bg-muted text-muted-foreground"
      )}
    >
      {tone === "ok" ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : null}
      {tone === "warn" || tone === "bad" ? <TriangleAlert className="h-3.5 w-3.5" /> : null}
      {label}
    </span>
  )
}

function MarkingCodeField({ value, label = "Код маркировки" }: { value: string; label?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const long = value.length > 36

  async function onCopy() {
    const ok = await copyText(value)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div className="space-y-1">
      <div className="text-[12px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
        <code
          title={value}
          className={cn(
            "min-w-0 flex-1 font-mono text-[12px] leading-5 text-foreground",
            expanded ? "whitespace-pre-wrap break-all" : "truncate"
          )}
        >
          {value}
        </code>
        {long ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px] text-muted-foreground"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Свернуть" : "Весь"}
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground"
              onClick={() => void onCopy()}
              aria-label="Скопировать код"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? "Скопировано" : "Скопировать код"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}

function ResultView({ item, index, total }: { item: CrptInfoResponseItem; index: number; total: number }) {
  const [extraOpen, setExtraOpen] = useState(false)
  const cisInfo = (item.cisInfo ?? {}) as Record<string, unknown>
  const status = textOrEmpty(cisInfo.status) || undefined
  const tone = classifyStatus(status)
  const productName = textOrEmpty(cisInfo.productName)
  const gtin = textOrEmpty(cisInfo.gtin)
  const brand = textOrEmpty(cisInfo.brand)
  const group = textOrEmpty(cisInfo.productGroup)
    ? russifyCrptProductGroup(cisInfo.productGroup)
    : ""
  const tnVed = textOrEmpty(cisInfo.tnVedEaes)
  const expiry = formatDateOnly(cisInfo.expirationDate)
  const expiryState = expiryTone(cisInfo.expirationDate)
  const cis = textOrEmpty(cisInfo.cis)
  const requested = textOrEmpty(cisInfo.requestedCis)
  const packageTypeRaw = textOrEmpty(cisInfo.packageType)
  const packageType = packageTypeRaw ? russifyCrptPackageType(packageTypeRaw) : ""
  const generalPackage = textOrEmpty(cisInfo.generalPackageType)
    ? russifyCrptPackageType(cisInfo.generalPackageType)
    : ""
  const emissionType = russifyEmissionType(textOrEmpty(cisInfo.emissionType))
  const child = Array.isArray(cisInfo.child) ? cisInfo.child.map(String) : []
  const partial = cisInfo.partialSaleInfo as Record<string, unknown> | undefined
  const certs = Array.isArray(cisInfo.certDoc) ? cisInfo.certDoc : []

  const extraRows: { label: string; value: string; mono?: boolean }[] = [
    { label: "ТН ВЭД", value: tnVed, mono: true },
    { label: "Тип упаковки ЧЗ", value: generalPackage && generalPackage !== packageType ? generalPackage : "" },
    { label: "Доп. статус", value: textOrEmpty(cisInfo.statusEx) },
    { label: "Производитель", value: textOrEmpty(cisInfo.manufacturerName) },
    { label: "ИНН производителя", value: textOrEmpty(cisInfo.manufacturerInn), mono: true },
    { label: "Владелец", value: textOrEmpty(cisInfo.ownerName) },
    { label: "ИНН владельца", value: textOrEmpty(cisInfo.ownerInn), mono: true },
    { label: "Изготовитель", value: textOrEmpty(cisInfo.producerName) },
    { label: "ИНН изготовителя", value: textOrEmpty(cisInfo.producerInn), mono: true },
    { label: "Дата эмиссии", value: formatDate(cisInfo.emissionDate) },
    { label: "Дата заявки", value: formatDate(cisInfo.applicationDate) },
    { label: "Ввод в оборот", value: formatDate(cisInfo.introducedDate) },
    {
      label: "Множественные продажи",
      value: cisInfo.isMultipleSales == null ? "" : cisInfo.isMultipleSales ? "Да" : "Нет",
    },
    {
      label: "Вывод из оборота",
      value: cisInfo.markWithdraw == null ? "" : cisInfo.markWithdraw ? "Да" : "Нет",
    },
  ].filter((row) => row.value)

  const sameCodes = Boolean(cis && requested && codesEqual(cis, requested))
  const showRequested = Boolean(requested && (!cis || !sameCodes))

  return (
    <div className="space-y-3">
      {total > 1 ? (
        <div className="text-[11px] text-muted-foreground">Результат {index + 1} из {total}</div>
      ) : null}

      <div
        className={cn(
          "rounded-lg border border-border border-l-[3px] px-3 py-2.5",
          tone === "ok" && "border-l-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/20",
          tone === "warn" && "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/20",
          tone === "bad" && "border-l-red-600 bg-red-50/70 dark:bg-red-950/20",
          tone === "neutral" && "border-l-zinc-400 bg-muted/40"
        )}
      >
        <StatusBadge tone={tone} label={statusLabel(status)} />
        {productName ? (
          <h3 className="mt-2 text-[16px] font-semibold leading-snug text-foreground">{productName}</h3>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">Название товара не указано</p>
        )}
        {gtin ? (
          <div className="mt-1 font-mono text-[13px] text-muted-foreground">
            GTIN {gtin}
          </div>
        ) : null}
        {expiry ? (
          <div
            className={cn(
              "mt-1.5 text-[13px] leading-5",
              expiryState === "bad" && "font-semibold text-red-800 dark:text-red-300",
              expiryState === "warn" && "font-semibold text-amber-800 dark:text-amber-300",
              expiryState === "ok" && "text-foreground"
            )}
          >
            {expiryState === "bad" ? "Просрочен с " : "Годен до "}
            {expiry}
          </div>
        ) : null}
      </div>

      {(brand || group) ? (
        <div>
          <SectionTitle>Основное</SectionTitle>
          <div>
            <KvRow label="Бренд" value={brand} strong />
            <KvRow label="Группа" value={group} />
          </div>
        </div>
      ) : null}

      {(packageType || emissionType || requested) ? (
        <div className="border-t border-border/70 pt-3">
          <SectionTitle>Маркировка</SectionTitle>
          <div>
            <KvRow label="Тип упаковки" value={packageType} />
            <KvRow label="Тип эмиссии" value={emissionType} />
            {sameCodes ? (
              <KvRow
                label="Запрошенный код"
                value={
                  <span className="inline-flex items-center gap-1 text-emerald-800 dark:text-emerald-300">
                    совпадает <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                }
              />
            ) : null}
          </div>
        </div>
      ) : null}

      {(cis || showRequested) ? (
        <div className="border-t border-border/70 pt-3">
          <SectionTitle>Технические данные</SectionTitle>
          <div className="space-y-2">
            {cis ? <MarkingCodeField value={cis} /> : null}
            {showRequested ? (
              <div className="rounded-lg border border-amber-500/25 bg-amber-50/50 px-2.5 py-2 dark:bg-amber-950/15">
                <div className="mb-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                  Запрошенный код отличается
                </div>
                <MarkingCodeField value={requested} label="Запрошенный код" />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <Collapsible open={extraOpen} onOpenChange={setExtraOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex h-8 w-full items-center justify-between rounded-md px-0 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <span>Дополнительные сведения</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", extraOpen && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pb-1">
          {extraRows.length > 0 ? (
            <div>
              {extraRows.map((row) => (
                <KvRow key={row.label} label={row.label} value={row.value} mono={row.mono} />
              ))}
            </div>
          ) : null}
          {partial && typeof partial === "object" ? (
            <div>
              <SectionTitle>Частичная продажа</SectionTitle>
              {Object.entries(partial).map(([key, value]) => (
                <KvRow
                  key={key}
                  label={key}
                  value={typeof value === "boolean" ? (value ? "Да" : "Нет") : String(value ?? "")}
                />
              ))}
            </div>
          ) : null}
          {certs.length > 0 ? (
            <div>
              <SectionTitle>Сертификаты</SectionTitle>
              {certs.map((cert, certIndex) =>
                typeof cert === "object" && cert !== null ? (
                  <div key={certIndex} className="mb-1">
                    {Object.entries(cert as Record<string, unknown>).map(([key, value]) => (
                      <KvRow key={key} label={key} value={String(value ?? "")} mono={key === "number"} />
                    ))}
                  </div>
                ) : null
              )}
            </div>
          ) : null}
          {child.length > 0 ? (
            <div>
              <SectionTitle>Вложенные коды ({child.length})</SectionTitle>
              <div className="max-h-28 space-y-1 overflow-auto rounded-lg border border-border bg-muted/30 px-2 py-1.5">
                {child.map((code) => (
                  <div key={code} className="font-mono text-[12px] whitespace-nowrap">
                    {code.replace(/,$/, "")}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2 font-mono text-[11px] leading-4">
            {JSON.stringify(item, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function buildCopySummary(item: CrptInfoResponseItem): string {
  const info = (item.cisInfo ?? {}) as Record<string, unknown>
  const lines = [
    statusLabel(textOrEmpty(info.status) || undefined),
    textOrEmpty(info.productName),
    textOrEmpty(info.gtin) ? `GTIN ${textOrEmpty(info.gtin)}` : "",
    textOrEmpty(info.brand) ? `Бренд ${textOrEmpty(info.brand)}` : "",
    formatDateOnly(info.expirationDate) ? `Годен до ${formatDateOnly(info.expirationDate)}` : "",
    textOrEmpty(info.cis) ? `КИ ${textOrEmpty(info.cis)}` : "",
  ].filter(Boolean)
  return lines.join("\n")
}

export interface CrptInfoDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  initialCodes?: string
}

export function CrptInfoDialog({ open, onOpenChange, initialCodes = "" }: CrptInfoDialogProps) {
  const [codesInput, setCodesInput] = useState(initialCodes)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<CrptInfoResponseItem[] | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [scanToast, setScanToast] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)

  const parsedPreview = useMemo(() => splitCrptCodeList(codesInput), [codesInput])
  const notFound = Boolean(error && /не найден/i.test(error))
  const firstSuccess = results?.find((item) => item.cisInfo && typeof item.cisInfo === "object") ?? null

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 40)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    return () => {
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
    }
  }, [])

  function prepareNextScan() {
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 20)
  }

  async function submit() {
    if (loading || parsedPreview.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const data = await fetchCrptInfo(parsedPreview)
      setResults(Array.isArray(data) ? data : [data as CrptInfoResponseItem])
      setScanToast(true)
      if (toastTimer.current != null) window.clearTimeout(toastTimer.current)
      toastTimer.current = window.setTimeout(() => setScanToast(false), 900)
      prepareNextScan()
    } catch (e) {
      setResults(null)
      setError(e instanceof Error ? e.message : "Не удалось получить данные из ЧЗ")
      prepareNextScan()
    } finally {
      setLoading(false)
    }
  }

  function clearInput() {
    setCodesInput("")
    setError(null)
    inputRef.current?.focus()
  }

  async function copySummary() {
    if (!firstSuccess) return
    const ok = await copyText(buildCopySummary(firstSuccess))
    if (!ok) return
    setCopiedAll(true)
    window.setTimeout(() => setCopiedAll(false), 1200)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[80vh] w-[calc(100vw-1.5rem)] flex-col gap-0 overflow-hidden rounded-[10px] p-0 sm:max-w-[640px]"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          window.setTimeout(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
          }, 0)
        }}
      >
        <TooltipProvider delayDuration={250}>
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-5 py-3">
          <DialogTitle className="text-[17px] font-semibold leading-none">Проверка кода в ЧЗ</DialogTitle>
          <DialogDescription className="sr-only">
            Сканируйте или вставьте код маркировки и проверьте его в Честном знаке
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-1.5">
            <label htmlFor="crpt-check-input" className="text-[12px] text-muted-foreground">
              Код маркировки
            </label>
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Input
                  id="crpt-check-input"
                  ref={inputRef}
                  value={codesInput}
                  onChange={(e) => setCodesInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      void submit()
                    }
                  }}
                  placeholder="Сканируйте или вставьте код"
                  className={cn(
                    "h-9 rounded-lg pr-8 font-mono text-[12px]",
                    error && "border-red-400 focus-visible:ring-red-400/40"
                  )}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                  disabled={loading}
                />
                {codesInput ? (
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={clearInput}
                    aria-label="Очистить"
                    disabled={loading}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <Button
                className="h-9 shrink-0 rounded-lg px-3.5"
                onClick={() => void submit()}
                disabled={loading || parsedPreview.length === 0}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Проверить"}
              </Button>
            </div>
            <div className="h-5 text-[12px] leading-5 text-muted-foreground">
              {loading ? "Проверяем в Честном знаке…" : "\u00a0"}
            </div>
          </div>

          <div className={cn("min-h-[72px]", loading && results ? "pointer-events-none opacity-40" : null)}>
            {!loading && !error && !results ? (
              <p className="text-[12px] leading-5 text-muted-foreground">
                Отсканируйте DataMatrix или вставьте код — результат появится сразу под полем.
              </p>
            ) : null}
            {error ? (
              <div className="rounded-lg border border-red-600/20 border-l-[3px] border-l-red-600 bg-red-50/70 px-3 py-2.5 dark:bg-red-950/20">
                <StatusBadge tone="bad" label={notFound ? "Код не найден" : "Ошибка проверки"} />
                {parsedPreview[0] ? (
                  <div className="mt-2">
                    <MarkingCodeField value={parsedPreview[0]} label="Код" />
                  </div>
                ) : null}
                <p className="mt-2 text-[13px] leading-5 text-foreground/90">
                  {notFound
                    ? "Код маркировки отсутствует в Честном знаке или недоступен для этой товарной группы."
                    : error}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2.5 h-8 rounded-lg"
                  onClick={() => void submit()}
                  disabled={loading || parsedPreview.length === 0}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Повторить
                </Button>
              </div>
            ) : null}

            {!error && results && results.length > 0 ? (
              <div className="space-y-4">
                {results.map((item, index) =>
                  item.cisInfo && typeof item.cisInfo === "object" ? (
                    <ResultView key={index} item={item} index={index} total={results.length} />
                  ) : (
                    <pre
                      key={index}
                      className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-[11px]"
                    >
                      {JSON.stringify(item, null, 2)}
                    </pre>
                  )
                )}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 flex-row justify-end gap-2 border-t border-border px-5 py-2.5 sm:space-x-0">
          {firstSuccess && !error ? (
            <Button type="button" variant="outline" className="h-8 rounded-lg" onClick={() => void copySummary()}>
              {copiedAll ? "Скопировано" : "Скопировать данные"}
            </Button>
          ) : null}
          <Button
            variant={firstSuccess && !error ? "outline" : "default"}
            className="h-8 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            Закрыть
          </Button>
        </DialogFooter>
        {scanToast ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-14 z-20 flex justify-center px-4">
            <div className="rounded-lg bg-emerald-800 px-3 py-1.5 text-[12px] font-semibold text-white">
              ✓ Код проверен
            </div>
          </div>
        ) : null}
        </TooltipProvider>
      </DialogContent>
    </Dialog>
  )
}
