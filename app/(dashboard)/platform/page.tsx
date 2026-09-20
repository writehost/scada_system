"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"

type Tenant = {
  siteId: number
  siteCode: string
  name: string
  isActive: boolean
  licenseType: string
  licenseExpiresAt: string | null
  planCode: string
  features: Record<string, boolean>
  maxUsers: number | null
}

const FEATURE_LABELS: Record<string, string> = {
  fg_plan: "План ГП",
  fg_fleet: "Флот",
  fg_stock: "Склад ГП",
  materials: "Материалы",
  workshop: "Цех",
  virtual_warehouse: "Вирт. склад",
  production: "Производство",
  marking: "Маркировка",
  multi_warehouse: "Неск. складов",
  analytics: "Аналитика",
  occupancy: "Заполненность",
}

export default function PlatformAdminPage() {
  const { toast } = useToast()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [features, setFeatures] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState("")
  const [name, setName] = useState("")
  const [plan, setPlan] = useState("standard")
  const [license, setLicense] = useState("trial")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/wms/platform/tenants", { credentials: "include" })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setTenants(data.tenants || [])
      setFeatures(data.features || [])
    } catch (e) {
      toast({
        title: "Платформа",
        description: e instanceof Error ? e.message : "ошибка",
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  async function createTenant() {
    try {
      const r = await fetch("/api/wms/platform/tenants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteCode: code,
          name,
          planCode: plan,
          licenseType: license,
          licenseExpiresAt:
            license === "trial"
              ? new Date(Date.now() + 30 * 864e5).toISOString()
              : license === "subscription"
                ? new Date(Date.now() + 365 * 864e5).toISOString()
                : null,
        }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      toast({ title: "Организация создана", description: data.tenant?.siteCode })
      setCode("")
      setName("")
      await load()
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "",
        variant: "destructive",
      })
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4">
      <div>
        <h1 className="text-lg font-semibold">Платформа · организации</h1>
        <p className="text-xs text-muted-foreground">
          SaaS-тенанты (wms_sites). Скит — enterprise / бессрочная. Новым org можно отключить план ГП и
          флот.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Новая организация</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Input className="h-9 text-sm" placeholder="код (site_code)" value={code} onChange={(e) => setCode(e.target.value)} />
          <Input className="h-9 text-sm" placeholder="название" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="lite">Lite</option>
            <option value="standard">Standard</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <select className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={license} onChange={(e) => setLicense(e.target.value)}>
            <option value="trial">Trial 30д</option>
            <option value="subscription">Подписка 1г</option>
            <option value="perpetual">Бессрочная</option>
          </select>
        </div>
        <Button className="mt-3" size="sm" onClick={() => void createTenant()}>
          Создать
        </Button>
      </div>

      <div className="overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-2">Код</th>
              <th className="p-2">Название</th>
              <th className="p-2">План</th>
              <th className="p-2">Лицензия</th>
              <th className="p-2">Модули</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-6 text-center text-muted-foreground">
                  …
                </td>
              </tr>
            ) : (
              tenants.map((t) => (
                <tr key={t.siteId} className="border-t border-border">
                  <td className="p-2 font-mono text-xs">{t.siteCode}</td>
                  <td className="p-2">{t.name}</td>
                  <td className="p-2">{t.planCode}</td>
                  <td className="p-2 text-xs">
                    {t.licenseType}
                    {!t.isActive ? " · выкл" : ""}
                    {t.licenseExpiresAt ? (
                      <div className="text-muted-foreground">до {new Date(t.licenseExpiresAt).toLocaleDateString("ru-RU")}</div>
                    ) : null}
                  </td>
                  <td className="p-2">
                    <div className="flex max-w-md flex-wrap gap-1">
                      {(features.length ? features : Object.keys(FEATURE_LABELS)).map((f) => {
                        const on = Boolean(t.features?.[f])
                        return (
                          <span
                            key={f}
                            className={
                              "rounded px-1.5 py-0.5 text-[10px] " +
                              (on ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground line-through")
                            }
                            title={f}
                          >
                            {FEATURE_LABELS[f] || f}
                          </span>
                        )
                      })}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
