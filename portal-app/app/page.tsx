import Link from "next/link"
import { Catalog, type CatalogProduct } from "@/components/catalog"
import { EcosystemMap, type MapProduct } from "@/components/ecosystem-map"
import { MyApps } from "@/components/my-apps"
import { Advantages, Audience, CtaBand, Faq, HowItWorks, Scenarios } from "@/components/sections"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { CATEGORIES, INTEGRATIONS, productByKey, products, STATUS_LABEL, type ProductKey } from "@/lib/products"
import { getSession, myApps } from "@/lib/session"
import { siteConfig } from "@/lib/site"

export const dynamic = "force-dynamic"

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const session = await getSession()
  const list = products()
  const apps = session ? myApps(session) : []
  const openUrls: Partial<Record<ProductKey, string | null>> = {}
  for (const a of apps) openUrls[a.key] = a.url

  const mapProducts: MapProduct[] = list.map((p) => ({
    key: p.key,
    name: p.name,
    short: p.short,
    tagline: p.tagline,
    status: p.status,
    statusLabel: STATUS_LABEL[p.status],
    color: p.color,
    onColor: p.onColor,
    requestable: p.requestable,
  }))
  const catalog: CatalogProduct[] = list.map((p) => ({
    key: p.key,
    name: p.name,
    tagline: p.tagline,
    description: p.description,
    features: p.features,
    categories: p.categories,
    status: p.status,
    statusLabel: STATUS_LABEL[p.status],
    color: p.color,
    onColor: p.onColor,
    requestable: p.requestable,
    partOfName: p.partOf ? productByKey(p.partOf)?.name || null : null,
    accessNote: p.accessNote || null,
  }))
  const site = siteConfig()
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "SCADA SYSTEM",
    url: site.publicUrl,
    description: "Единая цифровая экосистема для управления бизнесом.",
  }

  return (
    <>
      <SiteHeader overlay user={session ? { name: session.name, email: session.email, isOwner: session.isOwner } : null} />
      <main id="main">
        <section aria-labelledby="hero-title" className="relative overflow-hidden bg-navy-950 text-white">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_72%_45%,rgb(31_107_255/0.32),transparent_70%),radial-gradient(ellipse_50%_40%_at_10%_0%,rgb(56_189_248/0.12),transparent_70%)]" />
          <div aria-hidden="true" className="blueprint pointer-events-none absolute inset-0" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-20 pt-[calc(var(--header-h)+48px)] sm:px-6 lg:grid-cols-[1fr_1.12fr] lg:gap-6 lg:px-8 lg:pb-28 lg:pt-[calc(var(--header-h)+72px)]">
            <div className="max-w-xl">
              {sp.auth_error && (
                <div role="alert" className="mb-6 rounded-xl border border-[#ff9d8a]/40 bg-[#ff6b4a]/10 px-4 py-3 text-sm text-[#ffd6cc]">
                  {sp.auth_error}
                </div>
              )}
              <p className="eyebrow inline-flex items-center gap-2 rounded-full border border-ice-300/20 bg-white/5 px-3 py-1.5 text-ice-300">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-ice-400" aria-hidden="true" />
                Экосистема промышленного ПО
              </p>
              <h1 id="hero-title" className="display mt-6 text-[clamp(3rem,1.6rem+6vw,5.6rem)]">
                SCADA
                <br />
                <span className="bg-gradient-to-r from-white via-brand-200 to-ice-300 bg-clip-text text-transparent">SYSTEM</span>
              </h1>
              <p className="mt-6 text-xl font-semibold leading-snug text-white sm:text-2xl">
                Единая цифровая экосистема для управления вашим бизнесом.
              </p>
              <p className="mt-4 text-base leading-relaxed text-white/65 sm:text-lg">
                От склада и производства до транспорта, оборудования, энергоресурсов и цифровой идентификации — управляйте процессами в единой экосистеме.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link href="/request" className="btn btn-primary h-12 px-6 text-base">
                  Запросить подключение
                </Link>
                <a href="#products" className="btn btn-ghost-dark h-12 px-6 text-base">
                  Изучить продукты
                </a>
              </div>
              {session ? (
                <a href="#my-apps" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-ice-300 hover:text-white">
                  Перейти к моим приложениям
                  <span aria-hidden="true">→</span>
                </a>
              ) : (
                <a href="/api/auth/login?next=%2F%23my-apps" className="mt-6 inline-flex items-center gap-2.5 text-sm font-semibold text-white/80 hover:text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 4.5 6v5.5c0 4.6 3.1 8 7.5 9.5 4.4-1.5 7.5-4.9 7.5-9.5V6z" /></svg>
                  </span>
                  Войти через SCADA ID
                  <span aria-hidden="true">→</span>
                </a>
              )}
            </div>
            <div className="relative lg:-mr-6">
              <EcosystemMap products={mapProducts} integrations={INTEGRATIONS} />
            </div>
          </div>
        </section>

        {session && (
          <MyApps
            apps={apps}
            firstName={session.firstName}
            organization={session.organization?.name || null}
            productNames={Object.fromEntries(list.map((p) => [p.key, p.name]))}
          />
        )}

        <section id="products" aria-labelledby="products-title" className="mx-auto max-w-7xl px-4 pt-24 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="eyebrow text-brand-600">Каталог</p>
              <h2 id="products-title" className="h-section mt-3">Продукты экосистемы</h2>
              <p className="mt-4 text-lg leading-relaxed text-slate-text">
                Независимые продукты с общим входом и интеграциями. У каждого — свой статус: мы честно показываем, что уже работает, а что в разработке.
              </p>
            </div>
            <Link href="/request" className="btn btn-secondary self-start lg:self-auto">Выбрать несколько продуктов</Link>
          </div>
          <div className="mt-10">
            <Catalog products={catalog} categories={CATEGORIES} openUrls={openUrls} />
          </div>
        </section>

        <Advantages />
        <HowItWorks />
        <Scenarios />
        <Audience />
        <Faq />
        <CtaBand />
      </main>
      <SiteFooter />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  )
}
