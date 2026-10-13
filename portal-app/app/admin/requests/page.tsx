import type { Metadata } from "next"
import { requireOwnerPage } from "@/components/admin/gate"
import { RequestsTable } from "@/components/admin/requests-table"
import { SiteHeader } from "@/components/site-header"
import { products } from "@/lib/products"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Заявки на подключение", robots: { index: false, follow: false } }

export default async function AdminRequestsPage() {
  const s = await requireOwnerPage("/admin/requests")
  if (!("sub" in s)) return s
  return (
    <>
      <SiteHeader user={{ name: s.name, email: s.email, isOwner: true }} />
      <main id="main" className="mx-auto max-w-7xl px-4 pb-24 pt-[calc(var(--header-h)+32px)] sm:px-6 lg:px-8">
        <RequestsTable products={products().map((p) => ({ key: p.key, short: p.short, name: p.name, color: p.color, onColor: p.onColor }))} />
      </main>
    </>
  )
}
