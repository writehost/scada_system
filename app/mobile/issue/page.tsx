"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, Route, ScanLine, Send } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  getPosPickPlan,
  postPosIssue,
  type PosPickPlanResponse,
} from "@/lib/wms-api"

export default function MobileIssuePage() {
  const [itemCode, setItemCode] = useState("")
  const [qty, setQty] = useState("1")
  const [recipientName, setRecipientName] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [lineName, setLineName] = useState("")
  const [verifyCode, setVerifyCode] = useState("")
  const [plan, setPlan] = useState<PosPickPlanResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const qtyNumber = useMemo(() => Number(qty), [qty])
  const expectedLocations = useMemo(() => new Set((plan?.plan || []).map((p) => p.locationCode.toUpperCase())), [plan])
  const verifyOk = verifyCode.trim() ? expectedLocations.has(verifyCode.trim().toUpperCase()) : null

  async function buildPlan() {
    if (!itemCode.trim() || !(qtyNumber > 0)) {
      setError("Укажите номенклатуру и количество")
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      setPlan(await getPosPickPlan({ itemCode, qty: qtyNumber }))
    } catch (e) {
      setPlan(null)
      setError(e instanceof Error ? e.message : "Не удалось получить FEFO-подбор")
    } finally {
      setBusy(false)
    }
  }

  async function issue() {
    if (!plan || !recipientName.trim() || !targetLocationCode.trim()) {
      setError("Сначала получите FEFO-план, затем укажите получателя и ячейку линии")
      return
    }
    if (verifyOk === false) {
      setError("Отсканированная ячейка не входит в FEFO-маршрут")
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await postPosIssue({
        itemCode: plan.item.itemCode,
        qty: qtyNumber,
        recipientName,
        targetLocationCode,
        lineName,
      })
      setMessage(`Выдано ${result.issuedQty} из ${result.requestedQty}; документов: ${result.documents.length}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Выдача отклонена сервером")
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
            <h1 className="font-semibold text-foreground">Выдача FEFO</h1>
            <p className="text-xs text-muted-foreground">POS-подбор, маршрут, контроль ячейки</p>
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
            <Route className="h-4 w-4 text-primary" />
            Номенклатура и количество
          </div>
          <div className="space-y-3">
            <Input autoFocus value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="Отсканируйте/введите itemCode или GTIN" className="h-12 rounded-xl font-mono" />
            <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="Количество" className="h-12 rounded-xl" />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy} onClick={() => void buildPlan()}>
              Показать остаток и FEFO
            </Button>
          </div>
        </Card>

        {plan ? (
          <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">{plan.item.itemName}</div>
                <div className="font-mono text-xs text-muted-foreground">{plan.item.itemCode}</div>
              </div>
              <Badge variant="secondary" className={plan.enough ? "rounded-lg" : "rounded-lg bg-destructive/10 text-destructive"}>
                {plan.totalAvailable} доступно
              </Badge>
            </div>
            <div className="space-y-2">
              {plan.plan.map((row) => (
                <div key={`${row.lotId}-${row.locationCode}`} className="rounded-xl bg-secondary/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono font-semibold">{row.locationCode}</div>
                      <div className="text-xs text-muted-foreground">
                        Стеллаж {row.rack || "—"} · полка {row.shelf || "—"} · партия {row.lotCode}
                      </div>
                    </div>
                    <Badge variant="secondary" className="rounded-lg">взять {row.takeQty}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Эмиссия: {row.emissionAtIso ? new Date(row.emissionAtIso).toLocaleDateString("ru-RU") : "—"} ·
                    срок: {row.expiryAt ? new Date(row.expiryAt).toLocaleDateString("ru-RU") : "—"} ·
                    доступно: {row.availableQty}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <Send className="h-4 w-4 text-primary" />
            Подтверждение выдачи
          </div>
          <div className="space-y-3">
            <Input value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="Скан ячейки/коробки для сверки" className="h-12 rounded-xl font-mono" />
            {verifyOk !== null ? (
              <div className={verifyOk ? "text-sm text-primary" : "text-sm text-destructive"}>
                {verifyOk ? "Ячейка соответствует FEFO-плану" : "Не та ячейка: серверный FEFO-план требует другую"}
              </div>
            ) : null}
            <Input value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Получатель: ФИО/RFID/код" className="h-12 rounded-xl" />
            <Input value={lineName} onChange={(e) => setLineName(e.target.value)} placeholder="Линия / цех" className="h-12 rounded-xl" />
            <Input value={targetLocationCode} onChange={(e) => setTargetLocationCode(e.target.value.toUpperCase())} placeholder="Ячейка линии, например LINE-1" className="h-12 rounded-xl font-mono" />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy || !plan} onClick={() => void issue()}>
              Выдать по FEFO
            </Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
