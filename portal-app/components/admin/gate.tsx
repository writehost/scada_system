import Link from "next/link"
import { redirect } from "next/navigation"
import { SiteHeader } from "@/components/site-header"
import { getSession, type PortalSession } from "@/lib/session"

/** Серверная проверка прав для страниц админки; API проверяет права отдельно. */
export async function requireOwnerPage(next: string): Promise<PortalSession | React.ReactElement> {
  const s = await getSession()
  if (!s) redirect(`/api/auth/login?next=${encodeURIComponent(next)}`)
  if (!s.isOwner) {
    return (
      <>
        <SiteHeader user={{ name: s.name, email: s.email, isOwner: false }} />
        <main id="main" className="mx-auto max-w-xl px-4 pb-24 pt-[calc(var(--header-h)+64px)] text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">Нет доступа</h1>
          <p className="mt-3 text-slate-text">
            Раздел заявок доступен только администратору экосистемы. Если права выданы недавно, выйдите и войдите снова.
          </p>
          <Link href="/" className="btn btn-secondary mt-8">На главную</Link>
        </main>
      </>
    )
  }
  return s
}
