"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, ArrowRightLeft, CheckCircle2, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { getItemStockAvailability, postStockTransfer } from "@/lib/wms-api"

export default function MobileMovementPage() {
  const [itemCode, setItemCode] = useState("")
  const [fromLocationCode, setFromLocationCode] = useState("")
  const [toLocationCode, setToLocationCode] = useState("")
  const [qty, setQty] = useState("1")
  const [availableQty, setAvailableQty] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const qtyNumber = useMemo(() => Number(qty), [qty])
  const qtyOk = Number.isFinite(qtyNumber) && qtyNumber > 0
  const overAvailable = availableQty != null && qtyOk && qtyNumber - availableQty > 1e-9

  async function checkAvailability() {
    if (!itemCode.trim() || !fromLocationCode.trim()) {
      setError("Укажите номенклатуру и ячейку «откуда»")
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await getItemStockAvailability({
        itemCode: itemCode.trim(),
        locationCode: fromLocationCode.trim(),
      })
      setAvailableQty(res.totalAvailable)
      if (res.totalAvailable > 0 && qtyNumber > res.totalAvailable) {
        setQty(String(res.totalAvailable))
      }
    } catch (e) {
      setAvailableQty(null)
      setError(e instanceof Error ? e.message : "Не удалось проверить остаток")
    } finally {
      setBusy(false)
    }
  }

  async function transfer() {
    const from = fromLocationCode.trim()
    const to = toLocationCode.trim()
    if (!itemCode.trim() || !from || !to) {
      setError("Заполните номенклатуру и обе ячейки")
      return
    }
    if (from === to) {
      setError("Ячейки «откуда» и «куда» должны отличаться")
      return
    }
    if (!qtyOk) {
      setError("Укажите количество")
      return
    }
    if (overAvailable) {
      setError(`Нельзя переместить больше ${availableQty} шт`)
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await postStockTransfer({
        itemCode: itemCode.trim(),
        fromLocationCode: from,
        toLocationCode: to,
        qty: qtyNumber,
      })
      const doc = result.documentId ? ` · документ ${result.documentId}` : ""
      setMessage(`Перемещено ${qtyNumber} шт · ${from} → ${to}${doc}`)
      setAvailableQty((prev) => (prev != null ? Math.max(0, prev - qtyNumber) : prev))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Перемещение отклонено сервером")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 z-40 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-foreground">Перемещение</h1>
            <p className="text-xs text-muted-foreground">Между ячейками WMS</p>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile/scan">
              <ScanLine className="h-5 w-5" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <Card className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <div className="flex gap-2">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              {error}
            </div>
          </Card>
        ) : null}
        {message ? (
          <Card className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm">
            <div className="flex gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              {message}
            </div>
          </Card>
        ) : null}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <ArrowRightLeft className="h-4 w-4 text-primary" />
            Номенклатура и маршрут
          </div>
          <div className="space-y-3">
            <Input
              autoFocus
              value={itemCode}
              onChange={(e) => setItemCode(e.target.value)}
              placeholder="itemCode / GTIN"
              className="h-12 rounded-xl font-mono"
            />
            <Input
              value={fromLocationCode}
              onChange={(e) => setFromLocationCode(e.target.value.toUpperCase())}
              placeholder="Откуда — ячейка"
              className="h-12 rounded-xl font-mono"
            />
            <Input
              value={toLocationCode}
              onChange={(e) => setToLocationCode(e.target.value.toUpperCase())}
              placeholder="Куда — ячейка"
              className="h-12 rounded-xl font-mono"
            />
            <Input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="numeric"
              placeholder="Количество"
              className="h-12 rounded-xl"
            />
            {availableQty != null ? (
              <Badge variant="secondary" className="rounded-lg">
                Доступно в «откуда»: {availableQty}
              </Badge>
            ) : null}
            {overAvailable ? (
              <div className="text-sm text-destructive">Количество превышает доступный остаток</div>
            ) : null}
            <Button
              variant="outline"
              className="h-12 w-full rounded-xl"
              disabled={busy}
              onClick={() => void checkAvailability()}
            >
              Проверить остаток
            </Button>
            <Button
              className="h-12 w-full rounded-xl bg-primary text-primary-foreground"
              disabled={busy || overAvailable}
              onClick={() => void transfer()}
            >
              Переместить
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
