"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ACTION_LABEL, STATUS_LABEL } from "@/lib/wms/yms/state-machine"
import type { YmsAction, YmsStatus } from "@/lib/wms/yms/state-machine"
import { fetchBoard, postTransition, postVisit, type YmsVisit } from "@/components/wms/yms/api"

const GATE_ACTIONS = new Set(["arrive", "hold_entry", "allow_entry", "deny_entry", "depart"])

export function YmsGateDesk() {
  const [q, setQ] = useState("")
  const [visits, setVisits] = useState<YmsVisit[]>([])
  const [error, setError] = useState<string | null>(null)
  const [plate, setPlate] = useState("")
  const [driverName, setDriver] = useState("")
  const [busy, setBusy] = useState(false)

  async function load(query: string) {
    const params = new URLSearchParams()
    if (query.trim()) params.set("q", query.trim())
    const board = await fetchBoard(params)
    const gateish = board.visits.filter((visit) =>
      ["expected", "at_gate", "awaiting_entry", "ready_exit"].includes(visit.status)
    )
    setVisits(query.trim() ? board.visits : gateish)
    setError(null)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(q).catch((e) => setError(e instanceof Error ? e.message : "нет связи"))
    }, 200)
    return () => window.clearTimeout(timer)
  }, [q])

  async function act(visitId: string, action: string) {
    setBusy(true)
    try {
      await postTransition(visitId, { action, reason: action === "deny_entry" ? "отказ на КПП" : null })
      await load(q)
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-3xl flex-col gap-3 p-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">КПП</h1>
        <Link href="/" className="text-sm text-muted-foreground underline">
          Диспетчерская
        </Link>
      </div>
      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Госномер"
        className="h-12 text-lg"
        aria-label="Поиск по госномеру"
        autoFocus
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {visits.length === 0 && <li className="text-sm text-muted-foreground">Нет заявок по этому номеру.</li>}
        {visits.map((visit) => (
          <li key={visit.visitId} className="rounded-md border border-border bg-card p-3">
            <div className="text-xl font-semibold tracking-wide">{visit.plate}</div>
            <div className="text-sm text-muted-foreground">
              {visit.visitNo} · {STATUS_LABEL[visit.status as YmsStatus] || visit.status}
              {visit.driverName ? ` · ${visit.driverName}` : ""}
              {visit.late ? " · окно просрочено" : ""}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {visit.actions.filter((action) => GATE_ACTIONS.has(action)).map((action) => (
                <Button key={action} type="button" disabled={busy} className="h-11" onClick={() => void act(visit.visitId, action)}>
                  {ACTION_LABEL[action as YmsAction] || action}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          setBusy(true)
          void postVisit({ plate, driverName, operation: "INBOUND", walkIn: true, vehicleType: "tent" })
            .then(() => {
              setPlate("")
              setDriver("")
              return load(q || plate)
            })
            .catch((e) => setError(e instanceof Error ? e.message : "не удалось зарегистрировать"))
            .finally(() => setBusy(false))
        }}
      >
        <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Внеплановый номер" aria-label="Внеплановый номер" className="h-11" required />
        <Input value={driverName} onChange={(e) => setDriver(e.target.value)} placeholder="Водитель" aria-label="Водитель внепланового визита" className="h-11" />
        <Button type="submit" className="h-11" disabled={busy}>
          На КПП
        </Button>
      </form>
    </div>
  )
}
