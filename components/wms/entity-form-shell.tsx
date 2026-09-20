"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type EntityRailAction = {
  label: string
  onClick?: () => void
  href?: string
  icon?: ReactNode
}

export type EntityRailMeta = {
  label: string
  value: string
}

/**
 * ERPNext-like shell: main content + sticky right rail (actions / attachments / tags / meta).
 */
export function EntityFormShell({
  children,
  title,
  subtitle,
  breadcrumbs,
  rail,
  className,
}: {
  children: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  breadcrumbs?: ReactNode
  rail?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-h-[calc(100vh-5.5rem)] flex-col bg-background", className)}>
      {(breadcrumbs || title) && (
        <div className="border-b border-border px-4 py-3 sm:px-5">
          {breadcrumbs ? <div className="mb-1 text-xs text-muted-foreground">{breadcrumbs}</div> : null}
          {title ? <div className="text-lg font-semibold tracking-tight text-foreground">{title}</div> : null}
          {subtitle ? <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div> : null}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">{children}</div>
        {rail ? (
          <aside className="hidden w-[260px] shrink-0 border-l border-border bg-card/40 lg:block xl:w-[280px]">
            <div className="sticky top-0 max-h-[calc(100vh-5.5rem)] overflow-y-auto p-3">{rail}</div>
          </aside>
        ) : null}
      </div>
    </div>
  )
}

export function EntityRailSection({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn("border-b border-border/70 py-3 first:pt-0 last:border-b-0", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
        {action}
      </div>
      {children}
    </section>
  )
}

export function EntityRailActionList({ actions }: { actions: EntityRailAction[] }) {
  if (!actions.length) return <p className="text-xs text-muted-foreground">—</p>
  return (
    <ul className="space-y-1">
      {actions.map((a) => (
        <li key={a.label}>
          {a.href ? (
            <a
              href={a.href}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/60"
            >
              {a.icon}
              <span>{a.label}</span>
              <span className="ml-auto text-muted-foreground">+</span>
            </a>
          ) : (
            <button
              type="button"
              onClick={a.onClick}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted/60"
            >
              {a.icon}
              <span>{a.label}</span>
              <span className="ml-auto text-muted-foreground">+</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export function EntityRailMetaList({ items }: { items: EntityRailMeta[] }) {
  if (!items.length) return null
  return (
    <dl className="space-y-2">
      {items.map((m) => (
        <div key={m.label}>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</dt>
          <dd className="mt-0.5 text-xs text-foreground">{m.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Two-column field grid for form sections (ERPNext-like). */
export function EntityFieldGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-x-6 gap-y-3 sm:grid-cols-2", className)}>{children}</div>
}

export function EntityField({
  label,
  required,
  children,
  hint,
  className,
}: {
  label: string
  required?: boolean
  children: ReactNode
  hint?: string
  className?: string
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 block text-xs text-muted-foreground">
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

export function EntitySection({
  title,
  action,
  children,
  className,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card/30", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}
