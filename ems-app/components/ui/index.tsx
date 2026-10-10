"use client"

// Базовые компоненты в стиле SCADA System (по образцу components/ui WMS: shadcn new-york,
// те же радиусы, плотность, состояния). Без Radix — на нативных элементах.

import { createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react"
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react"
import { cn } from "@/lib/client/cn"

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "link"; size?: "default" | "sm" | "lg" | "icon" | "icon-sm"; loading?: boolean }

const VARIANTS = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  outline: "border border-border bg-card hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  link: "text-foreground underline-offset-4 hover:underline px-0",
}
const SIZES = { default: "h-9 px-4", sm: "h-8 px-3 text-[13px]", lg: "h-10 px-6", icon: "size-9", "icon-sm": "size-8" }

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "default", size = "default", loading, disabled, children, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="animate-spin" /> : null}
      {children}
    </button>
  )
})

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn("ems-input", className)} {...props} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cn("ems-input appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...props}>
      {children}
    </select>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("ems-input h-auto min-h-20 py-2", className)} {...props} />
})

export function Field({ label, hint, error, children, className, htmlFor, required }: { label: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

export function Checkbox({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: ReactNode }) {
  const id = useId()
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2 text-sm", disabled && "cursor-not-allowed opacity-60")}>
      <input id={id} type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[oklch(0.65_0.17_115)]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  )
}

const BADGE = {
  neutral: "bg-muted text-foreground",
  primary: "bg-primary/20 text-[oklch(0.4_0.1_120)] dark:text-primary",
  success: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  warning: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
}

export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof BADGE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium", BADGE[tone], className)}>{children}</span>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("ems-skeleton h-4", className)} aria-hidden />
}

export function Panel({ title, subtitle, actions, children, className, bodyClassName }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cn("ems-panel", className)}>
      {title || actions ? (
        <div className="ems-panel-header">
          <div className="min-w-0">
            {title ? <h2 className="ems-panel-title">{title}</h2> : null}
            {subtitle ? <p className="ems-panel-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  )
}

export function Empty({ icon: Icon = Info, title, text, action }: { icon?: React.ComponentType<{ className?: string }>; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      {text ? <p className="max-w-md text-[13px] text-muted-foreground">{text}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: { message: string } | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-sm text-destructive">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{error.message}</span>
      {onRetry ? (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  )
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "success"; children: ReactNode; className?: string }) {
  const Icon = tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info
  return (
    <div className={cn("flex gap-2 rounded-xl border px-3 py-2 text-[13px]", tone === "warning" ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-900 dark:text-amber-200" : tone === "success" ? "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-900 dark:text-emerald-200" : "border-border bg-muted/40 text-foreground", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange, size = "sm", ariaLabel }: { value: T; options: Array<{ value: T; label: ReactNode; disabled?: boolean }>; onChange: (v: T) => void; size?: "sm" | "default"; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border/70 bg-card p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
          className={cn("whitespace-nowrap rounded-md px-2.5 font-medium transition-colors disabled:opacity-40", size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]", o.value === value ? "bg-muted text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Модальное окно на нативном <dialog>: фокус, Esc, блокировка фона. */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      className={cn("m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] rounded-2xl border border-border bg-card p-0 text-foreground shadow-xl backdrop:bg-black/35", size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-3xl" : "max-w-lg")}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-24px)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{title}</h2>
              {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Закрыть">
              <X />
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}

/** Подтверждение опасной операции; при confirmText нужно ввести точное значение. */
export function ConfirmDialog({ open, onClose, onConfirm, title, text, confirmLabel = "Подтвердить", confirmText, destructive = true }: { open: boolean; onClose: () => void; onConfirm: () => Promise<void> | void; title: string; text: ReactNode; confirmLabel?: string; confirmText?: string; destructive?: boolean }) {
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      setTyped("")
      setError(null)
    }
  }, [open])
  const ok = !confirmText || typed.trim() === confirmText
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={!ok}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              setError(null)
              try {
                await onConfirm()
                onClose()
              } catch (e) {
                setError((e as Error).message)
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div>{text}</div>
        {confirmText ? (
          <Field label={<>Введите «{confirmText}» для подтверждения</>}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </Field>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
    </Dialog>
  )
}

type Toast = { id: number; text: string; tone: "success" | "error" | "info" }
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast["tone"] = "success") => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x.slice(-3), { id, text, tone }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === "error" ? 7000 : 3500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6">
        {items.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl border bg-card px-3 py-2 text-sm shadow-lg", t.tone === "error" ? "border-destructive/40 text-destructive" : "border-border")}>
            {t.tone === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  return useContext(ToastCtx)
}

export type Tone = "neutral" | "warning" | "danger" | "success"

/** Плотная плитка показателя (как DashboardKpiTile в WMS). */
export function Stat({ label, value, sub, icon: Icon, tone = "neutral", loading, className, children }: { label: ReactNode; value: ReactNode; sub?: ReactNode; icon?: React.ComponentType<{ className?: string }>; tone?: Tone; loading?: boolean; className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-2xl border border-border/70 bg-card p-3 shadow-sm", tone === "warning" && "border-amber-500/40 bg-amber-500/[0.04]", tone === "danger" && "border-destructive/40 bg-destructive/[0.04]", className)}>
      <div className="flex items-start gap-2">
        {Icon ? (
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-lg", tone === "danger" ? "bg-destructive/15 text-destructive" : tone === "warning" ? "bg-amber-500/15 text-amber-700" : tone === "success" ? "bg-emerald-500/15 text-emerald-700" : "bg-primary/15 text-[oklch(0.45_0.12_120)]")}>
            <Icon className="size-3.5" />
          </span>
        ) : null}
        <span className="ems-label min-w-0 flex-1 leading-tight">{label}</span>
      </div>
      <div className="ems-num mt-1.5 line-clamp-2 break-words text-lg font-semibold leading-tight tracking-tight sm:text-xl">{loading ? <Skeleton className="h-6 w-24" /> : value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted-foreground">{loading ? <Skeleton className="h-3 w-32" /> : sub}</div> : null}
      {children}
    </div>
  )
}

export function Delta({ value, invert = true }: { value: number | null | undefined; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-muted-foreground">нет сравнения</span>
  const r = Math.round(value)
  const bad = invert ? r > 0 : r < 0
  return (
    <span className={cn("ems-num font-medium", r === 0 ? "text-muted-foreground" : bad ? "text-destructive" : "text-emerald-700 dark:text-emerald-400")}>
      {r > 0 ? "▲ +" : r < 0 ? "▼ −" : ""}
      {Math.abs(r)}%
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} />
}
