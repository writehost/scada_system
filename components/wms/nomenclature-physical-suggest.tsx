"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  formatTypicalDims,
  suggestPhysicalProfile,
  type PhysicalSuggestResult,
} from "@/lib/wms/physical-suggest"
import { storageClassLabel } from "@/lib/wms/physical-profile"
import { computePackVgh } from "@/lib/wms/pack-vgh"
import { postJson } from "@/lib/wms-api"
import type { NomenclatureFormState } from "@/lib/nomenclature-model"

type Props = {
  form: NomenclatureFormState
  onApplyTypical: (next: Partial<NomenclatureFormState>) => void
}

export function NomenclaturePhysicalSuggestPanel({ form, onApplyTypical }: Props) {
  const [llmBusy, setLlmBusy] = useState(false)
  const [llmHint, setLlmHint] = useState<string | null>(null)
  const [llmSuggest, setLlmSuggest] = useState<PhysicalSuggestResult | null>(null)

  const local = useMemo(
    () =>
      suggestPhysicalProfile({
        name: form.name,
        itemTypeCode: form.type,
        itemGroupCode: form.groupName || form.categoryName,
        itemClassCode: form.groupId,
        lengthMm: form.lengthMm ? Number(form.lengthMm) : null,
        widthMm: form.widthMm ? Number(form.widthMm) : null,
        heightMm: form.heightMm ? Number(form.heightMm) : null,
        netWeightKg: form.netWeightKg ? Number(form.netWeightKg) : null,
        grossWeightKg: form.grossWeightKg ? Number(form.grossWeightKg) : null,
      }),
    [
      form.name,
      form.type,
      form.groupName,
      form.categoryName,
      form.groupId,
      form.lengthMm,
      form.widthMm,
      form.heightMm,
      form.netWeightKg,
      form.grossWeightKg,
    ]
  )

  const shown = llmSuggest && llmSuggest.profile.storageClass ? llmSuggest : local
  const dims = formatTypicalDims(shown)
  const hasName = form.name.trim().length >= 2
  const autoApplied = useRef(false)

  function applyTypical() {
    if (shown.typicalLengthMm == null) return
    const pack = computePackVgh({
      name: form.name,
      volumeL: form.bottleVolumeL ? Number(form.bottleVolumeL) : null,
      bottleWeightG: form.bottleWeightG ? Number(form.bottleWeightG) : null,
      bottlesPerPallet: form.bottlesPerPallet ? Number(form.bottlesPerPallet) : null,
      layers: form.packLayers ? Number(form.packLayers) : null,
      bottlesPerLayer: form.bottlesPerLayer ? Number(form.bottlesPerLayer) : null,
      palletTareKg: form.palletTareKg ? Number(form.palletTareKg) : null,
      filmKg: form.filmKg ? Number(form.filmKg) : null,
    })
    onApplyTypical({
      lengthMm: String(pack?.palletLengthMm ?? shown.typicalLengthMm),
      widthMm: String(pack?.palletWidthMm ?? shown.typicalWidthMm ?? ""),
      heightMm: String(pack?.palletHeightMm ?? shown.typicalHeightMm ?? ""),
      netWeightKg: pack ? String(pack.unitNetKg) : shown.typicalWeightKg != null ? String(Number(shown.typicalWeightKg.toFixed(3))) : form.netWeightKg,
      grossWeightKg: pack ? String(pack.palletGrossKg) : form.grossWeightKg,
      bottleVolumeL: pack ? String(pack.volumeL) : form.bottleVolumeL,
      bottleWeightG: pack ? String(pack.bottleWeightG) : form.bottleWeightG,
      bottlesPerPallet: pack ? String(pack.bottlesPerPallet) : form.bottlesPerPallet,
      packLayers: pack ? String(pack.layers) : form.packLayers,
      bottlesPerLayer: pack ? String(pack.bottlesPerLayer) : form.bottlesPerLayer,
      palletTareKg: pack ? String(pack.palletTareKg) : form.palletTareKg,
      filmKg: pack ? String(pack.filmKg) : form.filmKg,
      conversionFactor: pack ? String(pack.bottlesPerPallet) : form.conversionFactor,
      storageUnitCode: pack ? form.storageUnitCode || "PALLET" : form.storageUnitCode,
      storageUnitName: pack ? form.storageUnitName || "палета" : form.storageUnitName,
    })
  }

  useEffect(() => {
    if (autoApplied.current) return
    if (!form.autoVgh) return
    if (!hasName || shown.typicalLengthMm == null) return
    if (form.lengthMm.trim() || form.netWeightKg.trim()) return
    autoApplied.current = true
    applyTypical()
  }, [hasName, shown.typicalLengthMm, form.autoVgh, form.lengthMm, form.netWeightKg])

  async function refineLlm() {
    if (!hasName) return
    setLlmBusy(true)
    setLlmHint(null)
    try {
      const res = await postJson<{ ok: boolean; llm?: boolean; suggestion?: PhysicalSuggestResult }>(
        "/api/wms/nomenclature/physical-suggest",
        {
          name: form.name,
          itemTypeCode: form.type,
          itemGroupCode: form.groupName || form.categoryName,
          useLlm: true,
        }
      )
      if (res.suggestion) {
        setLlmSuggest(res.suggestion)
        setLlmHint(res.llm ? "Уточнено через ИИ" : "ИИ не понадобился — хватило справочника")
      }
    } catch (e) {
      setLlmHint(e instanceof Error ? e.message : "ИИ недоступен, оставлен справочник")
    } finally {
      setLlmBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 sm:p-4">
      <p className="text-sm font-medium">Складской профиль — сам</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Класс считается по названию. Для воды и напитков вес палеты считается от литража бутылки,
        количества на палете, поддона и плёнки — не 500 кг «на всех».
      </p>
      {hasName ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-medium">
            {storageClassLabel(shown.profile.storageClass)}
          </span>
          <span className="text-xs text-muted-foreground">
            {shown.source === "catalog" ? shown.title : "по названию"}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Начните вводить наименование.</p>
      )}
      {hasName && dims ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Типично: <span className="font-medium text-foreground">{dims}</span>
        </p>
      ) : null}
      {hasName ? <p className="mt-1 text-xs text-muted-foreground">{shown.hint}</p> : null}
      {llmHint ? <p className="mt-1 text-xs text-muted-foreground">{llmHint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="rounded-lg"
          disabled={!hasName || shown.typicalLengthMm == null}
          onClick={applyTypical}
        >
          Подставить типичные размеры
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="rounded-lg"
          disabled={!hasName || llmBusy}
          onClick={() => void refineLlm()}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {llmBusy ? "ИИ…" : "Уточнить через ИИ"}
        </Button>
      </div>
    </div>
  )
}
