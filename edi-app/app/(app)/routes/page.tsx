"use client"

import { ArrowRight, GitBranch, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { api, fmtDateTime, useApi } from "@/components/api"
import { UserSelect } from "@/components/pickers"
import { can, useMe } from "@/components/shell"
import { Badge, Button, cn, ErrorLine, Field, IconButton, Input, Select, Spinner, toast } from "@/components/ui"
import { DOC_TYPES } from "@/lib/edi/doc-types.ts"
import { EDI_ROLES } from "@/lib/edi/permissions.ts"
import type { StepDef, WorkflowDefinition } from "@/lib/edi/workflow.ts"

type Def = { defId: string; code: string; name: string; version: number; isActive: boolean; docTypes: string[]; priority: number; definition: WorkflowDefinition; createdAt: string; running: number }
type Draft = { code: string; name: string; docTypes: string[]; priority: number; definition: WorkflowDefinition; baseVersion?: number }

const KIND: Record<string, string> = { approval: "Согласование", review: "Проверка", signing: "Подписание" }
const DECISIONS: Record<string, Array<{ v: StepDef["decisions"][number]; l: string }>> = {
  approval: [{ v: "approve", l: "Согласовать" }, { v: "reject", l: "Отклонить" }, { v: "rework", l: "На доработку" }],
  review: [{ v: "approve", l: "Принять" }, { v: "reject", l: "Отклонить" }, { v: "rework", l: "На доработку" }],
  signing: [{ v: "sign", l: "Подписать (нужна ЭП)" }, { v: "reject", l: "Отказать" }],
}
const COND_FIELD: Record<string, string> = { amount: "Сумма", docType: "Тип документа", department: "Подразделение", direction: "Направление" }
const COND_OP: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=", neq: "≠", in: "одно из" }

const newStep = (stage: number): StepDef => ({ id: `s${Math.random().toString(36).slice(2, 7)}`, name: "Новый шаг", kind: "approval", assignee: { type: "role", role: "edi_approver" }, mode: "any", stage, dueHours: 24, decisions: ["approve", "reject", "rework"] })

export default function RoutesPage() {
  const me = useMe()
  const { data, reload } = useApi<{ definitions: Def[]; presets: Array<{ code: string; name: string; docTypes: string[]; definition: WorkflowDefinition }> }>("/api/edi/workflows")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const admin = can(me, "edi.workflow.admin")
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>
  if (!me.plan.features.workflows) return <div className="p-6 text-[13px] text-muted-foreground">Маршруты согласования недоступны на тарифе «{me.plan.name}».</div>

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError("")
    try {
      const r = await api<{ version: number }>("/api/edi/workflows", { method: "POST", json: draft })
      toast(`Сохранена версия ${r.version}. Запущенные процессы продолжают идти по прежней версии.`)
      setDraft(null)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-bold">Маршруты согласования</h1>
        {admin && !draft && (
          <>
            <Select className="w-auto" value="" onChange={(e) => { const p = data.presets.find((x) => x.code === e.target.value); if (p) setDraft({ ...p, priority: 100 }) }} aria-label="Заготовка">
              <option value="">Из заготовки…</option>
              {data.presets.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
            </Select>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setDraft({ code: "", name: "", docTypes: [], priority: 100, definition: { steps: [newStep(1)] } })}>Новый маршрут</Button>
          </>
        )}
      </div>
      {!draft && (
        <div className="space-y-2">
          {data.definitions.length === 0 && <p className="text-[13px] text-muted-foreground">Маршрутов нет. Без маршрута документ нельзя отправить на согласование — создайте его из заготовки.</p>}
          {data.definitions.map((d) => (
            <section key={d.defId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <GitBranch className="size-4 text-muted-foreground" />
                <span className="text-[13px] font-semibold">{d.name}</span>
                <Badge>v{d.version}</Badge>
                {!d.isActive && <Badge tone="danger">отключён</Badge>}
                {d.running > 0 && <Badge tone="warning">в работе: {d.running}</Badge>}
                <span className="text-xs text-muted-foreground">{d.docTypes.length ? d.docTypes.map((t) => DOC_TYPES.find((x) => x.code === t)?.short ?? t).join(", ") : "все типы"} · {fmtDateTime(d.createdAt)}</span>
                {admin && <Button size="sm" className="ml-auto" onClick={() => setDraft({ code: d.code, name: d.name, docTypes: d.docTypes, priority: d.priority, definition: structuredClone(d.definition), baseVersion: d.version })}>Изменить</Button>}
              </div>
              <Flow def={d.definition} />
            </section>
          ))}
        </div>
      )}
      {draft && <Builder draft={draft} setDraft={setDraft} onSave={save} busy={busy} error={error} onCancel={() => setDraft(null)} />}
    </div>
  )
}

function Flow({ def }: { def: WorkflowDefinition }) {
  const stages = [...new Set(def.steps.map((s) => s.stage))].sort((a, b) => a - b)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <Badge>Создание</Badge>
      {stages.map((st) => (
        <span key={st} className="flex items-center gap-1.5">
          <ArrowRight className="size-3.5 text-muted-foreground" />
          <span className="flex flex-col gap-0.5">
            {def.steps.filter((s) => s.stage === st).map((s) => (
              <Badge key={s.id} tone={s.kind === "signing" ? "primary" : "info"} title={s.condition ? `если ${COND_FIELD[s.condition.field]} ${COND_OP[s.condition.op]} ${s.condition.value}` : undefined}>
                {s.name}
                {s.condition && " ?"}
              </Badge>
            ))}
          </span>
        </span>
      ))}
      <ArrowRight className="size-3.5 text-muted-foreground" />
      <Badge tone="success">Готово</Badge>
    </div>
  )
}

function Builder({ draft, setDraft, onSave, onCancel, busy, error }: { draft: Draft; setDraft: (d: Draft) => void; onSave: () => void; onCancel: () => void; busy: boolean; error: string }) {
  const steps = draft.definition.steps
  const stages = [...new Set(steps.map((s) => s.stage))].sort((a, b) => a - b)
  const setSteps = (next: StepDef[]) => {
    // нормализуем номера этапов, чтобы не было «дыр»
    const order = [...new Set(next.map((s) => s.stage))].sort((a, b) => a - b)
    setDraft({ ...draft, definition: { steps: next.map((s) => ({ ...s, stage: order.indexOf(s.stage) + 1 })) } })
  }
  const upd = (id: string, p: Partial<StepDef>) => setSteps(steps.map((s) => (s.id === id ? { ...s, ...p } : s)))
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Название" required className="sm:col-span-2"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
        <Field label="Код" hint={draft.baseVersion ? `новая версия после v${draft.baseVersion}` : "латиница"}><Input value={draft.code} disabled={Boolean(draft.baseVersion)} onChange={(e) => setDraft({ ...draft, code: e.target.value })} /></Field>
        <Field label="Приоритет" hint="меньше — выше"><Input inputMode="numeric" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 100 })} /></Field>
      </div>
      <Field label="Для типов документов (пусто — для всех)">
        <div className="flex flex-wrap gap-1">
          {DOC_TYPES.map((t) => (
            <button key={t.code} onClick={() => setDraft({ ...draft, docTypes: draft.docTypes.includes(t.code) ? draft.docTypes.filter((x) => x !== t.code) : [...draft.docTypes, t.code] })} className={cn("h-6 rounded-md border px-1.5 text-[11px]", draft.docTypes.includes(t.code) ? "border-ring bg-row-active" : "border-border")}>
              {t.short}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((st, i) => (
          <div key={st} className="flex shrink-0 items-start gap-3">
            <div className="w-72 space-y-2 rounded-xl bg-muted p-2">
              <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Этап {st}
                <span className="font-normal normal-case">{steps.filter((s) => s.stage === st).length > 1 ? "параллельно" : ""}</span>
              </div>
              {steps.filter((s) => s.stage === st).map((s) => (
                <StepEditor key={s.id} s={s} upd={(p) => upd(s.id, p)} remove={() => setSteps(steps.filter((x) => x.id !== s.id))} canRemove={steps.length > 1} />
              ))}
              <Button size="sm" variant="ghost" className="w-full" icon={<Plus className="size-3.5" />} onClick={() => setSteps([...steps, newStep(st)])}>Параллельный шаг</Button>
            </div>
            {i < stages.length - 1 && <ArrowRight className="mt-10 size-4 shrink-0 text-muted-foreground" />}
          </div>
        ))}
        <button className="mt-6 h-24 w-40 shrink-0 rounded-xl border-2 border-dashed border-border text-xs text-muted-foreground hover:border-ring" onClick={() => setSteps([...steps, newStep(Math.max(...stages) + 1)])}>
          + Следующий этап
        </button>
      </div>
      <ErrorLine error={error} />
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Отмена</Button>
        <Button variant="primary" busy={busy} disabled={!draft.name.trim() || !draft.code.trim()} onClick={onSave}>Сохранить версию</Button>
      </div>
    </section>
  )
}

