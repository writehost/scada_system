"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { REQUEST_STATUSES, REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/request-status"
import { api, fmtDate, ModuleChips, RequestStatusBadge, type AdminProduct } from "./ui"

type Row = {
  id: number
  publicNo: string
  createdAt: string
  firstName: string
  lastName: string
  email: string
  company: string
  requestedModules: string[]
  approvedModules: string[]
  status: RequestStatus
  assigneeName: string | null
}

export function RequestsTable({ products }: { products: AdminProduct[] }) {
  const router = useRouter()
  const [status, setStatus] = useState<RequestStatus | "">("")
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [mine, setMine] = useState(false)
  const [data, setData] = useState<{ items: Row[]; counts: Record<string, number> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (status) qs.set("status", status)
      if (query) qs.set("q", query)
      if (mine) qs.set("mine", "1")
      setData(await api(`/api/admin/requests?${qs}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [status, query, mine])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const total = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0

  return (
    <div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow text-brand-600">Администрирование экосистемы</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight">Заявки на подключение</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Только мои
          </label>
          <div className="relative">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Номер, email, организация"
              aria-label="Поиск заявок"
              className="field w-72 max-w-full pl-9"
            />
            <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </div>
          <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm" disabled={loading}>Обновить</button>
        </div>
      </div>

      <div role="tablist" aria-label="Статус заявки" className="-mx-4 mt-6 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        {[{ key: "" as const, label: "Все", n: total }, ...REQUEST_STATUSES.map((s) => ({ key: s, label: REQUEST_STATUS_LABEL[s], n: data?.counts[s] || 0 }))].map((t) => (
          <button
            key={t.key || "all"}
            role="tab"
            aria-selected={status === t.key}
            onClick={() => setStatus(t.key)}
            className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
              status === t.key ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-text hover:text-ink"
            }`}
          >
            {t.label}
            <span className={status === t.key ? "text-white/60" : "text-muted"}>{t.n}</span>
          </button>
        ))}
      </div>

      <div className="card mt-5 overflow-hidden">
        {error ? (
          <div role="alert" className="p-10 text-center">
            <p className="font-semibold text-danger">{error}</p>
            <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm mt-4">Повторить</button>
          </div>
        ) : !data && loading ? (
          <div className="space-y-3 p-6" aria-busy="true" aria-label="Загрузка заявок">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-11" />)}
          </div>
        ) : data && data.items.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-semibold">Заявок не найдено</p>
            <p className="mt-1 text-sm text-muted">{status || query || mine ? "Измените фильтры." : "Новые заявки появятся здесь сразу после отправки."}</p>
          </div>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="bg-frost text-xs uppercase tracking-wider text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Номер</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Дата</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Заявитель</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Организация</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Email</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Модули</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Статус</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Ответственный</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data?.items.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-frost/70"
                    onClick={() => router.push(`/admin/requests/${r.id}`)}
                    data-testid={`row-${r.publicNo}`}
                  >
                    <td className="px-4 py-3 font-mono font-semibold">
                      <Link href={`/admin/requests/${r.id}`} className="hover:text-brand-700" onClick={(e) => e.stopPropagation()}>
                        {r.publicNo}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-text">{fmtDate(r.createdAt)}</td>
                    <td className="px-4 py-3 font-semibold">{r.firstName} {r.lastName}</td>
                    <td className="max-w-[200px] truncate px-4 py-3" title={r.company}>{r.company}</td>
                    <td className="px-4 py-3 text-slate-text">{r.email}</td>
                    <td className="px-4 py-3">
                      <ModuleChips
                        keys={r.requestedModules}
                        products={products}
                        muted={r.approvedModules.length && ["approved", "invited", "access_granted"].includes(r.status) ? r.requestedModules.filter((m) => !r.approvedModules.includes(m)) : []}
                      />
                    </td>
                    <td className="px-4 py-3"><RequestStatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-slate-text">{r.assigneeName || <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
