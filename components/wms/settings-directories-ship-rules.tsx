"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { getSiteCode } from "@/lib/wms-api"

type ShipRule = {
  code: string
  name: string
  groupCode: string | null
  requiredLayers: number | null
  minRemainingDays: number | null
  note: string | null
  isActive: boolean
}

export function SettingsDirectoriesShipRules() {
  const [rows, setRows] = useState<ShipRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<ShipRule | null>(null)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [groupCode, setGroupCode] = useState("water")
  const [layers, setLayers] = useState("4")
  const [days, setDays] = useState("20")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const qp = new URLSearchParams({ siteCode: getSiteCode() })
      const r = await fetch(`/api/wms/directories/ship-rules?${qp}`, { cache: "no-store" })
      const data = (await r.json()) as { rules?: ShipRule[]; error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setRows(data.rules || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить правила")
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openCreate() {
    setEditing(null)
    setCode("")
    setName("")
    setGroupCode("water")
    setLayers("4")
    setDays("20")
    setNote("")
    setDialog(true)
  }

  function openEdit(row: ShipRule) {
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setGroupCode(row.groupCode || "")
    setLayers(row.requiredLayers != null ? String(row.requiredLayers) : "")
    setDays(row.minRemainingDays != null ? String(row.minRemainingDays) : "")
    setNote(row.note || "")
    setDialog(true)
  }

  async function save() {
    if (!code.trim() || !name.trim()) {
      setError("Код и название обязательны")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const r = await fetch("/api/wms/directories/ship-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteCode: getSiteCode(),
          code: code.trim(),
          name: name.trim(),
          groupCode: groupCode.trim() || null,
          requiredLayers: layers.trim() ? Number(layers) : null,
          minRemainingDays: days.trim() ? Number(days) : null,
          note: note.trim() || null,
        }),
      })
      const data = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setDialog(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: ShipRule) {
    if (!window.confirm(`Удалить правило «${row.name}»?`)) return
    const qp = new URLSearchParams({ siteCode: getSiteCode(), code: row.code })
    await fetch(`/api/wms/directories/ship-rules?${qp}`, { method: "DELETE" })
    await load()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Отгрузка контрагентам</h3>
          <p className="text-sm text-muted-foreground">
            Пятёрочка и похожие сети: сколько слоёв на палете и сколько дней срока должно остаться. Партию под
            контрагента помечают в карточке партии / на отгрузке ГП — тогда видно, что именно отгружать.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button type="button" size="sm" className="rounded-xl" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}
      <div className="divide-y rounded-xl border">
        {rows.map((row) => (
          <div key={row.code} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div>
              <div className="font-medium">{row.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                код {row.code}
                {row.groupCode ? ` · группа ${row.groupCode}` : ""}
                {row.requiredLayers != null ? ` · ${row.requiredLayers} слоя` : ""}
                {row.minRemainingDays != null ? ` · остаток срока ≥ ${row.minRemainingDays} дн.` : ""}
              </div>
              {row.note ? <p className="mt-1 text-xs text-muted-foreground">{row.note}</p> : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                <Pencil className="mr-1.5 h-4 w-4" />
                Изменить
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void remove(row)}>
                <Trash2 className="mr-1.5 h-4 w-4" />
                Удалить
              </Button>
            </div>
          </div>
        ))}
        {!loading && rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Правил нет.</p>
        ) : null}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Правило отгрузки" : "Новое правило"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="ship-rule-code">Код правила</Label>
              <Input
                id="ship-rule-code"
                className="mt-1 rounded-lg font-mono"
                placeholder="x5"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={!!editing}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Короткий идентификатор в системе. После создания не меняется.
              </p>
            </div>
            <div>
              <Label htmlFor="ship-rule-name">Контрагент</Label>
              <Input
                id="ship-rule-name"
                className="mt-1 rounded-lg"
                placeholder="Пятёрочка / X5"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Как сеть называется в интерфейсе склада ГП и в пометках партий.
              </p>
            </div>
            <div>
              <Label htmlFor="ship-rule-group">Группа номенклатуры</Label>
              <Input
                id="ship-rule-group"
                className="mt-1 rounded-lg font-mono"
                placeholder="water"
                value={groupCode}
                onChange={(e) => setGroupCode(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Фильтр на вкладке «Отгрузка» ГП: код группы 1С или productGroup (например water, softdrinks).
                Пусто — все группы.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ship-rule-layers">Слоёв на палете</Label>
                <Input
                  id="ship-rule-layers"
                  className="mt-1 rounded-lg"
                  placeholder="4"
                  value={layers}
                  onChange={(e) => setLayers(e.target.value)}
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Сколько слоёв требует сеть. Берётся из packing.layers в карточке номенклатуры.
                </p>
              </div>
              <div>
                <Label htmlFor="ship-rule-days">Мин. остаток срока, дней</Label>
                <Input
                  id="ship-rule-days"
                  className="mt-1 rounded-lg"
                  placeholder="20"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  inputMode="numeric"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Не отгружать, если до срока годности осталось меньше этого числа.
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="ship-rule-note">Заметка для кладовщика</Label>
              <Textarea
                id="ship-rule-note"
                className="mt-1 min-h-20 rounded-lg"
                placeholder="Например: партию помечаем под этого контрагента перед отгрузкой"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => void save()} disabled={saving}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
