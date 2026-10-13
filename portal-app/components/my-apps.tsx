"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { ProductKey } from "@/lib/products"
import { ProductIcon } from "./brand"

export type MyAppView = {
  key: ProductKey
  name: string
  color: string
  onColor: string
  role: string
  url: string | null
  organization: string | null
}

type MyRequest = {
  publicNo: string
  createdAt: string
  status: string
  statusLabel: string
  requestedModules: string[]
}

const ROLE: Record<string, string> = {
  god: "Владелец",
  admin: "Администратор",
  operator: "Оператор",
  viewer: "Просмотр",
}

export function MyApps({
  apps,
  firstName,
  organization,
  productNames,
}: {
  apps: MyAppView[]
  firstName: string
  organization: string | null
  productNames: Record<string, string>
}) {
  const [reqs, setReqs] = useState<MyRequest[] | null>(null)
  const [reqError, setReqError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch("/api/requests/mine", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(body.error || "Не удалось загрузить заявки")
        if (alive) setReqs(body.items || [])
      })
      .catch((e: Error) => alive && setReqError(e.message))
    return () => {
      alive = false
    }
  }, [])

  return (
    <section id="my-apps" aria-labelledby="my-apps-title" className="relative z-10 mx-auto -mt-10 max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="card p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="eyebrow text-brand-600">Личный кабинет</p>
            <h2 id="my-apps-title" className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
              Мои приложения
            </h2>
            <p className="mt-1 text-sm text-slate-text">
              {firstName ? `${firstName}, здесь` : "Здесь"} только продукты, доступ к которым выдан в SCADA ID
              {organization ? ` для организации «${organization}»` : ""}.
            </p>
          </div>
          <Link href="/request" className="btn btn-secondary btn-sm self-start sm:self-auto">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Запросить ещё модули
          </Link>
        </div>

        {apps.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-line bg-frost p-8 text-center">
            <p className="font-semibold">Подключённых приложений пока нет</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-text">
              Отправьте заявку — после одобрения доступ появится здесь. Если доступ уже выдан, выйдите и войдите снова, чтобы обновить права.
            </p>
            <Link href="/request" className="btn btn-primary btn-sm mt-5">Запросить подключение</Link>
          </div>
        ) : (
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((a) => (
              <li key={a.key} className="flex items-center gap-4 rounded-2xl border border-line p-4 transition-colors hover:border-brand-200 hover:bg-frost/60">
                <ProductIcon k={a.key} color={a.color} onColor={a.onColor} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold">{a.name}</div>
                  <div className="truncate text-xs text-muted">
                    {[a.organization, ROLE[a.role] || a.role].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm" aria-label={`Открыть ${a.name}`}>
                    Открыть
                  </a>
                ) : (
                  <span className="text-right text-xs text-muted">В сети предприятия</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 border-t border-line pt-6">
          <h3 className="text-sm font-bold">Мои заявки</h3>
          {reqError ? (
            <p role="alert" className="mt-3 text-sm text-danger">{reqError}</p>
          ) : reqs === null ? (
            <div className="mt-3 space-y-2" aria-busy="true" aria-label="Загрузка заявок">
              <div className="skeleton h-10" />
              <div className="skeleton h-10" />
            </div>
          ) : reqs.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Заявок с вашего email пока нет.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {reqs.map((r) => (
                <li key={r.publicNo} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                  <span className="font-mono font-semibold">{r.publicNo}</span>
                  <span className="text-muted">{new Date(r.createdAt).toLocaleDateString("ru-RU")}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-text">
                    {r.requestedModules.map((m) => productNames[m] || m).join(", ")}
                  </span>
                  <span className="chip bg-frost-2 text-ink">{r.statusLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
