"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Fingerprint, Zap } from "lucide-react"
import { api } from "@/lib/client/api"
import { Button, Field, Input, Notice, Segmented } from "@/components/ui"

function LoginInner() {
  const params = useSearchParams()
  const error = params.get("error")
  const next = params.get("next") || "/"
  const [status, setStatus] = useState<{ scadaId: boolean; devLogin: boolean } | null>(null)
  useEffect(() => {
    api<{ scadaId: boolean; devLogin: boolean }>("/api/auth/status").then(setStatus).catch(() => setStatus({ scadaId: false, devLogin: false }))
  }, [])
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Zap className="size-5" />
          </span>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">SCADA SYSTEM</p>
            <h1 className="text-xl font-semibold leading-tight">EMS</h1>
          </div>
        </div>
        <p className="mb-5 text-[13px] text-muted-foreground">Учёт электроэнергии, воды и коммунальных платежей — для дома и производства. Вход единой учётной записью SCADA ID.</p>
        {error ? (
          <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/[0.05] px-3 py-2 text-[13px] text-destructive">
            {error}
          </div>
        ) : null}
        <a
          href={`/api/auth/scada-id/start?next=${encodeURIComponent(next)}`}
          aria-disabled={status ? !status.scadaId : true}
          className={`flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90 ${status && !status.scadaId ? "pointer-events-none opacity-50" : ""}`}
        >
          <Fingerprint className="size-4" /> Войти через SCADA ID
        </a>
        {status && !status.scadaId ? <p className="mt-2 text-xs text-muted-foreground">Вход через SCADA ID не настроен на этом сервере (SCADA_ID_CLIENT_SECRET).</p> : null}
        {status?.devLogin ? <DevLogin next={next} /> : null}
      </section>
    </main>
  )
}

function DevLogin({ next }: { next: string }) {
  const [email, setEmail] = useState("dev@example.test")
  const [segment, setSegment] = useState<"home" | "industrial">("home")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  return (
    <form
      className="mt-6 space-y-3 border-t border-dashed border-border pt-4"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        setErr(null)
        try {
          await api("/api/auth/dev-login", { body: { email, name: email.split("@")[0], segment } })
          window.location.href = next
        } catch (x) {
          setErr((x as Error).message)
          setBusy(false)
        }
      }}
    >
      <Notice tone="warning">Режим разработчика (EMS_DEV_LOGIN=1). В эксплуатации отключён.</Notice>
      <Field label="Email" htmlFor="dev-email">
        <Input id="dev-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Segmented value={segment} onChange={setSegment} options={[{ value: "home", label: "Home" }, { value: "industrial", label: "Industrial" }]} ariaLabel="Тип аккаунта" />
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
      <Button type="submit" variant="outline" className="w-full" loading={busy}>
        Войти без SCADA ID
      </Button>
    </form>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
