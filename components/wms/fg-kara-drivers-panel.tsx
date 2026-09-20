"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2, Plus, Trash2, User } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createFgKaraDriver,
  deleteFgKaraDriver,
  updateFgKaraDriver,
  type FgKaraDriver,
  type FgKaraDriverScheduleSlot,
  type FgKaraFleetSnapshot,
  type FgKaraUnit,
} from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const WEEKDAYS = [
  { v: 1, label: "Пн" },
  { v: 2, label: "Вт" },
  { v: 3, label: "Ср" },
  { v: 4, label: "Чт" },
  { v: 5, label: "Пт" },
  { v: 6, label: "Сб" },
  { v: 0, label: "Вс" },
]

const SHIFTS = ["A", "B", "C", "D"]

const DRIVER_PERMS: Array<{ code: string; label: string }> = [
  { code: "main_line", label: "Основные задания линии" },
  { code: "interleave", label: "Попутные (interleave)" },
  { code: "urgent", label: "Срочные (конвейер / MES)" },
  { code: "any_line", label: "Любая линия" },
  { code: "refuse", label: "Может отказаться от задания" },
  { code: "manual_place", label: "Ручное размещение" },
]

type DetailTab = "details" | "roles" | "schedule" | "note"

function defaultSchedule(): FgKaraDriverScheduleSlot[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({ weekday, from: "08:00", to: "20:00" }))
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 180_000) {
      reject(new Error("фото больше 180 КБ — сожмите изображение"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("не удалось прочитать файл"))
    reader.readAsDataURL(file)
  })
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || "")
    .join("") || "?"
}

function fmtWhen(iso?: string) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return "—"
  }
}

type Props = {
  fleet: FgKaraFleetSnapshot | null
  lineOptions: Array<{ code: string; displayName: string }>
  onFleet: (next: FgKaraFleetSnapshot) => void
  onReload: () => Promise<void>
}

