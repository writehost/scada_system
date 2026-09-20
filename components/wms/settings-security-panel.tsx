"use client"

import { useEffect, useState } from "react"
import { ExternalLink, Loader2, RefreshCw, Save, ShieldCheck } from "lucide-react"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { getSiteCode } from "@/lib/wms-api"

type Settings = {
  enabled: boolean
  issuer: string
  apiUrl: string
  clientId: string
  clientSecret: string
  redirectUri: string
  updatedAt: string | null
  updatedBy: string | null
  hasClientSecret: boolean
  loginAvailable: boolean
}

const EMPTY: Settings = {
  enabled: true,
  issuer: "https://id.scada25.ru/realms/scada-system-id",
  apiUrl: "https://id.scada25.ru",
  clientId: "wms",
  clientSecret: "",
  redirectUri: "https://wms.scada25.ru/api/auth/scada-id/callback",
  updatedAt: null,
  updatedBy: null,
  hasClientSecret: false,
  loginAvailable: false,
}

export function SettingsSecurityPanel({ isAdmin }: { isAdmin: boolean }) {
  const [settings, setSettings] = useState<Settings>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/settings/scada-id?siteCode=${encodeURIComponent(getSiteCode())}`, {
        headers: authRequestHeaders(),
        cache: "no-store",
        credentials: "same-origin",
      })
      const data = (await res.json().catch(() => ({}))) as { settings?: Settings; error?: string }
      if (!res.ok) {
        setError(data.error || "Не удалось загрузить настройки безопасности")
        return
      }
      if (data.settings) setSettings(data.settings)
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(null)
    try {
      const res = await fetch("/api/settings/scada-id", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({
          siteCode: getSiteCode(),
          enabled: settings.enabled,
          issuer: settings.issuer,
          apiUrl: settings.apiUrl,
          clientId: settings.clientId,
          clientSecret: settings.clientSecret,
          redirectUri: settings.redirectUri,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { settings?: Settings; error?: string }
      if (!res.ok) {
        setError(data.error || "Не удалось сохранить")
        return
      }
      if (data.settings) setSettings(data.settings)
      setSaved("Настройки Scada ID сохранены")
    } catch {
      setError("Ошибка сети")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Безопасность</h2>
            <p className="mt-1 text-sm text-muted-foreground">Вход и права через Scada ID.</p>
          </div>
          <Button variant="outline" className="rounded-xl" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={loading ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
            Обновить
          </Button>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {saved ? <div className="mb-4 text-sm text-success">{saved}</div> : null}

        {loading ? (
          <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Загрузка…
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-secondary/20 p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 text-primary" />
                <div>
                  <div className="font-medium text-foreground">Вход через Scada ID</div>
                  <div className="text-sm text-muted-foreground">
                    {settings.loginAvailable
                      ? "Интеграция включена — на входе WMS есть Scada ID и passkey. Сам ключ добавляется не здесь, а в Scada ID → Портал → Security."
                      : "Нужны issuer, client id и секрет клиента Keycloak."}
                  </div>
                </div>
              </div>
              <Switch
                checked={settings.enabled}
                disabled={!isAdmin}
                onCheckedChange={(enabled) => setSettings((p) => ({ ...p, enabled }))}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Issuer</label>
                <Input
                  value={settings.issuer}
                  disabled={!isAdmin}
                  onChange={(e) => setSettings((p) => ({ ...p, issuer: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">API Scada ID</label>
                <Input
                  value={settings.apiUrl}
                  disabled={!isAdmin}
                  onChange={(e) => setSettings((p) => ({ ...p, apiUrl: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Client ID</label>
                <Input
                  value={settings.clientId}
                  disabled={!isAdmin}
                  onChange={(e) => setSettings((p) => ({ ...p, clientId: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Client secret</label>
                <Input
                  type="password"
                  value={settings.clientSecret}
                  disabled={!isAdmin}
                  placeholder={settings.hasClientSecret ? "••••••••" : "секрет клиента wms"}
                  onChange={(e) => setSettings((p) => ({ ...p, clientSecret: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-medium">Redirect URI</label>
                <Input
                  value={settings.redirectUri}
                  disabled={!isAdmin}
                  onChange={(e) => setSettings((p) => ({ ...p, redirectUri: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-4 text-sm">
              <div className="font-medium text-foreground">Где что настраивается</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>
                  Passkey / пароль аккаунта —{" "}
                  <a
                    href="https://id.scada25.ru/portal/security"
                    className="text-primary underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    id.scada25.ru/portal/security
                  </a>
                </li>
                <li>
                  Кому можно в WMS —{" "}
                  <a
                    href="https://id.scada25.ru/admin"
                    className="text-primary underline-offset-2 hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Scada ID → Админ → Права доступа
                  </a>
                </li>
                <li>Issuer, client id и секрет — эта страница WMS (подключение к ID).</li>
              </ul>
            </div>

            {isAdmin ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => window.open("https://id.scada25.ru/portal/security", "_blank", "noopener")}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Passkey в Scada ID
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => window.open("https://id.scada25.ru/admin", "_blank", "noopener")}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Права в Scada ID
                </Button>
                <Button className="rounded-xl" onClick={() => void save()} disabled={saving}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Сохранить
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Изменять интеграцию может только администратор WMS.</p>
            )}

            {settings.updatedAt ? (
              <p className="text-xs text-muted-foreground">
                Обновлено {new Date(settings.updatedAt).toLocaleString("ru-RU")}
                {settings.updatedBy ? ` · ${settings.updatedBy}` : ""}
              </p>
            ) : null}
          </div>
        )}
      </div>

    </div>
  )
}
