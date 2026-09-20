"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, RotateCcw, Trash2 } from "lucide-react"
import { CellLabelPreview } from "@/components/wms/cell-label-preview"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  CELL_LABEL_DEMO_CONTEXT,
  CELL_LABEL_SIZE_MAX,
  CELL_LABEL_SIZE_MIN,
  CELL_LABEL_SIZE_PRESETS,
  CELL_LABEL_VARIABLES,
  DEFAULT_CELL_LABEL_TEMPLATE,
  clampLabelMm,
  cloneCellLabelTemplate,
  parseMmInput,
  readCellLabelTemplate,
  writeCellLabelTemplate,
  type CellLabelTemplate,
  type CellLabelTextBlock,
} from "@/lib/cell-label-template"

function newTextBlock(): CellLabelTextBlock {
  return {
    id: `b-${Date.now().toString(36)}`,
    template: "{{displayName}}",
    fontSizePt: 9,
    fontWeight: "normal",
    align: "center",
    placement: "before",
    visible: true,
  }
}

export function SettingsCellLabelTemplate() {
  const [template, setTemplate] = useState<CellLabelTemplate>(() => readCellLabelTemplate())
  const [saved, setSaved] = useState(true)
  const [widthDraft, setWidthDraft] = useState("")
  const [heightDraft, setHeightDraft] = useState("")
  const [qrDraft, setQrDraft] = useState("")

  useEffect(() => {
    const next = readCellLabelTemplate()
    setTemplate(next)
    setWidthDraft(String(next.widthMm))
    setHeightDraft(String(next.heightMm))
    setQrDraft(String(next.qrSizeMm))
  }, [])

  useEffect(() => {
    if (saved) return
    const timer = window.setTimeout(() => {
      writeCellLabelTemplate(template)
      setSaved(true)
    }, 350)
    return () => window.clearTimeout(timer)
  }, [template, saved])

  function patch(next: CellLabelTemplate) {
    setTemplate(next)
    setSaved(false)
  }

  function save() {
    writeCellLabelTemplate(template)
    setSaved(true)
  }

  function resetDefault() {
    const next = cloneCellLabelTemplate(DEFAULT_CELL_LABEL_TEMPLATE)
    setTemplate(next)
    setWidthDraft(String(next.widthMm))
    setHeightDraft(String(next.heightMm))
    setQrDraft(String(next.qrSizeMm))
    writeCellLabelTemplate(next)
    setSaved(true)
  }

  function applySizePreset(widthMm: number, heightMm: number) {
    setWidthDraft(String(widthMm))
    setHeightDraft(String(heightMm))
    patch({ ...template, widthMm, heightMm })
  }

  function commitDraft(
    field: "widthMm" | "heightMm" | "qrSizeMm",
    raw: string,
    fallback: number
  ) {
    const parsed = parseMmInput(raw)
    const limits =
      field === "qrSizeMm"
        ? { min: CELL_LABEL_SIZE_MIN.qrSizeMm, max: CELL_LABEL_SIZE_MAX.qrSizeMm }
        : field === "widthMm"
          ? { min: CELL_LABEL_SIZE_MIN.widthMm, max: CELL_LABEL_SIZE_MAX.widthMm }
          : { min: CELL_LABEL_SIZE_MIN.heightMm, max: CELL_LABEL_SIZE_MAX.heightMm }
    const value = clampLabelMm(parsed ?? fallback, limits.min, limits.max, fallback)
    if (field === "widthMm") setWidthDraft(String(value))
    if (field === "heightMm") setHeightDraft(String(value))
    if (field === "qrSizeMm") setQrDraft(String(value))
    if (template[field] === value) return
    patch({ ...template, [field]: value })
  }

  function updateBlock(id: string, patchBlock: Partial<CellLabelTextBlock>) {
    patch({
      ...template,
      textBlocks: template.textBlocks.map((b) => (b.id === id ? { ...b, ...patchBlock } : b)),
    })
  }

  function removeBlock(id: string) {
    patch({ ...template, textBlocks: template.textBlocks.filter((b) => b.id !== id) })
  }

  function insertVariable(id: string, key: string) {
    const block = template.textBlocks.find((b) => b.id === id)
    if (!block) return
    const token = `{{${key}}}`
    updateBlock(id, { template: block.template ? `${block.template} ${token}` : token })
  }

  const sizePresetId = useMemo(() => {
    const hit = CELL_LABEL_SIZE_PRESETS.find(
      (p) => p.widthMm === template.widthMm && p.heightMm === template.heightMm
    )
    return hit?.id ?? "custom"
  }, [template.widthMm, template.heightMm])

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border/60 bg-secondary/15 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Как читать код ячейки</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <span className="font-mono text-foreground">ST</span> в начале смыслового кода — материал
            «стикеры» (<span className="font-mono">LB</span> — этикетки, <span className="font-mono">PK</span> —
            упаковка).
          </li>
          <li>
            <span className="font-mono text-foreground">A01-01</span> в конце — физический адрес; буква{" "}
            <span className="font-mono">A</span> часто обозначает класс/ряд (мелочь, крупное — по схеме вашего
            склада).
          </li>
          <li>
            Полная расшифровка — в карточке ячейки «Что означает этот код?» и в профиле слота (материал, процесс,
            форма, группа, объём).
          </li>
        </ul>
        <p className="mt-2">
          QR берёт стиль из блока «Стиль QR-кода» выше (форма модулей и логотип). Здесь настраиваются только размер
          этикетки и текст.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_280px]">
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Размер листа / этикетки</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Свой размер сохраняется сам (можно с запятой: 43,5). Готовые форматы — только быстрый выбор.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {CELL_LABEL_SIZE_PRESETS.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  size="sm"
                  variant={sizePresetId === p.id ? "default" : "outline"}
                  className="h-7 rounded-lg px-2 text-xs"
                  onClick={() => applySizePreset(p.widthMm, p.heightMm)}
                >
                  {p.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant={sizePresetId === "custom" ? "default" : "outline"}
                className="h-7 rounded-lg px-2 text-xs"
                onClick={() => {
                  setWidthDraft(String(template.widthMm))
                  setHeightDraft(String(template.heightMm))
                }}
              >
                Свой {template.widthMm} × {template.heightMm}
              </Button>
            </div>
            <div className="mt-3 grid max-w-md grid-cols-3 gap-3">
              <label className="text-xs">
                Ширина, мм
                <Input
                  inputMode="decimal"
                  min={CELL_LABEL_SIZE_MIN.widthMm}
                  max={CELL_LABEL_SIZE_MAX.widthMm}
                  value={widthDraft}
                  onChange={(e) => {
                    setWidthDraft(e.target.value)
                    const n = parseMmInput(e.target.value)
                    if (n == null) return
                    const value = clampLabelMm(
                      n,
                      CELL_LABEL_SIZE_MIN.widthMm,
                      CELL_LABEL_SIZE_MAX.widthMm,
                      template.widthMm
                    )
                    if (value !== template.widthMm) patch({ ...template, widthMm: value })
                  }}
                  onBlur={() => commitDraft("widthMm", widthDraft, template.widthMm)}
                  className="mt-1 h-8 rounded-lg"
                />
              </label>
              <label className="text-xs">
                Высота, мм
                <Input
                  inputMode="decimal"
                  min={CELL_LABEL_SIZE_MIN.heightMm}
                  max={CELL_LABEL_SIZE_MAX.heightMm}
                  value={heightDraft}
                  onChange={(e) => {
                    setHeightDraft(e.target.value)
                    const n = parseMmInput(e.target.value)
                    if (n == null) return
                    const value = clampLabelMm(
                      n,
                      CELL_LABEL_SIZE_MIN.heightMm,
                      CELL_LABEL_SIZE_MAX.heightMm,
                      template.heightMm
                    )
                    if (value !== template.heightMm) patch({ ...template, heightMm: value })
                  }}
                  onBlur={() => commitDraft("heightMm", heightDraft, template.heightMm)}
                  className="mt-1 h-8 rounded-lg"
                />
              </label>
              <label className="text-xs">
                QR, мм
                <Input
                  inputMode="decimal"
                  min={CELL_LABEL_SIZE_MIN.qrSizeMm}
                  max={CELL_LABEL_SIZE_MAX.qrSizeMm}
                  value={qrDraft}
                  onChange={(e) => {
                    setQrDraft(e.target.value)
                    const n = parseMmInput(e.target.value)
                    if (n == null) return
                    const value = clampLabelMm(
                      n,
                      CELL_LABEL_SIZE_MIN.qrSizeMm,
                      CELL_LABEL_SIZE_MAX.qrSizeMm,
                      template.qrSizeMm
                    )
                    if (value !== template.qrSizeMm) patch({ ...template, qrSizeMm: value })
                  }}
                  onBlur={() => commitDraft("qrSizeMm", qrDraft, template.qrSizeMm)}
                  className="mt-1 h-8 rounded-lg"
                />
              </label>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">Текстовые блоки</h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => patch({ ...template, textBlocks: [...template.textBlocks, newTextBlock()] })}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Блок
              </Button>
            </div>
            <div className="space-y-3">
              {template.textBlocks.map((block, idx) => (
                <div key={block.id} className="rounded-xl border border-border/60 bg-card p-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Блок {idx + 1}</span>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={block.visible ? "secondary" : "outline"}
                        className="h-7 rounded-md px-2 text-xs"
                        onClick={() => updateBlock(block.id, { visible: !block.visible })}
                      >
                        {block.visible ? "Вкл" : "Выкл"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 rounded-md p-0 text-destructive"
                        onClick={() => removeBlock(block.id)}
                        disabled={template.textBlocks.length <= 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={block.template}
                    onChange={(e) => updateBlock(block.id, { template: e.target.value })}
                    rows={2}
                    className="mb-2 font-mono text-xs"
                    placeholder="{{displayName}}"
                  />
                  <div className="mb-2 flex flex-wrap gap-1">
                    {CELL_LABEL_VARIABLES.slice(0, 8).map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted/80"
                        onClick={() => insertVariable(block.id, v.key)}
                        title={v.hint}
                      >
                        {`{{${v.key}}}`}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="text-[10px] uppercase text-muted-foreground">
                      Размер, pt
                      <Input
                        type="number"
                        min={6}
                        max={24}
                        value={block.fontSizePt}
                        onChange={(e) => updateBlock(block.id, { fontSizePt: Number(e.target.value) || 9 })}
                        className="mt-0.5 h-7 rounded-md text-xs"
                      />
                    </label>
                    <label className="text-[10px] uppercase text-muted-foreground">
                      Шрифт
                      <Select
                        value={block.fontWeight}
                        onValueChange={(v) =>
                          updateBlock(block.id, {
                            fontWeight: v as CellLabelTextBlock["fontWeight"],
                          })
                        }
                      >
                        <SelectTrigger className="mt-0.5 h-7 rounded-md text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="normal">Обычный</SelectItem>
                          <SelectItem value="bold">Жирный</SelectItem>
                          <SelectItem value="mono">Mono</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="text-[10px] uppercase text-muted-foreground">
                      Выравн.
                      <Select
                        value={block.align}
                        onValueChange={(v) => updateBlock(block.id, { align: v as CellLabelTextBlock["align"] })}
                      >
                        <SelectTrigger className="mt-0.5 h-7 rounded-md text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="left">Слева</SelectItem>
                          <SelectItem value="center">Центр</SelectItem>
                          <SelectItem value="right">Справа</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="text-[10px] uppercase text-muted-foreground">
                      Позиция
                      <Select
                        value={block.placement}
                        onValueChange={(v) =>
                          updateBlock(block.id, { placement: v as CellLabelTextBlock["placement"] })
                        }
                      >
                        <SelectTrigger className="mt-0.5 h-7 rounded-md text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="before">Над QR</SelectItem>
                          <SelectItem value="after">Под QR</SelectItem>
                        </SelectContent>
                      </Select>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" className="rounded-xl" onClick={save} disabled={saved}>
              {saved ? "Размер и шаблон сохранены" : "Сохраняем…"}
            </Button>
            <Button type="button" variant="outline" className="rounded-xl" onClick={resetDefault}>
              <RotateCcw className="mr-2 h-4 w-4" />
              По умолчанию
            </Button>
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-sm font-semibold">Превью (демо-ячейка)</Label>
          <CellLabelPreview context={CELL_LABEL_DEMO_CONTEXT} template={template} scale={0.85} className="shadow-md" />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">Переменные шаблона</h3>
        <div className="overflow-auto rounded-xl border border-border/60">
          <table className="wms-ag-grid min-w-[640px] text-xs">
            <thead>
              <tr>
                <th>Переменная</th>
                <th>Описание</th>
                <th>Пример</th>
              </tr>
            </thead>
            <tbody>
              {CELL_LABEL_VARIABLES.map((v) => (
                <tr key={v.key} className="wms-ag-row">
                  <td className="font-mono text-[11px]">{`{{${v.key}}}`}</td>
                  <td className="text-muted-foreground">{v.hint}</td>
                  <td className="font-mono text-[10px]">{v.example}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
