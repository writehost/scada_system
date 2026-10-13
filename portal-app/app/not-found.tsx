import Link from "next/link"
import { SiteHeader } from "@/components/site-header"

export default function NotFound() {
  return (
    <>
      <SiteHeader user={null} />
      <main id="main" className="mx-auto max-w-xl px-4 pb-24 pt-[calc(var(--header-h)+80px)] text-center">
        <p className="font-mono text-sm font-bold text-brand-600">404</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">Страница не найдена</h1>
        <p className="mt-3 text-slate-text">Возможно, ссылка устарела. Начните с каталога продуктов.</p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/" className="btn btn-primary">На главную</Link>
          <Link href="/request" className="btn btn-secondary">Запросить подключение</Link>
        </div>
      </main>
    </>
  )
}
