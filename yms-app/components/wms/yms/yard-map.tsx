"use client"

import { useRef, useState } from "react"
import type { BoardPayload, YardObject, YmsVisit } from "@/components/wms/yms/api"
import { headingBetween, hitchPose, TRAILER_LENGTH, TRAILER_WIDTH, TRACTOR_LENGTH, TRACTOR_WIDTH, type Point } from "@/lib/wms/yms/rig"
import { routeBetween } from "@/lib/wms/yms/yard-route"

const KIND_FILL: Record<string, string> = {
  boundary: "transparent",
  building: "var(--muted)",
  road: "color-mix(in oklch, var(--foreground) 8%, transparent)",
  gate_in: "color-mix(in oklch, var(--primary) 35%, var(--card))",
  gate_out: "color-mix(in oklch, var(--chart-2) 28%, var(--card))",
  parking: "var(--card)",
  dock: "var(--card)",
  unload_zone: "color-mix(in oklch, var(--chart-3) 22%, var(--card))",
  wait_zone: "color-mix(in oklch, var(--chart-2) 16%, var(--card))",
}

const STATUS_STROKE: Record<string, string> = {
  free: "var(--border)",
  occupied: "var(--foreground)",
  reserved: "var(--chart-3)",
  loading: "var(--primary)",
  unloading: "var(--chart-2)",
  blocked: "var(--destructive)",
  unavailable: "var(--destructive)",
}

type Job = NonNullable<BoardPayload["jobs"]>[number]

function placeOf(visit: YmsVisit, objects: YardObject[]): YardObject | null {
  if (visit.status === "at_gate" || visit.status === "awaiting_entry") {
    return objects.find((object) => object.kind === "gate_in") ?? null
  }
  if (visit.status === "ready_exit") return objects.find((object) => object.kind === "gate_out") ?? null
  if (visit.status === "to_dock" || visit.status === "loading" || visit.status === "unloading") {
    return objects.find((object) => object.objectId === visit.dockObjectId) ?? null
  }
  if (visit.status === "parked" || visit.status === "awaiting_dock") {
    return objects.find((object) => object.objectId === visit.parkingObjectId) ?? objects.find((object) => object.kind === "wait_zone") ?? null
  }
  if (visit.status === "on_yard") return objects.find((object) => object.kind === "wait_zone") ?? null
  return null
}

function confirmedPose(visit: YmsVisit, spot: YardObject, objects: YardObject[]) {
  const hitch = { x: spot.x + spot.w / 2, y: spot.y + spot.h / 2 }
  let tractorHeading = 0
  let trailerHeading = 0
  if (spot.kind === "dock") {
    const building = objects.find((object) => object.kind === "building")
    const buildingCenter = building ? building.y + building.h / 2 : spot.y - 40
    tractorHeading = hitch.y >= buildingCenter ? Math.PI / 2 : -Math.PI / 2
    trailerHeading = tractorHeading
  } else if (spot.kind === "parking") {
    tractorHeading = spot.w >= spot.h ? 0 : Math.PI / 2
    trailerHeading = tractorHeading
  } else {
    tractorHeading = -Math.PI / 2
    trailerHeading = tractorHeading
  }
  const gate = objects.find((object) => object.kind === "gate_in")
  const from = visit.parkingObjectId || gate?.objectId || null
  const to = spot.kind === "dock" ? spot.objectId : visit.parkingObjectId
  const path = routeBetween(objects, from, to)
  if (path && path.length >= 2) {
    tractorHeading = headingBetween(path[path.length - 2], path[path.length - 1])
    trailerHeading = path.length >= 3 ? headingBetween(path[path.length - 3], path[path.length - 2]) : tractorHeading
  }
  return { hitch, tractorHeading, trailerHeading, hasTrailer: Boolean(visit.trailerPlate), path }
}

