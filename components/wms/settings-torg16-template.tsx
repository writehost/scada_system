"use client"

import { useEffect, useRef, useState } from "react"
import { Download, FileText, Loader2, Save, Trash2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  deleteTorg16Template,
  downloadTorg16TemplateFile,
  getTorg16Settings,
  getTorg16TemplateMeta,
  saveTorg16Settings,
  uploadTorg16Template,
  type WmsTorg16Settings,
  type WmsTorg16TemplateMeta,
} from "@/lib/wms-api"
import { TORG16_VARIABLE_KEYS } from "@/lib/wms/torg16"

export function SettingsTorg16Template() {
  const [settings, setSettings] = useState<WmsTorg16Settings | null>(null)
  const [template, setTemplate] = useState<WmsTorg16TemplateMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [varsOpen, setVarsOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void Promise.all([getTorg16Settings(), getTorg16TemplateMeta()])
      .then(([res, meta]) => {
        if (cancelled) return
        setSettings(res.settings)
        setTemplate(meta.template)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить ТОРГ-16")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function patch(p: Partial<WmsTorg16Settings>) {
    setSettings((prev) => (prev ? { ...prev, ...p } : prev))
    setSaved(false)
  }

  async function onSave() {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveTorg16Settings(settings)
      setSettings(res.settings)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  async function onUpload(file: File) {
    setBusy(true)
    setError(null)
    try {
      const res = await uploadTorg16Template(file)
      setTemplate(res.template)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить шаблон")
    } finally {
      setBusy(false)
    }
  }

  async function onDelete() {
    if (!window.confirm("Удалить загруженный шаблон ТОРГ-16?")) return
    setBusy(true)
    setError(null)
    try {
      await deleteTorg16Template()
      setTemplate(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось удалить шаблон")
    } finally {
      setBusy(false)
    }
  }

  if (loading || !settings) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загрузка ТОРГ-16…
      </div>
    )
  }

  const fields: Array<{ key: keyof WmsTorg16Settings; label: string }> = [
    { key: "orgName", label: "Организация" },
    { key: "orgAddress", label: "Адрес" },
    { key: "orgPhone", label: "Телефон" },
    { key: "okpo", label: "ОКПО" },
    { key: "okdp", label: "ОКДП" },
    { key: "approveTitle", label: "Утверждаю — должность" },
    { key: "approveName", label: "Утверждаю — ФИО" },
    { key: "materiallyResponsible", label: "МОЛ" },
    { key: "commissionChair", label: "Председатель комиссии" },
    { key: "commissionMember1", label: "Член комиссии 1" },
    { key: "commissionMember2", label: "Член комиссии 2" },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold">Акт списания ТОРГ-16</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          В образец ТОРГ-16 поставьте переменные вида {"{{reasonName}}"} и загрузите файл как{" "}
          <span className="font-medium">.docx</span> или <span className="font-medium">.xlsx</span>. Старый .doc
          сначала сохраните в Word как Документ Word.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label className="text-xs">{field.label}</Label>
            <Input
              value={String(settings[field.key] ?? "")}
              onChange={(e) => patch({ [field.key]: e.target.value })}
              className="rounded-xl"
            />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="rounded-xl" disabled={saving} onClick={() => void onSave()}>
          {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
          {saved ? "Сохранено" : "Сохранить реквизиты"}
        </Button>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/70 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">Шаблон бланка</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {template
                ? `${template.originalName} · ${(template.bytes / 1024).toFixed(1)} КБ · ${template.kind}`
                : "Своего файла нет — скачается стартовый Excel со списком переменных."}
            </p>
          </div>
          <FileText className="h-7 w-7 shrink-0 text-muted-foreground/70" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="rounded-xl"
            disabled={busy}
            onClick={() => void downloadTorg16TemplateFile(template?.originalName || "TORG-16-shablon.xlsx")}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Скачать шаблон
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.xlsx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void onUpload(file)
              e.target.value = ""
            }}
          />
          <Button
            type="button"
            size="sm"
            className="rounded-xl"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            Загрузить .docx / .xlsx
          </Button>
          {template ? (
            <Button type="button" size="sm" variant="ghost" className="rounded-xl text-destructive" onClick={() => void onDelete()}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Удалить
            </Button>
          ) : null}
        </div>
      </div>

      <div>
        <Button type="button" variant="ghost" size="sm" className="h-auto px-0 text-xs" onClick={() => setVarsOpen((v) => !v)}>
          {varsOpen ? "Скрыть переменные" : "Показать переменные для шаблона"}
        </Button>
        {varsOpen ? (
          <div className="mt-2 max-h-64 overflow-auto rounded-xl border border-border/70 text-xs">
            <table className="w-full">
              <tbody>
                {TORG16_VARIABLE_KEYS.map((item) => (
                  <tr key={item.key} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-1.5 font-mono">{`{{${item.key}}}`}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{item.hint}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  )
}
