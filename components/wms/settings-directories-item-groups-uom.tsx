"use client"

import { useEffect, useState } from "react"
import { Download, ExternalLink, ImageIcon, Pencil, Plus, Power, RefreshCw, Trash2, Upload, Wrench } from "lucide-react"
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
  applyDirectoryItemGroupShelfLife,
  createDirectoryItemGroup,
  createDirectoryUom,
  deleteDirectoryItemGroup,
  listDirectoryItemGroups,
  listDirectoryUoms,
  patchDirectoryItemGroup,
  patchDirectoryUom,
  syncDirectoryItemGroupsFromItems,
  deduplicateDirectoryItemGroups,
  uploadDirectoryItemGroupImage,
  type ItemGroupDirectoryRow,
  type UomDirectoryRow,
} from "@/lib/wms-api"

export function SettingsDirectoriesItemGroupsUom() {
  const [groups, setGroups] = useState<ItemGroupDirectoryRow[]>([])
  const [uoms, setUoms] = useState<UomDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [deduping, setDeduping] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const [grpDialog, setGrpDialog] = useState(false)
  const [grpEditing, setGrpEditing] = useState<ItemGroupDirectoryRow | null>(null)
  const [grpCode, setGrpCode] = useState("")
  const [grpName, setGrpName] = useState("")
  const [grpDesc, setGrpDesc] = useState("")
  const [grpImageUrl, setGrpImageUrl] = useState("")
  const [grpSort, setGrpSort] = useState("100")
  const [grpDefaultShelfLife, setGrpDefaultShelfLife] = useState("")
  const [grpApplyShelfLife, setGrpApplyShelfLife] = useState(false)
  const [grpActive, setGrpActive] = useState(true)
  const [grpSaving, setGrpSaving] = useState(false)
  const [grpUploading, setGrpUploading] = useState(false)
  const [grpActionCode, setGrpActionCode] = useState<string | null>(null)
  const [showInactiveGroups, setShowInactiveGroups] = useState(false)

  const [uomDialog, setUomDialog] = useState(false)
  const [uomEditing, setUomEditing] = useState<UomDirectoryRow | null>(null)
  const [uomCode, setUomCode] = useState("")
  const [uomName, setUomName] = useState("")
  const [uomDesc, setUomDesc] = useState("")
  const [uomSort, setUomSort] = useState("100")
  const [uomActive, setUomActive] = useState(true)
  const [uomSaving, setUomSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [gRes, uRes] = await Promise.allSettled([
        listDirectoryItemGroups({ withCounts: true }),
        listDirectoryUoms(),
      ])
      const g = gRes.status === "fulfilled" ? gRes.value : { groups: [] as ItemGroupDirectoryRow[] }
      const u = uRes.status === "fulfilled" ? uRes.value : { uoms: [] as UomDirectoryRow[] }
      setGroups(g.groups || [])
      setUoms(u.uoms || [])
      const errors: string[] = []
      if (gRes.status === "rejected") {
        errors.push(
          gRes.reason instanceof Error ? `Группы: ${gRes.reason.message}` : "Группы: ошибка загрузки"
        )
      }
      if (uRes.status === "rejected") {
        errors.push(
          uRes.reason instanceof Error ? `ЕИ: ${uRes.reason.message}` : "ЕИ: ошибка загрузки"
        )
      }
      if (g.tableMissing || u.tableMissing) {
        errors.push(
          "Таблицы справочников ещё не созданы в БД. Установите последнее обновление WMS (патчи БД применятся автоматически) или выполните SQL-патчи вручную."
        )
      }
      if (errors.length > 0) setError(errors.join(" "))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить справочники")
      setGroups([])
      setUoms([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function prepareGroupImageUpload(file: File): Promise<File> {
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

  async function syncFromItems() {
    setSyncing(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const r = await syncDirectoryItemGroupsFromItems()
      await load()
      setSuccessMsg(
        `Подтянуто из номенклатуры: ${r.insertedFromItemGroupCode + r.insertedFromProductGroup} групп. ${r.note ?? ""}`.trim()
      )
      window.setTimeout(() => setSuccessMsg(null), 6000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Синхронизация не удалась")
    } finally {
      setSyncing(false)
    }
  }

  async function dedupeGroups() {
    const ok = window.confirm(
      "Объединить дубли и исправить перепутанные код/название?\n\n" +
        "• «Крышки для бутыли» + Probs → код probs, название «Крышки для бутыли»\n" +
        "• Два «Автомобильные жидкости» → один autofluids\n" +
        "• Номенклатура будет перепривязана к правильным кодам."
    )
    if (!ok) return
    setDeduping(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const r = await deduplicateDirectoryItemGroups()
      await load()
      setSuccessMsg(
        `Готово: исправлено ${r.fixedSwapped}, объединено ${r.mergedGroups}, удалено дублей ${r.removedGroups}, перепривязано позиций ${r.reassignedItems}.`
      )
      window.setTimeout(() => setSuccessMsg(null), 8000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось объединить дубли")
    } finally {
      setDeduping(false)
    }
  }

  function openGrpCreate() {
    setGrpEditing(null)
    setGrpCode("")
    setGrpName("")
    setGrpDesc("")
    setGrpImageUrl("")
    setGrpSort("100")
    setGrpDefaultShelfLife("")
    setGrpApplyShelfLife(false)
    setGrpActive(true)
    setError(null)
    setGrpDialog(true)
  }

  function openGrpEdit(row: ItemGroupDirectoryRow) {
    setGrpEditing(row)
    setGrpCode(row.code)
    setGrpName(row.name)
    setGrpDesc(row.description || "")
    setGrpImageUrl(row.imageUrl || "")
    setGrpSort(String(row.sortOrder))
    setGrpDefaultShelfLife(
      row.defaultShelfLifeDays != null && row.defaultShelfLifeDays > 0
        ? String(row.defaultShelfLifeDays)
        : ""
    )
    setGrpApplyShelfLife(false)
    setGrpActive(row.isActive)
    setError(null)
    setGrpDialog(true)
  }

  async function submitGrp() {
    const code = grpCode.trim().toLowerCase()
    const name = grpName.trim()
    if (!code || !name) {
      setError("Системный код и наименование обязательны")
      return
    }
    if (!grpEditing && /[а-яё]/i.test(code)) {
      setError("Новый системный код — латиница (water, stickers). Русское название — в поле «Наименование». Уже заведённые группы из 1С можно оставить как есть.")
      return
    }
    setGrpSaving(true)
    setError(null)
    try {
      const sortOrder = Number(grpSort)
      const defaultShelfLifeDays = grpDefaultShelfLife.trim()
        ? Math.max(1, Math.trunc(Number(grpDefaultShelfLife)))
        : null
      if (grpEditing) {
        await patchDirectoryItemGroup(grpEditing.code, {
          name,
          description: grpDesc.trim() || null,
          imageUrl: grpImageUrl.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : grpEditing.sortOrder,
          isActive: grpActive,
          defaultShelfLifeDays,
          applyShelfLifeToItems: grpApplyShelfLife && defaultShelfLifeDays != null,
        })
      } else {
        await createDirectoryItemGroup({
          code,
          name,
          description: grpDesc.trim() || null,
          imageUrl: grpImageUrl.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
          defaultShelfLifeDays,
          applyShelfLifeToItems: grpApplyShelfLife && defaultShelfLifeDays != null,
        })
      }
      setGrpDialog(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения группы")
    } finally {
      setGrpSaving(false)
    }
  }

  async function uploadGrpImage(file: File | null) {
    const code = grpCode.trim()
    if (!file) return
    if (!code) {
      setError("Сначала укажите код группы")
      return
    }
    setGrpUploading(true)
    setError(null)
    try {
      const prepared = await prepareGroupImageUpload(file)
      const res = await uploadDirectoryItemGroupImage({ groupCode: code, file: prepared })
      setGrpImageUrl(res.imageUrl)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить картинку")
    } finally {
      setGrpUploading(false)
    }
  }

  async function toggleGrpActive(row: ItemGroupDirectoryRow) {
    setGrpActionCode(row.code)
    setError(null)
    try {
      await patchDirectoryItemGroup(row.code, { isActive: !row.isActive })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить активность группы")
    } finally {
      setGrpActionCode(null)
    }
  }

  async function deleteGrp(row: ItemGroupDirectoryRow) {
    const ok = window.confirm(
      `Удалить группу "${row.name}" (${row.code})?\n\nЕсли группа уже используется в номенклатуре, она будет безопасно отключена.`
    )
    if (!ok) return
    setGrpActionCode(row.code)
    setError(null)
    try {
      const res = await deleteDirectoryItemGroup(row.code)
      await load()
      setSuccessMsg(res.mode === "deleted" ? "Группа удалена." : `Группа используется в ${res.usedCount} позициях и поэтому отключена.`)
      window.setTimeout(() => setSuccessMsg(null), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить группу")
    } finally {
      setGrpActionCode(null)
    }
  }

  function openUomCreate() {
    setUomEditing(null)
    setUomCode("")
    setUomName("")
    setUomDesc("")
    setUomSort("100")
    setUomActive(true)
    setError(null)
    setUomDialog(true)
  }

  function openUomEdit(row: UomDirectoryRow) {
    setUomEditing(row)
    setUomCode(row.code)
    setUomName(row.name)
    setUomDesc(row.description || "")
    setUomSort(String(row.sortOrder))
    setUomActive(row.isActive)
    setError(null)
    setUomDialog(true)
  }

  async function submitUom() {
    const code = uomCode.trim().toLowerCase()
    const name = uomName.trim()
    if (!code || !name) {
      setError("Код и название единицы обязательны")
      return
    }
    setUomSaving(true)
    setError(null)
    try {
      const sortOrder = Number(uomSort)
      if (uomEditing) {
        await patchDirectoryUom(uomEditing.code, {
          name,
          description: uomDesc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : uomEditing.sortOrder,
          isActive: uomActive,
        })
      } else {
        await createDirectoryUom({
          code,
          name,
          description: uomDesc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        })
      }
      setUomDialog(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения единицы")
    } finally {
      setUomSaving(false)
    }
  }

  return (
    <div className="space-y-10">
      <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm text-foreground space-y-2">
        <p>
          <strong className="font-semibold">Группа товара и класс хранения — разные вещи.</strong>{" "}
          Группа («Вода», «Стикеры Скит») приходит из 1С. Класс S1–S5 считается сам.
        </p>
        <p className="text-muted-foreground">
          Стикер с названием напитка («Стикер Шмаковка») — это невыпущенная этикетка, группа стикеров.
          Бутылка «Шмаковка №1» — готовая продукция: считаем бутылки, на которых стикер уже наклеен, а не сами стикеры.
        </p>
      </div>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Группы товаров</h3>
            <p className="text-sm text-muted-foreground">
              Поле «группа» в карточке номенклатуры. Отключённые и пустые из 1С по умолчанию скрыты.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={deduping || syncing}
              onClick={() => void dedupeGroups()}
            >
              <Wrench className="mr-2 h-4 w-4" />
              {deduping ? "Объединение…" : "Объединить дубли"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              disabled={syncing || deduping}
              onClick={() => void syncFromItems()}
            >
              <Download className="mr-2 h-4 w-4" />
              {syncing ? "Синхронизация…" : "Из номенклатуры"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl"
              onClick={() => setShowInactiveGroups((v) => !v)}
            >
              {showInactiveGroups ? "Скрыть отключённые" : "Показать отключённые"}
            </Button>
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-xl bg-primary text-primary-foreground"
              onClick={openGrpCreate}
            >
              <Plus className="mr-2 h-4 w-4" />
              Добавить группу
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : groups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Справочник пуст. Нажмите «Из номенклатуры» или «Добавить группу», либо дождитесь обновления WMS с патчем
            БД.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border max-h-[420px] overflow-y-auto">
            {groups
              .filter((row) => {
                if (!row.name?.trim() && !row.code?.trim()) return false
                if (showInactiveGroups) return true
                return row.isActive && (row.itemCount ?? 0) > 0
              })
              .map((row) => (
              <div
                key={row.code}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-secondary/40"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-xl border border-border bg-muted object-cover"
                    />
                  ) : (
                    <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{row.name || row.code}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                      Системный код: {row.code}
                    </div>
                  {row.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                  ) : null}
                    <div className="mt-1 text-xs text-muted-foreground">
                      {typeof row.itemCount === "number" ? `${row.itemCount} поз. в номенклатуре · ` : ""}
                      {row.defaultShelfLifeDays ? `срок ${row.defaultShelfLifeDays} дн. · ` : ""}
                      порядок {row.sortOrder} · {row.isActive ? "активна" : "выкл."}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    asChild
                  >
                    <a href={`/nomenclature?group=${encodeURIComponent(row.code)}`}>
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Номенклатура в группе
                    </a>
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    disabled={grpActionCode === row.code}
                    onClick={() => void toggleGrpActive(row)}
                  >
                    <Power className="mr-2 h-4 w-4" />
                    {row.isActive ? "Отключить" : "Включить"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl text-destructive hover:text-destructive"
                    disabled={grpActionCode === row.code}
                    onClick={() => void deleteGrp(row)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Удалить
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => openGrpEdit(row)}
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Изменить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Единицы измерения</h3>
            <p className="text-sm text-muted-foreground">
              Подписи к коду <span className="font-mono text-xs">uom_code</span> (pcs, bottle, block…). Код в карточке
              товара — латиницей.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            <Button
              type="button"
              size="sm"
              className="rounded-xl bg-primary text-primary-foreground"
              onClick={openUomCreate}
            >
              <Plus className="mr-2 h-4 w-4" />
              Добавить единицу
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : uoms.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Справочник пуст — примените обновление с патчем{" "}
            <span className="font-mono text-xs">2026-05-29_wms_uom_defs.sql</span>.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {uoms.map((row) => (
              <div
                key={row.code}
                className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-secondary/40"
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-foreground">{row.code}</div>
                  <div className="text-sm text-foreground">{row.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    порядок {row.sortOrder} · {row.isActive ? "активна" : "выкл."}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 rounded-xl"
                  onClick={() => openUomEdit(row)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Изменить
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {(successMsg || (error && !grpDialog && !uomDialog)) && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            successMsg
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {successMsg || error}
        </div>
      )}

      <Dialog open={grpDialog} onOpenChange={(o) => !grpSaving && setGrpDialog(o)}>
        <DialogContent className="max-h-[92dvh] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{grpEditing ? "Группа товаров" : "Новая группа товаров"}</DialogTitle>
            <DialogDescription>
              <strong>Системный код</strong> — латиница для БД и ТСД (<span className="font-mono">probs</span>,{" "}
              <span className="font-mono">autofluids</span>). <strong>Наименование</strong> — как видит оператор
              («Крышки для бутыли»). После использования в номенклатуре код лучше не менять.
            </DialogDescription>
          </DialogHeader>
          {error && grpDialog ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="grid max-h-[calc(92dvh-180px)] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Системный код</label>
              <Input
                value={grpCode}
                onChange={(e) => setGrpCode(e.target.value)}
                disabled={!!grpEditing || grpSaving}
                className="rounded-xl font-mono"
                placeholder="probs"
              />
              <p className="text-xs text-muted-foreground">Латиница, без пробелов. Не русское название.</p>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Наименование</label>
              <Input
                value={grpName}
                onChange={(e) => setGrpName(e.target.value)}
                disabled={grpSaving}
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Textarea
                value={grpDesc}
                onChange={(e) => setGrpDesc(e.target.value)}
                disabled={grpSaving}
                className="rounded-xl min-h-[72px]"
              />
            </div>
            <div className="grid gap-2 rounded-xl border border-border bg-secondary/30 p-3">
              <div className="flex items-start gap-3">
                {grpImageUrl.trim() ? (
                  <img
                    src={grpImageUrl.trim()}
                    alt=""
                    className="size-20 shrink-0 rounded-xl border border-border bg-muted object-cover"
                  />
                ) : (
                  <div className="flex size-20 shrink-0 items-center justify-center rounded-xl border border-dashed border-border bg-muted/40 text-muted-foreground">
                    <ImageIcon className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1 space-y-2">
                  <label className="text-sm font-medium">Картинка группы</label>
                  <Input
                    value={grpImageUrl}
                    onChange={(e) => setGrpImageUrl(e.target.value)}
                    disabled={grpSaving || grpUploading}
                    className="rounded-xl text-xs"
                    placeholder="/wms-item-images/group-water.png или https://..."
                  />
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium hover:bg-secondary">
                      <Upload className="mr-2 h-3.5 w-3.5" />
                      {grpUploading ? "Загрузка..." : "Загрузить файл"}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="hidden"
                        disabled={grpSaving || grpUploading}
                        onChange={(e) => void uploadGrpImage(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    {grpImageUrl.trim() ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs"
                        disabled={grpSaving || grpUploading}
                        onClick={() => setGrpImageUrl("")}
                      >
                        Убрать
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Файл до 8 МБ. Перед отправкой картинка ужимается, чтобы обновление прошло даже через nginx с лимитом 1 МБ.
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Срок годности по умолчанию, дней</label>
              <Input
                value={grpDefaultShelfLife}
                onChange={(e) => setGrpDefaultShelfLife(e.target.value)}
                disabled={grpSaving}
                className="rounded-xl"
                placeholder="365"
                inputMode="numeric"
              />
              <p className="text-xs text-muted-foreground">
                Для группы <span className="font-mono">stickers</span> — срок рулона стикеров при приёмке и на
                этикетке «Серия». Рекомендуется 365. Пусто — без значения в справочнике.
              </p>
              {grpEditing && grpDefaultShelfLife.trim() ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={grpApplyShelfLife}
                    onChange={(e) => setGrpApplyShelfLife(e.target.checked)}
                    disabled={grpSaving}
                  />
                  Обновить shelf_life_days у всей номенклатуры этой группы
                </label>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Порядок сортировки</label>
              <Input
                value={grpSort}
                onChange={(e) => setGrpSort(e.target.value)}
                disabled={grpSaving}
                className="rounded-xl"
              />
            </div>
            {grpEditing ? (
              <div className="flex items-center justify-between rounded-xl bg-secondary p-3">
                <span className="text-sm">Активна</span>
                <Switch checked={grpActive} onCheckedChange={setGrpActive} disabled={grpSaving} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrpDialog(false)} disabled={grpSaving}>
              Отмена
            </Button>
            <Button
              className="bg-primary text-primary-foreground"
              onClick={() => void submitGrp()}
              disabled={grpSaving}
            >
              {grpSaving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={uomDialog} onOpenChange={(o) => !uomSaving && setUomDialog(o)}>
        <DialogContent className="max-h-[92dvh] overflow-hidden sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{uomEditing ? "Единица измерения" : "Новая единица"}</DialogTitle>
            <DialogDescription>
              Код латиницей: <span className="font-mono">pcs</span>, <span className="font-mono">bottle</span>.
            </DialogDescription>
          </DialogHeader>
          {error && uomDialog ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          <div className="grid max-h-[calc(92dvh-180px)] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Код</label>
              <Input
                value={uomCode}
                onChange={(e) => setUomCode(e.target.value)}
                disabled={!!uomEditing || uomSaving}
                className="rounded-xl font-mono"
                placeholder="pcs"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Название</label>
              <Input
                value={uomName}
                onChange={(e) => setUomName(e.target.value)}
                disabled={uomSaving}
                className="rounded-xl"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Textarea
                value={uomDesc}
                onChange={(e) => setUomDesc(e.target.value)}
                disabled={uomSaving}
                className="rounded-xl min-h-[72px]"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Порядок</label>
              <Input value={uomSort} onChange={(e) => setUomSort(e.target.value)} disabled={uomSaving} className="rounded-xl" />
            </div>
            {uomEditing ? (
              <div className="flex items-center justify-between rounded-xl bg-secondary p-3">
                <span className="text-sm">Активна</span>
                <Switch checked={uomActive} onCheckedChange={setUomActive} disabled={uomSaving} />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUomDialog(false)} disabled={uomSaving}>
              Отмена
            </Button>
            <Button
              className="bg-primary text-primary-foreground"
              onClick={() => void submitUom()}
              disabled={uomSaving}
            >
              {uomSaving ? "Сохранение…" : "Сохранить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
