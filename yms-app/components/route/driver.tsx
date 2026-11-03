"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { nodeForAddress, type MapGeometry, type Pt } from "@/lib/route/graph"
import { api, ApiError, cache, fmtEta, fmtMeters, listenKeyboardScanner, newRequestId, subscribe } from "@/components/route/client"
import { MapView, type MapForklift, type MapMarker, type MapViewHandle } from "@/components/route/map-view"

/* ---------- типы ответа сервера (driverState) ---------- */
type Scan = {
  scanId: string
  code: string
  codeType: string
  result: "accepted" | "rejected"
  rejectCode: string | null
  message: string
  expected: string | null
  details: Record<string, unknown>
} | null

type RouteResult =
  | { ok: true; polyline: Pt[]; lengthM: number; etaS: number; edgeIds: string[] }
  | { ok: false; code: string; reason: string }

type TaskView = {
  taskId: string
  taskNo: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  version: number
  instruction: string
  sourceCode: string
  destCode: string
  sourceNodeId: string | null
  destNodeId: string | null
  huCode: string
  itemName: string | null
  lotCode: string | null
  qty: number | null
  loaded: boolean
  actions: string[]
  blockedReason: string | null
  cancelReason: string | null
  wmsMovementStatus: string | null
  loadScan: Scan
  addressScan: Scan
  lastScan: Scan
  route: { phase: string; result: RouteResult | null; plannedPickupToDrop: RouteResult | null; from: string } | null
}

type Position = { karaId: string; x: number; y: number; headingDeg: number | null; state: string; label: string; quality: number; source: string }

type DriverState = {
  user?: { login: string; fio: string }
  session: { karaId: string; karaName: string | null; shiftCode: string | null } | null
  forklift?: { id: string; name: string; boardNumber: string | null }
  task?: TaskView | null
  next?: { taskNo: string; typeLabel: string; sourceCode: string; destCode: string; emptyRunM: number | null } | null
  position?: Position | null
  map?: { mapId: string; version: number; revision: number } | null
  openExceptions?: number
  fleet?: { available: boolean; reason: string | null; units: Array<{ id: string; name: string; boardNumber: string | null; enabled: boolean; driverName: string | null; busyBy: string | null }> }
}

type MapPayload = { map: { mapId: string; version: number; revision: number; geometry: MapGeometry } | null; blocks: Array<{ edgeId: string; reason: string }> }

const PROBLEMS: Array<{ kind: string; label: string }> = [
  { kind: "pallet_missing", label: "Палеты нет на месте" },
  { kind: "wrong_pallet_on_place", label: "На месте другая палета" },
  { kind: "pallet_damaged", label: "Палета повреждена" },
  { kind: "address_occupied", label: "Адрес занят" },
  { kind: "no_route", label: "Не проехать" },
  { kind: "forklift_fault", label: "Неисправен погрузчик" },
  { kind: "stop_task", label: "Остановить задание" },
  { kind: "other", label: "Позвать диспетчера" },
]

const ADDRESS_ALT = new Set(["address_full", "address_reserved", "placement_rule", "address_quarantine", "address_inactive"])

function posChip(p: Position | null | undefined): { cls: string; ic: string; text: string } {
  if (!p) return { cls: "bad", ic: "⌖", text: "Позиция не определена" }
  if (p.state === "ok") return { cls: "ok", ic: "⌖", text: "Позиция по меткам" }
  if (p.state === "manual") return { cls: "warn", ic: "✋", text: "Ручная позиция" }
  if (p.state === "degraded") return { cls: "warn", ic: "⌖", text: "Позиция неточная" }
  return { cls: "bad", ic: "⌖", text: "Позиция не определена" }
}

