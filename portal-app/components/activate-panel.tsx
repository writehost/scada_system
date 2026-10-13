"use client"

import Link from "next/link"
import { useState } from "react"

type Outcome = { app: string; state: string; detail: string }

export function ActivatePanel({ token }: { token: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ status: string; grants: Outcome[]; alreadyActive: boolean } | null>(null)

  async function activate() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Ошибка ${res.status}`)
      setResult(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Нет связи с сервером. Попробуйте ещё раз.")
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    const done = result.status === "access_granted"
    return (
      <div aria-live="polite" data-testid="activation-result" data-status={result.status}>
        <h2 className="text-xl font-extrabold">{done ? "Доступ активирован" : "Приглашение принято"}</h2>
        <p className="mt-2 text-slate-text">
          {done
            ? "Права выданы в SCADA ID. Обновите сессию, чтобы приложения появились в разделе «Мои приложения»."
            : "Часть доступа администратор выдаст вручную — мы уже сообщили ему. Как только права появятся, войдите снова."}
        </p>
        {result.grants.length > 0 && (
          <ul className="mt-4 space-y-1.5 text-sm">
            {result.grants.map((g) => (
              <li key={g.app} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${g.state === "provisioned" ? "bg-ok" : "bg-warn"}`} aria-hidden="true" />
                <span className="font-mono">{g.app}</span>
                <span className="text-muted">— {g.state === "provisioned" ? "выдан" : "выдаст администратор"}</span>
              </li>
            ))}
          </ul>
        )}
        <a href="/api/auth/login?next=%2F%23my-apps" className="btn btn-primary mt-6" data-testid="refresh-session">
          Открыть мои приложения
        </a>
      </div>
    )
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" onClick={() => void activate()} disabled={busy} data-testid="activate">
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        Активировать доступ
      </button>
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-[#fdecea] px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">
        Доступ выдаётся только к одобренным продуктам и выбранной организации. <Link href="/#faq" className="underline">Как это работает</Link>
      </p>
    </div>
  )
}
