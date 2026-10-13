import { SiteFooter } from "./site-footer"
import { SiteHeader } from "./site-header"
import { getSession } from "@/lib/session"

export async function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  const s = await getSession()
  return (
    <>
      <SiteHeader user={s ? { name: s.name, email: s.email, isOwner: s.isOwner } : null} />
      <main id="main" className="mx-auto max-w-3xl px-4 pb-24 pt-[calc(var(--header-h)+48px)] sm:px-6">
        <p className="eyebrow text-brand-600">Документы</p>
        <h1 className="mt-3 text-4xl font-extrabold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-muted">Редакция от {updated}</p>
        <div className="mt-10 space-y-6 text-[15px] leading-relaxed text-slate-text [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
