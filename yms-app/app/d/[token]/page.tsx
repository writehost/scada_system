"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Button } from "@/components/ui/button"

type Card = {
  visitNo: string
  plate: string
  trailerPlate: string | null
  driverName: string | null
  status: string
  operation: string
  parkingCode: string | null
  dockCode: string | null
  instruction: string | null
  sentAt: string | null
  deliveredAt: string | null
  acknowledgedAt: string | null
  deliveryNote: string | null
}

export default function DriverVisitPage() {
  const params = useParams<{ token: string }>()
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load(ack = false) {
    const res = await fetch(`/api/driver/${params.token}`, { method: ack ? "POST" : "GET", cache: "no-store" })
    const data = (await res.json().catch(() => ({}))) as Card & { error?: string }
    if (!res.ok) throw new Error(data.error || "визит не найден")
    setCard(data)
    setError(null)
  }

  useEffect(() => {
    void load().catch((e: Error) => setError(e.message))
    const timer = window.setInterval(() => {
      void load().catch(() => setError("нет связи, повтор через несколько секунд"))
    }, 8000)
    return () => window.clearInterval(timer)
  }, [params.token])

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col gap-3 p-4">
      <p className="text-xs tracking-[0.14em] text-muted-foreground">SCADA YMS</p>
      <h1 className="text-2xl font-semibold">Ваш рейс</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {card && (
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <div className="text-2xl font-semibold tracking-wide">{card.plate}</div>
          <div className="text-muted-foreground">{card.visitNo}</div>
          <div className="mt-3">{card.status}</div>
          <div>{card.operation}</div>
          {card.trailerPlate && <div>Прицеп {card.trailerPlate}</div>}
          <div>Стоянка {card.parkingCode || "не назначена"}</div>
          <div>Док {card.dockCode || "не назначен"}</div>
          {card.instruction && <p className="mt-3 font-medium">{card.instruction}</p>}
          {card.sentAt && <p>Вызов отправлен {new Date(card.sentAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</p>}
          <p>{card.deliveredAt ? "Доставка подтверждена" : card.deliveryNote}</p>
          {card.acknowledgedAt ? (
            <p>Получение подтверждено</p>
          ) : (
            card.instruction && (
              <Button type="button" className="mt-3" onClick={() => void load(true).catch((e: Error) => setError(e.message))}>
                Подтвердить получение
              </Button>
            )
          )}
        </section>
      )}
    </main>
  )
}
