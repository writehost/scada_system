"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ACTION_LABEL, OPERATION_LABEL, STATUS_LABEL } from "@/lib/wms/yms/state-machine"
import type { YmsAction, YmsStatus } from "@/lib/wms/yms/state-machine"
import {
  fetchBoard,
  fetchVisit,
  postDiscrepancy,
  postTransition,
  postVisit,
  saveYard,
  searchOrders,
  type BoardPayload,
  type YardObject,
  type YmsVisit,
} from "@/components/wms/yms/api"
import { YardMap } from "@/components/wms/yms/yard-map"

const FILTER_KEY = "yms.dispatcher.filters"

const KPIS: Array<{ key: keyof BoardPayload["kpis"]; label: string; status?: string; late?: boolean }> = [
  { key: "onYard", label: "На территории" },
  { key: "awaitingEntry", label: "Ждут въезда", status: "at_gate" },
  { key: "awaitingDock", label: "Ждут док", status: "awaiting_dock" },
  { key: "loading", label: "Погрузка", status: "loading" },
  { key: "unloading", label: "Разгрузка", status: "unloading" },
  { key: "readyExit", label: "К выезду", status: "ready_exit" },
  { key: "overdue", label: "Просрочено окно", late: true },
]

const DOCK_STATUS: Record<string, string> = {
  free: "свободен",
  occupied: "занят",
  reserved: "забронирован",
  loading: "погрузка",
  unloading: "разгрузка",
  blocked: "блокировка",
  unavailable: "недоступен",
}

function labelStatus(status: string) {
  return status in STATUS_LABEL ? STATUS_LABEL[status as YmsStatus] : status
}

function labelAction(action: string) {
  return action in ACTION_LABEL ? ACTION_LABEL[action as YmsAction] : action
}

