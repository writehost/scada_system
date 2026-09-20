"use client"

import type { CSSProperties } from "react"
import type { Torg1Fields } from "@/lib/wms/torg1"
import { isTorg1PermanentField } from "@/lib/wms/torg1"
import obrazecGrid from "./torg1-obrazec-page1.json"
import { obrazecSlotAt } from "./torg1-obrazec-slots"
import { obrazecSlotKey, obrazecSlotPatch, obrazecSlotValue } from "./torg1-obrazec-values"
import { cn } from "@/lib/utils"

type Props = {
  fields: Torg1Fields
  auto: Torg1Fields
  readOnly?: boolean
  lockPermanentFields?: boolean
  onChange: (next: Torg1Fields) => void
}

const ink: CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "11px",
  lineHeight: 1.25,
  color: "#000",
}

const GRID_ROWS = obrazecGrid.rows.filter(
  (row, i) => !String(row[0] ?? "").includes("КонсультантПлюс") && i < 64
)

const COLS = obrazecGrid.cols

function slotLocked(
  slot: NonNullable<ReturnType<typeof obrazecSlotAt>>,
  readOnly?: boolean,
  lockPermanent?: boolean
) {
  if (readOnly) return true
  if (!lockPermanent) return false
  if (slot.kind === "orgLine") return true
  if (slot.kind === "field" || slot.kind === "datePart") {
    return isTorg1PermanentField(slot.key)
  }
  return false
}

function cellText(row: string[], col: number) {
  return String(row[col] ?? "").trim()
}

/** Сколько пустых ячеек справа до следующего текста/слота (для colspan). */
function spanUntilNext(row: string[], ri: number, startCol: number) {
  let span = 1
  for (let c = startCol + 1; c < COLS; c += 1) {
    if (obrazecSlotAt(ri, c) || cellText(row, c)) break
    span += 1
  }
  return span
}

function CellInput({
  value,
  readOnly,
  align,
  onChange,
}: {
  value: string
  readOnly?: boolean
  align?: "left" | "center" | "right"
  onChange: (v: string) => void
}) {
  return (
    <input
      value={value}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : 0}
      onChange={(e) => {
        if (!readOnly) onChange(e.target.value)
      }}
      className={cn(
        "torg1-line-input w-full min-w-0 border-0 border-b border-black bg-transparent px-0.5 py-0 outline-none",
        readOnly ? "cursor-default text-[#1a3a8a]/90" : "text-[#1a3a8a]",
        align === "center" && "text-center",
        align === "right" && "text-right"
      )}
      style={ink}
    />
  )
}

type RowSeg =
  | { kind: "slot"; col: number; span: number; slot: NonNullable<ReturnType<typeof obrazecSlotAt>> }
  | { kind: "text"; col: number; span: number; text: string }
  | { kind: "empty"; col: number; span: number }

function buildRowSegments(row: string[], ri: number): RowSeg[] {
  const segs: RowSeg[] = []
  let ci = 0
  while (ci < COLS) {
    const slot = obrazecSlotAt(ri, ci)
    if (slot) {
      const span = spanUntilNext(row, ri, ci)
      segs.push({ kind: "slot", col: ci, span, slot })
      ci += span
      continue
    }
    const text = cellText(row, ci)
    if (text) {
      const span = spanUntilNext(row, ri, ci)
      segs.push({ kind: "text", col: ci, span, text })
      ci += span
      continue
    }
    const span = spanUntilNext(row, ri, ci)
    segs.push({ kind: "empty", col: ci, span })
    ci += span
  }
  return segs
}

export function Torg1ObrazecSheet({ fields, auto, readOnly, lockPermanentFields, onChange }: Props) {
  return (
    <div className="torg1-obrazec-wrap w-full overflow-x-auto">
      <table className="torg1-obrazec-grid w-full min-w-[720px] border-collapse" style={ink}>
        <tbody>
          {GRID_ROWS.map((row, ri) => (
            <tr key={ri} className="min-h-[18px]">
              {buildRowSegments(row, ri).map((seg) => {
                if (seg.kind === "slot") {
                  const locked = slotLocked(seg.slot, readOnly, lockPermanentFields)
                  const value = obrazecSlotValue(fields, seg.slot)
                  const autoValue = obrazecSlotValue(auto, seg.slot)
                  const align =
                    seg.slot.kind === "orgLine"
                      ? "left"
                      : seg.slot.kind === "field" || seg.slot.kind === "datePart"
                        ? seg.slot.align ?? "left"
                        : "left"
                  return (
                    <td
                      key={`s-${seg.col}`}
                      colSpan={seg.span}
                      className="p-0 align-bottom"
                    >
                      <CellInput
                        value={value}
                        readOnly={locked}
                        align={align}
                        onChange={(v) => onChange(obrazecSlotPatch(fields, seg.slot, v))}
                      />
                      {value !== autoValue && !locked ? (
                        <span className="print:hidden text-[7px] text-slate-400">●</span>
                      ) : null}
                    </td>
                  )
                }

                if (seg.kind === "text") {
                  const codeBox =
                    ri >= 5 && ri <= 14 && seg.col >= 84 && seg.col <= 101
                  return (
                    <td
                      key={`t-${seg.col}`}
                      colSpan={seg.span}
                      className={cn(
                        "whitespace-normal break-words p-0 px-0.5 align-bottom",
                        codeBox && "border border-black"
                      )}
                    >
                      {seg.text}
                    </td>
                  )
                }

                return <td key={`e-${seg.col}`} colSpan={seg.span} className="p-0" />
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { obrazecSlotKey }
