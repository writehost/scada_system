"use client"

import { Plus, RotateCcw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Torg1Fields, Torg1Line } from "@/lib/wms/torg1"
import { cn } from "@/lib/utils"

type Props = {
  fields: Torg1Fields
  readOnly?: boolean
  onChange: (next: Torg1Fields) => void
  onReset?: () => void
  showAllColumns?: boolean
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

export function Torg1GoodsScreenTable({
  fields,
  readOnly,
  onChange,
  onReset,
  showAllColumns = false,
}: Props) {
  function patchLine(index: number, patch: Partial<Torg1Line>) {
    if (readOnly) return
    onChange({
      ...fields,
      lines: fields.lines.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line
      ),
    })
  }

  function removeLine(index: number) {
    if (readOnly) return
    onChange({
      ...fields,
      lines: fields.lines
        .filter((_, lineIndex) => lineIndex !== index)
        .map((line, lineIndex) => ({ ...line, lineNo: lineIndex + 1 })),
    })
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border/70 bg-card print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2.5">
        <h3 className="text-sm font-semibold">
          Позиции приёмки · {fields.lines.length}
        </h3>
        {!readOnly ? (
          <div className="flex items-center gap-2">
            {onReset ? (
              <Button type="button" size="sm" variant="ghost" onClick={onReset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Из приёмки
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({
                  ...fields,
                  lines: [...fields.lines, emptyLine(fields.lines.length + 1)],
                })
              }
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Добавить
            </Button>
          </div>
        ) : null}
      </div>

      <div className="max-h-[440px] overflow-auto">
        <table
          className={cn(
            "w-full border-collapse text-xs",
            showAllColumns ? "min-w-[1080px]" : "min-w-[760px]"
          )}
        >
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="w-10 border-b px-2 py-2 text-center font-medium">№</th>
              <th className="min-w-[320px] border-b px-2 py-2 font-medium">Наименование</th>
              <th className="w-40 border-b px-2 py-2 font-medium">Код</th>
              <th className="w-16 border-b px-2 py-2 text-center font-medium">ЕИ</th>
              <th className="w-24 border-b px-2 py-2 text-right font-medium">По документу</th>
              <th className="w-24 border-b px-2 py-2 text-right font-medium">Факт</th>
              {showAllColumns ? (
                <>
                  <th className="w-36 border-b px-2 py-2 font-medium">Партия</th>
                  <th className="w-48 border-b px-2 py-2 font-medium">Примечание</th>
                </>
              ) : null}
              {!readOnly ? <th className="w-10 border-b" /> : null}
            </tr>
          </thead>
          <tbody>
            {fields.lines.length === 0 ? (
              <tr>
                <td
                  colSpan={(readOnly ? 6 : 7) + (showAllColumns ? 2 : 0)}
                  className="px-3 py-8 text-center text-sm text-muted-foreground"
                >
                  В приёмке нет товарных позиций
                </td>
              </tr>
            ) : (
              fields.lines.map((line, index) => (
                <tr
                  key={`${line.lineNo}-${line.itemCode}-${index}`}
                  className="border-b border-border/50 last:border-b-0 hover:bg-muted/30"
                >
                  <td className="px-2 py-2 text-center align-top text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-2 py-2 align-top">
                    {readOnly ? (
                      <div className="whitespace-normal font-medium leading-5">{line.name || "—"}</div>
                    ) : (
                      <Input
                        value={line.name}
                        onChange={(event) => patchLine(index, { name: event.target.value })}
                        className="h-8 min-w-[300px]"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 align-top font-mono text-[11px]">
                    {readOnly ? (
                      line.itemCode || "—"
                    ) : (
                      <Input
                        value={line.itemCode}
                        onChange={(event) => patchLine(index, { itemCode: event.target.value })}
                        className="h-8 font-mono text-xs"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-center align-top">
                    {readOnly ? (
                      line.uom || "—"
                    ) : (
                      <Input
                        value={line.uom}
                        onChange={(event) => patchLine(index, { uom: event.target.value })}
                        className="h-8 text-center"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-right align-top tabular-nums">
                    {readOnly ? (
                      line.qtyDoc || "—"
                    ) : (
                      <Input
                        value={line.qtyDoc}
                        onChange={(event) => patchLine(index, { qtyDoc: event.target.value })}
                        className="h-8 text-right"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 text-right align-top font-medium tabular-nums">
                    {readOnly ? (
                      line.qtyFact || "—"
                    ) : (
                      <Input
                        value={line.qtyFact}
                        onChange={(event) => patchLine(index, { qtyFact: event.target.value })}
                        className="h-8 text-right"
                      />
                    )}
                  </td>
                  {showAllColumns ? (
                    <>
                      <td className="px-2 py-2 align-top">
                        {readOnly ? (
                          line.lotCode || "—"
                        ) : (
                          <Input
                            value={line.lotCode}
                            onChange={(event) =>
                              patchLine(index, { lotCode: event.target.value })
                            }
                            className="h-8"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 align-top">
                        {readOnly ? (
                          line.note || "—"
                        ) : (
                          <Input
                            value={line.note}
                            onChange={(event) =>
                              patchLine(index, { note: event.target.value })
                            }
                            className="h-8"
                          />
                        )}
                      </td>
                    </>
                  ) : null}
                  {!readOnly ? (
                    <td className="px-1 py-1.5 align-top">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => removeLine(index)}
                        aria-label={`Удалить позицию ${index + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
