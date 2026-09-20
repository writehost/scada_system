"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  actQuickReceiving,
  listQuickReceivings,
  verifyQuickLpn,
  type QuickReceivingRow,
} from "@/lib/wms-api"
import { openLpnLabels } from "@/lib/quick-receiving-label"
import { cn } from "@/lib/utils"

const OFFLINE_KEY = "wms.quick.verify.queue"

type OfflineVerify = {
  receivingId: string
  scannedCode: string
  deviceId: string
  at: string
}

function readQueue(): OfflineVerify[] {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY)
    const parsed = raw ? (JSON.parse(raw) as OfflineVerify[]) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeQueue(rows: OfflineVerify[]) {
  localStorage.setItem(OFFLINE_KEY, JSON.stringify(rows))
}

export default function QuickReceivingMarkPage() {
  const [rows, setRows] = useState<QuickReceivingRow[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [scan, setScan] = useState("")
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null)
  const [offline, setOffline] = useState(false)
  const [queued, setQueued] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const openRows = rows.filter((r) => r.status === "open")
  const active = rows.find((r) => r.receivingId === activeId) ?? openRows[0] ?? null

  async function reload() {
    try {
      const data = await listQuickReceivings()
      setRows(data.rows ?? [])
      setActiveId((prev) => prev ?? data.rows?.find((r) => r.status === "open")?.receivingId ?? null)
      setOffline(false)
      await flushQueue()
    } catch {
      setOffline(true)
    }
  }

  async function flushQueue() {
    const pending = readQueue()
    if (pending.length === 0) {
      setQueued(0)
      return
    }
    const left: OfflineVerify[] = []
    for (const item of pending) {
      try {
        await verifyQuickLpn(item)
      } catch (e) {
        const status = typeof e === "object" && e && "status" in e ? Number((e as { status?: number }).status) : 0
        if (status >= 400 && status < 500 && status !== 408) {
          continue
        }
        left.push(item)
      }
    }
    writeQueue(left)
    setQueued(left.length)
    if (left.length < pending.length) {
      const data = await listQuickReceivings()
      setRows(data.rows ?? [])
    }
  }

  useEffect(() => {
    void reload()
    const id = window.setInterval(() => void reload(), 4000)
    const up = () => {
      setOffline(!navigator.onLine)
      if (navigator.onLine) void flushQueue()
    }
    window.addEventListener("online", up)
    window.addEventListener("offline", up)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("online", up)
      window.removeEventListener("offline", up)
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeId, flash])

  const current = useMemo(() => {
    if (!active) return null
    if (active.mode === "sequential") {
      return (
        active.lpns.find((l) => l.status === "WAITING_VERIFICATION" || l.status === "PRINTED") ||
        active.lpns.find((l) => l.status === "WAITING_PRINT" || l.status === "PRINT_ERROR" || l.status === "CREATED") ||
        null
      )
    }
    return (
      active.lpns.find((l) => l.status === "WAITING_VERIFICATION" || l.status === "PRINTED") ||
      active.lpns.find((l) => l.status === "WAITING_PRINT" || l.status === "CREATED") ||
      null
    )
  }, [active])

  const waitingScan = active?.lpns.filter((l) => l.status === "WAITING_VERIFICATION" || l.status === "PRINTED") ?? []
  const waitingPrint = active?.lpns.filter((l) => ["WAITING_PRINT", "CREATED", "PRINT_ERROR"].includes(l.status)) ?? []

  async function printCurrent() {
    if (!active || !current) return
    setBusy(true)
    try {
      openLpnLabels([current])
      const res = await actQuickReceiving(active.receivingId, "print", {
        lpnCode: current.lpnCode,
        deviceId: localStorage.getItem("tsd_device_id") || "tsd",
      })
      setRows((prev) => prev.map((r) => (r.receivingId === res.receiving.receivingId ? res.receiving : r)))
      setFlash({ ok: true, text: "Отправлено на печать. Наклейте и отсканируйте этот стикер." })
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Ошибка печати" })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  async function printAll() {
    if (!active || waitingPrint.length === 0) return
    setBusy(true)
    try {
      openLpnLabels(waitingPrint)
      const res = await actQuickReceiving(active.receivingId, "print_all", {
        deviceId: localStorage.getItem("tsd_device_id") || "tsd",
      })
      setRows((prev) => prev.map((r) => (r.receivingId === res.receiving.receivingId ? res.receiving : r)))
      setFlash({ ok: true, text: `Напечатано ${waitingPrint.length}. Сканируйте в любом порядке.` })
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : "Ошибка печати" })
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  async function submitScan() {
    if (!active || !scan.trim()) return
    const scannedCode = scan.trim()
    const deviceId = localStorage.getItem("tsd_device_id") || "tsd"
    setBusy(true)
    try {
      const res = await verifyQuickLpn({
        receivingId: active.receivingId,
        scannedCode,
        deviceId,
      })
      setRows((prev) => prev.map((r) => (r.receivingId === res.receiving.receivingId ? res.receiving : r)))
      setFlash({
        ok: true,
        text: `✓ Стикер подтверждён ${res.lpn}${res.next_lpn ? `\nДальше: ${res.next_lpn}` : ""}`,
      })
      setScan("")
      setOffline(false)
    } catch (e) {
      const status = typeof e === "object" && e && "status" in e ? Number((e as { status?: number }).status) : 0
      if (!navigator.onLine || status === 0 || status >= 500) {
        const next = [
          ...readQueue(),
          { receivingId: active.receivingId, scannedCode, deviceId, at: new Date().toISOString() },
        ]
        writeQueue(next)
        setQueued(next.length)
        setOffline(true)
        setFlash({ ok: true, text: "Нет связи. Скан сохранён и уйдёт при появлении сети." })
        setScan("")
      } else {
        setFlash({ ok: false, text: e instanceof Error ? e.message : "Ошибка скана" })
        setScan("")
      }
    } finally {
      setBusy(false)
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }

  if (!active) {
    return (
      <div className="p-4 text-[16px]">
        <h1 className="text-2xl font-semibold">Маркировка при приёмке</h1>
        <p className="mt-3 leading-snug text-muted-foreground">
          Нет открытой быстрой приёмки. Создайте её на десктопе: Приёмка → Быстрая.
        </p>
        <Button className="mt-5 h-14 w-full rounded-xl text-lg" onClick={() => void reload()}>
          Обновить
        </Button>
      </div>
    )
  }

  const needPrint = current && (current.status === "WAITING_PRINT" || current.status === "PRINT_ERROR" || current.status === "CREATED")
  const needScan = Boolean(waitingScan.length)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {offline ? (
        <div className="rounded-xl bg-red-700 px-3 py-2.5 text-center text-base font-semibold text-white">
          Нет связи{queued ? ` · в очереди ${queued}` : ""}
        </div>
      ) : null}

      {openRows.length > 1 ? (
        <select
          className="h-12 rounded-xl border border-border bg-card px-3 text-base"
          value={active.receivingId}
          onChange={(e) => setActiveId(e.target.value)}
        >
          {openRows.map((row) => (
            <option key={row.receivingId} value={row.receivingId}>
              {row.number} · {row.itemName}
            </option>
          ))}
        </select>
      ) : null}

      <div>
        <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Приёмка {active.number}
        </div>
        <div className="text-[20px] font-semibold leading-snug">{active.itemName}</div>
        <div className="text-[16px] text-muted-foreground">LOT {active.lotCode}</div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-xl bg-emerald-50 px-2 py-3">
          <div className="text-[12px] text-muted-foreground">Готово</div>
          <div className="text-3xl font-bold tabular-nums">
            {active.progress.verified} / {active.progress.total}
          </div>
        </div>
        <div className="rounded-xl bg-amber-50 px-2 py-3">
          <div className="text-[12px] text-muted-foreground">Осталось</div>
          <div className="text-3xl font-bold tabular-nums">{Math.max(0, active.progress.total - active.progress.verified)}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 text-center">
        <div className="text-[12px] uppercase tracking-wide text-muted-foreground">
          {needScan ? "Ожидается скан" : "Текущий стикер"}
        </div>
        <div className="mt-1 font-mono text-[34px] font-bold leading-none tracking-wide">
          {needScan && active.mode === "sequential" ? waitingScan[0]?.lpnCode : current?.lpnCode || "—"}
        </div>
        {needPrint ? (
          <Button className="mt-4 h-[72px] w-full rounded-2xl text-xl" disabled={busy} onClick={() => void printCurrent()}>
            {busy ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : null}
            Печатать
          </Button>
        ) : null}
        {needPrint && waitingPrint.length > 1 ? (
          <Button
            variant="outline"
            className="mt-2 h-14 w-full rounded-2xl text-base"
            disabled={busy}
            onClick={() => void printAll()}
          >
            Распечатать все ({waitingPrint.length})
          </Button>
        ) : null}
        {needScan ? (
          <p className="mt-4 text-[17px] font-medium leading-snug text-amber-900">
            Наклейте стикер и отсканируйте его
          </p>
        ) : null}
        {!current ? <p className="mt-3 text-muted-foreground">Все стикеры подтверждены</p> : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submitScan()
        }}
      >
        <Input
          ref={inputRef}
          value={scan}
          onChange={(e) => setScan(e.target.value)}
          placeholder="Сканер DataMatrix"
          className="h-16 rounded-2xl font-mono text-xl"
          autoFocus
          autoComplete="off"
          inputMode="none"
          disabled={busy || !needScan}
        />
      </form>

      {flash ? (
        <div
          className={cn(
            "whitespace-pre-line rounded-2xl px-3 py-3 text-center text-[17px] font-semibold leading-snug",
            flash.ok ? "bg-emerald-700 text-white" : "bg-red-700 text-white"
          )}
        >
          {flash.text}
        </div>
      ) : null}

      {active.mode === "batch" && waitingScan.length > 0 ? (
        <div className="rounded-xl bg-muted/60 px-3 py-2 text-[14px] leading-snug">
          <div className="font-medium">
            {active.progress.verified} / {active.progress.total} подтверждено
          </div>
          <div className="text-muted-foreground">Не подтверждены: {waitingScan.map((l) => l.lpnCode).join(", ")}</div>
        </div>
      ) : null}
    </div>
  )
}
