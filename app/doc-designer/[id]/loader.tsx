"use client"

import dynamic from "next/dynamic"
import { Toaster } from "@/components/ui/sonner"

/** Studio SDK работает только в браузере. */
const DocumentDesigner = dynamic(() => import("@/components/doc-designer/DocumentDesigner"), {
  ssr: false,
  loading: () => <div className="flex h-screen items-center justify-center bg-[#eceef1] text-[13px] text-slate-500">Загружаем редактор…</div>,
})

export function DocumentDesignerLoader({ templateId }: { templateId: string }) {
  return (
    <>
      <DocumentDesigner templateId={templateId} />
      <Toaster position="bottom-right" />
    </>
  )
}
