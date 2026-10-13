import type { Metadata } from "next"
import Link from "next/link"
import { ActivatePanel } from "@/components/activate-panel"
import { ProductIcon } from "@/components/brand"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { productByKey } from "@/lib/products"
import { inspectInvite } from "@/lib/requests"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Активация доступа", robots: { index: false, follow: false } }

export default async function ActivatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const token = ((await searchParams).token || "").trim()
  const session = await getSession()
  const invite = /^[A-Za-z0-9_-]{20,100}$/.test(token) ? await inspectInvite(token).catch(() => null) : null
  const next = `/activate?token=${encodeURIComponent(token)}`
  const sameUser = session && invite && session.email.toLowerCase() === invite.email.toLowerCase()

  return (
    <>
      <SiteHeader user={session ? { name: session.name, email: session.email, isOwner: session.isOwner } : null} />
      <main id="main" className="mx-auto max-w-2xl px-4 pb-24 pt-[calc(var(--header-h)+48px)]">
        <div className="card p-8 sm:p-10">
          <p className="eyebrow text-brand-600">Приглашение SCADA ID</p>
          {!invite ? (
            <>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Ссылка недействительна</h1>
              <p className="mt-3 text-slate-text">Возможно, приглашение отправили повторно — используйте ссылку из последнего письма. Если не получается, свяжитесь с администратором.</p>
              <Link href="/" className="btn btn-secondary mt-8">На главную</Link>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-3xl font-extrabold tracking-tight">Заявка {invite.publicNo}</h1>
              <p className="mt-3 text-slate-text">
                Одобрен доступ{invite.organizationName ? <> для организации <b className="text-ink">«{invite.organizationName}»</b></> : null}:
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {invite.approvedModules.map((k) => {
                  const p = productByKey(k)
                  return p ? (
                    <li key={k} className="inline-flex items-center gap-2 rounded-xl border border-line py-1 pl-1 pr-3 text-sm font-semibold">
                      <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={26} />
                      {p.name}
                    </li>
                  ) : null
                })}
              </ul>
              <div className="mt-8 border-t border-line pt-6">
                {invite.status === "access_granted" ? (
                  <>
                    <p className="font-semibold text-ok">Доступ уже активирован.</p>
                    <a href="/api/auth/login?next=%2F%23my-apps" className="btn btn-primary mt-4">Открыть мои приложения</a>
                  </>
                ) : invite.status !== "invited" ? (
                  <p className="text-slate-text">Приглашение отозвано администратором.</p>
                ) : invite.expired ? (
                  <p className="text-slate-text">Срок действия приглашения истёк. Попросите администратора отправить его повторно.</p>
                ) : !session ? (
                  <>
                    <p className="text-slate-text">
                      Войдите через SCADA ID под учётной записью <b className="text-ink">{invite.emailHint}</b>. Если вы ещё не завершили регистрацию — сначала пройдите по ссылке из письма SCADA ID.
                    </p>
                    <a href={`/api/auth/login?next=${encodeURIComponent(next)}&hint=${encodeURIComponent(invite.email)}`} className="btn btn-primary mt-5" data-testid="login-to-activate">
                      Войти через SCADA ID
                    </a>
                  </>
                ) : !sameUser ? (
                  <>
                    <p className="text-slate-text">
                      Вы вошли как <b className="text-ink">{session.email}</b>, а приглашение выдано для <b className="text-ink">{invite.emailHint}</b>. Выйдите и войдите под нужной учётной записью.
                    </p>
                    <form action="/api/auth/logout" method="post" className="mt-5">
                      <button type="submit" className="btn btn-secondary">Выйти</button>
                    </form>
                  </>
                ) : (
                  <ActivatePanel token={token} />
                )}
              </div>
            </>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  )
}
