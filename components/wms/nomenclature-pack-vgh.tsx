"use client"

import { useEffect, useMemo, type Dispatch, type SetStateAction } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { computePackVgh, parseVolumeLiters } from "@/lib/wms/pack-vgh"
import type { NomenclatureFormState } from "@/lib/nomenclature-model"

type Props = {
  form: NomenclatureFormState
  setForm: Dispatch<SetStateAction<NomenclatureFormState>>
}

export function NomenclaturePackVghPanel({ form, setForm }: Props) {
  const parsedVolume = parseVolumeLiters(form.name)
  const calc = useMemo(
    () =>
      computePackVgh({
        name: form.name,
        volumeL: form.bottleVolumeL ? Number(form.bottleVolumeL) : parsedVolume,
        bottleWeightG: form.bottleWeightG ? Number(form.bottleWeightG) : null,
        bottlesPerPallet: form.bottlesPerPallet ? Number(form.bottlesPerPallet) : null,
        layers: form.packLayers ? Number(form.packLayers) : null,
        bottlesPerLayer: form.bottlesPerLayer ? Number(form.bottlesPerLayer) : null,
        palletTareKg: form.palletTareKg ? Number(form.palletTareKg) : null,
        filmKg: form.filmKg ? Number(form.filmKg) : null,
      }),
    [
      form.name,
      form.bottleVolumeL,
      form.bottleWeightG,
      form.bottlesPerPallet,
      form.packLayers,
      form.bottlesPerLayer,
      form.palletTareKg,
      form.filmKg,
      parsedVolume,
    ]
  )

  function applyFrom(calcIn: NonNullable<typeof calc>, keepAuto = true) {
    setForm((p) => {
      const next = {
        ...p,
        autoVgh: keepAuto ? true : p.autoVgh,
        bottleVolumeL: String(calcIn.volumeL),
        bottleWeightG: String(calcIn.bottleWeightG),
        bottlesPerPallet: String(calcIn.bottlesPerPallet),
        packLayers: String(calcIn.layers),
        bottlesPerLayer: String(calcIn.bottlesPerLayer),
        palletTareKg: String(calcIn.palletTareKg),
        filmKg: String(calcIn.filmKg),
        lengthMm: String(calcIn.palletLengthMm),
        widthMm: String(calcIn.palletWidthMm),
        heightMm: String(calcIn.palletHeightMm),
        diameterMm: String(calcIn.bottleDiameterMm),
        netWeightKg: String(calcIn.unitNetKg),
        grossWeightKg: String(calcIn.palletGrossKg),
        volumeM3: (calcIn.palletLengthMm * calcIn.palletWidthMm * calcIn.palletHeightMm / 1e9).toFixed(3),
        conversionFactor: String(calcIn.bottlesPerPallet),
        storageUnitCode: p.storageUnitCode || "PALLET",
        storageUnitName: p.storageUnitName || "палета",
      }
      const same =
        next.lengthMm === p.lengthMm &&
        next.widthMm === p.widthMm &&
        next.heightMm === p.heightMm &&
        next.grossWeightKg === p.grossWeightKg &&
        next.netWeightKg === p.netWeightKg &&
        next.bottleWeightG === p.bottleWeightG &&
        next.bottlesPerPallet === p.bottlesPerPallet
      return same ? p : next
    })
  }

  function apply() {
    if (!calc) return
    applyFrom(calc, true)
  }

  useEffect(() => {
    if (!form.autoVgh || !calc) return
    applyFrom(calc, true)
  }, [form.autoVgh, calc])

  function setField(key: keyof NomenclatureFormState, value: string | boolean) {
    setForm((p) => ({ ...p, [key]: value }))
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/60 bg-secondary/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Авторасчёт ВГХ тары</p>
          <p className="mt-1 text-xs text-muted-foreground">
            0,5 л ≈ 600 г одной бутылки. Палета = штуки × вес бутылки + поддон + плёнка. Количество на палете
            разное для 0,5 / 1,5 / 11 / 19 л — его можно поправить.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={form.autoVgh} onCheckedChange={(v) => setField("autoVgh", v)} />
          Считать автоматически
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Литраж" value={form.bottleVolumeL || (parsedVolume != null ? String(parsedVolume) : "")} onChange={(v) => setField("bottleVolumeL", v)} placeholder="0.5" />
        <Field label="Вес бутылки, г" value={form.bottleWeightG} onChange={(v) => setField("bottleWeightG", v)} placeholder="600" />
        <Field label="Бутылок на палете" value={form.bottlesPerPallet} onChange={(v) => setField("bottlesPerPallet", v)} placeholder="144" />
        <Field label="Слоёв" value={form.packLayers} onChange={(v) => setField("packLayers", v)} placeholder="6" />
        <Field label="Бутылок в слое" value={form.bottlesPerLayer} onChange={(v) => setField("bottlesPerLayer", v)} placeholder="24" />
        <Field label="Вес поддона, кг" value={form.palletTareKg} onChange={(v) => setField("palletTareKg", v)} placeholder="22" />
        <Field label="Плёнка, кг" value={form.filmKg} onChange={(v) => setField("filmKg", v)} placeholder="0.4" />
      </div>
      {calc ? (
        <p className="text-xs text-muted-foreground">
          {calc.hint}. Палета {calc.palletLengthMm}×{calc.palletWidthMm}×{calc.palletHeightMm} мм.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">В названии нет литража (0,5л, 1,5л, 19л) — укажите литраж вручную.</p>
      )}
      <Button type="button" size="sm" className="rounded-lg" disabled={!calc} onClick={apply}>
        Заполнить габариты и вес
      </Button>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode="decimal" className="rounded-xl" />
    </div>
  )
}
