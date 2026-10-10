"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, MailCheck } from "lucide-react"
import { api } from "@/lib/client/api"
import { Button } from "@/components/ui"

function VerifyInner() {
  const token = useSearchParams().get("token") ?? ""
  const [state, setState] = useState<{ ok?: boolean; email?: string; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        {state?.ok ? (
          <>
            <CheckCircle2 className="mx-auto mb-3 size-10 text-emerald-600" />
            <h1 className="text-lg font-semibold">Адрес подтверждён</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Уведомления SCADA EMS будут приходить на {state.email}. Отписаться или поставить паузу можно в настройках уведомлений.</p>
          </>
        ) : (
          <>
            <MailCheck className="mx-auto mb-3 size-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Подтверждение адреса</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">Нажмите кнопку, чтобы получать уведомления SCADA EMS на этот адрес.</p>
            {state?.error ? <p className="mt-3 text-[13px] text-destructive">{state.error}</p> : null}
            <Button
              className="mt-4 w-full"
              loading={busy}
              disabled={!token}
              onClick={async () => {
                setBusy(true)
                try {
                  setState(await api<{ ok: boolean; email: string }>("/api/email/verify", { body: { token } }))
                } catch (e) {
                  setState({ error: (e as Error).message })
                } finally {
                  setBusy(false)
                }
              }}
            >
              Подтвердить
            </Button>
          </>
        )}
      </section>
    </main>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyInner />
    </Suspense>
  )
}
