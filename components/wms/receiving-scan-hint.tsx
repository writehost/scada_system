"use client"

import { AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { ReceivingScanEventRow } from "@/components/wms/receiving-scan-events-table"
import {
  DEFAULT_RECEIVING_SITE_RULES,
  receivingScanGateFromRow,
  type ReceivingSiteRules,
} from "@/lib/receiving-scan-policy"

let hintRules: ReceivingSiteRules = DEFAULT_RECEIVING_SITE_RULES
let hintGroup: string | null = null

export function setReceivingScanHintContext(
  rules?: ReceivingSiteRules | null,
  productGroup?: string | null
) {
  hintRules = rules ?? DEFAULT_RECEIVING_SITE_RULES
  hintGroup = productGroup ?? null
}

const CRPT_STATUS_LABELS: Record<string, string> = {
  INTRODUCED: "В обороте",
  APPLIED: "Нанесён",
  EMITTED: "Эмитирован",
  WRITTEN_OFF: "Списан",
  RETIRED: "Выведен",
  WITHDRAWN: "Изъят",
}

const ITEM_STATUS_LABELS: Record<string, string> = {
  эммитирован: "Эмитирован",
  эмитирован: "Эмитирован",
  просрочен: "Просрочен",
  истекает: "Истекает",
  нанесен: "Нанесён",
}

function crptLabel(code: string | null | undefined): string | null {
  if (!code?.trim()) return null
  const key = code.trim().toUpperCase()
  return CRPT_STATUS_LABELS[key] ?? code
}

function parseExpiryDays(note: string | null | undefined): number | null {
  if (!note) return null
  const m = note.match(/просрочен\s+(\d+)\s*дн/i)
  return m ? Number(m[1]) : null
}

function crptKey(row: ReceivingScanEventRow): string {
  return (row.stickerStatus ?? "").trim().toUpperCase()
}

export function isReceivingScanExpired(row: ReceivingScanEventRow): boolean {
  return row.expiryState === "expired" || row.itemStatus === "просрочен"
}

function scanGate(row: ReceivingScanEventRow) {
  return receivingScanGateFromRow(row, hintRules, hintGroup)
}

export function isReceivingScanAllowed(row: ReceivingScanEventRow): boolean {
  const gate = scanGate(row)
  return gate.allowed && !gate.blocked && !(gate.expired && gate.expiryMode === "confirm")
}

export function buildReceivingScanHints(row: ReceivingScanEventRow): string[] {
  const hints: string[] = []
  const crpt = crptLabel(row.stickerStatus)
  if (crpt) hints.push(`Текущий статус кода в ЧЗ: ${crpt}`)

  const gate = scanGate(row)
  if (gate.reason) hints.push(gate.reason)
  else if (gate.allowed && !gate.blocked) {
    hints.push("Статус ЧЗ разрешён правилом площадки — код можно принять.")
  }

  const warning = row.expiryState === "warning" || row.itemStatus === "истекает"
  if (gate.expired) {
    const days = parseExpiryDays(row.note)
    if (gate.expiryMode === "block") {
      hints.push(
        `Приёмка заблокирована: код просрочен${days != null ? ` на ${days} дн.` : ""}.`
      )
    } else if (gate.expiryMode === "confirm") {
      hints.push(
        `Код просрочен${days != null ? ` на ${days} дн.` : ""} — нужна отметка при проводке.`
      )
    }
  } else if (warning) {
    hints.push("Срок годности истекает — проверьте партию перед приёмкой.")
  }

  return [...new Set(hints)]
}

export function isReceivingScanBlocked(row: ReceivingScanEventRow): boolean {
  return scanGate(row).blocked
}

export function receivingScanStatusKind(
  row: ReceivingScanEventRow
): "ok" | "blocked" | "unknown" {
  const gate = scanGate(row)
  if (gate.blocked) return "blocked"
  if (gate.allowed && !(gate.expired && gate.expiryMode === "confirm")) return "ok"
  return "unknown"
}

function crptStatusLabel(code: string | null | undefined): string | null {
  if (!code?.trim()) return null
  const key = code.trim().toUpperCase()
  return CRPT_STATUS_LABELS[key] ?? code
}

function itemStatusLabel(code: string | null | undefined): string | null {
  if (!code?.trim()) return null
  const key = code.trim().toLowerCase()
  return ITEM_STATUS_LABELS[key] ?? code
}

/** Краткая подпись для таблицы — без дублирующих бейджей и иконок. */
export function receivingScanStatusSummary(row: ReceivingScanEventRow): {
  primary: string
  detail: string | null
} {
  const crpt = crptLabel(row.stickerStatus)
  const item = itemStatusLabel(row.itemStatus)
  if (isReceivingScanExpired(row)) {
    return {
      primary: "Просрочен",
      detail: crpt ? `ЧЗ: ${crpt}` : item && item !== "Просрочен" ? item : null,
    }
  }
  if (isReceivingScanAllowed(row)) {
    return { primary: "Эмитирован", detail: null }
  }
  if (isReceivingScanBlocked(row)) {
    return {
      primary: crpt ?? item ?? "Приёмка заблокирована",
      detail: item && crpt && item !== crpt ? item : buildReceivingScanHints(row)[1] ?? null,
    }
  }
  return {
    primary: crpt ?? item ?? "Статус не определён",
    detail: null,
  }
}

export function ReceivingScanStatusCell({ row }: { row: ReceivingScanEventRow }) {
  const { primary, detail } = receivingScanStatusSummary(row)
  const kind = receivingScanStatusKind(row)

  return (
    <div className="flex items-start gap-2">
      <ReceivingScanStatusIcon row={row} />
      <div className="min-w-0 space-y-0.5">
        <p
          className={cn(
            "text-sm font-medium leading-snug",
            kind === "ok" && "text-emerald-800",
            kind === "blocked" && "text-red-800",
            kind === "unknown" && "text-muted-foreground"
          )}
        >
          {primary}
        </p>
        {detail ? <p className="text-xs leading-snug text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  )
}

export function ReceivingScanStatusIcon({
  row,
  className,
}: {
  row: ReceivingScanEventRow
  className?: string
}) {
  const kind = receivingScanStatusKind(row)
  const hints = buildReceivingScanHints(row)
  const label =
    kind === "ok"
      ? "Эмитирован — успешная приёмка"
      : kind === "blocked"
        ? hints[0] ?? "Приёмка заблокирована"
        : "Статус кода не определён"

  const Icon =
    kind === "ok" ? CheckCircle2 : kind === "blocked" ? AlertTriangle : CircleDashed

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            kind === "ok"
              ? "bg-emerald-500/15 text-emerald-700"
              : kind === "blocked"
                ? "bg-red-500/15 text-red-700"
                : "bg-muted text-muted-foreground",
            className
          )}
          aria-label={label}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs space-y-1 text-xs">
        {hints.length > 0
          ? hints.map((h) => (
              <p key={h}>{h}</p>
            ))
          : (
              <p>{label}</p>
            )}
      </TooltipContent>
    </Tooltip>
  )
}

