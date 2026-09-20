"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarCog, Layers, Plus, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  createCalendarRule,
  deleteCalendarRule,
  listCalendarRules,
  updateCalendarRule,
  type WmsCalendarRule,
} from "@/lib/wms-api"

function template(kind: string): { kind: string; configText: string } {
  if (kind === "document") {
    return {
      kind,
      configText: JSON.stringify(
        {
          eventTypeCode: "receiving",
          documentTypes: ["receiving", "putaway", "shipping", "transfer"],
          documentStatuses: [],
          dateField: "bestEffort",
          severityCode: "info",
          statusCode: "planned",
          tags: ["docs"],
        },
        null,
        2
      ),
    }
  }
  if (kind === "quarantine") {
    return {
      kind,
      configText: JSON.stringify(
        {
          eventTypeCode: "quarantine",
          minQty: 0,
          severityCode: "warn",
          statusCode: "in_progress",
          tags: ["lots"],
        },
        null,
        2
      ),
    }
  }
  if (kind === "expiry") {
    return {
      kind,
      configText: JSON.stringify(
        {
          eventTypeCode: "expiry_warning",
          dateField: "expiryAt",
          warnDays: 7,
          criticalDays: 2,
          minQty: 0,
          includeBlocked: false,
          severityCode: "warn",
          statusCode: "planned",
          tags: ["expiry"],
        },
        null,
        2
      ),
    }
  }
  return { kind: "custom", configText: JSON.stringify({}, null, 2) }
}

export default function AdminCalendarRulesPage() {
  const [rules, setRules] = useState<WmsCalendarRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [kind, setKind] = useState<"document" | "quarantine" | "expiry" | "custom">("document")
  const [priority, setPriority] = useState("100")
  const [isActive, setIsActive] = useState(true)
  const [configText, setConfigText] = useState(template("document").configText)
  const [bootstrapping, setBootstrapping] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await listCalendarRules()
      setRules(data.rules || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить правила")
      setRules([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activeCount = useMemo(() => rules.filter((r) => r.isActive && !r.deletedAt).length, [rules])
  const hasAnyRules = rules.some((r) => !r.deletedAt)

  function openCreate() {
    const t = template(kind)
    setName("")
    setPriority("100")
    setIsActive(true)
    setConfigText(t.configText)
    setOpen(true)
  }

  async function create() {
    setError(null)
    try {
      const parsed = JSON.parse(configText || "{}") as Record<string, unknown>
      const p = Number(priority)
      const res = await createCalendarRule({
        name: name.trim() || `Rule ${new Date().toLocaleString("ru-RU")}`,
        kind,
        isActive,
        priority: Number.isFinite(p) ? p : 100,
        config: parsed,
      })
      setRules((prev) => [res.rule, ...prev])
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать правило (проверьте JSON)")
    }
  }

  async function createDefaults() {
    setBootstrapping(true)
    setError(null)
    try {
      const docCfg = JSON.parse(template("document").configText) as Record<string, unknown>
      const qCfg = JSON.parse(template("quarantine").configText) as Record<string, unknown>
      const eCfg = JSON.parse(template("expiry").configText) as Record<string, unknown>
      const created = await Promise.all([
        createCalendarRule({
          name: "Документы → события",
          kind: "document",
          isActive: true,
          priority: 50,
          config: docCfg,
        }),
        createCalendarRule({
          name: "Карантин (лоты) → события",
          kind: "quarantine",
          isActive: true,
          priority: 60,
          config: qCfg,
        }),
        createCalendarRule({
          name: "Сроки (expiry) → предупреждения",
          kind: "expiry",
          isActive: true,
          priority: 70,
          config: eCfg,
        }),
      ])
      setRules((prev) => [...created.map((x) => x.rule), ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось создать базовые правила")
      await load()
    } finally {
      setBootstrapping(false)
    }
  }

  async function toggle(rule: WmsCalendarRule) {
    const next = !rule.isActive
    setRules((prev) => prev.map((r) => (r.ruleId === rule.ruleId ? { ...r, isActive: next } : r)))
    try {
      const res = await updateCalendarRule({ ruleId: rule.ruleId, patch: { isActive: next } })
      setRules((prev) => prev.map((r) => (r.ruleId === rule.ruleId ? res.rule : r)))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить правило")
      await load()
    }
  }

  async function remove(rule: WmsCalendarRule) {
    setRules((prev) => prev.filter((r) => r.ruleId !== rule.ruleId))
    try {
      await deleteCalendarRule(rule.ruleId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить правило")
      await load()
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Правила календаря</h1>
        <p className="text-sm text-muted-foreground">
          Управление derived-событиями (документы, карантин, партии/лоты). Активных правил: {activeCount}
        </p>
      </div>

      {error && <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>}

      <div className="rounded-2xl bg-card p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <CalendarCog className="h-5 w-5" />
            Rules
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => void createDefaults()}
              disabled={loading || bootstrapping || hasAnyRules}
              title={hasAnyRules ? "Базовые правила уже есть" : "Создать 3 базовых правила (Документы + Карантин + Сроки)"}
            >
              <Layers className="mr-2 h-4 w-4" />
              Базовые правила
            </Button>
            <select
              className="h-9 rounded-xl border border-input bg-background px-3 text-sm"
              value={kind}
              onChange={(e) => {
                const k = e.target.value as "document" | "quarantine" | "expiry" | "custom"
                setKind(k)
                setConfigText(template(k).configText)
              }}
            >
              <option value="document">document</option>
              <option value="quarantine">quarantine</option>
              <option value="expiry">expiry</option>
              <option value="custom">custom</option>
            </select>
            <Button className="rounded-xl" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить правило
            </Button>
            <Button variant="outline" className="rounded-xl" onClick={() => void load()} disabled={loading}>
              Обновить
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка...</div>
        ) : rules.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            Правил пока нет. Создайте правило для документов или карантина — и календарь начнёт строить derived-события по ним.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <div key={rule.ruleId} className="flex items-start justify-between gap-4 rounded-2xl border bg-background p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium text-foreground">{rule.name}</div>
                    <Badge variant="secondary" className="rounded-lg">{rule.kind}</Badge>
                    <Badge variant="secondary" className="rounded-lg">prio {rule.priority}</Badge>
                    {rule.deletedAt && <Badge className="rounded-lg">deleted</Badge>}
                  </div>
                  <div className="mt-2 rounded-xl bg-secondary/30 p-3 text-xs text-muted-foreground">
                    <pre className="whitespace-pre-wrap break-words">{JSON.stringify(rule.config || {}, null, 2)}</pre>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">active</span>
                    <Switch checked={rule.isActive} onCheckedChange={() => void toggle(rule)} disabled={Boolean(rule.deletedAt)} />
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    className="rounded-xl text-destructive border-destructive/30 hover:bg-destructive/10"
                    onClick={() => void remove(rule)}
                    disabled={Boolean(rule.deletedAt)}
                    aria-label="Удалить правило"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новое правило</DialogTitle>
            <DialogDescription>Шаблон можно править как JSON. Это максимально гибкий формат.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            <label className="text-sm font-medium text-foreground">
              Name
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например: Документы приёмки → Поставка" />
            </label>
            <label className="text-sm font-medium text-foreground">
              Priority
              <Input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="100" />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="text-sm font-medium text-foreground">Active</span>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </label>
            <label className="text-sm font-medium text-foreground">
              Config (JSON)
              <Textarea value={configText} onChange={(e) => setConfigText(e.target.value)} className="min-h-56 rounded-xl font-mono text-xs" />
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => void create()} disabled={!configText.trim()}>
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

