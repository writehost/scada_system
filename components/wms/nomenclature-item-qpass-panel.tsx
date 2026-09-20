"use client"

import { useCallback, useEffect, useState } from "react"
import { ExternalLink, FileBadge, Loader2, Printer, RotateCcw, Unlink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { qpassQrImageUrl } from "@/lib/wms/qpass"
import { ensureItemQpass, getItemQpass, saveItemQpass, type QpassPass } from "@/lib/wms-api"
import { cn } from "@/lib/utils"

type Props = {
  itemCode: string
  itemName?: string
  equipmentSerial?: string
  /** Показывать карточку, даже если паспорт не привязан (для оборудования). */
  showEmpty?: boolean
  disabled?: boolean
  className?: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function qrSrc(pass: QpassPass): string {
  return pass.qrImageUrl || qpassQrImageUrl(pass.publicId)
}

function openQpassPrint(pass: QpassPass): boolean {
  const title = escapeHtml(pass.title || pass.publicId)
  const meta = [pass.inventoryCode, pass.serial].filter(Boolean).join(" · ")
  const img = escapeHtml(qrSrc(pass))
  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    @page { size: 50mm 60mm; margin: 2mm; }
    body { font-family: Arial, sans-serif; margin: 0; padding: 4px; }
    .sticker { border: 1px solid #e5e5e5; border-radius: 8px; padding: 6px; }
    .qr { text-align: center; }
    .qr img { width: 42mm; height: 42mm; }
    h1 { font-size: 9pt; margin: 4px 0 2px; font-weight: 600; text-align: center; }
    p { font-size: 7pt; margin: 0; text-align: center; word-break: break-all; color: #333; }
  </style>
</head>
<body>
  <div class="sticker">
    <div class="qr"><img src="${img}" alt="${title}" /></div>
    <h1>${title}</h1>
    <p>${escapeHtml(meta)}</p>
  </div>
  <script>window.onload = () => { setTimeout(() => window.print(), 120); };</script>
</body>
</html>`
  const blob = new Blob([html], { type: "text/html;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const w = window.open(url, "_blank", "width=420,height=560")
  if (!w) {
    URL.revokeObjectURL(url)
    return false
  }
  w.addEventListener("load", () => URL.revokeObjectURL(url), { once: true })
  return true
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline gap-2">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="min-w-0 break-all font-mono text-[11px] text-foreground" title={value}>
        {value}
      </div>
    </div>
  )
}

function PanelShell({
  children,
  className,
  action,
  loading,
}: {
  children: React.ReactNode
  className?: string
  action?: React.ReactNode
  loading?: boolean
}) {
  return (
    <div className={cn("w-full rounded-xl border border-border/60 bg-background/70", className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-1.5">
        <div className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <FileBadge className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Техпаспорт QPass</span>
          {loading ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function NomenclatureItemQpassPanel({
  itemCode,
  itemName,
  equipmentSerial,
  showEmpty,
  disabled,
  className,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState(false)
  const [pass, setPass] = useState<QpassPass | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const applyResult = useCallback((row: { found: boolean; pass: QpassPass | null }) => {
    setFound(Boolean(row.found && row.pass))
    setPass(row.pass)
  }, [])

  const name = (itemName || "").trim()
  const serial = (equipmentSerial || "").trim()

  useEffect(() => {
    if (!itemCode || disabled) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const stored = await getItemQpass(itemCode)
        if (cancelled) return
        if (stored.found && stored.pass) {
          applyResult(stored)
          return
        }
        if (name && serial) {
          const ensured = await ensureItemQpass(itemCode, { name, serial })
          if (!cancelled) applyResult(ensured)
          return
        }
        if (!cancelled) applyResult(stored)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "QPass недоступен")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applyResult, disabled, itemCode, name, reloadKey, serial])

  async function unlink() {
    setSaving(true)
    setError(null)
    try {
      const row = await saveItemQpass(itemCode, null)
      applyResult(row)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отвязать паспорт")
    } finally {
      setSaving(false)
    }
  }

  async function link() {
    if (!name || !serial) return
    setSaving(true)
    setError(null)
    try {
      const ensured = await ensureItemQpass(itemCode, { name, serial })
      applyResult(ensured)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать паспорт")
    } finally {
      setSaving(false)
    }
  }

  if (!loading && !error && !found && !showEmpty) return null

  if (error) {
    return (
      <PanelShell className={className}>
        <div className="border-t border-destructive/20 px-3 py-2">
          <p className="text-[11px] leading-snug text-destructive">{error}</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 h-7 rounded-lg px-2 text-xs"
            onClick={() => setReloadKey((v) => v + 1)}
          >
            <RotateCcw className="mr-1.5 h-3 w-3" />
            Повторить
          </Button>
        </div>
      </PanelShell>
    )
  }

  if (loading && !pass) {
    return (
      <PanelShell className={className} loading>
        <div className="flex items-start gap-2.5 border-t border-border/50 px-3 py-2.5">
          <div className="h-16 w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </PanelShell>
    )
  }

  if (!found || !pass) {
    return (
      <PanelShell className={className}>
        <div className="border-t border-border/50 px-3 py-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            {serial
              ? "Паспорт ещё не привязан — создадим его в QPass по названию и серийному номеру."
              : "Паспорт не привязан. Укажите серийный номер во вкладке «Реквизиты» — паспорт создастся автоматически."}
          </p>
          {serial && name ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-7 rounded-lg px-2 text-xs"
              onClick={() => void link()}
              disabled={disabled || saving}
            >
              {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
              Привязать паспорт
            </Button>
          ) : null}
        </div>
      </PanelShell>
    )
  }

  return (
    <PanelShell
      className={className}
      loading={loading}
      action={
        <a
          href={pass.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
        >
          Открыть
          <ExternalLink className="h-3 w-3" />
        </a>
      }
    >
      <div className="space-y-1.5 border-t border-border/50 px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <a
            href={pass.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg border border-border/60 bg-white p-1"
            title={pass.title || pass.publicId}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc(pass)} alt="" className="h-14 w-14" />
          </a>
          <div
            className="line-clamp-3 min-w-0 flex-1 text-xs font-medium leading-snug"
            title={pass.title || itemName || "Паспорт"}
          >
            {pass.title || itemName || "Паспорт"}
          </div>
        </div>
        <div className="space-y-0.5">
          {pass.serial ? <MetaRow label="Серийный" value={pass.serial} /> : null}
          {pass.inventoryCode ? <MetaRow label="Инв. №" value={pass.inventoryCode} /> : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5 border-t border-border/50 px-3 py-1.5">
        <Button type="button" size="sm" className="h-7 rounded-lg px-2 text-xs" onClick={() => {
          if (!openQpassPrint(pass)) setError("Разрешите всплывающие окна для печати")
        }}>
          <Printer className="mr-1.5 h-3 w-3" />
          Печать
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-lg px-2 text-xs text-muted-foreground"
          onClick={() => void unlink()}
          disabled={disabled || saving}
          title="Отвязать паспорт от позиции"
        >
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Unlink className="mr-1.5 h-3 w-3" />}
          Отвязать
        </Button>
      </div>
    </PanelShell>
  )
}
