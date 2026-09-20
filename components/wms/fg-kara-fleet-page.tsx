"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Plus, RefreshCw, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  advanceFgMission,
  createFgKara,
  dispatchFgKara,
  getFgKaraFleet,
  listDirectoryProductionLines,
  updateFgKara,
  type FgKaraDriver,
  type FgKaraFleetSnapshot,
  type FgKaraMission,
  type FgKaraRoute,
  type FgKaraUnit,
} from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"
import { FgKaraDriversPanel } from "@/components/wms/fg-kara-drivers-panel"
import { FgKaraAnalyticsPanel } from "@/components/wms/fg-kara-analytics-panel"

type St = "free" | "busy" | "queued" | "off"
type Tab = "dispatch" | "fleet" | "routes" | "tasks" | "drivers" | "stats"

function statusOf(k: FgKaraUnit, missions: FgKaraMission[]): St {
  if (!k.enabled) return "off"
  const mine = missions.filter((m) => m.karaId === k.id)
  if (mine.some((m) => m.status === "active")) return "busy"
  if (mine.some((m) => m.status === "queued")) return "queued"
  return "free"
}

function routeLabel(r: FgKaraRoute) {
  const from = r.lineCode || "—"
  const to =
    r.recommendedRowIds?.[0] ||
    r.stops.find((s) => s.kind === "drop")?.rowId ||
    r.stops.find((s) => s.kind === "drop")?.label ||
    "…"
  return `${from} → ${to}`
}

function driverOf(drivers: FgKaraDriver[], karaId: string) {
  return drivers.find((d) => d.karaId === karaId && d.enabled) || null
}

function activeOf(missions: FgKaraMission[], karaId: string) {
  return missions.find((m) => m.karaId === karaId && m.status === "active") || null
}

function minsAgo(iso: string | null | undefined) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.round((Date.now() - t) / 60000))
}