export function RouteDriver() {
  const [state, setState] = useState<DriverState | null>(null)
  const [mapData, setMapData] = useState<MapPayload | null>(null)
  const [online, setOnline] = useState(true)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [modal, setModal] = useState<null | "problem" | "manual" | "decline" | "camera" | "end">(null)
  const [orientation, setOrientation] = useState<"north" | "heading">("north")
  const [others, setOthers] = useState<MapForklift[]>([])
  const [livePos, setLivePos] = useState<Position | null>(null)
  const [actionError, setActionError] = useState<{ message: string; code: string | null } | null>(null)
  const pending = useRef<{ key: string; crid: string } | null>(null)
  const mapRef = useRef<MapViewHandle | null>(null)

  const say = useCallback((text: string) => {
    setToast(text)
    window.setTimeout(() => setToast((t) => (t === text ? null : t)), 3500)
  }, [])

  const loadState = useCallback(async () => {
    try {
      const s = await api<DriverState>("GET", "/api/route/tasks/active")
      setState((prev) => ({ ...prev, ...s, fleet: prev?.fleet }))
      if (s.session) cache.set("driver", s)
      setOnline(true)
      setLivePos(null)
      return s
    } catch (e) {
      if (e instanceof ApiError && e.code === "no_session") return null
      if (e instanceof ApiError && e.offline) {
        setOnline(false)
        const cached = cache.get<DriverState>("driver")
        if (cached) setState((prev) => prev ?? cached)
      }
      return null
    }
  }, [])

  const loadSession = useCallback(async () => {
    try {
      const s = await api<DriverState>("GET", "/api/route/driver/session")
      setState(s)
      setOnline(true)
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        setOnline(false)
        const cached = cache.get<DriverState>("driver")
        if (cached) setState(cached)
      }
    }
  }, [])

  const loadMap = useCallback(async () => {
    try {
      const m = await api<MapPayload>("GET", "/api/route/map/current")
      setMapData(m)
      if (m.map) cache.set("map", m)
    } catch (e) {
      if (e instanceof ApiError && e.offline) {
        const cached = cache.get<MapPayload>("map")
        if (cached) setMapData((prev) => prev ?? cached)
      }
    }
  }, [])

  const loadOthers = useCallback(async () => {
    try {
      const r = await api<{ positions: Position[]; fleet: { units: Array<{ id: string; name: string }> } }>("GET", "/api/route/forklifts")
      const names = new Map(r.fleet.units.map((u) => [u.id, u.name]))
      setOthers(
        r.positions
          .filter((p) => p.state === "ok")
          .map((p) => ({ id: p.karaId, x: p.x, y: p.y, headingDeg: p.headingDeg, state: p.state, label: names.get(p.karaId) || p.karaId }))
      )
    } catch {
      /* другие погрузчики — второстепенно */
    }
  }, [])

  useEffect(() => {
    void loadSession().then(() => loadState())
    void loadMap()
  }, [loadSession, loadState, loadMap])

  // события сервера
  const refreshTimer = useRef<number | null>(null)
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current)
    refreshTimer.current = window.setTimeout(() => void loadState(), 200)
  }, [loadState])

  useEffect(() => {
    const unsub = subscribe(
      (ev) => {
        if (ev.topic === "forklift.position.updated" && typeof ev.data.x === "number") {
          setLivePos(ev.data as unknown as Position)
          return
        }
        if (ev.topic === "map.published" || ev.topic === "route.blocked" || ev.topic === "route.unblocked") void loadMap()
        if (ev.topic === "task.cancelled") say("Задание отменено диспетчером")
        if (ev.topic === "forklift.localization.lost") say("Метки не видны — позиция не определена")
        scheduleRefresh()
      },
      (ok) => {
        setOnline(ok)
        if (ok) scheduleRefresh()
      }
    )
    const onOnline = () => {
      setOnline(true)
      void loadState()
      void loadMap()
    }
    const onOffline = () => setOnline(false)
    window.addEventListener("online", onOnline)
    window.addEventListener("offline", onOffline)
    return () => {
      unsub()
      window.removeEventListener("online", onOnline)
      window.removeEventListener("offline", onOffline)
    }
  }, [loadMap, loadState, say, scheduleRefresh])

  // маршрут пересчитывается сервером от текущей позиции
  const task = state?.task ?? null
  const moving = task && ["ACCEPTED", "EN_ROUTE_PICKUP", "LOAD_CONFIRMED", "EN_ROUTE_DROPOFF"].includes(task.status)
  useEffect(() => {
    if (!state?.session) return
    const id = window.setInterval(() => {
      if (online) void loadState()
      void loadOthers()
    }, moving ? 3000 : 10000)
    void loadOthers()
    return () => window.clearInterval(id)
  }, [state?.session, moving, online, loadState, loadOthers])

  /* ---------- команды ---------- */
  const run = useCallback(
    async (key: string, path: string, body: Record<string, unknown> = {}) => {
      if (!online) {
        say("Нет соединения — действие не отправлено")
        return null
      }
      const crid = pending.current?.key === key ? pending.current.crid : newRequestId()
      pending.current = { key, crid }
      setBusy(true)
      setActionError(null)
      try {
        const res = await api<{ state?: DriverState; decision?: { ok: boolean; message: string }; offered?: string | null }>("POST", path, {
          ...body,
          clientRequestId: crid,
          expectedVersion: task?.version ?? undefined,
        })
        pending.current = null
        if (res.state) setState((prev) => ({ ...prev, ...res.state!, fleet: prev?.fleet }))
        else await loadState()
        return res
      } catch (e) {
        const err = e as ApiError
        if (err.offline) {
          setOnline(false)
          say("Нет соединения. Нажмите ещё раз после восстановления связи — повтор безопасен.")
        } else {
          pending.current = null
          setActionError({ message: err.message, code: err.code })
          if (err.code === "version_conflict" || err.code === "task_reassigned" || err.code === "task_cancelled") await loadState()
          else if (err.status === 409 || err.status === 503) await loadState()
        }
        return null
      } finally {
        setBusy(false)
      }
    },
    [online, task?.version, loadState, say]
  )

  const scan = useCallback(
    async (code: string, method = "scanner", manualReason = "") => {
      if (!task) return
      const toAddress = ["LOAD_CONFIRMED", "EN_ROUTE_DROPOFF", "AT_DROPOFF"].includes(task.status)
      const toPallet = ["EN_ROUTE_PICKUP", "AT_PICKUP", "ACCEPTED"].includes(task.status)
      if (!toAddress && !toPallet) return
      const res = await run(
        `scan:${code}`,
        `/api/route/tasks/${task.taskId}/${toAddress ? "scan-address" : "scan-pallet"}`,
        { code, method, manualReason }
      )
      if (res?.decision && !res.decision.ok) navigator.vibrate?.([120, 60, 120])
    },
    [task, run]
  )

  useEffect(() => listenKeyboardScanner((code) => void scan(code)), [scan])

  /* ---------- карта ---------- */
  const g = mapData?.map?.geometry ?? null
  const pos = livePos && livePos.karaId === state?.session?.karaId ? { ...state?.position, ...livePos } : state?.position ?? null
  const coordOf = useCallback(
    (nodeId: string | null, code: string): Pt | null => {
      if (!g) return null
      const id = nodeId || nodeForAddress(g, code)
      const n = id ? g.nodes.find((x) => x.id === id) : null
      return n ? { x: n.x, y: n.y } : null
    },
    [g]
  )
  const markers = useMemo<MapMarker[]>(() => {
    if (!task) return []
    const out: MapMarker[] = []
    const p = coordOf(task.sourceNodeId, task.sourceCode)
    const d = coordOf(task.destNodeId, task.destCode)
    if (p && !task.loaded) out.push({ ...p, label: task.sourceCode, kind: "pickup" })
    if (d) out.push({ ...d, label: task.destCode, kind: "dropoff" })
    return out
  }, [task, coordOf])
  const forklifts = useMemo<MapForklift[]>(() => {
    const list: MapForklift[] = others.filter((o) => o.id !== state?.session?.karaId)
    if (pos && state?.session) {
      list.push({
        id: state.session.karaId,
        x: pos.x,
        y: pos.y,
        headingDeg: pos.headingDeg ?? null,
        state: pos.state,
        label: state.forklift?.name || state.session.karaName || state.session.karaId,
        self: true,
        carrying: task?.loaded,
      })
    }
    return list
  }, [others, pos, state?.session, state?.forklift?.name, task?.loaded])
  const blocked = useMemo(() => new Set((mapData?.blocks ?? []).map((b) => b.edgeId)), [mapData?.blocks])
  const rr = task?.route?.result
  const routeLine = rr && rr.ok ? rr.polyline : null
  const planned = task && !task.loaded && task.route?.plannedPickupToDrop?.ok ? task.route.plannedPickupToDrop.polyline : null
  const destRack = task?.destCode?.replace(/^FG-/, "") ?? null

  /* ---------- выбор погрузчика ---------- */
  if (state && !state.session) {
    const fleet = state.fleet
    return (
      <div className="rt-root">
        <div className="rt-pick">
          <div className="rt-top">
            <div className="rt-brand">
              SCADA System Route<small>НАВИГАТОР ПОГРУЗЧИКА</small>
            </div>
            <div className="rt-spacer" />
            <span className="rt-who">{state.user?.fio}</span>
            <span className={`rt-chip ${online ? "ok" : "bad"}`}>
              <span className="ic">{online ? "●" : "✕"}</span>
              {online ? "На связи" : "Нет соединения"}
            </span>
          </div>
          <div className="rt-pick-list">
            {!fleet?.available && <p style={{ color: "var(--rt-danger)", fontSize: 18 }}>Флот погрузчиков WMS недоступен: {fleet?.reason || "нет данных"}</p>}
            {fleet?.units.map((u) => (
              <button
                key={u.id}
                type="button"
                disabled={!u.enabled || Boolean(u.busyBy) || busy || !online}
                onClick={async () => {
                  setBusy(true)
                  try {
                    const s = await api<DriverState>("POST", "/api/route/driver/session", { karaId: u.id })
                    setState(s)
                    cache.set("driver", s)
                  } catch (e) {
                    say((e as Error).message)
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                {u.name}
                <small>{u.busyBy ? `занят: ${u.busyBy}` : !u.enabled ? "выключен" : u.driverName ? `закреплён: ${u.driverName}` : "свободен"}</small>
              </button>
            ))}
          </div>
        </div>
        {toast && <div className="rt-toast">{toast}</div>}
      </div>
    )
  }

  /* ---------- основной экран ---------- */
  const pc = posChip(pos as Position | null)
  const st = task?.status
  const enRoute = st === "EN_ROUTE_PICKUP" || st === "ACCEPTED" || st === "EN_ROUTE_DROPOFF" || st === "LOAD_CONFIRMED"
  const lastScan = task?.lastScan
  const rejectedNow = lastScan && lastScan.result === "rejected" ? lastScan : null
  const needAltAddress = Boolean(
    task && task.loaded && ((rejectedNow && rejectedNow.rejectCode && ADDRESS_ALT.has(rejectedNow.rejectCode)) || (actionError?.code && ADDRESS_ALT.has(actionError.code)))
  )

  let step = "Ожидание задания"
  let instr = "Нет активных заданий"
  let instrCls = ""
  let primary: { label: string; onClick: () => void; disabled?: boolean } | null = null
  const secondary: Array<{ label: string; onClick: () => void; cls?: string; disabled?: boolean }> = []

  if (task) {
    step = `${task.typeLabel} · ${task.taskNo}`
    instr = task.instruction
    const v = { expectedVersion: task.version }
    switch (st) {
      case "OFFERED":
        primary = { label: "Принять задание", onClick: () => void run("accept", `/api/route/tasks/${task.taskId}/accept`, v) }
        secondary.push({ label: "Отказаться", onClick: () => setModal("decline") })
        break
      case "ACCEPTED":
      case "EN_ROUTE_PICKUP":
      case "LOAD_CONFIRMED":
      case "EN_ROUTE_DROPOFF":
        primary = { label: "Я на месте", onClick: () => void run("arrive", `/api/route/tasks/${task.taskId}/arrive`, v) }
        break
      case "AT_PICKUP": {
        const ok = task.loadScan?.result === "accepted"
        if (ok) {
          instr = "Палета проверена — подтвердите погрузку"
          instrCls = "ok"
        } else if (rejectedNow) {
          instr = rejectedNow.rejectCode === "wrong_pallet" ? "Неверная палета" : rejectedNow.message
          instrCls = "bad"
        }
        primary = ok
          ? { label: "Подтвердить погрузку", onClick: () => void run("load", `/api/route/tasks/${task.taskId}/confirm-load`, v) }
          : { label: "Сканировать палету", onClick: () => setModal("camera") }
        break
      }
      case "AT_DROPOFF": {
        const ok = task.addressScan?.result === "accepted"
        if (ok) {
          instr = `Адрес ${task.destCode} подтверждён — поставьте палету`
          instrCls = "ok"
        } else if (rejectedNow) {
          instr = rejectedNow.rejectCode === "wrong_address" ? "Неверный адрес" : rejectedNow.message
          instrCls = "bad"
        }
        primary = ok
          ? { label: "Подтвердить постановку", onClick: () => void run("drop", `/api/route/tasks/${task.taskId}/confirm-dropoff`, v).then((r) => r?.offered && say("Предложено следующее задание")) }
          : { label: "Сканировать адрес", onClick: () => setModal("camera") }
        break
      }
      case "PAUSED":
        primary = { label: "Продолжить", onClick: () => void run("resume", `/api/route/tasks/${task.taskId}/pause`, v) }
        break
      case "BLOCKED":
        instrCls = "bad"
        primary = { label: "Сообщить диспетчеру", onClick: () => setModal("problem") }
        if (task.loaded && !needAltAddress) {
          secondary.push({ label: "Другой адрес", onClick: () => void run("newaddr", `/api/route/tasks/${task.taskId}/new-address`, { reason: task.blockedReason || "задание заблокировано" }) })
        }
        break
      default:
        break
    }
    if (needAltAddress) {
      secondary.unshift({ label: "Другой адрес", onClick: () => void run("newaddr", `/api/route/tasks/${task.taskId}/new-address`, { reason: rejectedNow?.message || "адрес недоступен" }) })
    }
    if (st && st !== "OFFERED" && st !== "BLOCKED") secondary.push({ label: "Проблема", onClick: () => setModal("problem"), cls: "danger" })
    if (st === "AT_PICKUP" || st === "AT_DROPOFF") secondary.push({ label: "Вручную", onClick: () => setModal("manual") })
    if (st && ["ACCEPTED", "EN_ROUTE_PICKUP", "LOAD_CONFIRMED", "EN_ROUTE_DROPOFF"].includes(st)) {
      secondary.push({ label: "Пауза", onClick: () => void run("pause", `/api/route/tasks/${task.taskId}/pause`, { expectedVersion: task.version }) })
    }
  } else if (state?.session) {
    secondary.push({ label: "Закончить смену", onClick: () => setModal("end") })
  }

  const scanLine =
    task && (st === "AT_PICKUP" || st === "AT_DROPOFF") && lastScan ? (
      lastScan.result === "accepted" ? (
        <div className="rt-scan ok">
          ✔ {st === "AT_PICKUP" ? `${String(lastScan.details?.itemName ?? "")} · партия ${String(lastScan.details?.lotCode ?? "—")} · ${lastScan.code}` : `${lastScan.code} — адрес верный`}
        </div>
      ) : (
        <div className="rt-scan bad">
          ✕ {lastScan.message}
          {lastScan.expected ? ` · ожидается ${lastScan.expected}, факт ${String((lastScan.details as { actual?: string })?.actual ?? lastScan.code)}` : ""}
        </div>
      )
    ) : null

  return (
    <div className="rt-root">
      <div className="rt-driver">
        <header className="rt-top">
          <div className="rt-brand">
            SCADA System Route<small>НАВИГАТОР ПОГРУЗЧИКА</small>
          </div>
          <span className="rt-kara">{state?.forklift?.name ?? "…"}</span>
          <span className="rt-who">
            {state?.user?.fio}
            {state?.session?.shiftCode ? ` · смена ${state.session.shiftCode}` : ""}
          </span>
          <div className="rt-spacer" />
          <span className={`rt-chip ${online ? "ok" : "bad"}`} role="status">
            <span className="ic">{online ? "●" : "✕"}</span>
            {online ? "На связи" : "Нет соединения"}
          </span>
          <span className={`rt-chip ${pc.cls}`}>
            <span className="ic">{pc.ic}</span>
            {pc.text}
          </span>
          {task && <span className={`rt-chip ${st === "BLOCKED" ? "bad" : st === "PAUSED" ? "warn" : "info"}`}>{task.statusLabel}</span>}
        </header>

        <main className="rt-mapwrap">
          <MapView
            ref={mapRef}
            geometry={g}
            route={routeLine}
            planned={planned}
            markers={markers}
            forklifts={forklifts}
            blockedEdgeIds={blocked}
            highlightRack={destRack}
            followId={state?.session?.karaId ?? null}
            orientation={orientation}
            onOrientationChange={setOrientation}
          />
          {!online && <div className="rt-offline">Нет соединения · показаны последние данные сервера</div>}
          <div className="rt-banner">
            {rr && rr.ok && enRoute && (
              <span className="rt-chip info">
                {fmtMeters(rr.lengthM)} · ≈ {fmtEta(rr.etaS)}
              </span>
            )}
            {rr && !rr.ok && rr.code === "no_path" && <span className="rt-chip bad">⚠ Безопасный маршрут не найден — диспетчер уведомлён</span>}
            {rr && !rr.ok && rr.code === "unknown_node" && <span className="rt-chip bad">⚠ {rr.reason}</span>}
            {task?.route?.from === "pickup" && enRoute && <span className="rt-chip warn">Маршрут от места получения: позиция не определена</span>}
            {!g && <span className="rt-chip bad">Карта склада не опубликована</span>}
          </div>
        </main>

        <section className={`rt-card ${enRoute ? "compact" : ""} ${scanLine || actionError ? "has-scan" : ""}`} aria-live="polite">
          <div className="rt-what">
            <div className="rt-step">{step}</div>
            <div className={`rt-instr ${instrCls}`}>{instr}</div>
            {task && (
              <div className="rt-legs">
                <span className="pick">↑ {task.sourceCode}</span>
                <span className="dim">→</span>
                <span className="drop">↓ {task.destCode}</span>
              </div>
            )}
            {task && !enRoute && (
              <div className="rt-cargo">
                <code>{task.huCode}</code> {task.itemName ? `· ${task.itemName}` : ""} {task.lotCode ? `· партия ${task.lotCode}` : ""}
              </div>
            )}
            {scanLine}
            {actionError && <div className="rt-scan bad">✕ {actionError.message}</div>}
            {st === "BLOCKED" && task?.blockedReason && <div className="rt-scan bad">Причина: {task.blockedReason}. Ожидайте решения диспетчера.</div>}
            {state?.next && !enRoute && (
              <div className="rt-next">
                Следом: {state.next.typeLabel} {state.next.sourceCode} → {state.next.destCode}
              </div>
            )}
          </div>
          <div className="rt-actions">
            {primary && (
              <button type="button" className="rt-btn primary" disabled={busy || !online || primary.disabled} onClick={primary.onClick}>
                {busy ? "…" : primary.label}
              </button>
            )}
            {secondary.length > 0 && (
              <div className="rt-row">
                {secondary.map((b) => (
                  <button key={b.label} type="button" className={`rt-btn ${b.cls ?? ""}`} disabled={busy || (!online && b.label !== "Проблема")} onClick={b.onClick}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {modal === "problem" && task && (
        <ProblemModal
          onClose={() => setModal(null)}
          onSend={async (kind, note) => {
            const r = await run(`problem:${kind}`, `/api/route/tasks/${task.taskId}/exception`, { kind, note })
            if (r) {
              setModal(null)
              say((r as { message?: string }).message || "Диспетчер уведомлён")
            }
          }}
          busy={busy}
        />
      )}
      {modal === "decline" && task && (
        <ReasonModal
          title="Отказаться от задания"
          reasons={["Погрузчик занят", "Неисправность", "Перерыв по графику", "Другое"]}
          onClose={() => setModal(null)}
          onPick={async (reason) => {
            await run("decline", `/api/route/tasks/${task.taskId}/decline`, { reason })
            setModal(null)
          }}
        />
      )}
      {modal === "end" && (
        <ReasonModal
          title="Закончить смену"
          reasons={["Конец смены", "Перерыв", "Смена погрузчика"]}
          onClose={() => setModal(null)}
          onPick={async (reason) => {
            try {
              await api("DELETE", "/api/route/driver/session", { reason })
              setModal(null)
              await loadSession()
            } catch (e) {
              say((e as Error).message)
            }
          }}
        />
      )}
      {modal === "manual" && (
        <ManualModal
          what={task && ["LOAD_CONFIRMED", "EN_ROUTE_DROPOFF", "AT_DROPOFF"].includes(task.status) ? "адрес" : "палету"}
          onClose={() => setModal(null)}
          onSend={async (code, reason) => {
            setModal(null)
            await scan(code, reason ? "manual" : "tablet", reason)
          }}
        />
      )}
      {modal === "camera" && (
        <CameraModal
          onClose={() => setModal(null)}
          onCode={async (code) => {
            setModal(null)
            await scan(code, "camera")
          }}
        />
      )}
      {toast && <div className="rt-toast">{toast}</div>}
    </div>
  )
}

function ProblemModal({ onClose, onSend, busy }: { onClose: () => void; onSend: (kind: string, note: string) => void; busy: boolean }) {
  const [note, setNote] = useState("")
  return (
    <div className="rt-modal-back" onClick={onClose}>
      <div className="rt-modal" role="dialog" aria-label="Проблема" onClick={(e) => e.stopPropagation()}>
        <h2>Что случилось?</h2>
        <div className="rt-grid2">
          {PROBLEMS.map((p) => (
            <button key={p.kind} type="button" className="rt-btn" disabled={busy} onClick={() => onSend(p.kind, note)}>
              {p.label}
            </button>
          ))}
        </div>
        <input className="rt-input" placeholder="Комментарий (необязательно)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="rt-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}

function ReasonModal({ title, reasons, onClose, onPick }: { title: string; reasons: string[]; onClose: () => void; onPick: (r: string) => void }) {
  return (
    <div className="rt-modal-back" onClick={onClose}>
      <div className="rt-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <div className="rt-grid2">
          {reasons.map((r) => (
            <button key={r} type="button" className="rt-btn" onClick={() => onPick(r)}>
              {r}
            </button>
          ))}
        </div>
        <button type="button" className="rt-btn" onClick={onClose}>
          Назад
        </button>
      </div>
    </div>
  )
}

function ManualModal({ what, onClose, onSend }: { what: string; onClose: () => void; onSend: (code: string, reason: string) => void }) {
  const [code, setCode] = useState("")
  const [reason, setReason] = useState("")
  return (
    <div className="rt-modal-back" onClick={onClose}>
      <div className="rt-modal" role="dialog" aria-label="Ручной ввод" onClick={(e) => e.stopPropagation()}>
        <h2>Ввести {what} вручную</h2>
        <input className="rt-input" autoFocus placeholder={what === "адрес" ? "FG-A-32" : "SSCC: 00…"} value={code} onChange={(e) => setCode(e.target.value)} />
        <input className="rt-input" placeholder="Причина ручного ввода (обязательно)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <p style={{ margin: 0, color: "var(--rt-muted)" }}>Ручной ввод разрешён не всем ролям. Сервер проверит права и запишет причину в журнал.</p>
        <div className="rt-row">
          <button type="button" className="rt-btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="rt-btn primary" disabled={!code.trim() || reason.trim().length < 3} onClick={() => onSend(code.trim(), reason.trim())}>
            Проверить
          </button>
        </div>
      </div>
    </div>
  )
}

/** Камера планшета/палеты: BarcodeDetector (QR, DataMatrix, Code128 для SSCC). */
function CameraModal({ onClose, onCode }: { onClose: () => void; onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement | null>(null)
  const [msg, setMsg] = useState("Наведите камеру на код")
  useEffect(() => {
    let stop = false
    let stream: MediaStream | null = null
    const BD = (window as unknown as { BarcodeDetector?: new (o: unknown) => { detect: (v: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> } }).BarcodeDetector
    if (!BD || !navigator.mediaDevices?.getUserMedia) {
      setMsg("Камера на этом устройстве недоступна — используйте сканер или ручной ввод")
      return
    }
    const detector = new BD({ formats: ["qr_code", "data_matrix", "code_128"] })
    void navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s
        if (!video.current) return
        video.current.srcObject = s
        await video.current.play()
        const tick = async () => {
          if (stop || !video.current) return
          try {
            const found = await detector.detect(video.current)
            if (found[0]?.rawValue) {
              onCode(found[0].rawValue)
              return
            }
          } catch {
            /* кадр не распознан */
          }
          window.setTimeout(tick, 200)
        }
        void tick()
      })
      .catch(() => setMsg("Нет доступа к камере"))
    return () => {
      stop = true
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [onCode])
  return (
    <div className="rt-modal-back" onClick={onClose}>
      <div className="rt-modal" role="dialog" aria-label="Сканирование камерой" onClick={(e) => e.stopPropagation()}>
        <h2>Сканирование</h2>
        <video ref={video} muted playsInline style={{ width: "100%", maxHeight: "50vh", background: "#000", borderRadius: 10 }} />
        <p style={{ margin: 0 }}>{msg}. Аппаратный сканер работает всегда, без этого окна.</p>
        <button type="button" className="rt-btn" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}