function Rig({
  hitch,
  tractorHeading,
  trailerHeading,
  hasTrailer,
  selected,
  plate,
  onClick,
}: {
  hitch: Point
  tractorHeading: number
  trailerHeading: number
  hasTrailer: boolean
  selected: boolean
  plate: string
  onClick: () => void
}) {
  const pose = hitchPose({ hitch, tractorHeading, trailerHeading, hasTrailer })
  const fill = selected ? "#c6e34a" : "#243024"
  const ink = selected ? "#24300a" : "#f4f1ea"
  return (
    <g onClick={onClick} className="cursor-pointer">
      {hasTrailer && pose.trailerCenter && (
        <g transform={`translate(${pose.trailerCenter.x} ${pose.trailerCenter.y}) rotate(${(trailerHeading * 180) / Math.PI})`}>
          <rect x={-TRAILER_LENGTH / 2} y={-TRAILER_WIDTH / 2} width={TRAILER_LENGTH} height={TRAILER_WIDTH} rx={2} fill={fill} stroke="#1f2a24" />
          <rect x={-TRAILER_LENGTH / 2 + 4} y={-1.2} width={6} height={2.4} fill="#1f2a24" />
          <rect x={TRAILER_LENGTH / 2 - 14} y={-1.2} width={6} height={2.4} fill="#1f2a24" />
        </g>
      )}
      <g transform={`translate(${pose.tractorCenter.x} ${pose.tractorCenter.y}) rotate(${(tractorHeading * 180) / Math.PI})`}>
        <rect x={-TRACTOR_LENGTH / 2} y={-TRACTOR_WIDTH / 2} width={TRACTOR_LENGTH * 0.62} height={TRACTOR_WIDTH} rx={1.5} fill={fill} stroke="#1f2a24" />
        <rect x={TRACTOR_LENGTH * 0.12} y={-TRACTOR_WIDTH / 2 + 1} width={TRACTOR_LENGTH * 0.36} height={TRACTOR_WIDTH - 2} rx={2} fill={selected ? "#e8f7a8" : "#3a4638"} stroke="#1f2a24" />
        <circle cx={TRACTOR_LENGTH * 0.42} cy={0} r={1.4} fill="#d7dee4" />
      </g>
      <text x={hitch.x + 8} y={hitch.y - 12} fontSize={9} fill={ink} stroke="#1f2a24" strokeWidth={0.4}>
        {plate.slice(0, 8)}
      </text>
    </g>
  )
}

function Forklift({ x, y, carrying, label }: { x: number; y: number; carrying: boolean; label: string }) {
  return (
    <g>
      <rect x={x - 7} y={y - 5} width={14} height={10} rx={2} fill="#3d6b8a" stroke="#1f2a24" />
      <rect x={x + 7} y={y - 2} width={7} height={1.4} fill="#1f2a24" />
      <rect x={x + 7} y={y + 0.8} width={7} height={1.4} fill="#1f2a24" />
      {carrying && <rect x={x + 8} y={y - 4} width={8} height={8} fill="#c4a15a" stroke="#1f2a24" />}
      <text x={x} y={y + 16} fontSize={7} textAnchor="middle" fill="#1f2a24">
        {label}
      </text>
    </g>
  )
}

