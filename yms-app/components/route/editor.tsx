"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { validateMap, type MapEdge, type MapGeometry, type MapIssue, type MapNode, type Pt } from "@/lib/route/graph"
import { api } from "@/components/route/client"
import { MapView, type MapHit, type MapMarker } from "@/components/route/map-view"

type Version = { mapId: string; version: number; status: string; title: string | null; revision: number; createdBy: string | null; publishedAt: string | null; updatedAt: string }
type Change = { changeId: string; version: number; action: string; summary: string; actor: string; at: string }
type Marker = {
  family: string
  tagId: number
  x: number
  y: number
  zM: number
  sizeM: number
  zone: string | null
  active: boolean
  mountHeightM: number | null
  yawDeg: number
  mount?: "ceiling" | "wall"
  bindingVersion?: number
  calibratedAt: string | null
  note: string | null
}
type Tool = "select" | "node" | "edge" | "delete" | "area" | "point" | "address" | "tag"

let seq = Date.now() % 100000

export function RouteEditor() {
  const [versions, setVersions] = useState<Version[]>([])
  const [changes, setChanges] = useState<Change[]>([])
  const [mapId, setMapId] = useState<string | null>(null)
  const [meta, setMeta] = useState<Version | null>(null)
  const [g, setG] = useState<MapGeometry | null>(null)
  const [dirty, setDirty] = useState(false)
  const [tool, setTool] = useState<Tool>("select")
  const [selNode, setSelNode] = useState<string | null>(null)
  const [selEdge, setSelEdge] = useState<string | null>(null)
  const [edgeStart, setEdgeStart] = useState<string | null>(null)
  const [areaPts, setAreaPts] = useState<Array<[number, number]>>([])
  const [areaKind, setAreaKind] = useState<"obstacle" | "no_go" | "pedestrian" | "wall">("no_go")
  const [tab, setTab] = useState<"props" | "check" | "log" | "tags" | "devices">("props")
  const [msg, setMsg] = useState<string | null>(null)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [showAccess, setShowAccess] = useState(true)

  const loadVersions = useCallback(async () => {
    const r = await api<{ versions: Version[]; changes: Change[] }>("GET", "/api/route/map/versions")
    setVersions(r.versions)
    setChanges(r.changes)
    return r.versions
  }, [])
  const open = useCallback(async (id: string) => {
    const r = await api<{ map: Version & { geometry: MapGeometry } }>("GET", `/api/route/map/versions/${id}`)
    setMapId(id)
    setMeta(r.map)
    setG(r.map.geometry)
    setDirty(false)
    setSelNode(null)
    setSelEdge(null)
  }, [])
  const loadTags = useCallback(async () => {
    try {
      setMarkers((await api<{ markers: Marker[] }>("GET", "/api/route/apriltags")).markers)
    } catch {
      /* нет прав или пусто */
    }
  }, [])

  useEffect(() => {
    void loadVersions().then((v) => {
      const pick = v.find((x) => x.status === "draft") ?? v.find((x) => x.status === "published") ?? v[0]
      if (pick) void open(pick.mapId)
    })
    void loadTags()
  }, [loadVersions, open, loadTags])

  const validation = useMemo(() => (g ? validateMap(g) : null), [g])
  const editable = meta?.status === "draft"

  const mutate = (fn: (d: MapGeometry) => void) => {
    if (!g || !editable) {
      setMsg("Опубликованную версию менять нельзя — создайте черновик")
      return
    }
    const copy: MapGeometry = JSON.parse(JSON.stringify(g))
    fn(copy)
    setG(copy)
    setDirty(true)
  }

  const onClick = (hit: MapHit) => {
    if (!g) return
    const w = { x: Math.round(hit.world.x * 10) / 10, y: Math.round(hit.world.y * 10) / 10 }
    switch (tool) {
      case "select":
        setSelNode(hit.nodeId ?? null)
        setSelEdge(hit.nodeId ? null : hit.edgeId ?? null)
        setTab("props")
        break
      case "node":
        mutate((d) => {
          const id = `u${++seq}`
          d.nodes.push({ id, x: w.x, y: w.y, kind: "way" })
          setSelNode(id)
        })
        break
      case "edge":
        if (!hit.nodeId) return
        if (!edgeStart) setEdgeStart(hit.nodeId)
        else if (edgeStart !== hit.nodeId) {
          const a = edgeStart
          const b = hit.nodeId
          mutate((d) => {
            if (!d.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))) {
              const id = `ue${++seq}`
              d.edges.push({ id, from: a, to: b })
              setSelEdge(id)
            }
          })
          setEdgeStart(b)
        }
        break
      case "delete":
        if (hit.nodeId) {
          const id = hit.nodeId
          mutate((d) => {
            d.nodes = d.nodes.filter((n) => n.id !== id)
            d.edges = d.edges.filter((e) => e.from !== id && e.to !== id)
            d.addresses = d.addresses.filter((a) => a.nodeId !== id)
            d.points = d.points.filter((p) => p.nodeId !== id)
          })
        } else if (hit.edgeId) {
          const id = hit.edgeId
          mutate((d) => {
            d.edges = d.edges.filter((e) => e.id !== id)
          })
        }
        break
      case "area":
        setAreaPts((p) => [...p, [w.x, w.y]])
        break
      case "point": {
        if (!hit.nodeId) return setMsg("Точку получения/постановки привязывают к узлу")
        const code = window.prompt("Код точки (например LINE-SIPA, SHIP-1, BUF-1)")?.trim().toUpperCase()
        if (!code) return
        const kind = (window.prompt("Тип: line_pickup / buffer / shipping / return / storage / other", "line_pickup") || "other").trim()
        const nodeId = hit.nodeId
        mutate((d) => {
          d.points = d.points.filter((p) => p.code !== code)
          d.points.push({ id: `pt-${code.toLowerCase()}`, code, kind: kind as "other", nodeId, label: code })
        })
        break
      }
      case "address": {
        if (!hit.nodeId) return setMsg("Адрес WMS привязывают к узлу доступа")
        const code = window.prompt("Код адреса WMS (например FG-A-32)")?.trim().toUpperCase()
        if (!code) return
        const nodeId = hit.nodeId
        mutate((d) => {
          d.addresses = d.addresses.filter((a) => a.locationCode !== code)
          d.addresses.push({ locationCode: code, nodeId })
        })
        break
      }
      case "tag": {
        const fam = window.prompt("Семейство AprilTag", markers[0]?.family || "tag36h11")?.trim()
        const id = Number(window.prompt("ID метки"))
        const size = Number(window.prompt("Размер метки по внешнему краю чёрной рамки, м (измерить линейкой)", "0.2"))
        const mountRaw = window.prompt("Крепление: потолок или стена", "стена")?.trim().toLowerCase()
        const mount = mountRaw?.startsWith("п") || mountRaw === "ceiling" ? "ceiling" : "wall"
        const zM = Number(window.prompt("Высота центра метки от пола, м (измерить рулеткой)", ""))
        const yawDeg = Number(
          window.prompt(mount === "wall" ? "Куда смотрит метка, курс плана в градусах (0 — вправо, 90 — вниз по плану)" : "Направление оси +x метки, курс плана в градусах", "0")
        )
        if (!fam || !Number.isInteger(id) || !Number.isFinite(zM) || !Number.isFinite(yawDeg)) {
          setMsg("Метка не сохранена: нужны семейство, ID, измеренная высота и курс")
          return
        }
        void api("PUT", "/api/route/apriltags", { markers: [{ family: fam, tagId: id, x: w.x, y: w.y, zM, yawDeg, mount, sizeM: size }] })
          .then(() => loadTags())
          .catch((e: Error) => setMsg(e.message))
        break
      }
    }
  }

  const onDragNode = (id: string, w: Pt, phase: "move" | "end") => {
    if (tool !== "select" || !editable || !g) return
    const copy = { ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(w.x * 10) / 10, y: Math.round(w.y * 10) / 10 } : n)) }
    setG(copy)
    if (phase === "end") setDirty(true)
  }

  const save = async () => {
    if (!mapId || !g || !meta) return
    try {
      const r = await api<{ map: Version & { geometry: MapGeometry } }>("PUT", `/api/route/map/versions/${mapId}`, {
        geometry: g,
        expectedRevision: meta.revision,
        summary: window.prompt("Комментарий к изменению", "") || "",
      })
      setMeta(r.map)
      setDirty(false)
      setMsg("Черновик сохранён")
      await loadVersions()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const publish = async () => {
    if (!mapId) return
    if (dirty) return setMsg("Сначала сохраните черновик")
    try {
      await api("POST", `/api/route/map/versions/${mapId}/publish`, { note: window.prompt("Что изменилось для водителей?", "") || "" })
      setMsg("Опубликовано — водители перешли на новую версию")
      await loadVersions()
      await open(mapId)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  const newDraft = async () => {
    if (!mapId) return
    try {
      const r = await api<{ map: Version }>("POST", "/api/route/map/versions", { fromMapId: mapId })
      await loadVersions()
      await open(r.map.mapId)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const node = g?.nodes.find((n) => n.id === selNode) ?? null
  const edge = g?.edges.find((e) => e.id === selEdge) ?? null
  const issueRefs = new Set((validation?.issues ?? []).filter((i) => i.level === "error").map((i) => i.ref).filter(Boolean) as string[])
  const mapMarkers: MapMarker[] = [
    ...(g?.points ?? []).map((p) => {
      const n = g!.nodes.find((x) => x.id === p.nodeId)
      return n ? { x: n.x, y: n.y, label: p.code, kind: "point" as const } : null
    }),
    ...markers.map((m) => ({ x: m.x, y: m.y, label: `${m.tagId}`, kind: "tag" as const })),
    ...areaPts.map(([x, y], i) => ({ x, y, label: i === 0 ? "зона" : "", kind: "draft" as const })),
  ].filter(Boolean) as MapMarker[]

  return (
    <div className="rt-root">
      <div className="rt-desk">
        <header className="rt-top">
          <div className="rt-brand">
            SCADA System Forklift<small>КАРТА И МЕТКИ</small>
          </div>
          <a className="rt-chip info" href="/route/dispatch">
            Диспетчерская
          </a>
          <select className="rt-mini" value={mapId ?? ""} onChange={(e) => void open(e.target.value)}>
            {versions.map((v) => (
              <option key={v.mapId} value={v.mapId}>
                v{v.version} · {v.status === "published" ? "опубликована" : v.status === "draft" ? "черновик" : "архив"}
              </option>
            ))}
          </select>
          <span className={`rt-chip ${editable ? "warn" : "ok"}`}>{editable ? `черновик, ред. ${meta?.revision}` : "только просмотр"}</span>
          <div className="rt-spacer" />
          {dirty && <span className="rt-chip warn">не сохранено</span>}
          <button type="button" className="rt-mini" onClick={() => void newDraft()}>
            Новый черновик
          </button>
          <button type="button" className="rt-mini" disabled={!editable || !dirty} onClick={() => void save()}>
            Сохранить
          </button>
          <button type="button" className="rt-mini primary" disabled={!editable || !validation?.ok} onClick={() => void publish()}>
            Опубликовать
          </button>
        </header>
        <div className="rt-desk-body">
          <div className="rt-mapwrap">
            <MapView
              geometry={g}
              markers={mapMarkers}
              highlightNodeIds={new Set([selNode, edgeStart].filter(Boolean) as string[])}
              highlightEdgeIds={new Set([selEdge, ...issueRefs].filter(Boolean) as string[])}
              blockedEdgeIds={new Set(g?.edges.filter((e) => e.blocked).map((e) => e.id) ?? [])}
              showAccess={showAccess}
              draggableNodes={tool === "select" && editable}
              onDragNode={onDragNode}
              onClick={onClick}
            />
            <div className="rt-tools">
              {(
                [
                  ["select", "Выбор/перенос"],
                  ["node", "+ Узел"],
                  ["edge", "+ Проезд"],
                  ["delete", "Удалить"],
                  ["area", "+ Зона"],
                  ["point", "Точка получения/постановки"],
                  ["address", "Адрес WMS"],
                  ["tag", "+ AprilTag"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={tool === k ? "on" : ""}
                  onClick={() => {
                    setTool(k)
                    setEdgeStart(null)
                    if (k !== "area") setAreaPts([])
                  }}
                >
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => setShowAccess((v) => !v)}>
                Подъезды к рядам: {showAccess ? "показ" : "скрыты"}
              </button>
              {tool === "area" && (
                <>
                  <select value={areaKind} onChange={(e) => setAreaKind(e.target.value as typeof areaKind)}>
                    <option value="no_go">запретная зона</option>
                    <option value="obstacle">препятствие</option>
                    <option value="wall">стена</option>
                    <option value="pedestrian">пешеходная зона</option>
                  </select>
                  <button
                    type="button"
                    disabled={areaPts.length < 3}
                    onClick={() => {
                      const label = window.prompt("Название зоны", "") || undefined
                      mutate((d) => d.areas.push({ id: `area-${++seq}`, kind: areaKind, polygon: areaPts, label }))
                      setAreaPts([])
                    }}
                  >
                    Замкнуть зону ({areaPts.length})
                  </button>
                </>
              )}
            </div>
          </div>
          <aside className="rt-side">
            <nav className="rt-tabs">
              {(
                [
                  ["props", "Свойства"],
                  ["check", `Проверка${validation && !validation.ok ? " ⚠" : ""}`],
                  ["log", "Журнал"],
                  ["tags", `Метки (${markers.length})`],
                  ["devices", "Устройства"],
                ] as const
              ).map(([k, label]) => (
                <button key={k} type="button" className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="rt-pane">
              {msg && (
                <div className="rt-item" onClick={() => setMsg(null)}>
                  {msg}
                </div>
              )}
              {tab === "props" && (
                <>
                  <div className="rt-item">
                    <dl className="rt-kv">
                      <dt>Узлов</dt>
                      <dd>{g?.nodes.length}</dd>
                      <dt>Проездов</dt>
                      <dd>{g?.edges.length}</dd>
                      <dt>Адресов WMS</dt>
                      <dd>{g?.addresses.length}</dd>
                      <dt>Точек</dt>
                      <dd>{g?.points.length}</dd>
                      <dt>Зон</dt>
                      <dd>{g?.areas.length}</dd>
                      <dt>Масштаб</dt>
                      <dd>{g ? `${(1 / g.coord.metersPerUnit).toFixed(1)} px/м` : "—"}</dd>
                    </dl>
                  </div>
                  {node && <NodeProps node={node} g={g!} mutate={mutate} />}
                  {edge && <EdgeProps edge={edge} g={g!} mutate={mutate} />}
                  {!node && !edge && <div className="m">Выберите узел или проезд на карте.</div>}
                </>
              )}
              {tab === "check" && <Issues issues={validation?.issues ?? []} components={validation?.components ?? 0} onPick={(ref) => (setSelEdge(ref), setSelNode(ref))} />}
              {tab === "log" &&
                changes.map((c) => (
                  <div key={c.changeId} className="rt-item">
                    <div className="h">
                      <span>
                        v{c.version} · {c.action}
                      </span>
                      <span className="m">{new Date(c.at).toLocaleString("ru-RU")}</span>
                    </div>
                    <div className="m">
                      {c.summary} · {c.actor}
                    </div>
                  </div>
                ))}
              {tab === "tags" && <TagsPane markers={markers} reload={loadTags} setMsg={setMsg} />}
              {tab === "devices" && <DevicesPane setMsg={setMsg} />}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function NodeProps({ node, g, mutate }: { node: MapNode; g: MapGeometry; mutate: (fn: (d: MapGeometry) => void) => void }) {
  const addr = g.addresses.filter((a) => a.nodeId === node.id).map((a) => a.locationCode)
  const set = (patch: Partial<MapNode>) => mutate((d) => Object.assign(d.nodes.find((n) => n.id === node.id)!, patch))
  return (
    <div className="rt-item">
      <div className="h">Узел {node.id}</div>
      <label className="rt-field">
        Тип
        <select value={node.kind} onChange={(e) => set({ kind: e.target.value as MapNode["kind"] })}>
          {["way", "junction", "access", "pickup", "drop", "buffer", "ship", "gate"].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="rt-field">
        Подпись
        <input value={node.label ?? ""} onChange={(e) => set({ label: e.target.value || undefined })} />
      </label>
      <div className="m">
        x {node.x}, y {node.y} {addr.length ? `· адреса: ${addr.join(", ")}` : ""}
      </div>
    </div>
  )
}

function EdgeProps({ edge, g, mutate }: { edge: MapEdge; g: MapGeometry; mutate: (fn: (d: MapGeometry) => void) => void }) {
  const set = (patch: Partial<MapEdge>) => mutate((d) => Object.assign(d.edges.find((e) => e.id === edge.id)!, patch))
  const a = g.nodes.find((n) => n.id === edge.from)
  const b = g.nodes.find((n) => n.id === edge.to)
  const len = a && b ? Math.hypot(a.x - b.x, a.y - b.y) * g.coord.metersPerUnit : 0
  const num = (v: string) => (v.trim() === "" ? null : Number(v))
  return (
    <div className="rt-item">
      <div className="h">
        Проезд {edge.id} · {len.toFixed(1)} м
      </div>
      {edge.note && <div className="rt-badge warn">{edge.note}</div>}
      <label className="rt-field">
        <span>
          <input type="checkbox" checked={Boolean(edge.oneway)} onChange={(e) => set({ oneway: e.target.checked })} /> Только {edge.from} → {edge.to}
        </span>
      </label>
      <button type="button" className="rt-mini" onClick={() => set({ from: edge.to, to: edge.from })}>
        Развернуть направление
      </button>
      <label className="rt-field">
        <span>
          <input type="checkbox" checked={edge.loadedAllowed !== false} onChange={(e) => set({ loadedAllowed: e.target.checked })} /> Можно с грузом
        </span>
      </label>
      <label className="rt-field">
        <span>
          <input type="checkbox" checked={Boolean(edge.blocked)} onChange={(e) => set({ blocked: e.target.checked })} /> Постоянно закрыт
        </span>
      </label>
      {edge.blocked && (
        <label className="rt-field">
          Причина закрытия
          <input value={edge.blockReason ?? ""} onChange={(e) => set({ blockReason: e.target.value })} />
        </label>
      )}
      <div className="rt-row">
        <label className="rt-field">
          Ширина, м
          <input type="number" step="0.1" value={edge.maxWidthM ?? ""} onChange={(e) => set({ maxWidthM: num(e.target.value) })} />
        </label>
        <label className="rt-field">
          Высота, м
          <input type="number" step="0.1" value={edge.maxHeightM ?? ""} onChange={(e) => set({ maxHeightM: num(e.target.value) })} />
        </label>
      </div>
      <div className="rt-row">
        <label className="rt-field">
          Скорость, км/ч
          <input type="number" value={edge.speedKmh ?? ""} onChange={(e) => set({ speedKmh: num(e.target.value) })} />
        </label>
        <label className="rt-field">
          Доплата, с
          <input type="number" value={edge.penaltyS ?? ""} onChange={(e) => set({ penaltyS: num(e.target.value) ?? 0 })} />
        </label>
      </div>
      <label className="rt-field">
        Типы погрузчиков (через запятую, пусто — любые)
        <input
          value={(edge.forkliftTypes ?? []).join(", ")}
          onChange={(e) => set({ forkliftTypes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
        />
      </label>
      <label className="rt-field">
        Длина, м (пусто — по координатам)
        <input type="number" step="0.1" value={edge.lengthM ?? ""} onChange={(e) => set({ lengthM: num(e.target.value) ?? undefined })} />
      </label>
    </div>
  )
}

function Issues({ issues, components, onPick }: { issues: MapIssue[]; components: number; onPick: (ref: string) => void }) {
  const errors = issues.filter((i) => i.level === "error")
  return (
    <>
      <div className="rt-item">
        <div className="h">
          <span>{errors.length ? `Ошибок: ${errors.length} — публикация запрещена` : "Ошибок нет — можно публиковать"}</span>
        </div>
        <div className="m">Связных частей графа: {components}</div>
      </div>
      {issues.slice(0, 300).map((i, k) => (
        <div key={k} className="rt-item" onClick={() => i.ref && onPick(i.ref)}>
          <span className={`rt-badge ${i.level === "error" ? "bad" : "warn"}`}>{i.level === "error" ? "ошибка" : "внимание"}</span> {i.message}
        </div>
      ))}
    </>
  )
}

function TagsPane({ markers, reload, setMsg }: { markers: Marker[]; reload: () => Promise<void>; setMsg: (s: string) => void }) {
  return (
    <>
      <div className="rt-item">
        <div className="h">Метки AprilTag</div>
        <div className="m">
          Семейство выбирается по числу нужных ID: tag36h11 — 587, tagStandard41h12 — 2115, tagStandard52h13 — 48714. tag16h5 — только для стенда.
        </div>
        <button
          type="button"
          className="rt-mini"
          onClick={() =>
            void api<{ imported: number; warnings: string[] }>("POST", "/api/route/apriltags")
              .then((r) => (setMsg(`Импортировано с плана WMS: ${r.imported}. ${r.warnings.join("; ")}`), reload()))
              .catch((e: Error) => setMsg(e.message))
          }
        >
          Импорт с плана WMS
        </button>
      </div>
      {markers.map((m) => (
        <div key={`${m.family}:${m.tagId}`} className="rt-item">
          <div className="h">
            <span>
              {m.family} · ID {m.tagId}
            </span>
            <span className={`rt-badge ${m.active ? "ok" : ""}`}>{m.active ? "активна" : "выкл"}</span>
          </div>
          <div className="m">
            {m.mount === "wall" ? "стена" : "потолок"} · x {m.x}, y {m.y} · центр {m.zM} м · курс {m.yawDeg}° · {m.sizeM} м · привязка v{m.bindingVersion ?? 1} · калибровка {m.calibratedAt ? new Date(m.calibratedAt).toLocaleDateString("ru-RU") : "нет"}
            {m.note ? ` · ${m.note}` : ""}
          </div>
          <button
            type="button"
            className="rt-mini"
            onClick={() =>
              void api("PUT", "/api/route/apriltags", { markers: [{ ...m, active: !m.active }] })
                .then(reload)
                .catch((e: Error) => setMsg(e.message))
            }
          >
            {m.active ? "Выключить" : "Включить"}
          </button>
        </div>
      ))}
    </>
  )
}

function DevicesPane({ setMsg }: { setMsg: (s: string) => void }) {
  const [devices, setDevices] = useState<Array<{ deviceId: string; karaId: string; kind: string; lastSeenAt: string | null; revokedAt: string | null }>>([])
  const [kara, setKara] = useState("")
  const [token, setToken] = useState<string | null>(null)
  const load = useCallback(() => {
    void api<{ devices: typeof devices }>("GET", "/api/route/devices")
      .then((r) => setDevices(r.devices))
      .catch(() => undefined)
  }, [])
  useEffect(load, [load])
  return (
    <>
      <div className="rt-item">
        <div className="h">Сервис позиционирования погрузчика</div>
        <label className="rt-field">
          ID погрузчика во флоте WMS
          <input value={kara} onChange={(e) => setKara(e.target.value)} placeholder="kara-1" />
        </label>
        <button
          type="button"
          className="rt-mini primary"
          onClick={() =>
            void api<{ token: string }>("POST", "/api/route/devices", { karaId: kara })
              .then((r) => (setToken(r.token), load()))
              .catch((e: Error) => setMsg(e.message))
          }
        >
          Выпустить токен
        </button>
        {token && (
          <div className="rt-badge warn" style={{ wordBreak: "break-all" }}>
            {token} — показывается один раз, впишите в конфиг сервиса
          </div>
        )}
      </div>
      {devices.map((d) => (
        <div key={d.deviceId} className="rt-item">
          <div className="h">
            <span>
              {d.deviceId} · {d.karaId}
            </span>
            <span className={`rt-badge ${d.revokedAt ? "bad" : "ok"}`}>{d.revokedAt ? "отозван" : "активен"}</span>
          </div>
          <div className="m">последний сигнал: {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString("ru-RU") : "нет"}</div>
          {!d.revokedAt && (
            <button type="button" className="rt-mini danger" onClick={() => void api("DELETE", `/api/route/devices?deviceId=${encodeURIComponent(d.deviceId)}`).then(load)}>
              Отозвать
            </button>
          )}
        </div>
      ))}
    </>
  )
}
