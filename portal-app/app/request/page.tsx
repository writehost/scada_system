import type { Metadata } from "next"
import { RequestWizard, type WizardProduct } from "@/components/request-wizard"
import { SiteFooter } from "@/components/site-footer"
import { SiteHeader } from "@/components/site-header"
import { productByKey, products, STATUS_LABEL } from "@/lib/products"
import { getSession } from "@/lib/session"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Запрос подключения",
  description: "Выберите продукты SCADA SYSTEM и отправьте заявку на подключение. Доступ выдаётся через SCADA ID после подтверждения администратором.",
  alternates: { canonical: "/request" },
}

export default async function RequestPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const session = await getSession()
  const list = products()
  const wizardProducts: WizardProduct[] = list
    .filter((p) => p.requestable || p.status === "development")
    .map((p) => ({
      key: p.key,
      name: p.name,
      tagline: p.tagline,
      status: p.status,
      statusLabel: STATUS_LABEL[p.status],
      color: p.color,
      onColor: p.onColor,
      requestable: p.requestable,
      note: p.partOf ? `в составе ${productByKey(p.partOf)?.short}` : null,
    }))
  const preselected = (sp.modules || "")
    .split(",")
    .map((s) => s.trim())
    .filter((k) => wizardProducts.some((p) => p.key === k && p.requestable))

  return (
    <>
      <SiteHeader user={session ? { name: session.name, email: session.email, isOwner: session.isOwner } : null} />
      <main id="main" className="mx-auto max-w-7xl px-4 pb-24 pt-[calc(var(--header-h)+40px)] sm:px-6 lg:px-8">
        <RequestWizard
          products={wizardProducts}
          preselected={preselected}
          signedIn={Boolean(session)}
          prefill={
            session
              ? {
                  firstName: session.firstName,
                  lastName: session.lastName,
                  email: session.email,
                  company: session.organization?.name || "",
                }
              : {}
          }
        />
      </main>
      <SiteFooter />
    </>
  )
}
