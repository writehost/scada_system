"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  DEFAULT_LABEL_SUZ_SETTINGS,
  loadLabelSuzSettings,
  saveLabelSuzSettings,
  type LabelSuzSettings,
} from "@/lib/wms/label-suz-settings"
import {
  buildLabelOrderPlan,
  fmtInt,
  type LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      {children}
      {hint ? <span className="text-[11px] leading-snug text-muted-foreground">{hint}</span> : null}
    </label>
  )
}

/**
 * Одна шестерёнка на страницу: слева реквизиты СУЗ (браузер), справа плановая
 * погрешность печати (общая для склада — лежит в базе).
 */
export function LabelOrderSettingsDialog({
  open,
  onOpenChange,
  waste,
  onSave,
  defaultTab = "waste",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  waste: LabelOrderWasteSettings
  onSave: (next: LabelOrderWasteSettings, suz: LabelSuzSettings) => Promise<void>
  defaultTab?: "waste" | "suz"
}) {
  const [tab, setTab] = useState<string>(defaultTab)
  const [suz, setSuz] = useState<LabelSuzSettings>(DEFAULT_LABEL_SUZ_SETTINGS)
  const [draft, setDraft] = useState<LabelOrderWasteSettings>(waste)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTab(defaultTab)
    setSuz(loadLabelSuzSettings())
    setDraft(waste)
    // Снимок только при открытии: опрос очереди не должен стирать черновик.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot on open
  }, [open])

  const preview = buildLabelOrderPlan(1000, draft)

  const save = async () => {
    setSaving(true)
    try {
      saveLabelSuzSettings(suz)
      await onSave(draft, suz)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 overflow-hidden sm:max-w-xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Настройки заказов кодов</DialogTitle>
          <DialogDescription>
            Погрешность печати и реквизиты СУЗ общие для склада. Отпечаток сертификата
            остаётся в этом браузере.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 overflow-hidden">
          <TabsList className="w-full">
            <TabsTrigger value="waste" className="flex-1">
              Погрешность печати
            </TabsTrigger>
            <TabsTrigger value="suz" className="flex-1">
              СУЗ и подпись
            </TabsTrigger>
          </TabsList>

          <TabsContent value="waste" className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Плановый хвост, % от заказа"
                hint="Сколько этикеток уходит на прокрутку рулона."
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={String(draft.wastePercent)}
                  onChange={(e) =>
                    setDraft((s) => ({ ...s, wastePercent: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field
                label="Минимальный хвост, шт"
                hint="Короткий заказ всё равно требует прокрутки."
              >
                <Input
                  type="number"
                  min={0}
                  value={String(draft.minWasteQty)}
                  onChange={(e) =>
                    setDraft((s) => ({ ...s, minWasteQty: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
              <Field
                label="Кратность количества, шт"
                hint="0 — не округлять. Например 100 для рулона по 100 этикеток."
              >
                <Input
                  type="number"
                  min={0}
                  value={String(draft.roundTo)}
                  onChange={(e) => setDraft((s) => ({ ...s, roundTo: Number(e.target.value) || 0 }))}
                />
              </Field>
              <Field
                label="Порог расхождения, п.п."
                hint="Факт выше плана на столько — строка подсветится красным."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.5"
                  value={String(draft.alertPercent)}
                  onChange={(e) =>
                    setDraft((s) => ({ ...s, alertPercent: Number(e.target.value) || 0 }))
                  }
                />
              </Field>
            </div>

            <label className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-2.5">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">
                  Добавлять запас в количество заказа
                </span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  Нужно ровно N годных этикеток — заказываем N + хвост.
                </span>
              </span>
              <Switch
                checked={draft.addWasteToOrder}
                onCheckedChange={(v) => setDraft((s) => ({ ...s, addWasteToOrder: Boolean(v) }))}
              />
            </label>

            <label className="flex items-start justify-between gap-3 rounded-lg border border-border/60 p-2.5">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">
                  Требовать факт после печати
                </span>
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  Напечатанные заказы без корректировки помечаются «факт не внесён».
                </span>
              </span>
              <Switch
                checked={draft.requireFactAfterPrint}
                onCheckedChange={(v) =>
                  setDraft((s) => ({ ...s, requireFactAfterPrint: Boolean(v) }))
                }
              />
            </label>

            <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
              Пример на 1000 кодов: заказ {fmtInt(preview.orderQty)} шт, хвост{" "}
              {fmtInt(preview.wasteQty)} шт, расход этикетки {fmtInt(preview.labelsQty)} шт.
              {draft.updatedAt ? (
                <>
                  {" "}
                  Изменено {new Date(draft.updatedAt).toLocaleString("ru-RU")}
                  {draft.updatedBy ? ` · ${draft.updatedBy}` : ""}.
                </>
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="suz" className="mt-3 max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            <Field label="omsId">
              <Input
                value={suz.omsId}
                onChange={(e) => setSuz((s) => ({ ...s, omsId: e.target.value }))}
              />
            </Field>
            <Field label="Базовый URL СУЗ">
              <Input
                value={suz.suzBaseUrl}
                onChange={(e) => setSuz((s) => ({ ...s, suzBaseUrl: e.target.value }))}
              />
            </Field>
            <Field label="clientToken" hint="Токен из simpleSignIn или личного кабинета СУЗ.">
              <Textarea
                value={suz.clientToken}
                onChange={(e) => setSuz((s) => ({ ...s, clientToken: e.target.value }))}
                className="min-h-[76px] font-mono text-xs"
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Товарная группа по умолчанию"
                  hint="Только если по GTIN не удалось понять группу. Вода и напитки в ЧЗ — разные шаблоны."
              >
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={suz.productGroup}
                  onChange={(e) =>
                    setSuz((s) => ({
                      ...s,
                      productGroup: e.target.value === "water" ? "water" : "softdrinks",
                      templateId: e.target.value === "water" ? 16 : 29,
                    }))
                  }
                >
                  <option value="softdrinks">Напитки (softdrinks)</option>
                  <option value="water">Вода (water)</option>
                </select>
              </Field>
              <Field label="templateId">
                <Input
                  type="number"
                  value={String(suz.templateId)}
                  onChange={(e) =>
                    setSuz((s) => ({ ...s, templateId: Number(e.target.value) || 29 }))
                  }
                />
              </Field>
              <Field label="serialNumberType">
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={suz.serialNumberType}
                  onChange={(e) =>
                    setSuz((s) => ({
                      ...s,
                      serialNumberType: e.target.value as LabelSuzSettings["serialNumberType"],
                    }))
                  }
                >
                  <option value="OPERATOR">OPERATOR</option>
                  <option value="OPERATOR_OR_PROVIDER">OPERATOR_OR_PROVIDER</option>
                  <option value="PROVIDER">PROVIDER</option>
                </select>
              </Field>
              <Field label="cisType по умолчанию">
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={suz.cisType}
                  onChange={(e) =>
                    setSuz((s) => ({ ...s, cisType: e.target.value as LabelSuzSettings["cisType"] }))
                  }
                >
                  <option value="UNIT">UNIT</option>
                  <option value="GROUP">GROUP</option>
                  <option value="SET">SET</option>
                </select>
              </Field>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Отмена
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