export function YmsDispatcher() {
  const [board, setBoard] = useState<BoardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState("")
  const [operation, setOperation] = useState("")
  const [lateOnly, setLateOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof fetchVisit>> | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftObjects, setDraftObjects] = useState<YardObject[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FILTER_KEY) || "null") as {
        q?: string
        status?: string
        operation?: string
      } | null
      if (saved) {
        setQ(saved.q || "")
        setStatus(saved.status || "")
        setOperation(saved.operation || "")
      }
    } catch {
      /* пустой кэш */
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(FILTER_KEY, JSON.stringify({ q, status, operation }))
  }, [q, status, operation])

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (status) params.set("status", status)
    if (operation) params.set("operation", operation)
    try {
      const data = await fetchBoard(params)
      setBoard(data)
      setError(null)
      setOffline(false)
    } catch (e) {
      setOffline(true)
      setError(e instanceof Error ? e.message : "нет связи с YMS")
    }
  }, [q, status, operation])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 200)
    const poll = window.setInterval(() => {
      void load()
    }, 8000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(poll)
    }
  }, [load])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    let ignore = false
    void fetchVisit(selectedId)
      .then((data) => {
        if (!ignore) setDetail(data)
      })
      .catch((e) => {
        if (!ignore) setError(e instanceof Error ? e.message : "не удалось открыть визит")
      })
    return () => {
      ignore = true
    }
  }, [selectedId, board?.events[0]?.eventId])

  const visits = useMemo(() => {
    const rows = board?.visits ?? []
    return lateOnly ? rows.filter((row) => row.late) : rows
  }, [board, lateOnly])

  const objects = draftObjects ?? board?.objects ?? []

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "ошибка")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h1 className="text-sm font-semibold tracking-tight">Территория</h1>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Номер, заявка, перевозчик"
          className="h-8 w-56"
          aria-label="Поиск визитов"
        />
        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
          className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          aria-label="Тип операции"
        >
          <option value="">Все операции</option>
          {Object.entries(OPERATION_LABEL).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
          Заявка
        </Button>
        <Button
          type="button"
          size="sm"
          variant={editing ? "default" : "outline"}
          onClick={() => {
            setEditing((value) => !value)
            setDraftObjects(null)
          }}
        >
          {editing ? "План" : "Править план"}
        </Button>
        <Link href="/gate" className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline">
          КПП
        </Link>
        <button
          type="button"
          className="text-xs text-muted-foreground"
          onClick={() => {
            void fetch("/api/auth/logout", { method: "POST" }).then(() => {
              window.location.href = "/login"
            })
          }}
        >
          Выход
        </button>
      </div>

      {offline && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive" role="status">
          Связь прервана. Показаны последние данные. {error}
        </div>
      )}
      {!offline && error && (
        <div className="border-b border-destructive/40 px-3 py-1.5 text-xs text-destructive" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 border-b border-border px-3 py-2 sm:grid-cols-4 xl:grid-cols-7">
        {KPIS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setLateOnly(Boolean(item.late))
              setStatus(item.status || "")
            }}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-left hover:border-foreground/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.label}</div>
            <div className="text-lg font-semibold tabular-nums leading-none">{board?.kpis[item.key] ?? "—"}</div>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_300px]">
        <section className="min-h-0 overflow-y-auto border-b border-border lg:border-b-0 lg:border-r">
          {visits.length === 0 && (
            <p className="px-3 py-6 text-sm text-muted-foreground">Нет визитов по этому фильтру.</p>
          )}
          <ul>
            {visits.map((visit) => (
              <li key={visit.visitId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(visit.visitId)}
                  className={`flex w-full flex-col gap-0.5 border-b border-border px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                    selectedId === visit.visitId ? "bg-muted" : ""
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium tracking-wide">{visit.plate}</span>
                    <span className="text-[10px] text-muted-foreground">{visit.visitNo}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {OPERATION_LABEL[visit.operation as keyof typeof OPERATION_LABEL] || visit.operation}
                    {" · "}
                    {labelStatus(visit.status)}
                    {visit.dockCode ? ` · ${visit.dockCode}` : ""}
                    {visit.late ? " · опоздание" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="min-h-[320px] p-2">
          <YardMap
            objects={objects}
            visits={visits}
            selectedId={selectedId}
            editing={editing}
            onSelectVisit={setSelectedId}
            onMove={(objectId, x, y) => {
              setDraftObjects((prev) => {
                const base = prev ?? board?.objects ?? []
                return base.map((object) => (object.objectId === objectId ? { ...object, x, y } : object))
              })
            }}
          />
          {editing && (
            <EditBar
              busy={busy}
              objects={objects}
              onChange={(next) => setDraftObjects(next)}
              onSave={() =>
                void run(async () => {
                  for (const object of draftObjects ?? objects) {
                    await saveYard({ ...object, geometryOnly: Boolean(object.objectId) })
                  }
                  setDraftObjects(null)
                  setEditing(false)
                })
              }
            />
          )}
        </section>

        <aside className="min-h-0 overflow-y-auto border-t border-border p-3 lg:border-l lg:border-t-0">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Доки</h2>
          <ul className="mt-2 space-y-1">
            {objects
              .filter((object) => object.kind === "dock")
              .map((dock) => {
                const visit = (board?.visits ?? []).find((row) => row.visitId === dock.currentVisitId)
                return (
                  <li key={dock.objectId} className="flex items-center justify-between rounded border border-border px-2 py-1 text-xs">
                    <span>{dock.code}</span>
                    <span className="text-muted-foreground">
                      {DOCK_STATUS[dock.status] || dock.status}
                      {visit ? ` · ${visit.plate}` : ""}
                    </span>
                  </li>
                )
              })}
          </ul>
          <h2 className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">События</h2>
          <ul className="mt-2 space-y-2">
            {(board?.events ?? []).slice(0, 12).map((event) => (
              <li key={event.eventId} className="text-xs">
                <div className="font-medium">{event.plate}</div>
                <div className="text-muted-foreground">
                  {labelStatus(event.toStatus)}
                  {event.actorLogin ? ` · ${event.actorLogin}` : ""}
                </div>
              </li>
            ))}
            {(board?.events.length ?? 0) === 0 && (
              <li className="text-xs text-muted-foreground">Журнал пуст.</li>
            )}
          </ul>
        </aside>
      </div>

      <Sheet open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{detail?.visit.plate || "Визит"}</SheetTitle>
          </SheetHeader>
          {detail && (
            <VisitBody
              detail={detail}
              busy={busy}
              objects={objects}
              onAction={(action, extra) =>
                void run(async () => {
                  await postTransition(detail.visit.visitId, { action, ...extra })
                })
              }
              onDiscrepancy={(kind, note) =>
                void run(async () => {
                  await postDiscrepancy(detail.visit.visitId, { kind, note })
                })
              }
            />
          )}
        </SheetContent>
      </Sheet>

      <NewVisitDialog
        open={creating}
        onOpenChange={setCreating}
        onCreate={(body) =>
          void run(async () => {
            const created = await postVisit(body)
            setCreating(false)
            setSelectedId(created.visit.visitId)
          })
        }
      />
    </div>
  )
}

function VisitBody({
  detail,
  busy,
  objects,
  onAction,
  onDiscrepancy,
}: {
  detail: Awaited<ReturnType<typeof fetchVisit>>
  busy: boolean
  objects: YardObject[]
  onAction: (action: string, extra?: Record<string, string>) => void
  onDiscrepancy: (kind: string, note: string) => void
}) {
  const visit = detail.visit
  const [parkingObjectId, setParking] = useState("")
  const [dockObjectId, setDock] = useState("")
  const [reason, setReason] = useState("")
  const parkings = objects.filter((object) => object.kind === "parking" && (object.status === "free" || object.currentVisitId === visit.visitId))
  const docks = objects.filter((object) => object.kind === "dock" && object.status !== "blocked" && object.status !== "unavailable")
  return (
    <div className="mt-4 space-y-3 text-sm">
      <p className="text-muted-foreground">
        {visit.visitNo} · {labelStatus(visit.status)}
        {visit.carrierName ? ` · ${visit.carrierName}` : ""}
      </p>
      <p>
        {visit.driverName || "Водитель не указан"}
        {visit.driverPhone ? ` · ${visit.driverPhone}` : ""}
      </p>
      {visit.counterparty && <p>Контрагент: {visit.counterparty}</p>}
      {detail.order && (
        <div className="rounded-md border border-border p-2 text-xs">
          <div className="font-medium">
            Заказ WMS {detail.order.documentNo || detail.order.documentId}
          </div>
          <div>
            План {detail.order.plannedQty}, подтверждено {detail.order.confirmedQty}, осталось {detail.order.remainingQty}. Палет {detail.order.palletCount}.
          </div>
          {detail.order.locations && <div>Где лежит: {detail.order.locations}</div>}
          <a href={`https://wms.scada25.ru/documents/${detail.order.documentId}`} className="underline">
            Открыть в WMS
          </a>
        </div>
      )}
      {visit.actions.includes("park") && (
        <select value={parkingObjectId} onChange={(e) => setParking(e.target.value)} className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs" aria-label="Стоянка">
          <option value="">Стоянка</option>
          {parkings.map((spot) => (
            <option key={spot.objectId} value={spot.objectId}>
              {spot.code}
            </option>
          ))}
        </select>
      )}
      {visit.actions.includes("assign_dock") && (
        <select value={dockObjectId} onChange={(e) => setDock(e.target.value)} className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs" aria-label="Док">
          <option value="">Док</option>
          {docks.map((dock) => (
            <option key={dock.objectId} value={dock.objectId}>
              {dock.code} · {dock.status}
            </option>
          ))}
        </select>
      )}
      {(visit.actions.includes("cancel") || visit.actions.includes("deny_entry")) && (
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Причина" className="h-8" />
      )}
      <div className="flex flex-wrap gap-1">
        {visit.actions.map((action) => (
          <Button
            key={action}
            type="button"
            size="sm"
            variant={action === "cancel" || action === "deny_entry" ? "outline" : "default"}
            disabled={busy || (action === "park" && !parkingObjectId) || (action === "assign_dock" && !dockObjectId)}
            onClick={() =>
              onAction(action, {
                ...(action === "park" ? { parkingObjectId } : {}),
                ...(action === "assign_dock" ? { dockObjectId } : {}),
                ...(reason ? { reason } : {}),
              })
            }
          >
            {labelAction(action)}
          </Button>
        ))}
      </div>
      {(visit.status === "loading" || visit.status === "unloading") && (
        <DiscrepancyForm disabled={busy} onSubmit={onDiscrepancy} />
      )}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">История</h3>
      <ul className="space-y-1 text-xs">
        {detail.events.map((event) => (
          <li key={event.eventId}>
            {labelStatus(event.toStatus)}
            {event.actorLogin ? ` · ${event.actorLogin}` : ""}
            {event.reason ? ` · ${event.reason}` : ""}
          </li>
        ))}
      </ul>
    </div>
  )
}

function DiscrepancyForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean
  onSubmit: (kind: string, note: string) => void
}) {
  const [kind, setKind] = useState("short")
  const [note, setNote] = useState("")
  return (
    <form
      className="space-y-1"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(kind, note)
      }}
    >
      <div className="text-xs text-muted-foreground">Расхождение с WMS</div>
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-full rounded-md border border-border bg-card px-2 text-xs">
        <option value="short">Недогруз</option>
        <option value="extra">Лишняя палета</option>
        <option value="damage">Повреждение</option>
        <option value="partial_cancel">Частичная отмена</option>
      </select>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Комментарий" className="h-8" />
      <Button type="submit" size="sm" variant="outline" disabled={disabled}>
        Зафиксировать расхождение
      </Button>
    </form>
  )
}

function EditBar({
  objects,
  busy,
  onChange,
  onSave,
}: {
  objects: YardObject[]
  busy: boolean
  onChange: (next: YardObject[]) => void
  onSave: () => void
}) {
  const [code, setCode] = useState("D-05")
  const [name, setName] = useState("Док D-05")
  const [kind, setKind] = useState("dock")
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Input value={code} onChange={(e) => setCode(e.target.value)} className="h-8 w-24" aria-label="Код объекта" />
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-40" aria-label="Название объекта" />
      <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-xs" aria-label="Тип объекта">
        <option value="dock">Док</option>
        <option value="parking">Стоянка</option>
        <option value="gate_in">КПП въезд</option>
        <option value="gate_out">КПП выезд</option>
        <option value="wait_zone">Ожидание</option>
        <option value="building">Здание</option>
      </select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() =>
          onChange([
            ...objects,
            {
              objectId: "",
              code,
              name,
              kind,
              status: "free",
              x: 40,
              y: 40,
              w: kind === "dock" ? 110 : 120,
              h: 48,
              allowedVehicleTypes: [],
              allowedOperations: [],
              currentVisitId: null,
              blockedReason: null,
            },
          ])
        }
      >
        Добавить
      </Button>
      <Button type="button" size="sm" disabled={busy} onClick={onSave}>
        Сохранить план
      </Button>
    </div>
  )
}

function NewVisitDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (body: Record<string, unknown>) => void
}) {
  const [plate, setPlate] = useState("")
  const [operation, setOperation] = useState("OUTBOUND")
  const [carrierName, setCarrier] = useState("")
  const [driverName, setDriver] = useState("")
  const [driverPhone, setPhone] = useState("")
  const [counterparty, setCounterparty] = useState("")
  const [plannedArrival, setPlanned] = useState("")
  const [wmsDocumentId, setDoc] = useState("")
  const [orders, setOrders] = useState<Array<{ documentId: string; documentNo: string | null; plannedQty: number; confirmedQty: number }>>([])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      void searchOrders(wmsDocumentId).then((data) => setOrders(data.orders)).catch(() => setOrders([]))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [open, wmsDocumentId])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Заявка на визит</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            onCreate({
              plate,
              operation,
              carrierName,
              driverName,
              driverPhone,
              counterparty,
              plannedArrival: plannedArrival ? new Date(plannedArrival).toISOString() : null,
              wmsDocumentId: wmsDocumentId || null,
              vehicleType: "tent",
            })
          }}
        >
          <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Госномер" required aria-label="Госномер" />
          <select value={operation} onChange={(e) => setOperation(e.target.value)} className="h-9 w-full rounded-md border border-border bg-card px-2 text-sm" aria-label="Операция">
            {Object.entries(OPERATION_LABEL).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <Input value={carrierName} onChange={(e) => setCarrier(e.target.value)} placeholder="Перевозчик" aria-label="Перевозчик" />
          <Input value={driverName} onChange={(e) => setDriver(e.target.value)} placeholder="Водитель" aria-label="Водитель" />
          <Input value={driverPhone} onChange={(e) => setPhone(e.target.value)} placeholder="Телефон" aria-label="Телефон" />
          <Input value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="Поставщик или получатель" aria-label="Контрагент" />
          <Input type="datetime-local" value={plannedArrival} onChange={(e) => setPlanned(e.target.value)} aria-label="Плановое прибытие" />
          <Input value={wmsDocumentId} onChange={(e) => setDoc(e.target.value)} placeholder="Номер заказа WMS" aria-label="Заказ WMS" />
          {orders.length > 0 && (
            <ul className="max-h-28 overflow-auto text-xs">
              {orders.map((order) => (
                <li key={order.documentId}>
                  <button type="button" className="underline" onClick={() => setDoc(order.documentId)}>
                    {order.documentNo || order.documentId}: {order.confirmedQty}/{order.plannedQty}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <Button type="submit">Создать</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
