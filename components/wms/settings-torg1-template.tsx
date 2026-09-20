"use client"

import { useEffect, useRef, useState } from "react"
import { Download, FileSpreadsheet, Loader2, Plus, RefreshCw, Save, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Torg1ExcelTemplatePreview } from "@/components/wms/torg1/torg1-excel-template-preview"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  deleteTorg1ExcelTemplate,
  downloadTorg1ExcelTemplateFile,
  getTorg1ExcelTemplateMeta,
  getTorg1Settings,
  listDirectoryReceivingCategories,
  saveTorg1Settings,
  uploadTorg1ExcelTemplate,
  refreshReceivingTorg1Documents,
  type Torg1RefreshMode,
  type WmsTorg1ExcelTemplateSlot,
  type WmsTorg1Settings,
} from "@/lib/wms-api"
import {
  defaultTorg1Settings,
  type Torg1Settings,
} from "@/lib/wms/torg1"
import { TORG1_EXCEL_VARIABLE_KEYS } from "@/lib/wms/torg1-excel"

function slotFromLabel(label: string): string {
  const raw = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return raw || `tpl-${Date.now().toString(36)}`
}

export function SettingsTorg1Template() {
  const [settings, setSettings] = useState<Torg1Settings>(defaultTorg1Settings())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [templates, setTemplates] = useState<WmsTorg1ExcelTemplateSlot[]>([])
  const [categories, setCategories] = useState<Array<{ code: string; name: string }>>([])
  const [excelBusy, setExcelBusy] = useState(false)
  const [excelMsg, setExcelMsg] = useState<string | null>(null)
  const excelInputRef = useRef<HTMLInputElement>(null)

  const [newLabel, setNewLabel] = useState("")
  const [newDocumentType, setNewDocumentType] = useState("receiving")
  const [newCategoryCode, setNewCategoryCode] = useState<string>("")
  const [uploadTarget, setUploadTarget] = useState<"default" | "new">("default")

  const [refreshMode, setRefreshMode] = useState<Torg1RefreshMode>("template")
  const [refreshBusy, setRefreshBusy] = useState(false)
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null)
  const [varsOpen, setVarsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([
      getTorg1Settings(),
      getTorg1ExcelTemplateMeta(),
      listDirectoryReceivingCategories().catch(() => ({ categories: [] })),
    ])
      .then(([res, excelMeta, cats]) => {
        if (cancelled) return
        setSettings(res.settings)
        setTemplates(excelMeta.templates || [])
        setCategories(
          (cats.categories || [])
            .filter((item) => item.isActive !== false)
            .map((item) => ({ code: item.code, name: item.name }))
        )
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить шаблон")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function patch(p: Partial<WmsTorg1Settings>) {
    setSettings((prev) => ({ ...prev, ...p }))
    setSaved(false)
  }

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await saveTorg1Settings(settings)
      setSettings(res.settings)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  async function onDownloadExcelTemplate(slot = "default", fileName = "TORG-1-shablon.xlsx") {
    setExcelBusy(true)
    setExcelMsg(null)
    setError(null)
    try {
      const kind = await downloadTorg1ExcelTemplateFile(fileName, { slot })
      setExcelMsg(kind === "custom" ? "Шаблон скачан" : "Скачан стартовый шаблон")
      window.setTimeout(() => setExcelMsg(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось скачать Excel-шаблон")
    } finally {
      setExcelBusy(false)
    }
  }

  async function onUploadExcelTemplate(file: File) {
    setExcelBusy(true)
    setExcelMsg(null)
    setError(null)
    try {
      const isNew = uploadTarget === "new"
      const label = isNew
        ? newLabel.trim() || file.name.replace(/\.xlsx$/i, "")
        : "Приёмка — общий"
      const slot = isNew ? slotFromLabel(label) : "default"
      const res = await uploadTorg1ExcelTemplate(file, {
        slot,
        label,
        documentType: isNew ? newDocumentType : "receiving",
        categoryCode: isNew && newCategoryCode ? newCategoryCode : null,
      })
      setTemplates(res.templates || [])
      setExcelMsg(`Загружен: ${res.template.label}`)
      if (isNew) {
        setNewLabel("")
        setNewCategoryCode("")
        setUploadTarget("default")
      }
      window.setTimeout(() => setExcelMsg(null), 4000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить Excel-шаблон")
    } finally {
      setExcelBusy(false)
    }
  }

  async function onDeleteExcelTemplate(slot: string) {
    if (!window.confirm(slot === "default" ? "Удалить общий шаблон приёмки?" : "Удалить этот шаблон?")) {
      return
    }
    setExcelBusy(true)
    setExcelMsg(null)
    setError(null)
    try {
      const res = await deleteTorg1ExcelTemplate(slot)
      setTemplates(res.templates || [])
      setExcelMsg("Шаблон удалён")
      window.setTimeout(() => setExcelMsg(null), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить шаблон")
    } finally {
      setExcelBusy(false)
    }
  }

  async function onRefreshAllDocuments() {
    if (
      !window.confirm(
        refreshMode === "full_reset"
          ? "Сбросить ТОРГ-1 у всех документов приёмки и пересобрать заново?"
          : "Обновить все документы приёмки по текущим настройкам?"
      )
    ) {
      return
    }
    setRefreshBusy(true)
    setRefreshMsg(null)
    setError(null)
    try {
      await saveTorg1Settings(settings)
      const res = await refreshReceivingTorg1Documents({ mode: refreshMode })
      if (res.errors.length > 0) {
        const details = res.errors
          .slice(0, 5)
          .map((item) => `${item.id}: ${item.message}`)
          .join("; ")
        throw new Error(
          `Обновлено ${res.totalUpdated}, не обновлено ${res.errors.length}. ${details}`
        )
      }
      setRefreshMsg(
        `Готово: ${res.totalUpdated} (${res.documentsUpdated} док., ${res.sessionsUpdated} сессий)`
      )
      window.setTimeout(() => setRefreshMsg(null), 8000)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить документы")
    } finally {
      setRefreshBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Шаблоны документов</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Отдельный .xlsx на тип/категорию. В Excel пишите {"{{переменные}}"} — WMS подставит их при скачивании.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div>
      ) : null}

      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Загрузка Excel</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Только настоящий .xlsx (не переименованный .xls). Разметка проверяется в Excel, здесь — список файлов.
            </p>
          </div>
          <FileSpreadsheet className="h-8 w-8 shrink-0 text-muted-foreground/70" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Куда загрузить</Label>
            <Select
              value={uploadTarget}
              onValueChange={(value) => setUploadTarget(value as "default" | "new")}
            >
              <SelectTrigger className="rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Общий шаблон приёмки</SelectItem>
                <SelectItem value="new">Новый шаблон под тип/категорию</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {uploadTarget === "new" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Название</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Например: Материалы"
                className="rounded-xl"
              />
            </div>
          ) : null}
          {uploadTarget === "new" ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Тип документа</Label>
                <Select value={newDocumentType} onValueChange={setNewDocumentType}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="receiving">Приёмка</SelectItem>
                    <SelectItem value="issue">Выдача</SelectItem>
                    <SelectItem value="return">Возврат</SelectItem>
                    <SelectItem value="shipping">Отгрузка</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Категория приёмки (необязательно)</Label>
                <Select
                  value={newCategoryCode || "__none__"}
                  onValueChange={(value) => setNewCategoryCode(value === "__none__" ? "" : value)}
                >
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Все категории" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Все категории</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.code} value={category.code}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={excelBusy}
            onClick={() => void onDownloadExcelTemplate("default", "TORG-1-shablon.xlsx")}
          >
            {excelBusy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Скачать общий / стартовый
          </Button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onUploadExcelTemplate(file)
              e.target.value = ""
            }}
          />
          <Button
            type="button"
            size="sm"
            className="rounded-xl"
            disabled={excelBusy || (uploadTarget === "new" && !newLabel.trim())}
            onClick={() => excelInputRef.current?.click()}
          >
            {uploadTarget === "new" ? (
              <Plus className="mr-1.5 h-4 w-4" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            {uploadTarget === "new" ? "Добавить шаблон" : "Загрузить общий"}
          </Button>
        </div>
        {excelMsg ? <p className="text-xs text-emerald-700">{excelMsg}</p> : null}
      </div>

      <Torg1ExcelTemplatePreview
        templates={templates}
        busy={excelBusy}
        onDownload={(slot, fileName) => void onDownloadExcelTemplate(slot, fileName)}
        onDelete={(slot) => void onDeleteExcelTemplate(slot)}
      />

      <div className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
        <div>
          <h3 className="text-sm font-semibold">Обновить документы приёмки</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Пересобирает данные ТОРГ-1 в WMS. Excel заполняется только при скачивании.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Режим</Label>
            <Select value={refreshMode} onValueChange={(v) => setRefreshMode(v as Torg1RefreshMode)}>
              <SelectTrigger className="w-[min(100%,320px)] rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="template">По шаблону</SelectItem>
                <SelectItem value="full_reset">Полный сброс</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            className="rounded-xl"
            disabled={refreshBusy || saving}
            onClick={() => void onRefreshAllDocuments()}
          >
            {refreshBusy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-4 w-4" />
            )}
            Обновить все приёмки
          </Button>
        </div>
        {refreshMsg ? <p className="text-xs text-emerald-800">{refreshMsg}</p> : null}
      </div>

      <div className="grid gap-4 rounded-2xl border border-border/70 bg-card p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Организация</Label>
          <Input value={settings.orgName} onChange={(e) => patch({ orgName: e.target.value })} placeholder="ООО «…»" />
        </div>
        <div className="space-y-2">
          <Label>Телефон</Label>
          <Input value={settings.orgPhone} onChange={(e) => patch({ orgPhone: e.target.value })} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Адрес</Label>
          <Input value={settings.orgAddress} onChange={(e) => patch({ orgAddress: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>ОКПО</Label>
          <Input value={settings.okpo} onChange={(e) => patch({ okpo: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>ОКДП</Label>
          <Input value={settings.okdp} onChange={(e) => patch({ okdp: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Утверждаю — должность</Label>
          <Input value={settings.approveTitle} onChange={(e) => patch({ approveTitle: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Утверждаю — ФИО</Label>
          <Input value={settings.approveName} onChange={(e) => patch({ approveName: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Button type="button" className="rounded-xl" onClick={() => void onSave()} disabled={saving}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            {saved ? "Сохранено" : "Сохранить постоянные данные"}
          </Button>
        </div>
      </div>

      <div>
        <button
          type="button"
          className="mb-2 text-sm font-semibold underline-offset-2 hover:underline"
          onClick={() => setVarsOpen((value) => !value)}
        >
          {varsOpen ? "Скрыть переменные Excel" : "Показать переменные Excel"}
        </button>
        {varsOpen ? (
          <ul className="grid max-h-56 gap-1 overflow-y-auto text-xs text-muted-foreground sm:grid-cols-2">
            {TORG1_EXCEL_VARIABLE_KEYS.map((v) => (
              <li key={v.key} className="rounded-lg border border-border/60 bg-muted/20 px-2 py-1.5">
                <span className="font-mono text-foreground">{`{{${v.key}}}`}</span> — {v.hint}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
