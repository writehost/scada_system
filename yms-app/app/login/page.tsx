"use client"

import { useState } from "react"

export default function LoginPage() {
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  return (
    <main className="yms-login">
      <section className="yms-card">
        <p className="yms-kicker">SCADA SYSTEM</p>
        <h1>YMS</h1>
        <p>Территория, КПП и доки. Вход тем же логином, что и в WMS.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            setBusy(true)
            setError("")
            void fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ login, password }),
            })
              .then(async (res) => {
                const data = (await res.json().catch(() => ({}))) as { error?: string }
                if (!res.ok) throw new Error(data.error || "Не удалось войти")
                window.location.href = "/"
              })
              .catch((e: Error) => setError(e.message))
              .finally(() => setBusy(false))
          }}
        >
          <input className="yms-input" value={login} onChange={(e) => setLogin(e.target.value)} placeholder="Логин" aria-label="Логин" autoComplete="username" required />
          <input className="yms-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" aria-label="Пароль" autoComplete="current-password" required />
          {error && <p className="yms-error">{error}</p>}
          <button className="yms-btn" type="submit" disabled={busy}>
            {busy ? "Вход…" : "Войти"}
          </button>
        </form>
      </section>
    </main>
  )
}
