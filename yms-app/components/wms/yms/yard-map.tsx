"use client"

import { useRef } from "react"
import type { YardObject, YmsVisit } from "@/components/wms/yms/api"

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

function placeOf(visit: YmsVisit, objects: YardObject[]): YardObject | null {
  if (visit.status === "at_gate" || visit.status === "awaiting_entry") {
    return objects.find((o) => o.kind === "gate_in") ?? null
  }
  if (visit.status === "ready_exit") return objects.find((o) => o.kind === "gate_out") ?? null
  if (visit.status === "to_dock" || visit.status === "loading" || visit.status === "unloading") {
    return objects.find((o) => o.objectId === visit.dockObjectId) ?? null
  }
  if (visit.status === "parked") return objects.find((o) => o.objectId === visit.parkingObjectId) ?? null
  if (visit.status === "on_yard" || visit.status === "awaiting_dock") {
    return objects.find((o) => o.kind === "wait_zone") ?? null
  }
  return null
}

export function YardMap({
  objects,
  visits,
  selectedId,
  editing,
  onSelectVisit,
  onMove,
}: {
  objects: YardObject[]
  visits: YmsVisit[]
  selectedId: string | null
  editing: boolean
  onSelectVisit: (visitId: string) => void
  onMove: (objectId: string, x: number, y: number) => void
}) {
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const pins = new Map<string, YmsVisit[]>()
  for (const visit of visits) {
    const spot = placeOf(visit, objects)
    if (!spot) continue
    const list = pins.get(spot.objectId) ?? []
    list.push(visit)
    pins.set(spot.objectId, list)
  }

  return (
    <svg
      viewBox="0 0 1000 800"
      className="h-full w-full rounded-md border border-border bg-background"
      role="img"
      aria-label="План территории"
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
            stroke={STATUS_STROKE[object.status] ?? "var(--border)"}
            strokeWidth={object.kind === "boundary" ? 1.5 : 1.25}
            className={editing ? "cursor-grab" : undefined}
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
          <text
            x={object.x + 6}
            y={object.y + 14}
            fontSize={11}
            fill="var(--foreground)"
            style={{ pointerEvents: "none" }}
          >
            {object.code}
          </text>
        </g>
      ))}
      {[...pins.entries()].map(([objectId, group]) => {
        const spot = objects.find((o) => o.objectId === objectId)
        if (!spot) return null
        return group.map((visit, index) => {
          const x = spot.x + 8 + (index % 3) * 36
          const y = spot.y + spot.h - 16 - Math.floor(index / 3) * 16
          const selected = visit.visitId === selectedId
          return (
            <g key={visit.visitId} onClick={() => onSelectVisit(visit.visitId)} className="cursor-pointer">
              <rect
                x={x}
                y={y}
                width={34}
                height={14}
                rx={2}
                fill={selected ? "var(--primary)" : "var(--foreground)"}
              />
              <text x={x + 3} y={y + 10} fontSize={8} fill={selected ? "var(--primary-foreground)" : "var(--card)"}>
                {visit.plate.slice(0, 6)}
              </text>
            </g>
          )
        })
      })}
    </svg>
  )
}
