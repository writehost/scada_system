"use client"

import { Printer } from "lucide-react"
import { use } from "react"
import { useApi } from "@/components/api"
import type { Detail } from "@/components/document-card"
import { PrintView, type Org } from "@/components/print-view"
import { Button, Spinner } from "@/components/ui"

export default function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data } = useApi<Detail>(`/api/edi/documents/${id}`)
  const { data: tpl } = useApi<{ templates: Array<{ templateId: string; layout: any; schema: any }>; org: Org | null }>("/api/edi/templates")
  if (!data || !tpl) return <div className="grid h-40 place-items-center"><Spinner /></div>
  const t = tpl.templates.find((x) => x.templateId === (data.document as any).templateId)
  const fields = { ...data.document.fields, templateBody: t?.schema?.body }
  return (
    <div className="bg-muted py-4 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-3 flex max-w-[210mm] items-center justify-between px-2">
        <span className="text-xs text-muted-foreground">Печатная форма. «Печать» → «Сохранить как PDF», чтобы получить PDF.</span>
        <Button variant="primary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Печать / PDF</Button>
      </div>
      <PrintView doc={{ ...data.document, fields }} cp={data.counterparty} lines={data.lines} org={tpl.org} layout={t?.layout} signatures={data.signatures.filter((s) => s.versionNo === data.document.signedVersion)} />
    </div>
  )
}