function StepEditor({ s, upd, remove, canRemove }: { s: StepDef; upd: (p: Partial<StepDef>) => void; remove: () => void; canRemove: boolean }) {
  const a = s.assignee
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card p-2">
      <div className="flex gap-1">
        <Input value={s.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Название шага" />
        {canRemove && <IconButton label="Удалить шаг" onClick={remove}><Trash2 className="size-3.5" /></IconButton>}
      </div>
      <div className="grid grid-cols-2 gap-1">
        <Select value={s.kind} onChange={(e) => { const kind = e.target.value as StepDef["kind"]; upd({ kind, decisions: DECISIONS[kind].map((d) => d.v) }) }} aria-label="Вид шага">
          {Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={a.type} onChange={(e) => upd({ assignee: e.target.value === "role" ? { type: "role", role: "edi_approver" } : e.target.value === "user" ? { type: "user", userId: "" } : { type: "responsible" } })} aria-label="Исполнитель">
          <option value="role">Роль</option>
          <option value="user">Сотрудник</option>
          <option value="responsible">Ответственный</option>
        </Select>
      </div>
      {a.type === "role" && (
        <div className="grid grid-cols-2 gap-1">
          <Select value={a.role} onChange={(e) => upd({ assignee: { ...a, role: e.target.value } })} aria-label="Роль">
            {Object.entries(EDI_ROLES).map(([k, r]) => <option key={k} value={k}>{r.name}</option>)}
          </Select>
          <Input placeholder="подразделение" value={a.department ?? ""} onChange={(e) => upd({ assignee: { ...a, department: e.target.value || null } })} aria-label="Подразделение" />
        </div>
      )}
      {a.type === "user" && <UserSelect value={a.userId} onChange={(v) => upd({ assignee: { type: "user", userId: v } })} placeholder="выберите сотрудника" />}
      {a.type === "role" && (
        <Select value={s.mode} onChange={(e) => upd({ mode: e.target.value as "any" | "all" })} aria-label="Режим">
          <option value="any">Достаточно одного из роли</option>
          <option value="all">Нужны все из роли</option>
        </Select>
      )}
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">Срок, ч</span>
        <Input className="h-7 w-16" inputMode="numeric" value={s.dueHours ?? ""} onChange={(e) => upd({ dueHours: e.target.value ? Number(e.target.value) : null })} />
        <span className="text-muted-foreground">эскалация</span>
        <div className="flex-1"><UserSelect value={s.escalateToUserId ?? ""} onChange={(v) => upd({ escalateToUserId: v || null })} placeholder="ответственному" /></div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        {DECISIONS[s.kind].map((d) => (
          <label key={d.v} className="flex items-center gap-1">
            <input type="checkbox" checked={s.decisions.includes(d.v)} onChange={(e) => upd({ decisions: e.target.checked ? [...s.decisions, d.v] : s.decisions.filter((x) => x !== d.v) })} />
            {d.l}
          </label>
        ))}
      </div>
      <details open={Boolean(s.condition)}>
        <summary className="cursor-pointer text-xs text-muted-foreground">Условие шага</summary>
        <div className="mt-1 grid grid-cols-[1fr_60px_1fr_auto] gap-1">
          <Select value={s.condition?.field ?? ""} onChange={(e) => upd({ condition: e.target.value ? { field: e.target.value as "amount", op: e.target.value === "amount" ? "gt" : "eq", value: s.condition?.value ?? "" } : null })} aria-label="Поле условия">
            <option value="">всегда</option>
            {Object.entries(COND_FIELD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {s.condition && (
            <>
              <Select value={s.condition.op} onChange={(e) => upd({ condition: { ...s.condition!, op: e.target.value as "gt" } })} aria-label="Оператор">
                {Object.entries(COND_OP).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Input value={Array.isArray(s.condition.value) ? s.condition.value.join(",") : String(s.condition.value)} onChange={(e) => upd({ condition: { ...s.condition!, value: s.condition!.field === "amount" ? Number(e.target.value) || 0 : e.target.value } })} aria-label="Значение" />
            </>
          )}
        </div>
      </details>
    </div>
  )
}
