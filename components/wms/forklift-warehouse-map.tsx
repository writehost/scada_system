"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  FORKLIFT_FLOOR_PLAN,
  FORKLIFT_MAP_SLOTS,
  getForkliftPlanStats,
  rowDisplayNumber,
  type ForkliftMapRow,
  type SlotLevel,
} from "@/lib/wms/forklift-pos-mock"
import "./forklift-warehouse-plan.css"

function ForkliftSvg({ color }: { color: string }) {
  const dark = shadeColor(color, -30)
  return (
    <svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg" className="h-full w-full">
      <ellipse cx="18" cy="32" rx="13" ry="3" fill="rgba(0,0,0,.3)" />
      <rect x="4" y="8" width="22" height="18" rx="4" fill={color} stroke={dark} strokeWidth="1.2" />
      <rect x="6" y="9" width="18" height="5" rx="2" fill="rgba(255,255,255,.2)" />
      <rect x="6" y="11" width="10" height="9" rx="2" fill="rgba(100,180,255,.4)" stroke={dark} strokeWidth="1" />
      <rect x="24" y="9" width="4" height="14" rx="2" fill={dark} />
      <rect x="26" y="12" width="9" height="2.5" rx="1" fill="#555" />
      <rect x="26" y="17" width="9" height="2.5" rx="1" fill="#555" />
      <circle cx="9" cy="26" r="4" fill="#222" stroke="#555" strokeWidth="1" />
      <circle cx="22" cy="26" r="4" fill="#222" stroke="#555" strokeWidth="1" />
      <circle cx="9" cy="10" r="3" fill="#222" stroke="#555" strokeWidth="1" />
      <circle cx="22" cy="10" r="3" fill="#222" stroke="#555" strokeWidth="1" />
      <circle cx="27" cy="11" r="2" fill="#ffe080" opacity="0.9" />
    </svg>
  )
}

