"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, KeyRound, Loader2, Plus, Trash2 } from "lucide-react"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type TokenRow = {
  tokenId: string
  name: string
  tokenPrefix: string
  createdAt: string
  lastUsedAt: string | null
}

function formatWhen(value: string | null | undefined) {
  if (!value) return "ещё не использовался"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function SettingsApiTokensPanel() {
  const [tokens, setTokens] = useState<TokenRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState("Интеграция")
  const [creating, setCreating] = useState(false)
  const [freshToken, setFreshToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/api-tokens", {
        cache: "no-store",
        credentials: "same-origin",
        headers: authRequestHeaders(),
      })
      const data = (await res.json().catch(() => ({}))) as { tokens?: TokenRow[]; error?: string }
      if (!res.ok) {
        setError(data.error || "Не удалось загрузить токены")
        return
      }
      setTokens(data.tokens || [])
    } catch {
      setError("Ошибка сети")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function createToken() {
    setCreating(true)
    setError(null)
    setFreshToken(null)
    setCopied(false)
    try {
      const res = await fetch("/api/auth/api-tokens", {
        method: "POST",
        credentials: "same-origin",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name }),
      })
      const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string }
      if (!res.ok || !data.token) {
        setError(data.error || "Не удалось выпустить токен")
        return
      }
      setFreshToken(data.token)
      setName("Интеграция")
      await load()
    } catch {
      setError("Ошибка сети")
    } finally {
      setCreating(false)
    }
  }

  async function copyToken() {
    if (!freshToken) return
    try {
      await navigator.clipboard.writeText(freshToken)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function revoke(tokenId: string) {
    if (!window.confirm("Отозвать этот токен? Интеграции с ним сразу получат 401.")) return
    setRevokingId(tokenId)
    setError(null)
    try {
      const res = await fetch(`/api/auth/api-tokens/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: authRequestHeaders(),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error || "Не удалось отозвать токен")
        return
      }
      if (freshToken) setFreshToken(null)
      await load()
    } catch {
      setError("Ошибка сети")
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">Токены API</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Для внешних вызовов используйте{" "}
          <span className="font-mono text-xs">Authorization: Bearer wmsu_…</span>. Токен показывается один раз.
          Вход на сайт по-прежнему идёт через логин и cookie, не через этот ключ.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {freshToken ? (
        <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <div className="text-sm font-medium text-foreground">Новый токен — скопируйте сейчас</div>
          <p className="mt-1 text-xs text-muted-foreground">Повторно открыть его нельзя. Храните как пароль.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={freshToken} className="rounded-xl font-mono text-xs" />
            <Button type="button" variant="outline" className="rounded-xl shrink-0" onClick={() => void copyToken()}>
              <Copy className="mr-2 h-4 w-4" />
              {copied ? "Скопировано" : "Копировать"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя, например «1С» или «Postman»"
          className="rounded-xl"
          maxLength={80}
        />
        <Button type="button" className="rounded-xl shrink-0" onClick={() => void createToken()} disabled={creating}>
          {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Выпустить токен
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Загрузка токенов…
        </div>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Активных токенов нет. Выпустите ключ, если нужен доступ к API снаружи.</p>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border">
          {tokens.map((token) => (
            <div key={token.tokenId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-foreground">{token.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {token.tokenPrefix}… · создан {formatWhen(token.createdAt)} · {formatWhen(token.lastUsedAt)}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-xl text-destructive"
                disabled={revokingId === token.tokenId}
                onClick={() => void revoke(token.tokenId)}
              >
                {revokingId === token.tokenId ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Отозвать
              </Button>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Анонимные запросы к /api/wms больше не принимаются. ТСД по-прежнему ходят со своим устройством из раздела
        «Терминалы».
      </p>
    </div>
  )
}
