import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ProductIcon, StatusPill } from "@/components/brand"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { INTEGRATIONS, PRODUCT_KEYS, productByKey, STATUS_HINT, STATUS_LABEL } from "@/lib/products"
import { getSession, myApps } from "@/lib/session"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = productByKey((await params).slug)
  if (!p) return {}
  return {
    title: `${p.name} — ${p.tagline.toLowerCase()}`,
    description: p.description,
    alternates: { canonical: `/products/${p.key}` },
    openGraph: { title: p.name, description: p.description, url: `/products/${p.key}` },
  }
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!(PRODUCT_KEYS as string[]).includes(slug)) notFound()
  const p = productByKey(slug)!
  const session = await getSession()
  const mine = session ? myApps(session).find((a) => a.key === p.key) : undefined
  const links = INTEGRATIONS.filter((l) => l.a === p.key || l.b === p.key)
  const parent = p.partOf ? productByKey(p.partOf) : undefined

  return (
    <>
      <SiteHeader user={session ? { name: session.name, email: session.email, isOwner: session.isOwner } : null} />
      <main id="main">
        <section className="relative overflow-hidden bg-navy-950 text-white">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse 55% 70% at 85% 30%, color-mix(in oklab, ${p.color} 45%, transparent), transparent 70%)` }} />
          <div aria-hidden="true" className="blueprint pointer-events-none absolute inset-0" />
          <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-[calc(var(--header-h)+48px)] sm:px-6 lg:px-8">
            <nav aria-label="Навигационная цепочка" className="text-sm text-white/55">
              <Link href="/" className="hover:text-white">Главная</Link> <span aria-hidden="true">/</span>{" "}
              <a href="/#products" className="hover:text-white">Продукты</a> <span aria-hidden="true">/</span>{" "}
              <span className="text-white/85">{p.short}</span>
            </nav>
            <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-center">
              <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={80} />
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">{p.name}</h1>
                  <StatusPill status={p.status} label={STATUS_LABEL[p.status]} />
                </div>
                <p className="mt-2 text-xl text-white/70">{p.tagline}</p>
              </div>
            </div>
            <p className="mt-8 max-w-3xl text-lg leading-relaxed text-white/75">{p.description}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              {mine ? (
                mine.url ? (
                  <a href={mine.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Открыть {p.short}</a>
                ) : (
                  <span className="btn btn-ghost-dark" aria-disabled="true">Доступ есть · в сети предприятия</span>
                )
              ) : p.requestable ? (
                <Link href={`/request?modules=${p.key}`} className="btn btn-primary">Запросить доступ</Link>
              ) : null}
              <a href="/#products" className="btn btn-ghost-dark">Все продукты</a>
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1.4fr_1fr] lg:px-8">
          <div className="card p-6 sm:p-8">
            <h2 className="text-2xl font-extrabold tracking-tight">Возможности</h2>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {p.features.map((f) => (
                <li key={f} className="flex gap-3 rounded-xl bg-frost p-4 text-[15px]">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            {p.limitations && p.limitations.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-bold uppercase tracking-wider text-muted">Ограничения текущей версии</h3>
                <ul className="mt-3 space-y-2 text-sm text-slate-text">
                  {p.limitations.map((l) => <li key={l}>— {l}</li>)}
                </ul>
              </div>
            )}
          </div>
          <div className="space-y-6">
            <div className="card p-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Статус</h2>
              <p className="mt-2 font-bold">{STATUS_LABEL[p.status]}</p>
              <p className="mt-1 text-sm text-slate-text">{STATUS_HINT[p.status]}</p>
              {(p.accessNote || parent) && <p className="mt-4 rounded-xl bg-frost px-3 py-2 text-sm text-slate-text">{p.accessNote || `В составе ${parent?.name}`}</p>}
            </div>
            {links.length > 0 && (
              <div className="card p-6">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted">Связи с другими продуктами</h2>
                <ul className="mt-4 space-y-3">
                  {links.map((l) => {
                    const other = productByKey(l.a === p.key ? l.b : l.a)!
                    return (
                      <li key={`${l.a}-${l.b}`} className="flex items-center gap-3 text-sm">
                        <ProductIcon k={other.key} color={other.color} onColor={other.onColor} size={30} />
                        <span className="min-w-0 flex-1">
                          <Link href={`/products/${other.key}`} className="font-semibold hover:text-brand-700">{other.short}</Link>
                          <span className="block text-xs text-muted">{l.label}</span>
                        </span>
                        <span className={`chip ${l.state === "live" ? "bg-[#e6f6ef] text-ok" : "bg-[#fff4e5] text-warn"}`}>{l.state === "live" ? "Работает" : "В планах"}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
