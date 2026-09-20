"use client"

import type { Torg1Fields } from "@/lib/wms/torg1"

type Props = {
  fields: Torg1Fields
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium text-foreground">{value || "—"}</div>
    </div>
  )
}

export function Torg1FieldsSummary({ fields }: Props) {
  return (
    <div className="mb-3 rounded-xl border border-border/70 bg-muted/20 p-3 print:hidden">
      <div className="mb-2 text-sm font-semibold">Данные для шаблона</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Организация" value={fields.orgName} />
        <Row label="№ документа" value={fields.documentNo} />
        <Row label="Дата" value={fields.composedAt} />
        <Row label="Поставщик" value={fields.supplier} />
        <Row label="Место приёмки" value={fields.place} />
        <Row label="Строк товара" value={String(fields.lines.length)} />
      </div>
    </div>
  )
}
