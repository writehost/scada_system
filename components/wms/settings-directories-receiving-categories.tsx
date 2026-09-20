"use client"

import { useEffect, useMemo, useState } from "react"
import { ImageIcon, Pencil, Plus, Power, RefreshCw, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  createDirectoryReceivingCategory,
  listDirectoryReceivingCategories,
  listOperatorNomenclatureGroups,
  patchDirectoryReceivingCategory,
  uploadDirectoryReceivingCategoryImage,
  type ReceivingCategoryDirectoryRow,
} from "@/lib/wms-api"
import type { OperatorNomenclatureGroup } from "@/lib/nomenclature-group-catalog"

function resolveImageSrc(url: string | null | undefined): string | null {
  const t = (url ?? "").trim()
  if (!t) return null
  if (t.startsWith("http://") || t.startsWith("https://") || t.startsWith("data:")) return t
  if (t.startsWith("/")) return t
  return `/wms-item-images/${t.replace(/^\/+/, "")}`
}

export function SettingsDirectoriesReceivingCategories() {
  const [categories, setCategories] = useState<ReceivingCategoryDirectoryRow[]>([])
  const [itemGroups, setItemGroups] = useState<OperatorNomenclatureGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [dialog, setDialog] = useState(false)
  const [editing, setEditing] = useState<ReceivingCategoryDirectoryRow | null>(null)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [sort, setSort] = useState("100")
  const [active, setActive] = useState(true)
  const [linkedCodes, setLinkedCodes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)

  const activeGroups = useMemo(
    () => [...itemGroups].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ru")),
    [itemGroups]
  )

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cats, groups] = await Promise.all([
        listDirectoryReceivingCategories(),
        listOperatorNomenclatureGroups(),
      ])
      setCategories(cats.categories || [])
      setItemGroups(groups.groups || [])
      if (cats.tableMissing) {
        setError(
          "Таблица подгрупп приёмки ещё не создана в БД. Установите обновление WMS или выполните SQL-патч 2026-06-11_receiving_categories.sql."
        )
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить подгруппы")
      setCategories([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function prepareImageUpload(file: File): Promise<File> {
    const maxInputSize = 8 * 1024 * 1024
    const targetSize = 700 * 1024
    if (file.size > maxInputSize) {
      throw new Error("Файл слишком большой. Загрузите картинку до 8 МБ.")
    }
    if (file.size <= targetSize) return file
    if (file.type === "image/gif") {
      throw new Error("GIF больше 700 КБ не поддерживается. Загрузите PNG/JPEG/WebP.")
    }
    const bitmap = await createImageBitmap(file)
    const maxSide = 900
    const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const ctx = canvas.getContext("2d")
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.82)
    })
    if (!blob) return file
    return new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" })
  }

  function openCreate() {
    setEditing(null)
    setCode("")
    setName("")
    setDesc("")
    setImageUrl("")
    setSort("100")
    setActive(true)
    setLinkedCodes([])
    setError(null)
    setDialog(true)
  }

  function openEdit(row: ReceivingCategoryDirectoryRow) {
    setEditing(row)
    setCode(row.code)
    setName(row.name)
    setDesc(row.description || "")
    setImageUrl(row.imageUrl || "")
    setSort(String(row.sortOrder))
    setActive(row.isActive)
    setLinkedCodes(row.linkedGroupCodes || [])
    setError(null)
    setDialog(true)
  }

  function groupCodes(g: OperatorNomenclatureGroup): string[] {
    return [...new Set([...(g.aliasCodes ?? []), g.code].filter(Boolean))]
  }

  function isGroupLinked(g: OperatorNomenclatureGroup): boolean {
    const codes = groupCodes(g)
    return codes.some((c) => linkedCodes.includes(c))
  }

  function toggleLinked(g: OperatorNomenclatureGroup) {
    const codes = groupCodes(g)
    setLinkedCodes((prev) => {
      const linked = codes.some((c) => prev.includes(c))
      if (linked) return prev.filter((c) => !codes.includes(c))
      return [...new Set([...prev, ...codes])]
    })
  }

  async function submit() {
    const trimmedCode = code.trim()
    const trimmedName = name.trim()
    if (!trimmedCode || !trimmedName) {
      setError("Код и название обязательны")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const sortOrder = Number(sort)
      const payload = {
        name: trimmedName,
        description: desc.trim() || null,
        imageUrl: imageUrl.trim() || null,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        linkedGroupCodes: linkedCodes,
      }
      if (editing) {
        await patchDirectoryReceivingCategory(editing.code, { ...payload, isActive: active })
      } else {
        await createDirectoryReceivingCategory({ code: trimmedCode, ...payload })
      }
      setDialog(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  async function uploadImage(file: File | null) {
    const trimmedCode = code.trim()
    if (!file) return
    if (!trimmedCode) {
      setError("Сначала укажите код подгруппы")
      return
    }
    setUploading(true)
    setError(null)
    try {
      const prepared = await prepareImageUpload(file)
      const r = await uploadDirectoryReceivingCategoryImage({
        categoryCode: trimmedCode,
        file: prepared,
      })
      const uploaded = r.imageUrl.trim()
      setImageUrl(uploaded)
      if (uploaded && trimmedCode) {
        try {
          await patchDirectoryReceivingCategory(trimmedCode, { imageUrl: uploaded })
          await load()
        } catch {
          /* category may not exist yet — user saves on submit */
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить картинку")
    } finally {
      setUploading(false)
    }
  }

  async function disableCategory(row: ReceivingCategoryDirectoryRow) {
    setError(null)
    try {
      await patchDirectoryReceivingCategory(row.code, { isActive: !row.isActive })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить статус")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Подгруппы приёмки</h3>
          <p className="text-sm text-muted-foreground">
            Что видит ТСД на приёмке. «Стикеры» — невыпущенные этикетки. «Вода и напитки» — бутылки, на которых стикер уже наклеен. Считаем бутылки, не стикеры.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Обновить
          </Button>
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить
          </Button>
        </div>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Загрузка…</p> : null}

      <div className="space-y-2">
        {categories.map((row) => (
          <div
            key={row.code}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
          >
            <div className="flex min-w-0 items-start gap-3">
              {resolveImageSrc(row.imageUrl) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolveImageSrc(row.imageUrl)!}
                  alt=""
                  className="h-14 w-14 rounded-lg object-cover bg-muted"
                  onError={(e) => {
                    e.currentTarget.style.display = "none"
                  }}
                />
              ) : (
                <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted">
                  <ImageIcon className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0">
                <div className="font-medium">
                  {row.name}{" "}
                  <span className="text-xs text-muted-foreground">({row.code})</span>
                  {!row.isActive ? (
                    <span className="ml-2 text-xs text-muted-foreground">выкл.</span>
                  ) : null}
                </div>
                {row.description ? (
                  <p className="text-sm text-muted-foreground">{row.description}</p>
                ) : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  Группы:{" "}
                  {row.linkedGroupCodes?.length
                    ? row.linkedGroupCodes.join(", ")
                    : "не заданы (на ТСД — прежняя логика по умолчанию)"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => openEdit(row)}>
                <Pencil className="mr-2 h-4 w-4" />
                Изменить
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void disableCategory(row)}>
                <Power className="mr-2 h-4 w-4" />
                {row.isActive ? "Отключить" : "Включить"}
              </Button>
            </div>
          </div>
        ))}
        {!loading && categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Подгруппы не настроены.</p>
        ) : null}
      </div>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Изменить подгруппу" : "Новая подгруппа"}</DialogTitle>
            <DialogDescription>
              Название и описание отображаются на ТСД. Отметьте товарные группы, которые входят в эту подгруппу.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Код (латиница, например stickers)"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={!!editing}
            />
            <Input placeholder="Название" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea
              placeholder="Краткое описание"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
            />
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  placeholder="/wms-item-images/receiving-cat-….webp"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  className="flex-1 font-mono text-xs"
                  title={imageUrl}
                />
                <label className="inline-flex shrink-0 cursor-pointer items-center">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void uploadImage(e.target.files?.[0] ?? null)}
                  />
                  <Button type="button" variant="outline" size="sm" asChild disabled={uploading}>
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      {uploading ? "…" : "Файл"}
                    </span>
                  </Button>
                </label>
              </div>
              {resolveImageSrc(imageUrl) ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={resolveImageSrc(imageUrl)!}
                    alt=""
                    className="h-16 w-16 rounded-lg object-cover"
                  />
                  <p className="min-w-0 break-all text-[11px] text-muted-foreground">{imageUrl}</p>
                </div>
              ) : imageUrl.trim() ? (
                <p className="text-xs text-amber-700">
                  Путь должен начинаться с /wms-item-images/ и иметь расширение .webp, .jpg или .png
                </p>
              ) : null}
            </div>
            <Input placeholder="Порядок сортировки" value={sort} onChange={(e) => setSort(e.target.value)} />
            {editing ? (
              <div className="flex items-center gap-2">
                <Switch checked={active} onCheckedChange={setActive} id="cat-active" />
                <label htmlFor="cat-active" className="text-sm">
                  Активна
                </label>
              </div>
            ) : null}
            <div>
              <p className="mb-2 text-sm font-medium">Товарные группы</p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border p-2">
                {activeGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Сначала создайте группы в «Группы и ЕИ».</p>
                ) : (
                  activeGroups.map((g) => (
                    <label key={g.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted/50">
                      <input
                        type="checkbox"
                        checked={isGroupLinked(g)}
                        onChange={() => toggleLinked(g)}
                      />
                      <span className="text-sm">
                        {g.name}
                        <span className="ml-1 text-muted-foreground">({g.code})</span>
                        {(g.aliasCodes?.length ?? 0) > 1 ? (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            +{g.aliasCodes!.length - 1} синон.
                          </span>
                        ) : null}
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(false)}>
              Отмена
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={saving}>
              {saving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
