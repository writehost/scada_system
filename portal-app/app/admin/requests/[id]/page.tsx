import type { Metadata } from "next"
import { requireOwnerPage } from "@/components/admin/gate"
import { RequestDetail } from "@/components/admin/request-detail"
import { SiteHeader } from "@/components/site-header"
import { products } from "@/lib/products"
import { provisioningConfigured } from "@/lib/scada-id/config"

export const dynamic = "force-dynamic"
export const metadata: Metadata = { title: "Заявка", robots: { index: false, follow: false } }

export default async function AdminRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const s = await requireOwnerPage(`/admin/requests/${id}`)
  if (!("sub" in s)) return s
  return (
    <>
      <SiteHeader user={{ name: s.name, email: s.email, isOwner: true }} />
      <main id="main" className="mx-auto max-w-7xl px-4 pb-24 pt-[calc(var(--header-h)+32px)] sm:px-6 lg:px-8">
        <RequestDetail
          id={id}
          provisioning={provisioningConfigured()}
          me={s.sub}
          products={products().map((p) => ({ key: p.key, short: p.short, name: p.name, color: p.color, onColor: p.onColor, partOf: p.partOf || null }))}
        />
      </main>
    </>
  )
}
