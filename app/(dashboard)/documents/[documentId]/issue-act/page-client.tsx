"use client"

import { Suspense, useEffect, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import {
  createDocumentIssueAct,
  getDocumentIssueAct,
  type WmsIssueActResult,
} from "@/lib/wms-api"

function resolveDocumentId(paramValue: string, queryValue: string | null): string {
  const fromQuery = (queryValue || "").trim()
  const fromParam = (paramValue || "").trim()
  if (fromQuery) return fromQuery
  if (fromParam === "__" || fromParam === "__export__") return ""
  return fromParam
}

function IssueActPrintBody() {
  const params = useParams()
  const searchParams = useSearchParams()
  const paramDocumentId = typeof params.documentId === "string" ? params.documentId : ""
  const documentId = resolveDocumentId(paramDocumentId, searchParams.get("documentId"))
  const [act, setAct] = useState<WmsIssueActResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [printed, setPrinted] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!documentId.trim()) {
        setError("Не указан документ")
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        let res: { act: WmsIssueActResult }
        try {
          res = await getDocumentIssueAct(documentId)
        } catch {
          res = await createDocumentIssueAct(documentId)
        }
        if (!cancelled) setAct(res.act)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить акт")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [documentId])

  useEffect(() => {
    if (!act || printed) return
    setPrinted(true)
    window.setTimeout(() => window.print(), 250)
  }, [act, printed])

  return (
    <main className="mx-auto max-w-[760px] bg-white px-10 py-8 text-black print:m-0 print:max-w-none print:p-0">
      <style jsx global>{`
        @page {
          size: A4;
          margin: 14mm;
        }
        @media print {
          body {
            background: white !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="no-print mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
        <span>Печатается только акт, без меню WMS.</span>
        <Button type="button" className="rounded-lg" onClick={() => window.print()}>
          Печать
        </Button>
      </div>

      {loading ? <div className="text-sm text-slate-600">Загрузка акта...</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {act ? (
        <article>
          <h1 className="mb-6 text-center text-xl font-bold uppercase tracking-wide">{act.title}</h1>
          <pre className="whitespace-pre-wrap font-sans text-[14px] leading-7 text-black">{act.bodyText}</pre>
        </article>
      ) : null}
    </main>
  )
}

export default function IssueActPrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-slate-600">Загрузка акта...</div>}>
      <IssueActPrintBody />
    </Suspense>
  )
}