export function FgKaraDriversPanel({ fleet, lineOptions, onFleet, onReload }: Props) {
  const { toast } = useToast()
  const drivers = fleet?.drivers ?? []
  const karas = fleet?.karas ?? []

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>("details")
  const [busy, setBusy] = useState(false)

  // create strip
  const [creating, setCreating] = useState(false)
  const [fullName, setFullName] = useState("")
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  // draft of selected
  const selected = useMemo(
    () => drivers.find((d) => d.id === selectedId) || null,
    [drivers, selectedId]
  )
  const [draft, setDraft] = useState<FgKaraDriver | null>(null)

  useEffect(() => {
    if (!selectedId && drivers[0]) setSelectedId(drivers[0].id)
  }, [drivers, selectedId])

  useEffect(() => {
    setDraft(selected ? { ...selected, schedule: [...(selected.schedule || [])], permissions: [...(selected.permissions || [])] } : null)
    setDetailTab("details")
  }, [selected?.id])

  const karaLabel = useMemo(() => {
    const map = new Map<string, FgKaraUnit>()
    for (const k of karas) map.set(k.id, k)
    return map
  }, [karas])

  async function handleCreate() {
    const name = fullName.trim()
    if (!name) {
      toast({ title: "Укажите ФИО", variant: "destructive" })
      return
    }
    setBusy(true)
    try {
      const res = await createFgKaraDriver({
        fullName: name,
        photoUrl,
        schedule: defaultSchedule(),
        enabled: true,
        permissions: ["main_line", "interleave"],
      })
      onFleet({ ...res.fleet, tags: fleet?.tags || [], pathTags: fleet?.pathTags })
      setFullName("")
      setPhotoUrl(null)
      setCreating(false)
      setSelectedId(res.driver.id)
      toast({ title: "Карщик добавлен", description: name })
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "не удалось создать",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!draft) return
    setBusy(true)
    try {
      const res = await updateFgKaraDriver(draft.id, {
        fullName: draft.fullName,
        photoUrl: draft.photoUrl,
        karaId: draft.karaId,
        lineCode: draft.lineCode,
        shiftCode: draft.shiftCode,
        schedule: draft.schedule,
        enabled: draft.enabled,
        permissions: draft.permissions || [],
        note: draft.note || "",
      })
      onFleet({ ...res.fleet, tags: fleet?.tags || [], pathTags: fleet?.pathTags })
      toast({ title: "Сохранено", description: draft.fullName })
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "не удалось сохранить",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Удалить карщика «${name}»?`)) return
    setBusy(true)
    try {
      await deleteFgKaraDriver(id)
      await onReload()
      if (selectedId === id) setSelectedId(null)
      toast({ title: "Удалён", description: name })
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "не удалось удалить",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  function togglePerm(code: string) {
    if (!draft) return
    const set = new Set(draft.permissions || [])
    if (set.has(code)) set.delete(code)
    else set.add(code)
    setDraft({ ...draft, permissions: [...set] })
  }

  function toggleWeekday(weekday: number) {
    if (!draft) return
    const has = draft.schedule.some((s) => s.weekday === weekday)
    if (has) {
      setDraft({ ...draft, schedule: draft.schedule.filter((s) => s.weekday !== weekday) })
    } else {
      setDraft({
        ...draft,
        schedule: [...draft.schedule, { weekday, from: "08:00", to: "20:00" }].sort(
          (a, b) => a.weekday - b.weekday
        ),
      })
    }
  }

  function patchSlot(weekday: number, patch: Partial<FgKaraDriverScheduleSlot>) {
    if (!draft) return
    setDraft({
      ...draft,
      schedule: draft.schedule.map((s) => (s.weekday === weekday ? { ...s, ...patch } : s)),
    })
  }

  return (
    <div className="flex min-h-[70vh] flex-col gap-0 overflow-hidden rounded-xl border border-border bg-card lg:flex-row">
      {/* list */}
      <div className="flex w-full flex-col border-b border-border lg:w-56 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Карщики
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-[11px]"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
            Новый
          </Button>
        </div>
        {creating ? (
          <div className="space-y-2 border-b border-border p-3">
            <Input
              placeholder="ФИО"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="h-9 text-sm"
            />
            <Input
              type="file"
              accept="image/*"
              className="h-9 text-xs"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                void fileToDataUrl(file)
                  .then(setPhotoUrl)
                  .catch((err) =>
                    toast({
                      title: "Фото",
                      description: err instanceof Error ? err.message : "ошибка",
                      variant: "destructive",
                    })
                  )
              }}
            />
            <Button type="button" size="sm" disabled={busy} className="w-full" onClick={() => void handleCreate()}>
              {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Создать
            </Button>
          </div>
        ) : null}
        <div className="max-h-48 flex-1 overflow-y-auto lg:max-h-none">
          {drivers.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground">Пока нет карщиков</p>
          ) : (
            drivers.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setSelectedId(d.id)}
                className={cn(
                  "flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-sm hover:bg-muted/40",
                  selectedId === d.id && "bg-muted/60"
                )}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {d.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={d.photoUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    initials(d.fullName)
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{d.fullName}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {d.shiftCode ? `Смена ${d.shiftCode}` : "—"}
                    {d.lineCode ? ` · ${d.lineCode}` : ""}
                  </div>
                </div>
                {!d.enabled ? (
                  <Badge variant="outline" className="text-[9px]">
                    выкл
                  </Badge>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>

      {/* detail form */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!draft ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            Выберите карщика или создайте нового
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-base font-semibold tracking-tight">{draft.fullName}</h2>
                  <Badge
                    variant="outline"
                    className={
                      draft.enabled
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300"
                        : ""
                    }
                  >
                    {draft.enabled ? "Active" : "Off"}
                  </Badge>
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{draft.id}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void handleDelete(draft.id, draft.fullName)}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Удалить
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={() => void handleSave()}>
                  {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Save
                </Button>
              </div>
            </div>

            <div className="flex border-b border-border px-2">
              {(
                [
                  ["details", "Данные"],
                  ["roles", "Роли и права"],
                  ["schedule", "График"],
                  ["note", "Заметка"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDetailTab(id)}
                  className={cn(
                    "border-b-2 px-3 py-2.5 text-xs font-medium transition",
                    detailTab === id
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div className="min-w-0 flex-1 overflow-y-auto p-4">
                {detailTab === "details" ? (
                  <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
                    <label className="block space-y-1 text-xs text-muted-foreground sm:col-span-2">
                      ФИО *
                      <Input
                        value={draft.fullName}
                        onChange={(e) => setDraft({ ...draft, fullName: e.target.value })}
                        className="h-10 text-sm text-foreground"
                      />
                    </label>
                    <label className="block space-y-1 text-xs text-muted-foreground">
                      Кара
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        value={draft.karaId || ""}
                        onChange={(e) => setDraft({ ...draft, karaId: e.target.value || null })}
                      >
                        <option value="">не закреплена</option>
                        {karas.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.boardName || k.name}
                            {k.boardNumber ? ` · №${k.boardNumber}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1 text-xs text-muted-foreground">
                      Линия производства
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        value={draft.lineCode || ""}
                        onChange={(e) => setDraft({ ...draft, lineCode: e.target.value || null })}
                      >
                        <option value="">не закреплена</option>
                        {lineOptions.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.displayName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1 text-xs text-muted-foreground">
                      Смена
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                        value={draft.shiftCode || "A"}
                        onChange={(e) => setDraft({ ...draft, shiftCode: e.target.value || null })}
                      >
                        {SHIFTS.map((s) => (
                          <option key={s} value={s}>
                            Смена {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                      />
                      Активен (принимает задания)
                    </label>
                  </div>
                ) : null}

                {detailTab === "roles" ? (
                  <div className="max-w-3xl space-y-4">
                    <div className="text-sm font-medium">Роли и режимы</div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({ ...draft, permissions: DRIVER_PERMS.map((p) => p.code) })
                        }
                      >
                        Select All
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setDraft({ ...draft, permissions: [] })}
                      >
                        Unselect All
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {DRIVER_PERMS.map((p) => {
                        const on = (draft.permissions || []).includes(p.code)
                        return (
                          <label
                            key={p.code}
                            className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm hover:bg-muted/30"
                          >
                            <input type="checkbox" checked={on} onChange={() => togglePerm(p.code)} />
                            <span>{p.label}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                {detailTab === "schedule" ? (
                  <div className="max-w-3xl space-y-3">
                    <div className="text-sm font-medium">Рабочий график</div>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((d) => {
                        const on = draft.schedule.some((s) => s.weekday === d.v)
                        return (
                          <button
                            key={d.v}
                            type="button"
                            onClick={() => toggleWeekday(d.v)}
                            className={cn(
                              "rounded-lg border px-3 py-1.5 text-xs font-medium",
                              on
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border text-muted-foreground"
                            )}
                          >
                            {d.label}
                          </button>
                        )
                      })}
                    </div>
                    <div className="space-y-2">
                      {draft.schedule
                        .slice()
                        .sort((a, b) => a.weekday - b.weekday)
                        .map((s) => {
                          const label = WEEKDAYS.find((w) => w.v === s.weekday)?.label || String(s.weekday)
                          return (
                            <div key={s.weekday} className="grid grid-cols-[48px_1fr_1fr] items-center gap-2">
                              <div className="text-xs font-medium">{label}</div>
                              <Input
                                type="time"
                                value={s.from}
                                onChange={(e) => patchSlot(s.weekday, { from: e.target.value })}
                                className="h-9 text-sm"
                              />
                              <Input
                                type="time"
                                value={s.to}
                                onChange={(e) => patchSlot(s.weekday, { to: e.target.value })}
                                className="h-9 text-sm"
                              />
                            </div>
                          )
                        })}
                    </div>
                  </div>
                ) : null}

                {detailTab === "note" ? (
                  <div className="max-w-3xl space-y-2">
                    <div className="text-sm font-medium">Заметка</div>
                    <textarea
                      className="min-h-[140px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
                      value={draft.note || ""}
                      onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                      placeholder="Комментарий диспетчера…"
                    />
                  </div>
                ) : null}
              </div>

              {/* right rail — ERPNext style */}
              <aside className="hidden w-[220px] shrink-0 border-l border-border bg-muted/10 xl:block">
                <div className="sticky top-0 space-y-4 p-4">
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl bg-muted text-lg font-semibold text-muted-foreground">
                      {draft.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={draft.photoUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        initials(draft.fullName)
                      )}
                    </div>
                    <div className="text-sm font-medium leading-tight">{draft.fullName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {draft.shiftCode ? `Смена ${draft.shiftCode}` : "Без смены"}
                      {draft.lineCode ? ` · ${draft.lineCode}` : ""}
                    </div>
                    <label className="w-full">
                      <span className="sr-only">Фото</span>
                      <Input
                        type="file"
                        accept="image/*"
                        className="h-8 text-[10px]"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          void fileToDataUrl(file)
                            .then((url) => setDraft({ ...draft, photoUrl: url }))
                            .catch((err) =>
                              toast({
                                title: "Фото",
                                description: err instanceof Error ? err.message : "ошибка",
                                variant: "destructive",
                              })
                            )
                        }}
                      />
                    </label>
                  </div>

                  <div className="space-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
                    <div>
                      <div className="font-medium text-foreground/80">Last Edited</div>
                      <div>{fmtWhen(draft.updatedAt)}</div>
                    </div>
                    <div>
                      <div className="font-medium text-foreground/80">Created</div>
                      <div>{fmtWhen(draft.createdAt)}</div>
                    </div>
                    {draft.karaId ? (
                      <div>
                        <div className="font-medium text-foreground/80">Кара</div>
                        <div>
                          {karaLabel.get(draft.karaId)?.boardName ||
                            karaLabel.get(draft.karaId)?.name ||
                            draft.karaId}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
