"use client"

/**
 * ТОРГ-1: бланк = ваш Excel-образец (CSV) + редактируемые переменные в ячейках.
 */

import type { CSSProperties } from "react"
import type { Torg1Fields, Torg1Line } from "@/lib/wms/torg1"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Plus, Trash2 } from "lucide-react"
import { Torg1ObrazecSheet } from "./torg1-obrazec-sheet"

type Props = {
  fields: Torg1Fields
  auto: Torg1Fields
  readOnly?: boolean
  lockPermanentFields?: boolean
  /** print-only: бланк стр.1 только при печати (html.torg1-printing), на экране — таблица товара. */
  blankMode?: "always" | "print-only"
  className?: string
  onChange: (next: Torg1Fields) => void
  onResetField?: (key: keyof Torg1Fields) => void
}

const ink: CSSProperties = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: "10px",
  color: "#000",
}

function emptyLine(lineNo: number): Torg1Line {
  return {
    lineNo,
    name: "",
    itemCode: "",
    uom: "шт",
    qtyDoc: "",
    qtyFact: "",
    lotCode: "",
    note: "",
  }
}

function LineInput({
  value,
  readOnly,
  onChange,
  className,
  align,
}: {
  value: string
  readOnly?: boolean
  onChange: (v: string) => void
  className?: string
  align?: "left" | "center" | "right"
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
        "torg1-line-input w-full border-0 border-b border-black bg-transparent px-0.5 py-0 outline-none",
        readOnly ? "text-[#1a3a8a]/90" : "text-[#1a3a8a]",
        align === "center" && "text-center",
        className
      )}
      style={ink}
    />
  )
}

export function Torg1Form({
  fields,
  auto,
  readOnly,
  lockPermanentFields = false,
  blankMode = "always",
  className,
  onChange,
  onResetField,
}: Props) {
  function updateLine(idx: number, patch: Partial<Torg1Line>) {
    if (readOnly) return
    onChange({
      ...fields,
      lines: fields.lines.map((row, i) => (i === idx ? { ...row, ...patch } : row)),
    })
  }

  return (
    <div
      className={cn(
        "torg1-sheet mx-auto w-fit max-w-none bg-white px-1 py-1 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none",
        className
      )}
      style={ink}
    >
      <div className={cn(blankMode === "print-only" && "torg1-blank-print-only")}>
        <Torg1ObrazecSheet
          fields={fields}
          auto={auto}
          readOnly={readOnly}
          lockPermanentFields={lockPermanentFields}
          onChange={onChange}
        />
      </div>

      {/* стр.2 ТОРГ-1 — товар (в CSV стр.1 нет) */}
      <div className="mt-3 border-t border-dashed border-black/30 pt-2 print:break-before-page">
        <div className="mb-1 text-[8px] text-black/45">2-я страница формы № ТОРГ-1</div>
        <div className="border border-black">
          <div className="flex items-center justify-between border-b border-black px-1.5 py-1">
            <span className="font-semibold">Товар</span>
            {!readOnly ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="print:hidden h-6 rounded-none px-2 text-[10px]"
                onClick={() =>
                  onChange({
                    ...fields,
                    lines: [...fields.lines, emptyLine(fields.lines.length + 1)],
                  })
                }
              >
                <Plus className="mr-1 h-3 w-3" />
                Строка
              </Button>
            ) : null}
          </div>
          <table className="w-full table-fixed border-collapse text-[9px]">
            <thead>
              <tr>
                <th className="w-7 border-b border-r border-black px-0.5 font-normal">№</th>
                <th className="border-b border-r border-black px-0.5 font-normal">наименование</th>
                <th className="w-24 border-b border-r border-black px-0.5 font-normal">код</th>
                <th className="w-9 border-b border-r border-black px-0.5 font-normal">ЕИ</th>
                <th className="w-11 border-b border-r border-black px-0.5 font-normal">док.</th>
                <th className="w-11 border-b border-r border-black px-0.5 font-normal">факт</th>
                <th className="w-14 border-b border-r border-black px-0.5 font-normal">партия</th>
                <th className="w-16 border-b border-black px-0.5 font-normal">прим.</th>
                {!readOnly ? <th className="print:hidden w-6 border-b border-black" /> : null}
              </tr>
            </thead>
            <tbody>
              {fields.lines.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 8 : 9} className="px-2 py-2 text-black/50">
                    Нет позиций
                  </td>
                </tr>
              ) : (
                fields.lines.map((line, idx) => (
                  <tr key={`${line.lineNo}-${idx}`}>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={String(line.lineNo)}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { lineNo: Number(v) || idx + 1 })}
                        align="center"
                      />
                    </td>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.name}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { name: v })}
                      />
                    </td>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.itemCode}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { itemCode: v })}
                      />
                    </td>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.uom}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { uom: v })}
                        align="center"
                      />
                    </td>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.qtyDoc}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { qtyDoc: v })}
                        align="center"
                      />
                    </td>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.qtyFact}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { qtyFact: v })}
                        align="center"
                      />
                    </td>
                    <td className="border-b border-r border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.lotCode}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { lotCode: v })}
                      />
                    </td>
                    <td className="border-b border-black/40 px-0.5 align-top">
                      <LineInput
                        value={line.note}
                        readOnly={readOnly}
                        onChange={(v) => updateLine(idx, { note: v })}
                      />
                    </td>
                    {!readOnly ? (
                      <td className="print:hidden border-b border-black/40 px-0.5 align-top">
                        <button
                          type="button"
                          className="text-black/40 hover:text-black"
                          onClick={() =>
                            onChange({
                              ...fields,
                              lines: fields.lines
                                .filter((_, i) => i !== idx)
                                .map((row, i) => ({ ...row, lineNo: i + 1 })),
                            })
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {onResetField ? (
            <div className="print:hidden border-t border-black/20 px-1.5 py-1">
              <button
                type="button"
                className="text-[10px] text-slate-600 hover:underline"
                onClick={() => onResetField("lines")}
              >
                Сбросить позиции к авто
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