function shadeColor(hex: string, amt: number): string {
  const col = hex.replace("#", "")
  const num = parseInt(col, 16)
  const r = Math.min(255, Math.max(0, (num >> 16) + amt))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amt))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amt))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`
}

function PlanSlot({ level, isNext }: { level: SlotLevel; isNext: boolean }) {
  return (
    <div
      className={cn(
        "fwp-slot",
        level === 1 && "fwp-slot-l1",
        level === 2 && "fwp-slot-l2",
        isNext && level === 0 && "fwp-slot-next"
      )}
    >
      {level === 2 ? <div className="fwp-slot-cap" /> : null}
    </div>
  )
}

function Conveyor({ height }: { height: number }) {
  const rollers = Math.max(4, Math.floor(height / 12))
  return (
    <div className="fwp-conveyor-outer">
      <div className="fwp-conveyor-label">{FORKLIFT_FLOOR_PLAN.conveyorLabel}</div>
      <div className="fwp-conveyor-body" style={{ height }}>
        <div className="fwp-conveyor-rail fwp-conveyor-rail-l" />
        <div className="fwp-conveyor-rail fwp-conveyor-rail-r" />
        <div className="fwp-conveyor-rollers">
          {Array.from({ length: rollers }).map((_, i) => (
            <div key={i} className="fwp-conveyor-roller" />
          ))}
        </div>
      </div>
      <div className="fwp-conveyor-arrow">▶</div>
    </div>
  )
}

function Road({ bottom }: { bottom?: boolean }) {
  return (
    <div className={cn("fwp-road", bottom && "fwp-road-bottom")}>
      <div className="fwp-road-label">П Р О Е З Д</div>
    </div>
  )
}

function RowColumn({
  row,
  disabled,
  onSelect,
}: {
  row: ForkliftMapRow
  disabled?: boolean
  onSelect: (row: ForkliftMapRow) => void
}) {
  const full = row.freePalletSlots < 1
  const num = rowDisplayNumber(row)
  const nextZero = row.nextSlotIndex !== null ? row.nextSlotIndex - 1 : -1

  return (
    <div className="fwp-row-col">
      {row.fifoRank ? (
        <span className="rounded-md bg-primary/90 px-1.5 py-0.5 text-[8px] font-bold text-primary-foreground">
          FIFO {row.fifoRank}
        </span>
      ) : null}
      <button
        type="button"
        disabled={disabled || full}
        onClick={() => onSelect(row)}
        className={cn("fwp-row-badge", full && "fwp-full", row.recommended && "fwp-fifo")}
        title={full ? `${row.label} — полон` : `Поставить в ${row.label}`}
      >
        #{num}
      </button>
      <div className="text-[9px] font-bold tracking-wide text-[#666]">з.{row.zone}</div>
      <div className="fwp-slots-col">
        {row.slotLevels
          .map((level, slotIdx) => ({ level, slotIdx }))
          .reverse()
          .map(({ level, slotIdx }) => (
            <PlanSlot key={slotIdx} level={level} isNext={slotIdx === nextZero} />
          ))}
      </div>
      <div>
        <div className="fwp-row-count">
          {row.occupiedPallets}
          <span className="text-[10px] font-normal text-[#555]">/{FORKLIFT_MAP_SLOTS}</span>
        </div>
        <div className="fwp-row-stacks">
          {row.stackCount > 0 ? `${row.stackCount} стопок` : ""}
        </div>
        <div className="fwp-row-zone">ряд {num}</div>
      </div>
    </div>
  )
}

export function ForkliftMapLegend({ className }: { className?: string }) {
  return (
    <div className={cn("fwp-legend", className)}>
      <div className="fwp-legend-item">
        <div className="fwp-legend-swatch fwp-ls-empty" />
        Пусто
      </div>
      <div className="fwp-legend-item">
        <div className="fwp-legend-swatch fwp-ls-l1" />
        1 палет
      </div>
      <div className="fwp-legend-item">
        <div className="fwp-legend-swatch fwp-ls-l2" />
        2 палета
      </div>
      <div className="fwp-legend-item">
        <div className="fwp-legend-swatch fwp-ls-next" />
        Следующее
      </div>
    </div>
  )
}

export function ForkliftWarehouseMap({
  rows,
  onSelectRow,
  disabled,
}: {
  rows: ForkliftMapRow[]
  onSelectRow: (row: ForkliftMapRow) => void
  disabled?: boolean
}) {
  const warehouseRef = useRef<HTMLDivElement>(null)
  const forkRefs = useRef<(HTMLDivElement | null)[]>([])
  const animRef = useRef<{
    x: number[]
    dx: number[]
    roadIdx: number[]
  } | null>(null)
  const rafRef = useRef<number | null>(null)

  const stats = getForkliftPlanStats(rows)
  const wallHeight = FORKLIFT_MAP_SLOTS * 29 + 120
  const conveyorHeight = Math.min(180, FORKLIFT_MAP_SLOTS * 16)

  useEffect(() => {
    const ware = warehouseRef.current
    if (!ware) return

    animRef.current = {
      x: [80, 240],
      dx: [1.4, -1.0],
      roadIdx: [0, 1],
    }

    const tick = () => {
      const state = animRef.current
      const el = warehouseRef.current
      if (!state || !el) return

      const W = el.offsetWidth || 600
      const roads = el.querySelectorAll<HTMLElement>(".fwp-road")
      const wRect = el.getBoundingClientRect()

      state.x.forEach((x, i) => {
        let nx = x + state.dx[i]
        if (nx > W - 44) {
          nx = W - 44
          state.dx[i] = -Math.abs(state.dx[i])
        }
        if (nx < 52) {
          nx = 52
          state.dx[i] = Math.abs(state.dx[i])
        }
        state.x[i] = nx

        const fork = forkRefs.current[i]
        if (!fork) return

        let roadY = 5
        const rd = roads[state.roadIdx[i]]
        if (rd) {
          const rRect = rd.getBoundingClientRect()
          roadY = rRect.top - wRect.top + 4
        }

        fork.style.left = `${nx}px`
        fork.style.top = `${roadY}px`
        fork.style.transform = state.dx[i] < 0 ? "scaleX(-1)" : "scaleX(1)"
      })

      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [rows.length])

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Нет рядов со свободным местом по фильтру.
      </div>
    )
  }

  return (
    <div className="fwp-root space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-foreground">
          Склад — <span className="text-primary">вид сверху</span>
        </p>
        <ForkliftMapLegend />
      </div>

      <div className="fwp-plan-card">
        <div className="fwp-plan-header">
          <h2>Схема склада · Постановка палетов</h2>
          <p>Нажмите #ряд — палета встанет в следующее свободное место</p>
        </div>

        <div className="fwp-warehouse-wrap">
          <div className="fwp-warehouse" ref={warehouseRef}>
            <div className="fwp-forklift" ref={(el) => { forkRefs.current[0] = el }}>
              <ForkliftSvg color="#e8a020" />
            </div>
            <div className="fwp-forklift" ref={(el) => { forkRefs.current[1] = el }}>
              <ForkliftSvg color="#3070c8" />
            </div>

            <div className="fwp-factory-wall" style={{ height: wallHeight }}>
              <div className="fwp-factory-label">{FORKLIFT_FLOOR_PLAN.factoryLabel}</div>
              <Conveyor height={conveyorHeight} />
            </div>

            <div className="fwp-warehouse-main">
              <Road />
              <div className="fwp-rows-strip">
                {rows.map((row) => (
                  <RowColumn
                    key={row.rowId}
                    row={row}
                    disabled={disabled}
                    onSelect={onSelectRow}
                  />
                ))}
              </div>
              <Road bottom />
            </div>
          </div>
        </div>

        <div className="fwp-plan-footer">
          <span>{FORKLIFT_FLOOR_PLAN.orientationHint}</span>
          <div className="fwp-stat-pill">
            <span>
              Свободно: <b>{stats.free}</b>
            </span>
            <span>
              Уровень 1: <b>{stats.level1}</b>
            </span>
            <span>
              Стопки: <b>{stats.level2}</b>
            </span>
          </div>
        </div>
        <div className="fwp-plan-meta">
          {rows.length} рядов на плане · {FORKLIFT_MAP_SLOTS} мест в колонке · всего{" "}
          {rows.length * FORKLIFT_MAP_SLOTS} ячеек
        </div>
      </div>
    </div>
  )
}
