"use client"

import { useEffect, useMemo, useState } from "react"
import { Code2, Plus, X } from "lucide-react"
import { COND_OPS, buildCondition, parseCondition, type CondModel, type CondOp, type CondRule } from "@/lib/doc-templates/jinja/expressions"
import type { DataSchema } from "@/lib/doc-templates/schema"
import { cn } from "@/lib/utils"
import { labelForExpr, type LoopContext } from "../studio/labels"
import { NativeSelect, Segmented, SmallButton, inputClassName } from "./fields"
import { VariablePicker } from "./VariablePicker"

/**
 * «Показывать блок, если [поле] [равно] [значение]». Без Jinja на экране;
 * сложное выражение, которое модель не описывает, остаётся в Advanced-режиме как есть.
 */
export function ConditionEditor({
  value,
  onChange,
  schema,
  loops,
}: {
  value: string
  onChange: (expr: string) => void
  schema: DataSchema
  loops: LoopContext
}) {
  const parsed = useMemo(() => parseCondition(value), [value])
  const [advanced, setAdvanced] = useState(!parsed)
  const [rawDraft, setRawDraft] = useState(value)
  const [pickFor, setPickFor] = useState<number | null>(null)
  useEffect(() => setRawDraft(value), [value])
  useEffect(() => {
    if (!parsed) setAdvanced(true)
  }, [parsed])

  const model: CondModel = parsed ?? { join: "and", rules: [] }
  const commit = (m: CondModel) => onChange(buildCondition(m))
  const update = (i: number, patch: Partial<CondRule>) => commit({ ...model, rules: model.rules.map((r, k) => (k === i ? { ...r, ...patch } : r)) })

  return (
    <div className="space-y-2">
      {!advanced && (
        <>
          {model.rules.length === 0 && <div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-[11.5px] text-slate-400">Условий нет — блок выводится всегда</div>}
          {model.rules.map((rule, i) => {
            const op = COND_OPS.find((o) => o.id === rule.op)
            const label = labelForExpr(schema, rule.left, loops)
            const rightValue = rule.right ? (rule.right.kind === "path" ? rule.right.value : rule.right.value == null ? "" : String(rule.right.value)) : ""
            return (
              <div key={i} className="space-y-1.5 rounded-md border border-amber-200 bg-amber-50/40 p-2">
                {i > 0 && <div className="-mt-0.5 text-[10.5px] font-semibold uppercase text-amber-700">{model.join === "and" ? "и" : "или"}</div>}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPickFor(i)}
                    className={cn(inputClassName, "flex items-center truncate text-left", !rule.left && "text-slate-400")}
                    title={rule.left}
                  >
                    {rule.left ? `${label.group ? `${label.group} · ` : ""}${label.label}` : "Выберите поле…"}
                  </button>
                  <button type="button" onClick={() => commit({ ...model, rules: model.rules.filter((_, k) => k !== i) })} className="rounded p-1 text-slate-400 hover:bg-white hover:text-red-600">
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="flex gap-1.5">
                  <div className="w-[46%]">
                    <NativeSelect<CondOp>
                      value={rule.op}
                      onChange={(op) => update(i, { op, right: COND_OPS.find((o) => o.id === op)?.unary ? undefined : rule.right ?? { kind: "literal", value: "" } })}
                      options={COND_OPS.map((o) => ({ value: o.id, label: o.label }))}
                    />
                  </div>
                  {!op?.unary && (
                    <input
                      className={inputClassName}
                      defaultValue={rightValue}
                      key={`${i}:${rightValue}`}
                      placeholder={label.type === "number" || label.type === "money" ? "0" : "значение"}
                      onBlur={(e) => {
                        const raw = e.target.value
                        const num = raw.trim() !== "" && /^-?\d+(\.\d+)?$/.test(raw.trim()) && (label.type === "number" || label.type === "money")
                        update(i, { right: { kind: "literal", value: num ? Number(raw) : raw } })
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                        e.stopPropagation()
                      }}
                    />
                  )}
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-2">
            <SmallButton onClick={() => setPickFor(-1)}>
              <Plus className="size-3.5" /> Условие
            </SmallButton>
            {model.rules.length > 1 && (
              <div className="w-28">
                <Segmented
                  value={model.join}
                  onChange={(join) => commit({ ...model, join })}
                  options={[
                    { value: "and", label: "И" },
                    { value: "or", label: "ИЛИ" },
                  ]}
                />
              </div>
            )}
          </div>
        </>
      )}
      {advanced && (
        <div className="space-y-1.5">
          <textarea
            className={cn(inputClassName, "h-20 resize-y py-1.5 text-[11.5px]")}
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace" }}
            value={rawDraft}
            spellCheck={false}
            onChange={(e) => setRawDraft(e.target.value)}
            onBlur={() => rawDraft !== value && onChange(rawDraft.trim())}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {!parsed && <div className="text-[10.5px] text-slate-400">Выражение сложнее визуального редактора — оно сохранится без изменений.</div>}
        </div>
      )}
      <button
        type="button"
        onClick={() => setAdvanced((a) => !a || !parsed)}
        className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"
        disabled={!parsed && advanced}
      >
        <Code2 className="size-3" /> {advanced ? (parsed ? "Визуальный режим" : "Advanced: выражение Jinja") : "Advanced: показать выражение Jinja"}
      </button>
      <VariablePicker
        open={pickFor !== null}
        onOpenChange={(o) => !o && setPickFor(null)}
        schema={schema}
        loops={loops}
        title="Поле условия"
        onPick={(path) => {
          const clean = path.replace(/\s*\|\s*length$/, "")
          if (pickFor === -1 || pickFor === null) commit({ ...model, rules: [...model.rules, { left: clean, op: "exists" }] })
          else update(pickFor, { left: clean })
        }}
      />
    </div>
  )
}
