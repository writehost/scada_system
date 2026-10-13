import type { ProductKey } from "@/lib/products"
import { REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/request-status"
import { ProductIcon } from "../brand"

export type AdminProduct = { key: ProductKey; short: string; name: string; color: string; onColor: string; partOf?: string | null }

const TONE: Record<RequestStatus, string> = {
  new: "bg-brand-50 text-brand-700",
  in_review: "bg-[#eef0ff] text-[#4338ca]",
  approved: "bg-[#e6f6ef] text-ok",
  rejected: "bg-[#fdecea] text-danger",
  invited: "bg-[#fff4e5] text-warn",
  access_granted: "bg-[#dff5ea] text-[#0b6b4b]",
}

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className={`chip whitespace-nowrap ${TONE[status]}`} data-status={status}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {REQUEST_STATUS_LABEL[status]}
    </span>
  )
}

export function ModuleChips({ keys, products, muted = [] }: { keys: string[]; products: AdminProduct[]; muted?: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {keys.map((k) => {
        const p = products.find((x) => x.key === k)
        if (!p) return <span key={k} className="chip bg-frost-2">{k}</span>
        return (
          <span
            key={k}
            title={p.name}
            className={`inline-flex items-center gap-1 rounded-lg border border-line bg-white py-0.5 pl-0.5 pr-2 text-xs font-semibold ${muted.includes(k) ? "opacity-40 line-through" : ""}`}
          >
            <ProductIcon k={p.key} color={p.color} onColor={p.onColor} size={18} />
            {p.short}
          </span>
        )
      })}
    </span>
  )
}

export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  })
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error || `Ошибка ${res.status}`)
  return body as T
}
