"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { MapGeometry, Pt } from "@/lib/route/graph"
import { api, ApiError, newRequestId, subscribe } from "@/components/route/client"
import { MapView, type MapForklift, type MapHit, type MapMarker } from "@/components/route/map-view"

type Task = {
  taskId: string
  taskNo: string
  type: string
  typeLabel: string
  status: string
  statusLabel: string
  priority: number
  version: number
  karaId: string | null
  driverLogin: string | null
  sourceCode: string
  destCode: string
  huCode: string
  itemName: string | null
  lotCode: string | null
  blockedReason: string | null
  createdAt: string
  wmsRefKind: string | null
  wmsRefId: string | null
}
type Position = { karaId: string; x: number; y: number; headingDeg: number | null; state: string; label: string; ageS: number; source: string }
type Unit = { id: string; name: string; enabled: boolean; autoAssign: boolean; forkliftType: string; profileStatus: string; driverName: string | null }
type Board = {
  fleet: { available: boolean; reason: string | null; units: Unit[] }
  positions: Position[]
  sessions: Array<{ karaId: string; fio: string; login: string; shiftCode: string | null; startedAt: string }>
  tasks: Task[]
  exceptions: Array<{ exceptionId: string; taskId: string | null; taskNo: string | null; kind: string; note: string; karaId: string | null; taskStatus: string | null; at: string; actor: string }>
  blocks: Array<{ blockId: string; edgeId: string; reason: string; createdBy: string; createdAt: string }>
  lineQueues: Record<string, number>
  demand: { wmsTasks: boolean; karaMissions: boolean }
  map: { version: number } | null
}
type MapPayload = { map: { geometry: MapGeometry; version: number } | null }
type TaskDetail = {
  task: Task & { route: { result: { ok: boolean; polyline?: Pt[]; reason?: string } | null; plannedPickupToDrop: { ok: boolean; polyline?: Pt[] } | null } | null; sourceNodeId: string | null; destNodeId: string | null }
  events: Array<{ eventId: string; action: string; from: string | null; to: string | null; actor: string; reason: string | null; at: string }>
}

const TYPES = ["PRODUCTION_PICKUP", "PUTAWAY", "RELOCATION", "SHIPPING_PICK", "STAGING", "RETURN", "EXCEPTION_MOVE"]
const BADGE: Record<string, string> = { BLOCKED: "bad", PAUSED: "warn", COMPLETED: "ok", CANCELLED: "", OFFERED: "warn" }