export function YardMap({
  objects,
  visits,
  jobs = [],
  selectedId,
  selectedObjectId,
  editing,
  onSelectVisit,
  onSelectObject,
  onMove,
}: {
  objects: YardObject[]
  visits: YmsVisit[]
  jobs?: Job[]
  selectedId: string | null
  selectedObjectId?: string | null
  editing: boolean
  onSelectVisit: (visitId: string) => void
  onSelectObject?: (objectId: string) => void
  onMove: (objectId: string, x: number, y: number) => void
}) {
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, k: 1 })
  const selected = visits.find((visit) => visit.visitId === selectedId) ?? null
  const selectedSpot = selected ? placeOf(selected, objects) : null
  const route = selected && selectedSpot ? confirmedPose(selected, selectedSpot, objects).path : null

  return (
    <svg
      viewBox={`${-view.x} ${-view.y} ${1000 / view.k} ${800 / view.k}`}
      className="h-full w-full rounded-md border border-border bg-background"
      role="img"
      aria-label="План территории"
      onWheel={(event) => {
        event.preventDefault()
        const next = Math.min(2.4, Math.max(0.6, view.k * (event.deltaY > 0 ? 0.92 : 1.08)))
        setView((current) => ({ ...current, k: next }))
      }}
      onPointerDown={(event) => {
        if (editing || event.target !== event.currentTarget) return
        pan.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }
      }}
      onPointerMove={(event) => {
        if (!pan.current) return
        const dx = (event.clientX - pan.current.x) * (1000 / view.k / 800)
        const dy = (event.clientY - pan.current.y) * (800 / view.k / 600)
        setView((current) => ({ ...current, x: pan.current!.vx + dx, y: pan.current!.vy + dy }))
      }}
      onPointerUp={() => {
        pan.current = null
      }}
    >
      {objects.map((object) => (
        <g key={object.objectId}>
          <rect
            x={object.x}
            y={object.y}
            width={object.w}
            height={object.h}
            rx={object.kind === "boundary" ? 8 : 4}
            fill={KIND_FILL[object.kind] ?? "var(--card)"}
            stroke={object.objectId === selectedObjectId ? "var(--primary)" : STATUS_STROKE[object.status] ?? "var(--border)"}
            strokeWidth={object.objectId === selectedObjectId ? 2.4 : object.kind === "boundary" ? 1.5 : 1.25}
            className={editing ? "cursor-grab" : object.kind === "dock" ? "cursor-pointer" : undefined}
            onClick={() => {
              if (!editing && object.kind === "dock") onSelectObject?.(object.objectId)
            }}
            onPointerDown={(event) => {
              if (!editing) return
              const svg = event.currentTarget.ownerSVGElement
              if (!svg) return
              const point = svg.createSVGPoint()
              point.x = event.clientX
              point.y = event.clientY
              const ctm = svg.getScreenCTM()
              if (!ctm) return
              const local = point.matrixTransform(ctm.inverse())
              drag.current = { id: object.objectId, dx: local.x - object.x, dy: local.y - object.y }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const active = drag.current
              if (!editing || !active || active.id !== object.objectId) return
              const svg = event.currentTarget.ownerSVGElement
              if (!svg) return
              const point = svg.createSVGPoint()
              point.x = event.clientX
              point.y = event.clientY
              const ctm = svg.getScreenCTM()
              if (!ctm) return
              const local = point.matrixTransform(ctm.inverse())
              onMove(object.objectId, Math.round(local.x - active.dx), Math.round(local.y - active.dy))
            }}
            onPointerUp={() => {
              drag.current = null
            }}
          />
          <text x={object.x + 6} y={object.y + 14} fontSize={11} fill="var(--foreground)" style={{ pointerEvents: "none" }}>
            {object.code}
          </text>
        </g>
      ))}
      {route && route.length > 1 && (
        <polyline
          points={route.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#8ea832"
          strokeWidth={3}
          strokeDasharray="7 5"
          style={{ pointerEvents: "none" }}
        />
      )}
      {visits.map((visit) => {
        const spot = placeOf(visit, objects)
        if (!spot) return null
        const pose = confirmedPose(visit, spot, objects)
        const index = visits.filter((row) => placeOf(row, objects)?.objectId === spot.objectId).findIndex((row) => row.visitId === visit.visitId)
        const hitch = { x: pose.hitch.x + (index % 2) * 18, y: pose.hitch.y + Math.floor(index / 2) * 16 }
        return (
          <Rig
            key={visit.visitId}
            hitch={hitch}
            tractorHeading={pose.tractorHeading}
            trailerHeading={pose.trailerHeading}
            hasTrailer={pose.hasTrailer}
            selected={visit.visitId === selectedId}
            plate={visit.plate}
            onClick={() => onSelectVisit(visit.visitId)}
          />
        )
      })}
      {jobs.map((job) => {
        const dock = objects.find((object) => object.objectId === job.dockObjectId)
        if (!dock) return null
        return (
          <Forklift
            key={job.jobId}
            x={dock.x + dock.w - 18}
            y={dock.y + 18}
            carrying={job.status === "carrying" && Boolean(job.carryingCode)}
            label="зона дока"
          />
        )
      })}
    </svg>
  )
}