export function ReceivingSessionScanIcons({
  rows,
  maxIcons = 8,
  totalCount,
}: {
  rows: ReceivingScanEventRow[]
  maxIcons?: number
  totalCount?: number
}) {
  const fullCount = Math.max(totalCount ?? 0, rows.length)
  if (rows.length === 0) {
    if (fullCount > 0) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs font-medium tabular-nums text-emerald-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {fullCount}
        </span>
      )
    }
    return <span className="text-xs text-muted-foreground">—</span>
  }

  const ok = rows.filter((r) => receivingScanStatusKind(r) === "ok").length
  const blocked = rows.filter((r) => receivingScanStatusKind(r) === "blocked").length
  const unknown = rows.length - ok - blocked
  const visible = rows.slice(0, maxIcons)
  const okShown = rows.length > 0 && ok === rows.length && fullCount > rows.length ? fullCount : ok
  const overflow = Math.max(fullCount - visible.length, 0)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium tabular-nums">
        {okShown > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {okShown}
          </span>
        ) : null}
        {blocked > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-800">
            <AlertTriangle className="h-3.5 w-3.5" />
            {blocked}
          </span>
        ) : null}
        {unknown > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
            <CircleDashed className="h-3.5 w-3.5" />
            {unknown}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-0.5">
        {visible.map((r) => (
          <ReceivingScanStatusIcon key={r.id} row={r} />
        ))}
        {overflow > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-secondary px-1 text-[10px] font-semibold text-muted-foreground">
                +{overflow}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Ещё {overflow} сканов — откройте сессию для полного списка
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}

export function ReceivingScanHintIcon({ row }: { row: ReceivingScanEventRow }) {
  const hints = buildReceivingScanHints(row)
  if (hints.length === 0) return null

  const allowed = isReceivingScanAllowed(row)
  const blocked = isReceivingScanBlocked(row)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
            allowed
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15"
              : blocked
                ? "border-red-500/40 bg-red-500/10 text-red-700 hover:bg-red-500/15"
                : "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15"
          )}
          aria-label="Пояснение по приёмке"
        >
          {allowed ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : blocked ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs space-y-1.5 p-3 text-left text-xs leading-relaxed">
        {hints.map((h) => (
          <p key={h}>{h}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