export function RouteDispatch() {
  const [board, setBoard] = useState<Board | null>(null)
  const [g, setG] = useState<MapGeometry | null>(null)
  const [tab, setTab] = useState<"tasks" | "fleet" | "problems" | "blocks" | "journal" | "create">("tasks")
  const [sel, setSel] = useState<string | null>(null)
  const [detail, setDetail] = useState<TaskDetail | null>(null)
  const [mode, setMode] = useState<null | { kind: "block" } | { kind: "position"; karaId: string }>(null)
  const [pickedEdges, setPickedEdges] = useState<string[]>([])
  const [reason, setReason] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [online, setOnline] = useState(true)
  const [journal, setJournal] = useState<Array<{ eventId: string; taskNo: string; action: string; from: string | null; to: string | null; actor: string; reason: string | null; at: string }>>([])

  const load = useCallback(async () => {
    try {
      setBoard(await api<Board>("GET", "/api/route/board"))
      setOnline(true)
    } catch (e) {
      if ((e as ApiError).offline) setOnline(false)
      else setMsg((e as Error).message)
    }
  }, [])
  const loadMap = useCallback(async () => {
    try {
      const m = await api<MapPayload>("GET", "/api/route/map/current")
      setG(m.map?.geometry ?? null)
    } catch {
      /* карта не опубликована */
    }
  }, [])
  const loadDetail = useCallback(async (id: string | null) => {
    if (!id) return setDetail(null)
    try {
      setDetail(await api<TaskDetail>("GET", `/api/route/tasks/${id}`))
    } catch (e) {
      setMsg((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
    void loadMap()
    const unsub = subscribe(
      (ev) => {
        if (ev.topic === "forklift.position.updated" && typeof ev.data.x === "number") {
          const p = ev.data as unknown as Position
          setBoard((b) => (b ? { ...b, positions: [...b.positions.filter((x) => x.karaId !== p.karaId), { ...p, ageS: 0 }] } : b))
          return
        }
        if (ev.topic === "map.published") void loadMap()
        void load()
      },
      setOnline
    )
    const t = window.setInterval(() => void load(), 15000)
    return () => {
      unsub()
      window.clearInterval(t)
    }
  }, [load, loadMap])
  useEffect(() => {
    void loadDetail(sel)
  }, [sel, loadDetail, board?.tasks])
  useEffect(() => {
    if (tab !== "journal") return
    void api<{ events: typeof journal }>("GET", "/api/route/journal?limit=150").then((r) => setJournal(r.events)).catch(() => undefined)
  }, [tab, board])

  const act = useCallback(
    async (fn: () => Promise<unknown>, ok?: string) => {
      setMsg(null)
      try {
        await fn()
        if (ok) setMsg(ok)
        await load()
      } catch (e) {
        setMsg((e as Error).message)
      }
    },
    [load]
  )

  const names = useMemo(() => new Map((board?.fleet.units ?? []).map((u) => [u.id, u.name])), [board])
  const forklifts: MapForklift[] = (board?.positions ?? []).map((p) => ({
    id: p.karaId,
    x: p.x,
    y: p.y,
    headingDeg: p.headingDeg,
    state: p.state,
    label: names.get(p.karaId) || p.karaId,
  }))
  const blocked = new Set((board?.blocks ?? []).map((b) => b.edgeId))
  const t = detail?.task ?? null
  const markers: MapMarker[] = []
  if (t && g) {
    const s = g.nodes.find((n) => n.id === t.sourceNodeId)
    const d = g.nodes.find((n) => n.id === t.destNodeId)
    if (s) markers.push({ x: s.x, y: s.y, label: t.sourceCode, kind: "pickup" })
    if (d) markers.push({ x: d.x, y: d.y, label: t.destCode, kind: "dropoff" })
  }
  const routeLine = t?.route?.result && t.route.result.ok ? t.route.result.polyline ?? null : null
  const planned = t?.route?.plannedPickupToDrop?.ok ? t.route.plannedPickupToDrop.polyline ?? null : null

  const onMapClick = (hit: MapHit) => {
    if (mode?.kind === "block" && hit.edgeId) {
      setPickedEdges((p) => (p.includes(hit.edgeId!) ? p.filter((x) => x !== hit.edgeId) : [...p, hit.edgeId!]))
    } else if (mode?.kind === "position") {
      const karaId = mode.karaId
      setMode(null)
      void act(() => api("POST", `/api/route/forklifts/${karaId}/position`, { x: hit.world.x, y: hit.world.y }), "Ручная позиция задана (помечена как ручная)")
    }
  }

  const tasks = board?.tasks ?? []
  const open = tasks.filter((x) => !["COMPLETED", "CANCELLED"].includes(x.status))
  const sessions = new Map((board?.sessions ?? []).map((s) => [s.karaId, s]))
  const positions = new Map((board?.positions ?? []).map((p) => [p.karaId, p]))

  return (
    <div className="rt-root">
      <div className="rt-desk">
        <header className="rt-top">
          <div className="rt-brand">
            SCADA System Route<small>ДИСПЕТЧЕРСКАЯ</small>
          </div>
          <a className="rt-chip info" href="/route/editor">
            Редактор карты
          </a>
          <span className="rt-chip info">Карта v{board?.map?.version ?? "—"}</span>
          <div className="rt-spacer" />
          <span className="rt-chip info">Активных: {open.length}</span>
          {Object.entries(board?.lineQueues ?? {}).map(([line, n]) => (
            <span key={line} className="rt-chip warn">
              {line}: {n}
            </span>
          ))}
          <span className={`rt-chip ${online ? "ok" : "bad"}`}>{online ? "● На связи" : "✕ Нет соединения"}</span>
        </header>
        <div className="rt-desk-body">
          <div className="rt-mapwrap">
            <MapView
              geometry={g}
              forklifts={forklifts}
              blockedEdgeIds={blocked}
              highlightEdgeIds={new Set(pickedEdges)}
              route={routeLine}
              planned={planned}
              markers={markers}
              onClick={onMapClick}
            />
            {mode && (
              <div className="rt-offline" style={{ background: "var(--rt-warn)", color: "#111" }}>
                {mode.kind === "block" ? `Выберите проезды на карте (${pickedEdges.length})` : `Нажмите на карте место для ${names.get(mode.karaId) || mode.karaId}`}
                <button type="button" className="rt-mini" style={{ marginLeft: 10 }} onClick={() => (setMode(null), setPickedEdges([]))}>
                  Отмена
                </button>
              </div>
            )}
          </div>
          <aside className="rt-side">
            <nav className="rt-tabs">
              {(
                [
                  ["tasks", "Задания", 0],
                  ["fleet", "Погрузчики", 0],
                  ["problems", "Проблемы", board?.exceptions.length ?? 0],
                  ["blocks", "Проезды", board?.blocks.length ?? 0],
                  ["journal", "Журнал", 0],
                  ["create", "Создать", 0],
                ] as const
              ).map(([k, label, n]) => (
                <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                  {label}
                  {n ? <span className="n">{n}</span> : null}
                </button>
              ))}
            </nav>
            <div className="rt-pane">
              {msg && (
                <div className="rt-item" onClick={() => setMsg(null)}>
                  {msg}
                </div>
              )}
              {!board?.fleet.available && <div className="rt-item">Флот WMS недоступен: {board?.fleet.reason}</div>}

              {tab === "tasks" && (
                <>
                  {tasks.length === 0 && <div className="m">Заданий нет</div>}
                  {tasks.map((x) => (
                    <div key={x.taskId} className={`rt-item ${sel === x.taskId ? "sel" : ""}`} onClick={() => setSel(x.taskId)}>
                      <div className="h">
                        <span>
                          {x.taskNo} · {x.typeLabel}
                        </span>
                        <span className={`rt-badge ${BADGE[x.status] ?? ""}`}>{x.statusLabel}</span>
                      </div>
                      <div>
                        {x.sourceCode} → {x.destCode} · приоритет {x.priority}
                      </div>
                      <div className="m">
                        {x.huCode} {x.itemName ? `· ${x.itemName}` : ""} {x.karaId ? `· ${names.get(x.karaId) || x.karaId}` : ""}
                        {x.blockedReason ? ` · ${x.blockedReason}` : ""}
                      </div>
                      {sel === x.taskId && <TaskActions task={x} units={board?.fleet.units ?? []} act={act} detail={detail} />}
                    </div>
                  ))}
                </>
              )}

              {tab === "fleet" &&
                (board?.fleet.units ?? []).map((u) => {
                  const s = sessions.get(u.id)
                  const p = positions.get(u.id)
                  const active = open.find((x) => x.karaId === u.id)
                  return (
                    <div key={u.id} className="rt-item">
                      <div className="h">
                        <span>{u.name}</span>
                        <span className={`rt-badge ${s ? "ok" : ""}`}>{s ? `занят: ${s.fio}` : "свободен"}</span>
                      </div>
                      <div className="m">
                        Позиция:{" "}
                        <span className={`rt-badge ${p?.state === "ok" ? "ok" : p?.state === "manual" || p?.state === "degraded" ? "warn" : "bad"}`}>
                          {p ? `${p.label}` : "не определена"}
                        </span>{" "}
                        {active ? `· ${active.taskNo} ${active.statusLabel}` : "· без задания"}
                      </div>
                      <div className="rt-row">
                        <button
                          type="button"
                          className="rt-mini"
                          onClick={() => void act(() => api("PATCH", `/api/route/forklifts/${u.id}`, { autoAssign: !u.autoAssign }))}
                        >
                          Автоназначение: {u.autoAssign ? "вкл" : "выкл"}
                        </button>
                        <button type="button" className="rt-mini" onClick={() => setMode({ kind: "position", karaId: u.id })}>
                          Ручная позиция
                        </button>
                      </div>
                    </div>
                  )
                })}

              {tab === "problems" &&
                (board?.exceptions ?? []).map((x) => <ProblemItem key={x.exceptionId} x={x} act={act} names={names} />)}

              {tab === "blocks" && (
                <>
                  <div className="rt-item">
                    <div className="h">Закрыть участок маршрута</div>
                    <label className="rt-field">
                      Причина
                      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ремонт, пролив, загрузка…" />
                    </label>
                    <div className="rt-row">
                      <button type="button" className="rt-mini" onClick={() => setMode({ kind: "block" })}>
                        Выбрать на карте ({pickedEdges.length})
                      </button>
                      <button
                        type="button"
                        className="rt-mini primary"
                        disabled={!pickedEdges.length || reason.trim().length < 3}
                        onClick={() =>
                          void act(async () => {
                            const r = await api<{ rechecked: Array<{ ok: boolean }> }>("POST", "/api/route/map/blocks", { edgeIds: pickedEdges, reason })
                            setPickedEdges([])
                            setMode(null)
                            setReason("")
                            const bad = r.rechecked.filter((x) => !x.ok).length
                            setMsg(bad ? `Закрыто. Без маршрута осталось заданий: ${bad} — они заблокированы` : "Закрыто, маршруты пересчитаны")
                          })
                        }
                      >
                        Закрыть
                      </button>
                    </div>
                  </div>
                  {(board?.blocks ?? []).map((b) => (
                    <div key={b.blockId} className="rt-item">
                      <div className="h">
                        <span>Проезд {b.edgeId}</span>
                        <button type="button" className="rt-mini" onClick={() => void act(() => api("DELETE", `/api/route/map/blocks?blockId=${b.blockId}`), "Проезд открыт")}>
                          Открыть
                        </button>
                      </div>
                      <div className="m">
                        {b.reason} · {b.createdBy} · {new Date(b.createdAt).toLocaleString("ru-RU")}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {tab === "journal" &&
                journal.map((e) => (
                  <div key={e.eventId} className="rt-item">
                    <div className="h">
                      <span>
                        {e.taskNo} · {e.action}
                      </span>
                      <span className="m">{new Date(e.at).toLocaleTimeString("ru-RU")}</span>
                    </div>
                    <div className="m">
                      {e.from ?? "—"} → {e.to ?? "—"} · {e.actor}
                      {e.reason ? ` · ${e.reason}` : ""}
                    </div>
                  </div>
                ))}

              {tab === "create" && <CreatePane act={act} demand={board?.demand} />}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function TaskActions({ task, units, act, detail }: { task: Task; units: Unit[]; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; detail: TaskDetail | null }) {
  const [kara, setKara] = useState(task.karaId ?? units[0]?.id ?? "")
  const [reason, setReason] = useState("")
  const [prio, setPrio] = useState(task.priority)
  const d = (action: string, extra: Record<string, unknown> = {}) =>
    act(() => api("POST", `/api/route/tasks/${task.taskId}/dispatch`, { action, reason, expectedVersion: task.version, clientRequestId: newRequestId(), ...extra }))
  const closed = ["COMPLETED", "CANCELLED"].includes(task.status)
  return (
    <div className="rt-item" onClick={(e) => e.stopPropagation()} style={{ background: "var(--rt-bg)" }}>
      {!closed && (
        <>
          <div className="rt-row">
            <select className="rt-mini" value={kara} onChange={(e) => setKara(e.target.value)}>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <button type="button" className="rt-mini primary" onClick={() => void d("assign", { karaId: kara })}>
              Назначить
            </button>
          </div>
          <div className="rt-row">
            <input className="rt-mini" type="number" min={0} max={100} value={prio} onChange={(e) => setPrio(Number(e.target.value))} />
            <button type="button" className="rt-mini" onClick={() => void d("priority", { priority: prio })}>
              Приоритет
            </button>
          </div>
          <label className="rt-field">
            Причина (для паузы, блокировки, отмены)
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="rt-row" style={{ flexWrap: "wrap" }}>
            {task.status === "PAUSED" ? (
              <button type="button" className="rt-mini" onClick={() => void d("resume")}>
                Продолжить
              </button>
            ) : (
              <button type="button" className="rt-mini" disabled={reason.trim().length < 3} onClick={() => void d("pause")}>
                Пауза
              </button>
            )}
            {task.status === "BLOCKED" ? (
              <button type="button" className="rt-mini" onClick={() => void d("unblock")}>
                Снять блок
              </button>
            ) : (
              <button type="button" className="rt-mini" disabled={reason.trim().length < 3} onClick={() => void d("block")}>
                Блок
              </button>
            )}
            <button type="button" className="rt-mini" onClick={() => void d("requeue")}>
              В очередь
            </button>
            <button type="button" className="rt-mini danger" disabled={reason.trim().length < 3} onClick={() => void d("cancel")}>
              Отменить
            </button>
          </div>
        </>
      )}
      {detail?.task.route?.result && !detail.task.route.result.ok && <div className="rt-badge bad">{detail.task.route.result.reason}</div>}
      {detail?.events.slice(0, 8).map((e) => (
        <div key={e.eventId} className="m">
          {new Date(e.at).toLocaleTimeString("ru-RU")} {e.action} {e.from ? `${e.from}→${e.to}` : ""} · {e.actor}
          {e.reason ? ` · ${e.reason}` : ""}
        </div>
      ))}
    </div>
  )
}

function ProblemItem({
  x,
  act,
  names,
}: {
  x: Board["exceptions"][number]
  act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>
  names: Map<string, string>
}) {
  const [res, setRes] = useState("")
  const go = (action: string) => act(() => api("POST", `/api/route/exceptions/${x.exceptionId}/resolve`, { resolution: res, action }), "Решение записано")
  return (
    <div className="rt-item">
      <div className="h">
        <span>{x.note}</span>
        <span className="rt-badge bad">{x.kind}</span>
      </div>
      <div className="m">
        {x.taskNo ?? "без задания"} · {x.karaId ? names.get(x.karaId) || x.karaId : ""} · {x.actor} · {new Date(x.at).toLocaleTimeString("ru-RU")}
      </div>
      <label className="rt-field">
        Решение
        <input value={res} onChange={(e) => setRes(e.target.value)} placeholder="что сделано" />
      </label>
      <div className="rt-row">
        {x.taskId && (
          <>
            <button type="button" className="rt-mini" disabled={res.trim().length < 3} onClick={() => void go("unblock")}>
              Продолжить задание
            </button>
            <button type="button" className="rt-mini" disabled={res.trim().length < 3} onClick={() => void go("requeue")}>
              В очередь
            </button>
            <button type="button" className="rt-mini danger" disabled={res.trim().length < 3} onClick={() => void go("cancel")}>
              Отменить
            </button>
          </>
        )}
        <button type="button" className="rt-mini" disabled={res.trim().length < 3} onClick={() => void go("none")}>
          Закрыть
        </button>
      </div>
    </div>
  )
}

function CreatePane({ act, demand }: { act: (fn: () => Promise<unknown>, ok?: string) => Promise<void>; demand?: { wmsTasks: boolean; karaMissions: boolean } }) {
  const [f, setF] = useState({ type: "RELOCATION", huCode: "", sourceCode: "", destCode: "", priority: 50, note: "" })
  const set = (k: string, v: string | number) => setF((p) => ({ ...p, [k]: v }))
  return (
    <>
      <div className="rt-item">
        <div className="h">Новое задание по палете WMS</div>
        <label className="rt-field">
          Тип
          <select value={f.type} onChange={(e) => set("type", e.target.value)}>
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="rt-field">
          SSCC / HU палеты
          <input value={f.huCode} onChange={(e) => set("huCode", e.target.value)} placeholder="00…" />
        </label>
        <div className="rt-row">
          <label className="rt-field">
            Откуда
            <input value={f.sourceCode} onChange={(e) => set("sourceCode", e.target.value)} placeholder="FG-A-1 / LINE-SIPA" />
          </label>
          <label className="rt-field">
            Куда
            <input value={f.destCode} onChange={(e) => set("destCode", e.target.value)} placeholder="FG-A-32" />
          </label>
        </div>
        <label className="rt-field">
          Приоритет (0–100)
          <input type="number" value={f.priority} onChange={(e) => set("priority", Number(e.target.value))} />
        </label>
        <button type="button" className="rt-mini primary" onClick={() => void act(() => api("POST", "/api/route/tasks", f), "Задание создано и поставлено в очередь")}>
          Создать
        </button>
        <div className="m">Палета проверяется в WMS: номенклатура, партия и количество берутся из WMS.</div>
      </div>
      <div className="rt-item">
        <div className="h">Потребности WMS</div>
        <div className="rt-row">
          <button type="button" className="rt-mini" onClick={() => void act(() => api("PUT", "/api/route/demand", { wmsTasks: !demand?.wmsTasks }))}>
            Задания WMS: {demand?.wmsTasks ? "вкл" : "выкл"}
          </button>
          <button type="button" className="rt-mini" onClick={() => void act(() => api("PUT", "/api/route/demand", { karaMissions: !demand?.karaMissions }))}>
            Миссии карщиков: {demand?.karaMissions ? "вкл" : "выкл"}
          </button>
        </div>
        <button
          type="button"
          className="rt-mini primary"
          onClick={() =>
            void act(async () => {
              const r = await api<{ report: { created: string[]; skipped: Array<{ ref: string; reason: string }>; errors: string[] } }>("POST", "/api/route/demand")
              throw new Error(`Создано: ${r.report.created.length}; пропущено: ${r.report.skipped.length}${r.report.errors.length ? `; ошибки: ${r.report.errors.join("; ")}` : ""}`)
            })
          }
        >
          Забрать потребности сейчас
        </button>
      </div>
    </>
  )
}
