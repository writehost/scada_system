"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  EMPTY_SLOT_PROFILE,
  SLOT_FIELD_HINTS,
  SLOT_FIELD_LABELS,
  buildSlotTitle,
  hasLineEquipment,
  type StorageSlotProfile,
} from "@/lib/storage-slot-ui"
import { HANDLING_LABELS, STORAGE_CLASS_META, STORAGE_CLASSES } from "@/lib/wms/physical-profile"
import { listItems } from "@/lib/wms-api"
import { useSlotProfileSelectOptions } from "@/lib/use-slot-profile-select-options"

type Props = {
  value: StorageSlotProfile
  onChange: (next: StorageSlotProfile) => void
  disabled?: boolean
  showPhysical?: boolean
  showPreview?: boolean
  compact?: boolean
  advancedOnly?: boolean
  /** Номенклатура, которая сейчас лежит в ячейке — для быстрого выбора. */
  occupancyItems?: Array<{ itemCode: string; name: string }>
}

function FieldHint({ children }: { children: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{children}</p>
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h3 className="text-sm font-semibold text-foreground sm:col-span-2">{children}</h3>
  )
}

function SelectField({
  id,
  label,
  hint,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string
  label: string
  hint?: string
  value: string | null | undefined
  options: readonly { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      {hint ? <FieldHint>{hint}</FieldHint> : null}
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function StorageSlotProfileForm({
  value,
  onChange,
  disabled,
  showPhysical = true,
  showPreview = true,
  compact = false,
  advancedOnly = false,
  occupancyItems = [],
}: Props) {
  const v = { ...EMPTY_SLOT_PROFILE, ...value }
  const selectOptions = useSlotProfileSelectOptions(v)
  const isSticker = (v.materialType ?? "ST") === "ST"
  const lineEquipment = hasLineEquipment(v)
  const showPhysicalField = showPhysical && !lineEquipment
  const [itemQuery, setItemQuery] = useState("")
  const [itemHits, setItemHits] = useState<Array<{ itemCode: string; name: string }>>([])

  useEffect(() => {
    const q = itemQuery.trim()
    if (q.length < 2) {
      setItemHits([])
      return
    }
    const t = window.setTimeout(() => {
      void listItems({ query: q, limit: 12, isActive: true }).then((res) => {
        setItemHits(
          (res.items ?? []).map((row) => ({
            itemCode: row.itemCode,
            name: row.name,
          }))
        )
      })
    }, 300)
    return () => window.clearTimeout(t)
  }, [itemQuery])

  function patch(partial: Partial<StorageSlotProfile>) {
    onChange({ ...v, ...partial })
  }

  const hint = (text: string) => (compact || advancedOnly ? undefined : text)

  if (advancedOnly) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-border/60 bg-secondary/10 p-4">
        <SelectField
          id="slot-group-adv"
          label={SLOT_FIELD_LABELS.productGroup}
          value={v.productGroup}
          options={selectOptions.productGroup}
          onChange={(productGroup) => patch({ productGroup })}
          disabled={disabled}
        />
        <SelectField
          id="slot-volume-adv"
          label={SLOT_FIELD_LABELS.volume}
          value={v.volume}
          options={selectOptions.volume}
          onChange={(volume) => patch({ volume })}
          disabled={disabled}
        />
        <SelectField
          id="slot-app-adv"
          label={SLOT_FIELD_LABELS.applicationPlace}
          value={v.applicationPlace}
          options={selectOptions.applicationPlace}
          onChange={(applicationPlace) => patch({ applicationPlace })}
          disabled={disabled}
        />
        <SelectField
          id="slot-equipment-adv"
          label={SLOT_FIELD_LABELS.equipment}
          value={v.equipment}
          options={selectOptions.equipment ?? []}
          onChange={(equipment) => patch({ equipment })}
          disabled={disabled}
        />
        <div className="space-y-1.5">
          <Label htmlFor="slot-cap-adv" className="text-sm font-medium">
            {SLOT_FIELD_LABELS.capacityUnits}
          </Label>
          <Input
            id="slot-cap-adv"
            value={v.capacityUnits != null ? String(v.capacityUnits) : ""}
            onChange={(e) => {
              const n = e.target.value.trim()
              patch({ capacityUnits: n ? Number(n) : null })
            }}
            inputMode="numeric"
            placeholder="500000"
            disabled={disabled}
            className="rounded-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slot-pri-adv" className="text-sm font-medium">
            {SLOT_FIELD_LABELS.priority}
          </Label>
          <Input
            id="slot-pri-adv"
            value={v.priority != null ? String(v.priority) : ""}
            onChange={(e) => {
              const n = e.target.value.trim()
              patch({ priority: n ? Number(n) : undefined })
            }}
            inputMode="numeric"
            placeholder="10"
            disabled={disabled}
            className="rounded-lg"
          />
        </div>
        <div className="rounded-xl border border-border/60 bg-background/80 p-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="slot-mix-nom-adv" className="text-sm font-medium">
              {SLOT_FIELD_LABELS.allowMixedNomenclature}
            </Label>
            <Switch
              id="slot-mix-nom-adv"
              checked={Boolean(v.allowMixedNomenclature)}
              onCheckedChange={(allowMixedNomenclature) => patch({ allowMixedNomenclature })}
              disabled={disabled}
            />
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/80 p-3 sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="slot-mix-batch-adv" className="text-sm font-medium">
              {SLOT_FIELD_LABELS.allowMixedBatches}
            </Label>
            <Switch
              id="slot-mix-batch-adv"
              checked={v.allowMixedBatches !== false}
              onCheckedChange={(allowMixedBatches) => patch({ allowMixedBatches })}
              disabled={disabled}
            />
          </div>
        </div>
        {showPreview ? (
          <div className="rounded-xl bg-primary/5 px-3 py-2.5 sm:col-span-2">
            <p className="text-xs font-medium text-muted-foreground">Название в списке</p>
            <p className="mt-1 text-sm font-medium text-foreground">{buildSlotTitle(v)}</p>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {!compact ? <SectionTitle>Класс хранения и физика</SectionTitle> : null}

      <SelectField
        id="slot-storage-class"
        label={SLOT_FIELD_LABELS.storageClass}
        hint={hint(SLOT_FIELD_HINTS.storageClass)}
        value={v.storageClass ?? "S1"}
        options={STORAGE_CLASSES.map((code) => ({
          value: code,
          label: STORAGE_CLASS_META[code].short,
        }))}
        onChange={(storageClass) => patch({ storageClass })}
        disabled={disabled}
      />
      <SelectField
        id="slot-handling"
        label={SLOT_FIELD_LABELS.handling}
        hint={hint(SLOT_FIELD_HINTS.handling)}
        value={v.handling ?? "MANUAL"}
        options={[
          { value: "MANUAL", label: HANDLING_LABELS.MANUAL },
          { value: "CART", label: HANDLING_LABELS.CART },
          { value: "FORKLIFT", label: HANDLING_LABELS.FORKLIFT },
        ]}
        onChange={(handling) => patch({ handling })}
        disabled={disabled}
      />
      {showPhysicalField ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Макс. габарит ячейки, мм</Label>
            <FieldHint>{SLOT_FIELD_HINTS.maxLengthMm}</FieldHint>
            <div className="grid grid-cols-3 gap-2">
              <Input
                value={v.maxLengthMm != null ? String(v.maxLengthMm) : ""}
                onChange={(e) =>
                  patch({ maxLengthMm: e.target.value.trim() ? Number(e.target.value) : null })
                }
                inputMode="numeric"
                placeholder="Д"
                disabled={disabled}
                className="rounded-lg"
              />
              <Input
                value={v.maxWidthMm != null ? String(v.maxWidthMm) : ""}
                onChange={(e) =>
                  patch({ maxWidthMm: e.target.value.trim() ? Number(e.target.value) : null })
                }
                inputMode="numeric"
                placeholder="Ш"
                disabled={disabled}
                className="rounded-lg"
              />
              <Input
                value={v.maxHeightMm != null ? String(v.maxHeightMm) : ""}
                onChange={(e) =>
                  patch({ maxHeightMm: e.target.value.trim() ? Number(e.target.value) : null })
                }
                inputMode="numeric"
                placeholder="В"
                disabled={disabled}
                className="rounded-lg"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-max-weight" className="text-sm font-medium">
              {SLOT_FIELD_LABELS.maxWeightG}
            </Label>
            <Input
              id="slot-max-weight"
              value={v.maxWeightG != null ? String(v.maxWeightG) : ""}
              onChange={(e) =>
                patch({ maxWeightG: e.target.value.trim() ? Number(e.target.value) : null })
              }
              inputMode="numeric"
              placeholder="20000"
              disabled={disabled}
              className="rounded-lg"
            />
          </div>
        </>
      ) : null}

      {!compact ? <SectionTitle>Производственные признаки</SectionTitle> : null}

      <SelectField
        id="slot-material"
        label={SLOT_FIELD_LABELS.materialType}
        hint={hint(SLOT_FIELD_HINTS.materialType)}
        value={v.materialType}
        options={selectOptions.materialType}
        onChange={(materialType) => patch({ materialType })}
        disabled={disabled}
      />
      <SelectField
        id="slot-process"
        label={SLOT_FIELD_LABELS.processType}
        hint={hint(SLOT_FIELD_HINTS.processType)}
        value={v.processType}
        options={selectOptions.processType}
        onChange={(processType) => patch({ processType })}
        disabled={disabled}
      />
      {isSticker ? (
        <SelectField
          id="slot-shape"
          label={SLOT_FIELD_LABELS.stickerShape}
          hint={hint(SLOT_FIELD_HINTS.stickerShape)}
          value={v.stickerShape}
          options={selectOptions.stickerShape}
          onChange={(stickerShape) => patch({ stickerShape })}
          disabled={disabled}
        />
      ) : (
        <div className="hidden sm:block" aria-hidden />
      )}
      <SelectField
        id="slot-equipment"
        label={SLOT_FIELD_LABELS.equipment}
        hint={hint(SLOT_FIELD_HINTS.equipment)}
        value={v.equipment}
        options={selectOptions.equipment ?? []}
        onChange={(equipment) => patch({ equipment })}
        disabled={disabled}
      />

      {!compact ? (
        <>
          <SelectField
            id="slot-group"
            label={SLOT_FIELD_LABELS.productGroup}
            hint={hint(SLOT_FIELD_HINTS.productGroup)}
            value={v.productGroup}
            options={selectOptions.productGroup}
            onChange={(productGroup) => patch({ productGroup })}
            disabled={disabled}
          />
          <SelectField
            id="slot-volume"
            label={SLOT_FIELD_LABELS.volume}
            hint={hint(SLOT_FIELD_HINTS.volume)}
            value={v.volume}
            options={selectOptions.volume}
            onChange={(volume) => patch({ volume })}
            disabled={disabled}
          />
          <SelectField
            id="slot-app"
            label={SLOT_FIELD_LABELS.applicationPlace}
            hint={hint(SLOT_FIELD_HINTS.applicationPlace)}
            value={v.applicationPlace}
            options={selectOptions.applicationPlace}
            onChange={(applicationPlace) => patch({ applicationPlace })}
            disabled={disabled}
          />
        </>
      ) : null}

      {showPhysicalField ? (
        <>
          {!compact ? <SectionTitle>Где находится на складе</SectionTitle> : null}
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="slot-phys" className="text-sm font-medium">
              {SLOT_FIELD_LABELS.physicalAddress}
              {compact ? (
                <span className="ml-1 font-normal text-muted-foreground">(необязательно)</span>
              ) : null}
            </Label>
            {!compact ? <FieldHint>{SLOT_FIELD_HINTS.physicalAddress}</FieldHint> : null}
            <Input
              id="slot-phys"
              value={v.physicalAddress ?? ""}
              onChange={(e) => patch({ physicalAddress: e.target.value })}
              placeholder="Полка-1, A01-01 — только для стеллажа"
              disabled={disabled}
              className="rounded-lg text-sm"
            />
          </div>
        </>
      ) : lineEquipment && compact ? (
        <p className="text-[11px] leading-snug text-muted-foreground sm:col-span-2">
          Для аппликатора/линии полка не нужна — код ячейки строится по профилю и оборудованию.
        </p>
      ) : null}

      {!compact ? (
        <>
          <SectionTitle>Закрепление номенклатуры</SectionTitle>
          <div className="rounded-xl border border-primary/25 bg-primary/5 p-3 sm:col-span-2 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <Label htmlFor="slot-remember-nom" className="text-sm font-medium">
                  {SLOT_FIELD_LABELS.rememberNomenclature}
                </Label>
                <FieldHint>{SLOT_FIELD_HINTS.rememberNomenclature}</FieldHint>
              </div>
              <Switch
                id="slot-remember-nom"
                checked={Boolean(v.rememberNomenclature)}
                onCheckedChange={(rememberNomenclature) => patch({ rememberNomenclature })}
                disabled={disabled}
              />
            </div>
            {v.rememberNomenclature ? (
              <div className="space-y-2">
                <Label className="text-sm font-medium">{SLOT_FIELD_LABELS.preferredItemCode}</Label>
                <FieldHint>{SLOT_FIELD_HINTS.preferredItemCode}</FieldHint>
                {v.preferredItemCode ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg bg-background px-3 py-2 text-sm">
                    <span className="font-mono text-xs">{v.preferredItemCode}</span>
                    <span className="text-muted-foreground">{v.preferredItemName}</span>
                    <button
                      type="button"
                      className="text-xs text-destructive hover:underline"
                      onClick={() => patch({ preferredItemCode: null, preferredItemName: null })}
                      disabled={disabled}
                    >
                      Сбросить
                    </button>
                  </div>
                ) : null}
                {occupancyItems.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {occupancyItems.map((row) => (
                      <button
                        key={row.itemCode}
                        type="button"
                        disabled={disabled}
                        className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-secondary/60"
                        onClick={() =>
                          patch({
                            preferredItemCode: row.itemCode,
                            preferredItemName: row.name,
                            rememberNomenclature: true,
                          })
                        }
                      >
                        <span className="font-medium">{row.name}</span>
                        <span className="ml-1 font-mono text-muted-foreground">{row.itemCode}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <Input
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  placeholder="Поиск номенклатуры…"
                  disabled={disabled}
                  className="rounded-lg"
                />
                {itemHits.length > 0 ? (
                  <div className="max-h-40 overflow-auto rounded-lg border bg-background">
                    {itemHits.map((row) => (
                      <button
                        key={row.itemCode}
                        type="button"
                        className="block w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-secondary/40"
                        onClick={() => {
                          patch({
                            preferredItemCode: row.itemCode,
                            preferredItemName: row.name,
                            rememberNomenclature: true,
                          })
                          setItemQuery("")
                          setItemHits([])
                        }}
                      >
                        <div className="font-medium">{row.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.itemCode}</div>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {!compact ? (
        <>
          <SectionTitle>Ограничения и приоритет</SectionTitle>

          <div className="space-y-1.5">
            <Label htmlFor="slot-cap" className="text-sm font-medium">
              {SLOT_FIELD_LABELS.capacityUnits}
            </Label>
            <FieldHint>{SLOT_FIELD_HINTS.capacityUnits}</FieldHint>
            <Input
              id="slot-cap"
              value={v.capacityUnits != null ? String(v.capacityUnits) : ""}
              onChange={(e) => {
                const n = e.target.value.trim()
                patch({ capacityUnits: n ? Number(n) : null })
              }}
              inputMode="numeric"
              placeholder="500000"
              disabled={disabled}
              className="rounded-lg"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="slot-pri" className="text-sm font-medium">
              {SLOT_FIELD_LABELS.priority}
            </Label>
            <FieldHint>{SLOT_FIELD_HINTS.priority}</FieldHint>
            <Input
              id="slot-pri"
              value={v.priority != null ? String(v.priority) : ""}
              onChange={(e) => {
                const n = e.target.value.trim()
                patch({ priority: n ? Number(n) : undefined })
              }}
              inputMode="numeric"
              placeholder="10"
              disabled={disabled}
              className="rounded-lg"
            />
          </div>

          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 sm:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <Label htmlFor="slot-mix-nom" className="text-sm font-medium">
                  {SLOT_FIELD_LABELS.allowMixedNomenclature}
                </Label>
                <FieldHint>{SLOT_FIELD_HINTS.allowMixedNomenclature}</FieldHint>
              </div>
              <Switch
                id="slot-mix-nom"
                checked={Boolean(v.allowMixedNomenclature)}
                onCheckedChange={(allowMixedNomenclature) => patch({ allowMixedNomenclature })}
                disabled={disabled}
              />
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 sm:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <Label htmlFor="slot-mix-batch" className="text-sm font-medium">
                  {SLOT_FIELD_LABELS.allowMixedBatches}
                </Label>
                <FieldHint>{SLOT_FIELD_HINTS.allowMixedBatches}</FieldHint>
              </div>
              <Switch
                id="slot-mix-batch"
                checked={v.allowMixedBatches !== false}
                onCheckedChange={(allowMixedBatches) => patch({ allowMixedBatches })}
                disabled={disabled}
              />
            </div>
          </div>
        </>
      ) : null}

      {showPreview ? (
        <div className="rounded-xl bg-primary/5 px-3 py-2.5 sm:col-span-2">
          <p className="text-xs font-medium text-muted-foreground">Как будет выглядеть в списке</p>
          <p className="mt-1 text-sm font-medium text-foreground">{buildSlotTitle(v)}</p>
        </div>
      ) : null}
    </div>
  )
}