function fmtElapsed(iso: string | null | undefined) {
  const m = minsAgo(iso)
  if (m == null) return "—"
  if (m < 60) return `${m}м`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`
}

function fmtMin(m: number | null) {
  if (m == null) return "—"
  if (m < 60) return `${m} мин`
  return `${Math.floor(m / 60)}ч ${m % 60}м`
}

/** Потребность: линия / loading point с очередью заданий */
type Demand = {
  key: string
  lineCode: string
  title: string
  waiting: number
  oldestMin: number | null
  target: string | null
  missionIds: string[]
  level: "critical" | "warn" | "ok"
}

function buildDemands(
  missions: FgKaraMission[],
  routes: FgKaraRoute[],
  loadingPoints: Array<{ id: string; name: string; lineCode: string | null; enabled: boolean }>,
  lines: Array<{ code: string; displayName: string }>
): Demand[] {
  const open = missions.filter((m) => m.status === "queued" || (m.status === "active" && m.kind === "urgent"))
  // group by line
  const byLine = new Map<string, FgKaraMission[]>()
  for (const m of open) {
    const line = (m.lineCode || "").trim() || "—"
    const arr = byLine.get(line) || []
    arr.push(m)
    byLine.set(line, arr)
  }

  // also surface enabled loading points with zero queue as "ok"
  const lineCodes = new Set<string>()
  for (const p of loadingPoints) {
    if (p.enabled && p.lineCode) lineCodes.add(p.lineCode)
  }
  for (const l of lines) lineCodes.add(l.code)
  for (const k of byLine.keys()) if (k !== "—") lineCodes.add(k)

  const out: Demand[] = []
  for (const code of lineCodes) {
    const list = byLine.get(code) || []
    const waiting = list.length
    let oldest: number | null = null
    for (const m of list) {
      const age = minsAgo(m.createdAt)
      if (age != null && (oldest == null || age > oldest)) oldest = age
    }
    const targets = new Set<string>()
    for (const m of list) {
      if (m.targetRowId) targets.add(m.targetRowId)
      else {
        const r = routes.find((x) => x.id === m.routeId)
        if (r?.recommendedRowIds?.[0]) targets.add(r.recommendedRowIds[0])
      }
    }
    const lp = loadingPoints.find((p) => p.lineCode === code)
    const lineMeta = lines.find((l) => l.code === code)
    let level: Demand["level"] = "ok"
    if (waiting > 0 && (oldest ?? 0) >= 10) level = "critical"
    else if (waiting > 0) level = "warn"

    // skip pure-ok lines with no loading point and no queue to reduce noise
    if (waiting === 0 && !lp && !lineMeta) continue

    out.push({
      key: code,
      lineCode: code,
      title: lp?.name || lineMeta?.displayName || code,
      waiting,
      oldestMin: oldest,
      target: targets.size ? [...targets].slice(0, 3).join("–") : null,
      missionIds: list.map((m) => m.id),
      level,
    })
  }

  // lines only from queue that weren't in set
  for (const [code, list] of byLine) {
    if (out.some((d) => d.lineCode === code)) continue
    const waiting = list.length
    let oldest: number | null = null
    for (const m of list) {
      const age = minsAgo(m.createdAt)
      if (age != null && (oldest == null || age > oldest)) oldest = age
    }
    out.push({
      key: code,
      lineCode: code,
      title: code,
      waiting,
      oldestMin: oldest,
      target: null,
      missionIds: list.map((m) => m.id),
      level: (oldest ?? 0) >= 10 ? "critical" : waiting > 0 ? "warn" : "ok",
    })
  }

  out.sort((a, b) => {
    const rank = { critical: 0, warn: 1, ok: 2 }
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level]
    return (b.oldestMin ?? -1) - (a.oldestMin ?? -1) || b.waiting - a.waiting
  })
  return out
}

function scoreKara(
  k: FgKaraUnit,
  demand: Demand,
  drivers: FgKaraDriver[],
  missions: FgKaraMission[],
  routes: FgKaraRoute[]
): number {
  const st = statusOf(k, missions)
  if (st === "off") return -100
  let s = 0
  if (st === "free") s += 50
  if (st === "queued") s += 10
  if (st === "busy") s += 0
  if (k.lineCode && k.lineCode === demand.lineCode) s += 30
  const hasRoute = (k.routeIds || []).some((id) => {
    const r = routes.find((x) => x.id === id)
    return r && r.lineCode === demand.lineCode
  })
  if (hasRoute) s += 20
  const d = driverOf(drivers, k.id)
  if (d?.lineCode === demand.lineCode) s += 15
  if (d?.shiftCode) s += 5
  return s
}

export function FgKaraFleetPage() {
  const { toast } = useToast()
  const [fleet, setFleet] = useState<FgKaraFleetSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [lines, setLines] = useState<Array<{ code: string; displayName: string }>>([])
  const [tab, setTab] = useState<Tab>("dispatch")
  const [q, setQ] = useState("")
  const [assignDemand, setAssignDemand] = useState<Demand | null>(null)
  const [drawerKara, setDrawerKara] = useState<FgKaraUnit | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [newNum, setNewNum] = useState("")
  const [newLine, setNewLine] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [routeFilter, setRouteFilter] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [f, lr] = await Promise.all([
        getFgKaraFleet(),
        listDirectoryProductionLines({ activeOnly: true }).catch(() => ({
          lines: [] as Array<{ code: string; displayName: string }>,
        })),
      ])
      setFleet(f)
      setLines(lr.lines || [])
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "загрузка",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  const apply = (n: FgKaraFleetSnapshot) =>
    setFleet({
      ...n,
      tags: fleet?.tags || n.tags || [],
      pathTags: fleet?.pathTags || n.pathTags,
    })

  const karas = fleet?.karas ?? []
  const drivers = fleet?.drivers ?? []
  const missions = fleet?.missions ?? []
  const routes = fleet?.routes ?? []
  const loadingPoints = fleet?.loadingPoints ?? []

  const lineOpts = useMemo(() => {
    const base = lines.map((l) => ({ code: l.code, displayName: l.displayName || l.code }))
    for (const k of karas) {
      if (k.lineCode && !base.some((x) => x.code === k.lineCode)) {
        base.push({ code: k.lineCode, displayName: k.lineCode })
      }
    }
    return base
  }, [lines, karas])

  const demands = useMemo(
    () => buildDemands(missions, routes, loadingPoints, lines),
    [missions, routes, loadingPoints, lines]
  )

  const freeKaras = useMemo(
    () =>
      karas
        .filter((k) => statusOf(k, missions) === "free")
        .sort((a, b) => (a.lineCode || "").localeCompare(b.lineCode || "", "ru")),
    [karas, missions]
  )

  const working = useMemo(() => {
    return karas
      .map((k) => {
        const m = activeOf(missions, k.id) || missions.find((x) => x.karaId === k.id && x.status === "queued")
        if (!m) return null
        return { kara: k, mission: m, driver: driverOf(drivers, k.id) }
      })
      .filter(Boolean) as Array<{ kara: FgKaraUnit; mission: FgKaraMission; driver: FgKaraDriver | null }>
  }, [karas, missions, drivers])

  const kpi = useMemo(() => {
    let free = 0,
      busy = 0,
      queued = 0,
      off = 0
    for (const k of karas) {
      const s = statusOf(k, missions)
      if (s === "free") free++
      else if (s === "busy") busy++
      else if (s === "queued") queued++
      else off++
    }
    return { free, busy, queued, off }
  }, [karas, missions])

  const recommended = useMemo(() => {
    if (!assignDemand) return []
    return [...karas]
      .map((k) => ({
        kara: k,
        score: scoreKara(k, assignDemand, drivers, missions, routes),
        st: statusOf(k, missions),
        driver: driverOf(drivers, k.id),
      }))
      .filter((x) => x.score > -50)
      .sort((a, b) => b.score - a.score || (a.st === "free" ? -1 : 1))
  }, [assignDemand, karas, drivers, missions, routes])

  async function assignKaraToDemand(kara: FgKaraUnit, demand: Demand) {
    setBusyId(kara.id)
    try {
      // prefer existing queued mission for this line without kara conflict
      const open = missions.find(
        (m) =>
          m.status === "queued" &&
          (m.lineCode === demand.lineCode || demand.missionIds.includes(m.id)) &&
          (!m.karaId || m.karaId === kara.id)
      )
      if (open && open.karaId === kara.id) {
        await advanceFgMission(open.id, "accept")
        await load()
      } else {
        const route =
          routes.find((r) => r.enabled && r.lineCode === demand.lineCode && kara.routeIds.includes(r.id)) ||
          routes.find((r) => r.enabled && r.lineCode === demand.lineCode) ||
          null
        const res = await dispatchFgKara({
          karaId: kara.id,
          lineCode: demand.lineCode === "—" ? undefined : demand.lineCode,
          routeId: route?.id,
          kind: "main",
          source: "manual",
          startStatus: "active",
          targetRowId: demand.target?.split("–")[0] || null,
          stops: route?.stops?.length
            ? route.stops
            : [
                { tagId: 1, kind: "pickup", label: demand.title },
                {
                  tagId: 0,
                  kind: "drop",
                  label: demand.target || "Выгрузка",
                  rowId: demand.target?.split("–")[0],
                },
              ],
        })
        if (res.fleet) apply(res.fleet)
        else await load()
      }
      setAssignDemand(null)
      toast({ title: "Назначено", description: `${kara.boardName || kara.name} → ${demand.title}` })
    } catch (e) {
      toast({
        title: "Не назначено",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  async function createKara() {
    if (!newName.trim()) return
    try {
      const r = await createFgKara({
        name: newName.trim(),
        boardName: newName.trim(),
        boardNumber: newNum || null,
        lineCode: newLine || null,
      })
      apply(r.fleet)
      setAddOpen(false)
      setNewName("")
      setNewNum("")
      setNewLine("")
    } catch (e) {
      toast({ title: "Ошибка", description: e instanceof Error ? e.message : "", variant: "destructive" })
    }
  }

  const qq = q.trim().toLowerCase()

  const filteredFree = useMemo(() => {
    if (!qq) return freeKaras
    return freeKaras.filter((k) => {
      const d = driverOf(drivers, k.id)
      return [k.name, k.boardName, k.boardNumber, k.lineCode, d?.fullName].join(" ").toLowerCase().includes(qq)
    })
  }, [freeKaras, drivers, qq])

  const filteredWorking = useMemo(() => {
    if (!qq) return working
    return working.filter(({ kara: k, mission: m, driver: d }) =>
      [k.name, k.boardName, m.routeName, m.palletId, m.targetRowId, d?.fullName, k.lineCode]
        .join(" ")
        .toLowerCase()
        .includes(qq)
    )
  }, [working, qq])

  const filteredDemands = useMemo(() => {
    if (!qq) return demands
    return demands.filter((d) =>
      [d.title, d.lineCode, d.target].join(" ").toLowerCase().includes(qq)
    )
  }, [demands, qq])

  const levelDot = {
    critical: "bg-red-500",
    warn: "bg-amber-500",
    ok: "bg-emerald-500",
  } as const

  return (
    <div className="flex h-[calc(100vh-6.5rem)] min-h-[480px] flex-col">
      {/* header */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-2">
        <h1 className="text-sm font-semibold">Флот ГП</h1>
        <span className="text-xs tabular-nums text-muted-foreground">
          <span className="text-amber-600 dark:text-amber-400">{kpi.busy} в работе</span>
          {" · "}
          <span className="text-emerald-600 dark:text-emerald-400">{kpi.free} свободно</span>
          {" · "}
          {kpi.queued} ожидают
          {kpi.off ? ` · ${kpi.off} offline` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative hidden sm:block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-7 w-44 pl-7 text-xs"
              placeholder="Кара, линия, палета…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3 w-3" />
            Кара
          </Button>
        </div>
      </div>

      {/* nav */}
      <div className="flex shrink-0 gap-0.5 border-b border-border">
        {(
          [
            ["dispatch", "Диспетчерская"],
            ["fleet", "Флот"],
            ["routes", "Маршруты"],
            ["tasks", "Задания"],
            ["drivers", "Водители"],
            ["stats", "Статистика"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium",
              tab === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* DISPATCH BOARD */}
      {tab === "dispatch" ? (
        <div className="mt-2 grid min-h-0 flex-1 gap-2 lg:grid-cols-3">
          {/* DEMAND */}
          <section className="flex min-h-0 flex-col rounded-lg border border-border">
            <header className="shrink-0 border-b border-border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Требуют кару
              <span className="ml-1 font-normal tabular-nums">
                ({filteredDemands.filter((d) => d.waiting > 0).length})
              </span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {filteredDemands.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">нет данных по линиям</p>
              ) : (
                filteredDemands.map((d) => (
                  <div
                    key={d.key}
                    className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2 hover:bg-muted/30"
                    style={{ minHeight: 52 }}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", levelDot[d.level])} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-semibold">{d.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {d.waiting > 0 ? (
                          <>
                            {d.waiting} в очереди
                            {d.oldestMin != null ? ` · ${fmtMin(d.oldestMin)}` : ""}
                            {d.target ? ` · ${d.target}` : ""}
                          </>
                        ) : (
                          "очереди нет"
                        )}
                      </div>
                    </div>
                    {d.waiting > 0 || d.level !== "ok" ? (
                      <Button
                        size="sm"
                        variant={d.level === "critical" ? "default" : "secondary"}
                        className="h-7 shrink-0 text-[11px]"
                        onClick={() => setAssignDemand(d)}
                      >
                        Назначить
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* FREE */}
          <section className="flex min-h-0 flex-col rounded-lg border border-border">
            <header className="shrink-0 border-b border-border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Доступные
              <span className="ml-1 font-normal tabular-nums">({filteredFree.length})</span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {filteredFree.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">свободных нет</p>
              ) : (
                filteredFree.map((k) => {
                  const d = driverOf(drivers, k.id)
                  return (
                    <div
                      key={k.id}
                      className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2 hover:bg-muted/30"
                      style={{ minHeight: 52 }}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => setDrawerKara(k)}
                      >
                        <div className="truncate text-xs font-semibold">
                          {k.boardName || k.name}
                          {k.boardNumber ? (
                            <span className="ml-1 font-normal text-muted-foreground">#{k.boardNumber}</span>
                          ) : null}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[d?.fullName?.split(" ").slice(0, 2).join(" "), k.lineCode].filter(Boolean).join(" · ") ||
                            "без водителя"}
                        </div>
                      </button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 text-[11px]"
                        onClick={() => {
                          // open assign with best demand for this kara's line or first critical
                          const dmd =
                            demands.find((x) => x.waiting > 0 && x.lineCode === k.lineCode) ||
                            demands.find((x) => x.waiting > 0) ||
                            null
                          if (dmd) setAssignDemand(dmd)
                          else toast({ title: "Нет очереди", description: "создайте задание во вкладке Задания" })
                        }}
                      >
                        Назначить
                      </Button>
                    </div>
                  )
                })
              )}
            </div>
          </section>

          {/* WORKING */}
          <section className="flex min-h-0 flex-col rounded-lg border border-border">
            <header className="shrink-0 border-b border-border px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              В работе
              <span className="ml-1 font-normal tabular-nums">({filteredWorking.length})</span>
            </header>
            <div className="min-h-0 flex-1 overflow-auto">
              {filteredWorking.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">никто не занят</p>
              ) : (
                filteredWorking.map(({ kara: k, mission: m, driver: d }) => {
                  const from = m.lineCode || k.lineCode || "—"
                  const to = m.targetRowId || "…"
                  return (
                    <div
                      key={k.id + m.id}
                      className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-2.5 py-2 hover:bg-muted/30"
                      style={{ minHeight: 52 }}
                      onClick={() => setDrawerKara(k)}
                    >
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          m.status === "queued" ? "bg-sky-500" : "bg-amber-500"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-xs font-semibold">{k.boardName || k.name}</span>
                          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                            {fmtElapsed(m.acceptedAt || m.createdAt)}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[d?.fullName?.split(" ").slice(0, 2).join(" "), `${from} → ${to}`].filter(Boolean).join(" · ")}
                        </div>
                        <div className="truncate text-[10px] text-muted-foreground">
                          {[m.palletId, m.kind !== "main" ? m.kind : null].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "fleet" ? (
        <div className="mt-2 min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background text-left text-[10px] uppercase text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-2 py-1.5">Кара</th>
                <th className="px-2 py-1.5">Водитель</th>
                <th className="px-2 py-1.5">Статус</th>
                <th className="px-2 py-1.5">Линия</th>
                <th className="px-2 py-1.5">Задание</th>
              </tr>
            </thead>
            <tbody>
              {karas.map((k) => {
                const st = statusOf(k, missions)
                const d = driverOf(drivers, k.id)
                const m = activeOf(missions, k.id) || missions.find((x) => x.karaId === k.id && x.status === "queued")
                const labels = { free: "свободна", busy: "в работе", queued: "очередь", off: "offline" }
                return (
                  <tr
                    key={k.id}
                    className="cursor-pointer border-b border-border/40 hover:bg-muted/40"
                    onClick={() => setDrawerKara(k)}
                  >
                    <td className="px-2 py-1.5 font-medium">
                      {k.boardName || k.name}
                      {k.boardNumber ? <span className="text-muted-foreground"> #{k.boardNumber}</span> : null}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">{d?.fullName || "—"}</td>
                    <td className="px-2 py-1.5">{labels[st]}</td>
                    <td className="px-2 py-1.5">{k.lineCode || "—"}</td>
                    <td className="max-w-[10rem] truncate px-2 py-1.5 text-muted-foreground">
                      {m ? m.routeName : "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "routes" ? (
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
          <Input
            className="h-8 max-w-xs text-xs"
            placeholder="Фильтр маршрутов…"
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-background text-left text-[10px] uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-2 py-1.5">Маршрут</th>
                  <th className="px-2 py-1.5">Направление</th>
                  <th className="px-2 py-1.5">Линия</th>
                  <th className="px-2 py-1.5">Кары</th>
                </tr>
              </thead>
              <tbody>
                {routes
                  .filter((r) => {
                    const f = routeFilter.trim().toLowerCase()
                    if (!f) return true
                    return [r.name, r.lineCode, ...(r.recommendedRowIds || [])].join(" ").toLowerCase().includes(f)
                  })
                  .map((r) => (
                    <tr key={r.id} className="border-b border-border/40">
                      <td className="px-2 py-1.5 font-medium">{r.name}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">{routeLabel(r)}</td>
                      <td className="px-2 py-1.5">{r.lineCode || "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">
                        {karas.filter((k) => k.routeIds?.includes(r.id)).length}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-auto">
          {missions.slice(0, 120).map((m) => {
            const k = karas.find((x) => x.id === m.karaId)
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-2 border-b border-border/40 px-2 py-1.5 text-xs"
              >
                <div className="min-w-0 truncate">
                  <span className="font-medium">{k?.boardName || k?.name || "—"}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {m.lineCode || "—"} · {m.status}
                    {m.palletId ? ` · ${m.palletId}` : ""}
                  </span>
                </div>
                {(m.status === "active" || m.status === "queued") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[11px]"
                    onClick={() => void advanceFgMission(m.id, "complete").then(() => load())}
                  >
                    Сдать
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {tab === "drivers" ? (
        <div className="min-h-0 flex-1 overflow-auto pt-2">
          <FgKaraDriversPanel fleet={fleet} lineOptions={lineOpts} onFleet={apply} onReload={load} />
        </div>
      ) : null}

      {tab === "stats" ? (
        <div className="min-h-0 flex-1 overflow-auto pt-2">
          <FgKaraAnalyticsPanel />
        </div>
      ) : null}

      {/* ASSIGN DRAWER */}
      {assignDemand ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div>
                <div className="text-sm font-semibold">Назначить кару</div>
                <div className="text-[11px] text-muted-foreground">{assignDemand.title}</div>
              </div>
              <button type="button" className="rounded p-1 hover:bg-muted" onClick={() => setAssignDemand(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-border px-3 py-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Источник</div>
                  <div className="font-medium">{assignDemand.lineCode}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Куда</div>
                  <div className="font-medium">{assignDemand.target || "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Ожидают</div>
                  <div className="font-medium">{assignDemand.waiting}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground">Старейшая</div>
                  <div className="font-medium">{fmtMin(assignDemand.oldestMin)}</div>
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
              <div className="mb-1 px-1 text-[10px] font-semibold uppercase text-muted-foreground">
                Рекомендуемые
              </div>
              {recommended.length === 0 ? (
                <p className="p-2 text-xs text-muted-foreground">нет подходящих кар</p>
              ) : (
                recommended.map(({ kara: k, st, driver: d, score }) => (
                  <div
                    key={k.id}
                    className="mb-1 flex items-center gap-2 rounded-md border border-border/60 px-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold">
                        {k.boardName || k.name}
                        <span className="ml-1 font-normal text-muted-foreground">
                          {st === "free" ? "свободна" : st === "busy" ? "занята" : st === "queued" ? "очередь" : "off"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {[d?.fullName?.split(" ").slice(0, 2).join(" "), k.lineCode].filter(Boolean).join(" · ") ||
                          "—"}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={st === "off" || busyId === k.id}
                      onClick={() => void assignKaraToDemand(k, assignDemand)}
                    >
                      {busyId === k.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Назначить"}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* KARA DRAWER */}
      {drawerKara ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setDrawerKara(null)}>
          <div
            className="flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="text-sm font-semibold">{drawerKara.boardName || drawerKara.name}</div>
              <button type="button" className="rounded p-1 hover:bg-muted" onClick={() => setDrawerKara(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 overflow-auto px-3 py-3 text-xs">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Водитель</div>
                <div className="font-medium">{driverOf(drivers, drawerKara.id)?.fullName || "—"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Линия</div>
                <select
                  className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2"
                  value={drawerKara.lineCode || ""}
                  onChange={(e) =>
                    void updateFgKara(drawerKara.id, { lineCode: e.target.value || null }).then((r) => {
                      apply(r.fleet)
                      const next = r.fleet.karas.find((x) => x.id === drawerKara.id)
                      if (next) setDrawerKara(next)
                    })
                  }
                >
                  <option value="">—</option>
                  {lineOpts.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.displayName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-[10px] uppercase text-muted-foreground">Маршруты</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(drawerKara.routeIds || []).map((id) => {
                    const r = routes.find((x) => x.id === id)
                    return r ? (
                      <span key={id} className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                        {routeLabel(r)}
                      </span>
                    ) : null
                  })}
                  {(drawerKara.routeIds || []).length === 0 ? (
                    <span className="text-muted-foreground">нет</span>
                  ) : null}
                </div>
              </div>
              {(() => {
                const m =
                  activeOf(missions, drawerKara.id) ||
                  missions.find((x) => x.karaId === drawerKara.id && x.status === "queued")
                if (!m) return null
                return (
                  <div className="rounded border border-border px-2 py-1.5">
                    <div className="text-[10px] uppercase text-muted-foreground">Задание</div>
                    <div className="font-medium">{m.routeName}</div>
                    <div className="text-muted-foreground">
                      {[m.status, m.palletId, m.targetRowId].filter(Boolean).join(" · ")}
                    </div>
                    {(m.status === "active" || m.status === "queued") && (
                      <Button
                        size="sm"
                        className="mt-2 h-7"
                        onClick={() => void advanceFgMission(m.id, "complete").then(() => load())}
                      >
                        Сдать
                      </Button>
                    )}
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      ) : null}

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-3 shadow-xl">
            <div className="mb-2 text-sm font-medium">Новая кара</div>
            <div className="space-y-2">
              <Input className="h-8 text-xs" placeholder="Название" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <Input className="h-8 text-xs" placeholder="Номер" value={newNum} onChange={(e) => setNewNum(e.target.value)} />
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                value={newLine}
                onChange={(e) => setNewLine(e.target.value)}
              >
                <option value="">Линия</option>
                {lineOpts.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.displayName}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex justify-end gap-1">
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setAddOpen(false)}>
                Отмена
              </Button>
              <Button size="sm" className="h-7" onClick={() => void createKara()}>
                Создать
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
