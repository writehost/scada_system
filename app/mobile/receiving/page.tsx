"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, PackageCheck, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  postManualReceivingDocument,
  resolveReceivingMarkingCode,
  type ResolveReceivingScanResponse,
} from "@/lib/wms-api"

export default function MobileReceivingPage() {
  const codeRef = useRef<HTMLInputElement | null>(null)
  const [code, setCode] = useState("")
  const [itemCode, setItemCode] = useState("")
  const [qty, setQty] = useState("1")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [documentNo, setDocumentNo] = useState("")
  const [resolved, setResolved] = useState<ResolveReceivingScanResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function resolveScan() {
    const raw = code.trim()
    if (!raw) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const data = await resolveReceivingMarkingCode(raw)
      setResolved(data)
      setItemCode(data.primaryItem.itemCode)
      if (!qty || Number(qty) <= 0) setQty("1")
    } catch (e) {
      setResolved(null)
      setError(e instanceof Error ? e.message : "Код не найден или сервер недоступен")
    } finally {
      setBusy(false)
    }
  }

  async function postDocument() {
    const cleanItem = (resolved?.primaryItem.itemCode || itemCode).trim()
    const count = Number(qty)
    if (!cleanItem || !(count > 0) || !targetLocationCode.trim()) {
      setError("Укажите номенклатуру, количество и ячейку")
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await postManualReceivingDocument({
        targetLocationCode,
        documentNo: documentNo || null,
        groupCode: resolved?.primaryItem.productGroup || null,
        groupName: resolved?.primaryItem.productGroupLabel || null,
        lines: [
          {
            itemCode: cleanItem,
            qty: count,
            markingCode: code || null,
            emissionAt: resolved?.expiry.emissionAt || null,
            lotExpiryAt: resolved?.expiry.expiresAt || null,
            batchLabel: resolved?.expiry.emissionAt || null,
          },
        ],
      })
      setMessage(`Приёмка создана: ${result.documentId}, строк ${result.lineCount}`)
      setCode("")
      setResolved(null)
      codeRef.current?.focus()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать приёмку")
    } finally {
      setBusy(false)
    }
  }

  const expiry = resolved?.expiry

  return (
    <div className="min-h-screen bg-background pb-28">
      <Link href="/mobile/receiving/mark" className="mb-3 flex min-h-12 items-center justify-center rounded-xl bg-primary px-3 text-base font-semibold text-primary-foreground">
        Маркировка при приёмке
      </Link>
      <div className="sticky top-0 z-40 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-foreground">Приёмка ТСД</h1>
            <p className="text-xs text-muted-foreground">DataMatrix/ЧЗ или ручной документ</p>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile/scan"><ScanLine className="h-5 w-5" /></Link>
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <Card className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <div className="flex gap-2"><AlertTriangle className="h-5 w-5 shrink-0" />{error}</div>
          </Card>
        ) : null}
        {message ? (
          <Card className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm">
            <div className="flex gap-2"><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />{message}</div>
          </Card>
        ) : null}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <ScanLine className="h-4 w-4 text-primary" />
            Скан маркировки
          </div>
          <div className="space-y-3">
            <Input
              ref={codeRef}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void resolveScan()
              }}
              placeholder="Отсканируйте DataMatrix"
              className="h-12 rounded-xl font-mono"
            />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy || !code.trim()} onClick={() => void resolveScan()}>
              Распознать код
            </Button>
          </div>
        </Card>

        {resolved ? (
          <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-semibold">{resolved.primaryItem.name}</div>
              <Badge variant="secondary" className="rounded-lg">{resolved.crptStatus || "код"}</Badge>
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div>Группа: {resolved.primaryItem.productGroupLabel || resolved.primaryItem.productGroup || "—"}</div>
              <div>GTIN/артикул: {resolved.primaryItem.gtin || resolved.primaryItem.itemCode}</div>
              <div>Дата эмиссии: {expiry?.emissionAt ? new Date(expiry.emissionAt).toLocaleString("ru-RU") : "—"}</div>
              <div>Срок: {expiry?.message || "—"}</div>
            </div>
            {resolved.warnings.length ? (
              <div className="mt-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-900">
                {resolved.warnings.join("; ")}
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <PackageCheck className="h-4 w-4 text-primary" />
            Провести приёмку
          </div>
          <div className="space-y-3">
            <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="Номенклатура / itemCode" className="h-12 rounded-xl font-mono" />
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="Количество" className="h-12 rounded-xl" />
            <Input value={targetLocationCode} onChange={(e) => setTargetLocationCode(e.target.value.toUpperCase())} placeholder="Ячейка, например A01-01" className="h-12 rounded-xl font-mono" />
            <Input value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} placeholder="Номер документа (опционально)" className="h-12 rounded-xl" />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy} onClick={() => void postDocument()}>
              Создать документ приёмки
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
