"use client"

import { useEffect, useMemo, useState } from "react"
import { FilePenLine, Loader2, RotateCcw, Save } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Torg1GoodsScreenTable } from "@/components/wms/torg1/torg1-goods-screen-table"
import type { Torg1Fields } from "@/lib/wms/torg1"
import { cn } from "@/lib/utils"

type ScalarKey = Exclude<keyof Torg1Fields, "lines">

type FieldDefinition = {
  label: string
  multiline?: boolean
  date?: boolean
  time?: boolean
}

const FIELD_DEFINITIONS: Record<ScalarKey, FieldDefinition> = {
  orgName: { label: "Организация" },
  orgAddress: { label: "Адрес организации", multiline: true },
  orgPhone: { label: "Телефон организации" },
  okpo: { label: "ОКПО" },
  okud: { label: "ОКУД" },
  okdp: { label: "ОКДП" },
  structuralUnit: { label: "Структурное подразделение / склад" },
  cameraNo: { label: "Камера" },
  sectionNo: { label: "Секция" },
  basisDoc: { label: "Основание", multiline: true },
  basisNo: { label: "Номер основания" },
  basisDate: { label: "Дата основания", date: true },
  operationKind: { label: "Вид операции" },
  documentNo: { label: "Номер документа" },
  composedAt: { label: "Дата составления", date: true },
  approveTitle: { label: "Утверждаю — должность" },
  approveName: { label: "Утверждаю — ФИО" },
  approveSign: { label: "Утверждаю — подпись / фамилия" },
  approveDate: { label: "Дата утверждения", date: true },
  place: { label: "Место приёмки" },
  commissionNote: { label: "Текст комиссии", multiline: true },
  commissionDate: { label: "Дата комиссии", date: true },
  accompanyingDocs: { label: "Сопроводительные документы", multiline: true },
  representativeCall: { label: "Вызов представителя", multiline: true },
  callDocNo: { label: "Номер вызова" },
  callDocDate: { label: "Дата вызова", date: true },
  shipper: { label: "Грузоотправитель", multiline: true },
  manufacturer: { label: "Производитель", multiline: true },
  supplier: { label: "Поставщик", multiline: true },
  insurer: { label: "Страховая компания", multiline: true },
  contractNo: { label: "Номер договора" },
  contractDate: { label: "Дата договора", date: true },
  invoiceNo: { label: "Номер счёта-фактуры" },
  invoiceDate: { label: "Дата счёта-фактуры", date: true },
  commercialAct: { label: "Коммерческий акт" },
  commercialActDate: { label: "Дата коммерческого акта", date: true },
  vetCert: { label: "Ветеринарное свидетельство" },
  vetCertDate: { label: "Дата вет. свидетельства", date: true },
  railWaybill: { label: "Железнодорожная накладная" },
  railWaybillDate: { label: "Дата ж/д накладной", date: true },
  deliveryMethod: { label: "Способ доставки", multiline: true },
  vehicleNo: { label: "Номер транспорта" },
  shipDate: { label: "Дата отправления", date: true },
  fromStation: { label: "Станция отправления", multiline: true },
  fromStationOrWarehouse: { label: "Склад отправителя", multiline: true },
  meatTemp: { label: "Температура" },
  arrivedAt: { label: "Дата прибытия", date: true },
  arrivedTime: { label: "Время прибытия", time: true },
  acceptStart: { label: "Начало приёмки — дата", date: true },
  acceptStartTime: { label: "Начало приёмки — время", time: true },
  acceptPause: { label: "Приостановление — дата", date: true },
  acceptPauseTime: { label: "Приостановление — время", time: true },
  acceptResume: { label: "Возобновление — дата", date: true },
  acceptResumeTime: { label: "Возобновление — время", time: true },
  acceptEnd: { label: "Окончание приёмки — дата", date: true },
  acceptEndTime: { label: "Окончание приёмки — время", time: true },
}

const GROUPS: Array<{
  value: string
  title: string
  fields: ScalarKey[]
}> = [
  {
    value: "main",
    title: "Документ",
    fields: [
      "documentNo",
      "composedAt",
      "operationKind",
      "place",
      "orgName",
      "orgAddress",
      "orgPhone",
      "okpo",
      "okud",
      "okdp",
      "structuralUnit",
      "cameraNo",
      "sectionNo",
    ],
  },
  {
    value: "approval",
    title: "Основание",
    fields: [
      "basisDoc",
      "basisNo",
      "basisDate",
      "approveTitle",
      "approveName",
      "approveSign",
      "approveDate",
    ],
  },
  {
    value: "commission",
    title: "Комиссия",
    fields: [
      "commissionNote",
      "commissionDate",
      "accompanyingDocs",
      "representativeCall",
      "callDocNo",
      "callDocDate",
    ],
  },
  {
    value: "parties",
    title: "Стороны и документы",
    fields: [
      "shipper",
      "manufacturer",
      "supplier",
      "insurer",
      "contractNo",
      "contractDate",
      "invoiceNo",
      "invoiceDate",
      "commercialAct",
      "commercialActDate",
      "vetCert",
      "vetCertDate",
      "railWaybill",
      "railWaybillDate",
    ],
  },
  {
    value: "delivery",
    title: "Доставка и время",
    fields: [
      "deliveryMethod",
      "vehicleNo",
      "shipDate",
      "fromStation",
      "fromStationOrWarehouse",
      "meatTemp",
      "arrivedAt",
      "arrivedTime",
      "acceptStart",
      "acceptStartTime",
      "acceptPause",
      "acceptPauseTime",
      "acceptResume",
      "acceptResumeTime",
      "acceptEnd",
      "acceptEndTime",
    ],
  },
]

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  documentLabel: string
  fields: Torg1Fields
  auto: Torg1Fields
  onSave: (fields: Torg1Fields) => Promise<void>
}

