"use client"

import { Loader2, X } from "lucide-react"
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react"

export function cn(...c: Array<string | false | null | undefined>): string {
  return c.filter(Boolean).join(" ")
}

type Variant = "primary" | "outline" | "ghost" | "danger" | "subtle"

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:brightness-95 font-semibold",
  outline: "border border-border bg-card hover:bg-muted",
  ghost: "hover:bg-muted",
  danger: "bg-destructive text-destructive-foreground hover:brightness-95 font-medium",
  subtle: "bg-muted hover:brightness-95",
}

export function Button({
  variant = "outline",
  size = "md",
  busy,
  icon,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; busy?: boolean; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg transition disabled:cursor-default disabled:opacity-50",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
        VARIANT[variant],
        className
      )}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cn("inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted disabled:opacity-40", className)}>
      {children}
    </button>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn("h-8 w-full rounded-lg border border-border bg-card px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:border-ring", className)} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cn("h-8 w-full rounded-lg border border-border bg-card px-2 text-[13px] outline-none focus:border-ring", className)}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn("min-h-16 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-ring", className)} />
}

export function Field({ label, hint, error, required, children, className }: { label: string; hint?: string; error?: string | null; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-[color-mix(in_oklch,var(--info)_15%,transparent)] text-[var(--info)]",
  success: "bg-[color-mix(in_oklch,var(--success)_16%,transparent)] text-[var(--success)]",
  warning: "bg-[color-mix(in_oklch,var(--warning)_20%,transparent)] text-[color-mix(in_oklch,var(--warning)_75%,black)] dark:text-[var(--warning)]",
  danger: "bg-[color-mix(in_oklch,var(--destructive)_14%,transparent)] text-[var(--destructive)]",
  primary: "bg-[color-mix(in_oklch,var(--primary)_35%,transparent)] text-foreground",
} as const

export type Tone = keyof typeof TONES

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-md px-1.5 text-[11px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  )
}

export const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  received: "info",
  in_review: "warning",
  rework: "warning",
  approved: "success",
  rejected: "danger",
  signing: "primary",
  signed: "success",
  sent: "info",
  completed: "success",
  cancelled: "neutral",
}

export const EXCHANGE_TONE: Record<string, Tone> = {
  none: "neutral",
  queued: "info",
  sent: "info",
  delivered: "info",
  accepted: "success",
  rejected: "danger",
  clarification: "warning",
  error: "danger",
}

export const WMS_TONE: Record<string, Tone> = {
  draft_created: "info",
  receiving: "warning",
  received: "success",
  received_with_discrepancies: "warning",
  link_error: "danger",
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} />
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px] text-muted-foreground">{children}</kbd>
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    const first = ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([aria-label='Закрыть'])")
    first?.focus()
    return () => window.removeEventListener("keydown", h)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={cn("flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-card shadow-xl sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Закрыть" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: string; count?: number | null }> }) {
  return (
    <div role="tablist" className="flex gap-0.5 overflow-x-auto border-b border-border">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          type="button"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "-mb-px flex h-8 shrink-0 items-center gap-1 border-b-2 px-2 text-[13px]",
            value === it.value ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {it.label}
          {it.count ? <span className="rounded bg-muted px-1 text-[10px]">{it.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function ErrorLine({ error }: { error: { message: string } | string | null | undefined }) {
  if (!error) return null
  return <p className="rounded-lg bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] px-3 py-2 text-xs text-destructive">{typeof error === "string" ? error : error.message}</p>
}

/** Тост без внешних библиотек. */
type ToastItem = { id: number; text: string; tone: "ok" | "error" }
let toastListeners: Array<(t: ToastItem[]) => void> = []
let toasts: ToastItem[] = []
export function toast(text: string, tone: "ok" | "error" = "ok") {
  const item = { id: Date.now() + Math.random(), text, tone }
  toasts = [...toasts, item]
  toastListeners.forEach((l) => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id)
    toastListeners.forEach((l) => l(toasts))
  }, tone === "error" ? 7000 : 3500)
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    toastListeners.push(setItems)
    return () => {
      toastListeners = toastListeners.filter((l) => l !== setItems)
    }
  }, [])
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-sm flex-col gap-2" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto rounded-xl border px-3 py-2 text-[13px] shadow-lg", t.tone === "error" ? "border-destructive/40 bg-card text-destructive" : "border-border bg-card")}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
