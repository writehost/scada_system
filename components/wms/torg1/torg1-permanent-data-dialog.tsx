"use client"

import { useEffect, useState } from "react"
import { Building2, Loader2, Save } from "lucide-react"
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
import { getTorg1Settings, saveTorg1Settings, type WmsTorg1Settings } from "@/lib/wms-api"
import { defaultTorg1Settings, type Torg1Settings } from "@/lib/wms/torg1"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => void
}

export function Torg1PermanentDataDialog({ open, onOpenChange, onSaved }: Props) {
  const [settings, setSettings] = useState<Torg1Settings>(defaultTorg1Settings())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void getTorg1Settings()
      .then((res) => {
        if (!cancelled) setSettings(res.settings)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  function patch(p: Partial<WmsTorg1Settings>) {
    setSettings((prev) => ({ ...prev, ...p }))
  }

  async function onSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await saveTorg1Settings(settings)
      setSettings(res.settings)
      onSaved?.()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Постоянные данные ТОРГ-1
          </DialogTitle>
          <DialogDescription>
            Реквизиты организации и блок «Утверждаю». Подставляются во все акты приёмки. Поля по конкретному
            документу (номер, дата, поставщик, позиции) правятся на бланке после «Разблокировать».
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Организация</Label>
              <Input value={settings.orgName} onChange={(e) => patch({ orgName: e.target.value })} placeholder="ООО «…»" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Адрес</Label>
              <Input value={settings.orgAddress} onChange={(e) => patch({ orgAddress: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input value={settings.orgPhone} onChange={(e) => patch({ orgPhone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>ОКПО</Label>
              <Input value={settings.okpo} onChange={(e) => patch({ okpo: e.target.value })} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>ОКДП</Label>
              <Input value={settings.okdp} onChange={(e) => patch({ okdp: e.target.value })} className="font-mono" />
            </div>
            <div className="space-y-1.5">
              <Label>Утверждаю — должность</Label>
              <Input value={settings.approveTitle} onChange={(e) => patch({ approveTitle: e.target.value })} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Утверждаю — ФИО</Label>
              <Input value={settings.approveName} onChange={(e) => patch({ approveName: e.target.value })} />
            </div>
          </div>
        )}

        {error ? <div className="text-sm text-destructive">{error}</div> : null}

        <DialogFooter>
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button type="button" className="rounded-xl" onClick={() => void onSave()} disabled={saving || loading}>
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Сохранить постоянные
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