function cloneFields(fields: Torg1Fields): Torg1Fields {
  return {
    ...fields,
    lines: fields.lines.map((line) => ({ ...line })),
  }
}

function FieldEditor({
  fieldKey,
  value,
  autoValue,
  onChange,
  onReset,
}: {
  fieldKey: ScalarKey
  value: string
  autoValue: string
  onChange: (value: string) => void
  onReset: () => void
}) {
  const definition = FIELD_DEFINITIONS[fieldKey]
  const changedFromAuto = value !== autoValue
  const commonProps = {
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => onChange(event.target.value),
    placeholder: definition.date
      ? "ДД.ММ.ГГГГ"
      : definition.time
        ? "ЧЧ:ММ"
        : undefined,
  }

  return (
    <div className={cn("space-y-1.5", definition.multiline && "sm:col-span-2")}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label htmlFor={`torg1-${fieldKey}`} className="min-w-0">
          <span>{definition.label}</span>{" "}
          <span className="font-mono text-[10px] font-normal text-muted-foreground">
            {`{{${fieldKey}}}`}
          </span>
        </Label>
        {changedFromAuto ? (
          <button
            type="button"
            className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={onReset}
            title="Вернуть значение из данных приёмки"
          >
            <RotateCcw className="inline h-3 w-3" /> авто
          </button>
        ) : null}
      </div>
      {definition.multiline ? (
        <Textarea
          id={`torg1-${fieldKey}`}
          {...commonProps}
          className="min-h-20 resize-y"
        />
      ) : (
        <Input id={`torg1-${fieldKey}`} {...commonProps} />
      )}
    </div>
  )
}

export function Torg1DocumentFieldsDialog({
  open,
  onOpenChange,
  documentLabel,
  fields,
  auto,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<Torg1Fields>(() => cloneFields(fields))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(cloneFields(fields))
    setError(null)
  }, [fields, open])

  const changed = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(fields),
    [draft, fields]
  )

  function patchField(fieldKey: ScalarKey, value: string) {
    setDraft((current) => ({ ...current, [fieldKey]: value }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await onSave(cloneFields(draft))
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить документ")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next)
      }}
    >
      <DialogContent className="flex max-h-[94vh] w-[96vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
        <DialogHeader className="border-b border-border/70 px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <FilePenLine className="h-5 w-5" />
            Все поля документа · {documentLabel}
          </DialogTitle>
          <DialogDescription>
            Эти значения относятся только к выбранной приёмке. Части дат,{" "}
            <span className="font-mono">{"{{orgLine}}"}</span> и{" "}
            <span className="font-mono">{"{{lines.count}}"}</span> вычисляются автоматически.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="main" className="min-h-0 flex-1 gap-0">
          <div className="overflow-x-auto border-b border-border/70 px-4 py-2">
            <TabsList className="w-max">
              {GROUPS.map((group) => (
                <TabsTrigger key={group.value} value={group.value}>
                  {group.title}
                </TabsTrigger>
              ))}
              <TabsTrigger value="goods">Товары ({draft.lines.length})</TabsTrigger>
            </TabsList>
          </div>

          {GROUPS.map((group) => (
            <TabsContent
              key={group.value}
              value={group.value}
              className="m-0 min-h-0 overflow-y-auto px-6 py-4"
            >
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.fields.map((fieldKey) => (
                  <FieldEditor
                    key={fieldKey}
                    fieldKey={fieldKey}
                    value={draft[fieldKey]}
                    autoValue={auto[fieldKey]}
                    onChange={(value) => patchField(fieldKey, value)}
                    onReset={() => patchField(fieldKey, auto[fieldKey])}
                  />
                ))}
              </div>
            </TabsContent>
          ))}

          <TabsContent
            value="goods"
            className="m-0 min-h-0 overflow-y-auto px-4 py-4"
          >
            <Torg1GoodsScreenTable
              fields={draft}
              onChange={setDraft}
              onReset={() =>
                setDraft((current) => ({
                  ...current,
                  lines: auto.lines.map((line) => ({ ...line })),
                }))
              }
              showAllColumns
            />
          </TabsContent>
        </Tabs>

        {error ? (
          <div className="border-t border-destructive/20 bg-destructive/5 px-6 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <DialogFooter className="border-t border-border/70 px-6 py-3">
          <Button
            type="button"
            variant="ghost"
            className="rounded-xl"
            disabled={saving}
            onClick={() => setDraft(cloneFields(auto))}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Сбросить всё к данным приёмки
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button
            type="button"
            className="rounded-xl"
            disabled={saving || !changed}
            onClick={() => void save()}
          >
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Сохранить документ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
