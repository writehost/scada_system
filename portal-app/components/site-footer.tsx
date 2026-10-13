import Link from "next/link"
import { products } from "@/lib/products"
import { siteConfig } from "@/lib/site"
import { BrandLogo } from "./brand"

export function SiteFooter() {
  const site = siteConfig()
  const list = products()
  return (
    <footer className="relative overflow-hidden bg-navy-950 text-white/70">
      <div className="blueprint pointer-events-none absolute inset-0 opacity-50" aria-hidden="true" />
      <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-8">
        <div>
          <BrandLogo tone="light" />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/60">
            Единая цифровая экосистема для склада, производства, транспорта, оборудования и цифровой идентификации.
          </p>
          <Link href="/request" className="btn btn-primary btn-sm mt-6">
            Запросить подключение
          </Link>
        </div>

        <nav aria-label="Продукты">
          <h2 className="eyebrow text-white/45">Продукты</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {list.map((p) => (
              <li key={p.key}>
                <Link href={`/products/${p.key}`} className="hover:text-white">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Разделы">
          <h2 className="eyebrow text-white/45">Портал</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><a href="/#products" className="hover:text-white">Каталог продуктов</a></li>
            <li><a href="/#how" className="hover:text-white">Как подключиться</a></li>
            <li><a href="/#scenarios" className="hover:text-white">Сценарии</a></li>
            <li><a href="/#faq" className="hover:text-white">Вопросы и ответы</a></li>
            <li><a href="/api/auth/login?next=%2F%23my-apps" className="hover:text-white">Войти через SCADA ID</a></li>
          </ul>
        </nav>

        <div>
          <h2 className="eyebrow text-white/45">Контакты</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {site.contactEmail && (
              <li>
                <a href={`mailto:${site.contactEmail}`} className="hover:text-white">{site.contactEmail}</a>
              </li>
            )}
            {site.contactPhone && (
              <li>
                <a href={`tel:${site.contactPhone.replace(/[^+\d]/g, "")}`} className="hover:text-white">{site.contactPhone}</a>
              </li>
            )}
            <li><Link href="/request" className="hover:text-white">Форма заявки</Link></li>
          </ul>
          <h2 className="eyebrow mt-8 text-white/45">Документы</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li><Link href="/privacy" className="hover:text-white">Политика конфиденциальности</Link></li>
            <li><Link href="/terms" className="hover:text-white">Условия использования</Link></li>
          </ul>
        </div>
      </div>
      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-white/45 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} SCADA SYSTEM{site.legalEntity ? ` · ${site.legalEntity}` : ""}</span>
          <span>Вход в продукты — только через SCADA ID и с выданными правами.</span>
        </div>
      </div>
    </footer>
  )
}
