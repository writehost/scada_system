"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { importWmsItemUoms, importWmsItems } from "@/lib/wms-api"
import {
  buildImportItemRow,
  buildImportUomRows,
  emptyNomenclatureForm,
  type NomenclatureFormState,
} from "@/lib/nomenclature-model"
import { NomenclatureFormTabs } from "@/components/wms/nomenclature-form-tabs"

export function CreateNomenclatureDialog({
  open,
  onOpenChange,
  onCreated,
  initialCode,
  initialName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: (itemCode: string, message: string) => void
  initialCode?: string
  initialName?: string
}) {
  const [form, setForm] = useState<NomenclatureFormState>(() => emptyNomenclatureForm())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const base = emptyNomenclatureForm()
    if (initialCode?.trim()) base.code = initialCode.trim()
    if (initialName?.trim()) base.name = initialName.trim()
    setForm(base)
    setError(null)
  }, [open, initialCode, initialName])

  async function submit() {
    const code = form.code.trim()
    const name = form.name.trim()
    if (!code || !name) {
      setError("Укажите код товара (itemCode) и полное наименование")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const row = buildImportItemRow(form)
      const result = await importWmsItems([row])
      const uoms = buildImportUomRows(form)
      if (uoms.length > 0) {
        await importWmsItemUoms(uoms)
      }
      const msg =
        result.inserted > 0
          ? "Позиция создана"
          : result.updated > 0
            ? "Такой код уже был — запись обновлена"
            : "Готово"
      onCreated(code, msg)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && onOpenChange(v)}>
      <DialogContent className="flex h-[95vh] max-h-[95vh] w-[calc(100vw-16px)] max-w-[min(1400px,calc(100vw-24px))] flex-col gap-0 overflow-hidden rounded-xl border-0 p-0 shadow-2xl sm:max-w-[min(1400px,calc(100vw-24px))]">
        <DialogHeader className="shrink-0 border-b border-border px-8 py-5">
          <DialogTitle>Новая позиция номенклатуры</DialogTitle>
          <DialogDescription>
            Все поля ниже необязательны, кроме кода и наименования. Полный набор реквизитов сохраняется в{" "}
            <span className="font-mono text-xs">item_attrs_json</span> и при необходимости дублируется в колонках WMS.
            Единицы хранения с коэффициентом (например бухта = 22 000 шт) добавляются в справочник единиц после создания
            позиции.
          </DialogDescription>
        </DialogHeader>

        <NomenclatureFormTabs form={form} setForm={setForm} loading={loading} />

        {error ? (
          <div className="shrink-0 border-t border-border bg-destructive/5 px-8 py-3 text-sm text-destructive">{error}</div>
        ) : null}

        <DialogFooter className="shrink-0 border-t border-border px-8 py-5">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={loading}>
            {loading ? "Сохранение…" : "Создать и открыть"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
