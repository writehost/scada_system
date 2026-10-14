"use client"

import { Fingerprint } from "lucide-react"
import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button, ErrorLine, Input } from "@/components/ui"

function LoginForm() {
  const params = useSearchParams()
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState(params.get("error") || "")
  const [busy, setBusy] = useState(false)
  const [scadaId, setScadaId] = useState(false)
  const next = params.get("next") || "/"
  useEffect(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d) => setScadaId(Boolean(d.scadaId)))
      .catch(() => setScadaId(false))
  }, [])
  return (
    <main className="grid min-h-full place-items-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10" />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">SCADA System</p>
            <h1 className="text-xl font-bold">Документооборот</h1>
          </div>
        </div>
        {scadaId && (
          <>
            <Button variant="primary" className="h-10 w-full" icon={<Fingerprint className="size-4" />} onClick={() => (window.location.href = `/api/auth/scada-id/start?next=${encodeURIComponent(next)}`)}>
              Войти через SCADA ID
            </Button>
            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              или учётной записью WMS
              <span className="h-px flex-1 bg-border" />
            </div>
          </>
        )}
        <form
          className="space-y-2.5"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            setError("")
            try {
              const res = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, password }) })
              const data = await res.json().catch(() => ({}))
              if (!res.ok) throw new Error(data.error || "Не удалось войти")
              window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/"
            } catch (err) {
              setError((err as Error).message)
              setBusy(false)
            }
          }}
        >
          <Input className="h-10" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Логин" aria-label="Логин" autoComplete="username" required autoFocus={!scadaId} />
          <Input className="h-10" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" aria-label="Пароль" autoComplete="current-password" required />
          <ErrorLine error={error} />
          <Button type="submit" variant={scadaId ? "outline" : "primary"} className="h-10 w-full" busy={busy}>
            Войти
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">Учётные записи и организации общие для экосистемы SCADA System — отдельной регистрации в EDI нет.</p>
      </section>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
