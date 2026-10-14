"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { use } from "react"
import { DocumentCard } from "@/components/document-card"

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <div className="mx-auto flex h-full max-w-5xl flex-col">
      <Link href={`/documents?id=${id}`} className="no-print flex items-center gap-1 px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> К журналу
      </Link>
      <div className="min-h-0 flex-1 border-x border-border">
        <DocumentCard id={id} />
      </div>
    </div>
  )
}
