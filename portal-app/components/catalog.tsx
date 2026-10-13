"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import type { CategoryKey, ProductKey } from "@/lib/products"
import { ProductIcon, StatusPill } from "./brand"

export type CatalogProduct = {
  key: ProductKey
  name: string
  tagline: string
  description: string
  features: string[]
  categories: CategoryKey[]
  status: string
  statusLabel: string
  color: string
  onColor: string
  requestable: boolean
  partOfName: string | null
  accessNote: string | null
}

export function Catalog({
  products,
  categories,
  openUrls,
}: {
  products: CatalogProduct[]
  categories: { key: CategoryKey; label: string }[]
  /** Продукты, к которым у вошедшего пользователя уже есть доступ (ключ → адрес). */
  openUrls: Partial<Record<ProductKey, string | null>>
}) {
  const [cat, setCat] = useState<CategoryKey | "all">("all")
  const used = useMemo(() => categories.filter((c) => products.some((p) => p.categories.includes(c.key))), [categories, products])
  const shown = cat === "all" ? products : products.filter((p) => p.categories.includes(cat))

  return (
    <div>
      <div role="toolbar" aria-label="Фильтр по категориям" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:px-0">
        {[{ key: "all" as const, label: "Все продукты" }, ...used].map((c) => {
          const n = c.key === "all" ? products.length : products.filter((p) => p.categories.includes(c.key)).length
          const on = cat === c.key
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => setCat(c.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                on ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-text hover:border-brand-300 hover:text-ink"
              }`}
            >
              {c.label}
              <span className={`text-xs ${on ? "text-white/60" : "text-muted"}`}>{n}</span>
            </button>
          )
        })}
      </div>

      {shown.length === 0 ? (
        <div className="card mt-8 p-10 text-center text-slate-text">В этой категории пока нет продуктов.</div>
      ) : (
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => {
            const open = Object.prototype.hasOwnProperty.call(openUrls, p.key)
            const openUrl = openUrls[p.key]
            return (
              <li
                key={p.key}
                className="card group relative flex flex-col overflow-hidden p-6 transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]"
                style={{ ["--pc" as string]: p.color }}
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-1 opacity-80"
                  style={{ background: `linear-gradient(90deg, ${p.color}, color-mix(in oklab, ${p.color} 30%, transparent))` }}
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-25"
                  style={{ background: p.color }}
                />
                <div className="flex items-start justify-between gap-3">
                  <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={48} />
                  <StatusPill status={p.status} label={p.statusLabel} />
                </div>
                <h3 className="mt-5 text-xl font-extrabold tracking-tight">{p.name}</h3>
                <p className="mt-1 text-sm font-semibold text-slate-text">{p.tagline}</p>
                <p className="mt-3 text-[15px] leading-relaxed text-slate-text">{p.description}</p>
                <ul className="mt-4 space-y-2 text-sm text-ink/85">
                  {p.features.slice(0, 4).map((f) => (
                    <li key={f} className="flex gap-2.5">
                      <svg className="mt-0.5 shrink-0" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="8" cy="8" r="7.25" fill="none" stroke={p.color} strokeOpacity=".45" />
                        <path d="m5 8.2 2 2 4-4.4" fill="none" stroke={p.color} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "saturate(1.2) brightness(.8)" }} />
                      </svg>
                      {f}
                    </li>
                  ))}
                </ul>
                {(p.partOfName || p.accessNote) && (
                  <p className="mt-4 rounded-xl bg-frost px-3 py-2 text-xs text-slate-text">{p.accessNote || `В составе ${p.partOfName}`}</p>
                )}
                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  <Link href={`/products/${p.key}`} className="btn btn-sm btn-secondary" aria-label={`Подробнее о ${p.name}`}>
                    Подробнее
                  </Link>
                  {open ? (
                    openUrl ? (
                      <a href={openUrl} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-primary" aria-label={`Открыть ${p.name}`}>
                        Открыть
                      </a>
                    ) : (
                      <span className="btn btn-sm btn-secondary" aria-disabled="true">Доступ есть</span>
                    )
                  ) : p.requestable ? (
                    <Link href={`/request?modules=${p.key}`} className="btn btn-sm btn-primary" aria-label={`Запросить доступ к ${p.name}`}>
                      Запросить доступ
                    </Link>
                  ) : (
                    <span className="btn btn-sm btn-secondary" aria-disabled="true">
                      {p.status === "development" ? "Скоро" : "Включён в каждую заявку"}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
