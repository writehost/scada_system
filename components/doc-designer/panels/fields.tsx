"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

/** Компактные поля правой панели: в духе приложения, без «студийного» вида. */

export function Section({ title, children, defaultOpen = true, aside }: { title: string; children: ReactNode; defaultOpen?: boolean; aside?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-slate-200 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          {aside}
          <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} />
        </span>
      </button>
      {open && <div className="space-y-2.5 px-3.5 pb-3.5">{children}</div>}
    </section>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[11px] font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="block text-[10.5px] leading-snug text-slate-400">{hint}</span>}
    </label>
  )
}

const inputCls =
  "h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-[12.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-400"

/** Текстовое поле, которое применяет значение по blur/Enter, чтобы не плодить шаги истории. */
export function TextInput({
  value,
  onCommit,
  placeholder,
  disabled,
  mono,
  className,
}: {
  value: string
  onCommit: (v: string) => void
  placeholder?: string
  disabled?: boolean
  mono?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input
      className={cn(inputCls, mono && "text-[11.5px]", className)}
      style={mono ? { fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" } : undefined}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          ;(e.target as HTMLInputElement).blur()
        }
        e.stopPropagation()
      }}
    />
  )
}

export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  suffix,
  disabled,
}: {
  value: number | null
  onCommit: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(value == null ? "" : String(value))
  useEffect(() => setDraft(value == null ? "" : String(value)), [value])
  const commit = () => {
    const n = Number(draft.replace(",", "."))
    if (!Number.isFinite(n)) return setDraft(value == null ? "" : String(value))
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
    if (clamped !== value) onCommit(clamped)
    setDraft(String(clamped))
  }
  return (
    <div className="relative">
      <input
        className={cn(inputCls, suffix && "pr-8")}
        inputMode="decimal"
        value={draft}
        step={step}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault()
            const n = Number(draft.replace(",", ".")) || 0
            const next = Math.round((n + (e.key === "ArrowUp" ? step : -step)) * 100) / 100
            setDraft(String(next))
            onCommit(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, next)))
          }
          e.stopPropagation()
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-slate-400">{suffix}</span>}
    </div>
  )
}

export function NativeSelect<T extends string>({
  value,
  onChange,
  options,
  disabled,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
  disabled?: boolean
}) {
  return (
    <select className={cn(inputCls, "pr-6")} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-0.5">
      <span>
        <span className="block text-[12px] text-slate-700">{label}</span>
        {hint && <span className="block text-[10.5px] leading-snug text-slate-400">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="mt-0.5 scale-90" />
    </label>
  )
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center rounded px-1.5 text-[11.5px] text-slate-600 transition",
            value === o.value ? "bg-white font-medium text-slate-900 shadow-sm" : "hover:text-slate-900"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function SmallButton({ children, onClick, variant = "default", disabled, title, className }: { children: ReactNode; onClick: () => void; variant?: "default" | "primary" | "ghost" | "danger"; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition disabled:opacity-40",
        variant === "default" && "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
        variant === "primary" && "bg-slate-900 text-white hover:bg-slate-800",
        variant === "ghost" && "text-slate-600 hover:bg-slate-100",
        variant === "danger" && "text-red-600 hover:bg-red-50",
        className
      )}
    >
      {children}
    </button>
  )
}

export const inputClassName = inputCls
