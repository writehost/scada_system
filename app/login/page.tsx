"use client"

import { FormEvent, Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Fingerprint, Loader2, Lock, ShieldCheck, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { LoginGsmtFab } from "@/components/login-gsmt-fab"
import { getAccessToken, setAccessToken } from "@/lib/auth/client-token"
import { syncWmsAccessHint } from "@/lib/auth/sync-hint"

function LoginForm() {
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || "/"
  const urlError = searchParams.get("error")

  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(urlError)
  const [loading, setLoading] = useState(false)
  const [scadaLoading, setScadaLoading] = useState(false)
  const [scadaAvailable, setScadaAvailable] = useState(false)

  useEffect(() => {
    syncWmsAccessHint()
    const token = getAccessToken()
    if (!token) return
    fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((r) => {
        if (r.ok) window.location.assign(callbackUrl.startsWith("/") ? callbackUrl : "/")
      })
      .catch(() => undefined)
  }, [callbackUrl])

  useEffect(() => {
    fetch("/api/auth/scada-id/status", { cache: "no-store", credentials: "same-origin" })
      .then((r) => r.json())
      .then((data: { loginAvailable?: boolean }) => setScadaAvailable(Boolean(data.loginAvailable)))
      .catch(() => setScadaAvailable(false))
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ login: login.trim(), password }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        accessToken?: string
      }
      if (!res.ok || !data.accessToken) {
        setError(data.error || "Не удалось войти")
        setLoading(false)
        return
      }
      setAccessToken(data.accessToken)
      window.location.assign(callbackUrl.startsWith("/") ? callbackUrl : "/")
    } catch {
      setError("Ошибка сети. Проверьте подключение.")
      setLoading(false)
    }
  }

  function startScadaId() {
    setScadaLoading(true)
    const next = callbackUrl.startsWith("/") ? callbackUrl : "/"
    const q = new URLSearchParams({ callbackUrl: next })
    const hint = login.trim()
    if (hint) q.set("loginHint", hint)
    window.location.assign(`/api/auth/scada-id/start?${q.toString()}`)
  }

  return (
    <Card className="border-border/60 shadow-lg">
      <CardHeader>
        <CardTitle>Авторизация</CardTitle>
        <CardDescription>Введите логин и пароль оператора</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login">Логин</Label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login"
                autoComplete="username"
                className="pl-9"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                className="pl-9"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Вход…
              </>
            ) : (
              "Войти"
            )}
          </Button>
        </form>

        {scadaAvailable ? (
          <>
            <div className="relative py-1 text-center text-xs uppercase tracking-wide text-muted-foreground">
              <span className="bg-card px-2">или Scada ID</span>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={startScadaId} disabled={scadaLoading || loading}>
              {scadaLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="mr-2 h-4 w-4" />
              )}
              Войти через Scada ID
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={startScadaId}
              disabled={scadaLoading || loading}
            >
              {scadaLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Fingerprint className="mr-2 h-4 w-4" />
              )}
              Passkey или Windows Hello
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <LoginGsmtFab />
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            SCADA SYSTEM
          </p>
          <h1 className="mt-2 text-3xl font-bold text-foreground">WMS</h1>
          <p className="mt-2 text-sm text-muted-foreground">Вход в систему управления складом</p>
        </div>

        <Suspense fallback={<div className="h-64 rounded-xl bg-muted/40" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  )
}
