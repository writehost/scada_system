"use client"

import { useEffect, useState } from "react"
import { Pencil, Plus, RefreshCw } from "lucide-react"
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
  createDirectoryNomenclatureType,
  createDirectoryPackagingProfile,
  listDirectoryNomenclatureTypes,
  listDirectoryPackagingProfiles,
  patchDirectoryNomenclatureType,
  patchDirectoryPackagingProfile,
  type NomenclatureTypeDirectoryRow,
  type PackagingProfileDirectoryRow,
} from "@/lib/wms-api"

export function SettingsDirectoriesPackagingNom() {
  const [profiles, setProfiles] = useState<PackagingProfileDirectoryRow[]>([])
  const [types, setTypes] = useState<NomenclatureTypeDirectoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [pkgDialog, setPkgDialog] = useState(false)
  const [pkgEditing, setPkgEditing] = useState<PackagingProfileDirectoryRow | null>(null)
  const [pkgCode, setPkgCode] = useState("")
  const [pkgName, setPkgName] = useState("")
  const [pkgDesc, setPkgDesc] = useState("")
  const [pkgSort, setPkgSort] = useState("100")
  const [pkgActive, setPkgActive] = useState(true)
  const [pkgSaving, setPkgSaving] = useState(false)

  const [typeDialog, setTypeDialog] = useState(false)
  const [typeEditing, setTypeEditing] = useState<NomenclatureTypeDirectoryRow | null>(null)
  const [typeCode, setTypeCode] = useState("")
  const [typeName, setTypeName] = useState("")
  const [typeDesc, setTypeDesc] = useState("")
  const [typeSort, setTypeSort] = useState("100")
  const [typeActive, setTypeActive] = useState(true)
  const [typeSaving, setTypeSaving] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [p, t] = await Promise.all([listDirectoryPackagingProfiles(), listDirectoryNomenclatureTypes()])
      setProfiles(p.profiles || [])
      setTypes(t.types || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить справочники")
      setProfiles([])
      setTypes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  function openPkgCreate() {
    setPkgEditing(null)
    setPkgCode("")
    setPkgName("")
    setPkgDesc("")
    setPkgSort("100")
    setPkgActive(true)
    setError(null)
    setPkgDialog(true)
  }

  function openPkgEdit(row: PackagingProfileDirectoryRow) {
    setPkgEditing(row)
    setPkgCode(row.code)
    setPkgName(row.name)
    setPkgDesc(row.description || "")
    setPkgSort(String(row.sortOrder))
    setPkgActive(row.isActive)
    setError(null)
    setPkgDialog(true)
  }

  async function submitPkg() {
    const code = pkgCode.trim().toLowerCase()
    const name = pkgName.trim()
    if (!code || !name) {
      setError("Код и название профиля обязательны")
      return
    }
    setPkgSaving(true)
    setError(null)
    try {
      const sortOrder = Number(pkgSort)
      if (pkgEditing) {
        await patchDirectoryPackagingProfile(pkgEditing.code, {
          name,
          description: pkgDesc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : pkgEditing.sortOrder,
          isActive: pkgActive,
        })
      } else {
        await createDirectoryPackagingProfile({
          code,
          name,
          description: pkgDesc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        })
      }
      setPkgDialog(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setPkgSaving(false)
    }
  }

  function openTypeCreate() {
    setTypeEditing(null)
    setTypeCode("")
    setTypeName("")
    setTypeDesc("")
    setTypeSort("100")
    setTypeActive(true)
    setError(null)
    setTypeDialog(true)
  }

  function openTypeEdit(row: NomenclatureTypeDirectoryRow) {
    setTypeEditing(row)
    setTypeCode(row.code)
    setTypeName(row.name)
    setTypeDesc(row.description || "")
    setTypeSort(String(row.sortOrder))
    setTypeActive(row.isActive)
    setError(null)
    setTypeDialog(true)
  }

  async function submitType() {
    const code = typeCode.trim().toUpperCase()
    const name = typeName.trim()
    if (!code || !name) {
      setError("Код и название типа обязательны")
      return
    }
    setTypeSaving(true)
    setError(null)
    try {
      const sortOrder = Number(typeSort)
      if (typeEditing) {
        await patchDirectoryNomenclatureType(typeEditing.code, {
          name,
          description: typeDesc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : typeEditing.sortOrder,
          isActive: typeActive,
        })
      } else {
        await createDirectoryNomenclatureType({
          code,
          name,
          description: typeDesc.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 100,
        })
      }
      setTypeDialog(false)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setTypeSaving(false)
    }
  }

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Профили упаковки</h3>
            <p className="text-sm text-muted-foreground">
              Код сохраняется в колонке <span className="font-mono text-xs">wms_items.packaging_profile</span>. Русские
              названия и описания — только для интерфейса и документов.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            <Button type="button" size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={openPkgCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить профиль
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : profiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Справочник пуст или таблица ещё не создана в БД. Примените патч{" "}
            <span className="font-mono text-xs">db/patches/2026-05-09_packaging_nom_type_defs.sql</span>, затем обновите
            страницу.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {profiles.map((row) => (
              <div key={row.code} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-secondary/40">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-foreground">{row.code}</div>
                  <div className="text-sm text-foreground">{row.name}</div>
                  {row.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground">
                    порядок {row.sortOrder} · {row.isActive ? "активен" : "выкл."}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => openPkgEdit(row)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Изменить
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Типы номенклатуры</h3>
            <p className="text-sm text-muted-foreground">
              Подписи к полю <span className="font-mono text-xs">type</span> внутри{" "}
              <span className="font-mono text-xs">item_attrs_json.nomenclature</span>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Обновить
            </Button>
            <Button type="button" size="sm" className="rounded-xl bg-primary text-primary-foreground" onClick={openTypeCreate}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить тип
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Загрузка…</div>
        ) : types.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
            Справочник пуст или таблица ещё не создана в БД (см. патч выше).
          </div>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            {types.map((row) => (
              <div key={row.code} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 hover:bg-secondary/40">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-semibold text-foreground">{row.code}</div>
                  <div className="text-sm text-foreground">{row.name}</div>
                  {row.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                  ) : null}
                  <div className="mt-1 text-xs text-muted-foreground">
                    порядок {row.sortOrder} · {row.isActive ? "активен" : "выкл."}
                  </div>
                </div>
                <Button type="button" variant="outline" size="sm" className="shrink-0 rounded-xl" onClick={() => openTypeEdit(row)}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Изменить
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && !pkgDialog && !typeDialog && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      <Dialog open={pkgDialog} onOpenChange={(o) => !pkgSaving && setPkgDialog(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{pkgEditing ? "Профиль упаковки" : "Новый профиль упаковки"}</DialogTitle>
            <DialogDescription>
              Код латиницей (например <span className="font-mono">stickers</span>). После использования в позициях код лучше не
              переименовывать — меняйте только название и описание.
            </DialogDescription>
          </DialogHeader>
          {error && pkgDialog ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          ) : null}
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Код</label>
              <Input
                value={pkgCode}
                onChange={(e) => setPkgCode(e.target.value)}
                disabled={!!pkgEditing || pkgSaving}
                className="rounded-xl font-mono"
                placeholder="my_profile"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Название</label>
              <Input value={pkgName} onChange={(e) => setPkgName(e.target.value)} disabled={pkgSaving} className="rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Textarea value={pkgDesc} onChange={(e) => setPkgDesc(e.target.value)} disabled={pkgSaving} className="rounded-xl text-sm" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Порядок сортировки</label>
                <Input value={pkgSort} onChange={(e) => setPkgSort(e.target.value)} disabled={pkgSaving} className="rounded-xl" />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={pkgActive} onCheckedChange={setPkgActive} disabled={pkgSaving || !pkgEditing} />
                <span className="text-sm text-muted-foreground">{pkgEditing ? "Активен" : "Новые записи активны"}</span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setPkgDialog(false)} disabled={pkgSaving}>
              Отмена
            </Button>
            <Button type="button" className="rounded-xl" onClick={() => void submitPkg()} disabled={pkgSaving}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={typeDialog} onOpenChange={(o) => !typeSaving && setTypeDialog(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{typeEditing ? "Тип номенклатуры" : "Новый тип номенклатуры"}</DialogTitle>
            <DialogDescription>
              Код в верхнем регистре (например <span className="font-mono">PRODUCT</span>). Должен совпадать с полем{" "}
              <span className="font-mono">type</span> в JSON номенклатуры.
            </DialogDescription>
          </DialogHeader>
          {error && typeDialog ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
          ) : null}
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Код</label>
              <Input
                value={typeCode}
                onChange={(e) => setTypeCode(e.target.value)}
                disabled={!!typeEditing || typeSaving}
                className="rounded-xl font-mono"
                placeholder="MY_TYPE"
              />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Название</label>
              <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} disabled={typeSaving} className="rounded-xl" />
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm font-medium">Описание</label>
              <Textarea value={typeDesc} onChange={(e) => setTypeDesc(e.target.value)} disabled={typeSaving} className="rounded-xl text-sm" rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <label className="text-sm font-medium">Порядок сортировки</label>
                <Input value={typeSort} onChange={(e) => setTypeSort(e.target.value)} disabled={typeSaving} className="rounded-xl" />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={typeActive} onCheckedChange={setTypeActive} disabled={typeSaving || !typeEditing} />
                <span className="text-sm text-muted-foreground">{typeEditing ? "Активен" : "Новые записи активны"}</span>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => setTypeDialog(false)} disabled={typeSaving}>
              Отмена
            </Button>
            <Button type="button" className="rounded-xl" onClick={() => void submitType()} disabled={typeSaving}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
