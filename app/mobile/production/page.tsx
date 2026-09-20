"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, Factory, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  consumeProductionLineStock,
  type ProductionConsumeResponse,
} from "@/lib/wms-api"

export default function MobileProductionConsumePage() {
  const [locationCode, setLocationCode] = useState("")
  const [itemCode, setItemCode] = useState("")
  const [qty, setQty] = useState("")
  const [datamatrix, setDatamatrix] = useState("")
  const [lineCode, setLineCode] = useState("")
  const [operatorName, setOperatorName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProductionConsumeResponse | null>(null)

  async function consume(mode: "qty" | "datamatrix") {
    if (!locationCode.trim()) {
      setError("Укажите ячейку линии/цеха")
      return
    }
    if (mode === "qty" && (!itemCode.trim() || !(Number(qty) > 0))) {
      setError("Для списания по количеству нужны номенклатура и qty")
      return
    }
    if (mode === "datamatrix" && !datamatrix.trim()) {
      setError("Отсканируйте DataMatrix")
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      setResult(await consumeProductionLineStock({
        locationCode: locationCode.trim(),
        itemCode: itemCode.trim() || undefined,
        qty: mode === "qty" ? Number(qty) : undefined,
        datamatrix: mode === "datamatrix" ? datamatrix.trim() : undefined,
        lineCode: lineCode.trim() || undefined,
        operatorName: operatorName.trim() || undefined,
        sourceSystem: "tsd-android",
      }))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Списание отклонено сервером")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 z-40 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-foreground">Списание с линии</h1>
            <p className="text-xs text-muted-foreground">По кодам или количеству</p>
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

        {result ? (
          <Card className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm">
            <div className="mb-2 flex gap-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              <span>Списание принято сервером</span>
            </div>
            <div className="space-y-1 text-muted-foreground">
              <div>Номенклатура: {result.itemName || result.itemCode || "—"}</div>
              <div>Ячейка: {result.locationCode || "—"}</div>
              <div>Qty: {result.qty ?? "—"}</div>
              <div>Остаток линии: {result.beforeInProductionQty ?? "—"} → {result.afterInProductionQty ?? "—"}</div>
            </div>
          </Card>
        ) : null}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <Factory className="h-4 w-4 text-primary" />
            Линия / цех
          </div>
          <div className="space-y-3">
            <Input autoFocus value={locationCode} onChange={(e) => setLocationCode(e.target.value.toUpperCase())} placeholder="Ячейка линии, например LINE-1" className="h-12 rounded-xl font-mono" />
            <Input value={lineCode} onChange={(e) => setLineCode(e.target.value)} placeholder="Код линии / цеха" className="h-12 rounded-xl" />
            <Input value={operatorName} onChange={(e) => setOperatorName(e.target.value)} placeholder="Оператор / камера / RFID" className="h-12 rounded-xl" />
          </div>
        </Card>

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">По DataMatrix</div>
            <Badge variant="secondary" className="rounded-lg">точно</Badge>
          </div>
          <div className="space-y-3">
            <Input value={datamatrix} onChange={(e) => setDatamatrix(e.target.value)} placeholder="Скан нанесённого кода" className="h-12 rounded-xl font-mono" />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy} onClick={() => void consume("datamatrix")}>
              Списать код
            </Button>
          </div>
        </Card>

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-semibold">По количеству</div>
            <Badge variant="secondary" className="rounded-lg">камера 180000</Badge>
          </div>
          <div className="space-y-3">
            <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="Номенклатура / itemCode" className="h-12 rounded-xl font-mono" />
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="Количество" className="h-12 rounded-xl" />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy} onClick={() => void consume("qty")}>
              Списать количество
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
