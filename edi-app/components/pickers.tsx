"use client"

import { Plus, Search } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useApi, useDebounced } from "./api"
import { CounterpartyQuickCreate } from "./counterparty-form"
import { cn, IconButton, Input, Select } from "./ui"

type Cp = { id: string; name: string; shortName?: string | null; inn: string | null; kpp?: string | null; status?: string }

function useOutside(ref: React.RefObject<HTMLElement | null>, fn: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && fn()
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [ref, fn])
}

export function CounterpartyPicker({ value, onChange, allowCreate = true }: { value: Cp | null; onChange: (cp: Cp | null) => void; allowCreate?: boolean }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [hi, setHi] = useState(0)
  const dq = useDebounced(q, 200)
  const { data } = useApi<{ rows: Cp[] }>(open ? `/api/edi/counterparties?q=${encodeURIComponent(dq)}&limit=12` : null, [dq, open])
  const box = useRef<HTMLDivElement>(null)
  useOutside(box, () => setOpen(false))
  const rows = data?.rows ?? []
  return (
    <div ref={box} className="relative">
      <div className="flex gap-1">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
          <Input
            className="pl-7"
            value={open ? q : value ? `${value.shortName || value.name}${value.inn ? ` · ИНН ${value.inn}` : ""}` : q}
            placeholder="Название или ИНН"
            onFocus={() => (setOpen(true), setQ(""))}
            onChange={(e) => (setQ(e.target.value), setHi(0), setOpen(true))}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(rows.length - 1, h + 1)))
              if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)))
              if (e.key === "Enter" && rows[hi]) (e.preventDefault(), onChange(rows[hi]), setOpen(false))
              if (e.key === "Escape") setOpen(false)
            }}
            aria-label="Контрагент"
          />
        </div>
        {allowCreate && (
          <IconButton label="Новый контрагент" className="border border-border" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
          </IconButton>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
          {rows.map((c, i) => (
            <button key={c.id} className={cn("block w-full rounded-lg px-2 py-1.5 text-left", i === hi ? "bg-muted" : "hover:bg-muted")} onMouseEnter={() => setHi(i)} onClick={() => (onChange(c), setOpen(false))}>
              <div className="text-[13px]">{c.name}</div>
              <div className="text-[11px] text-muted-foreground">ИНН {c.inn ?? "—"}{c.kpp ? ` · КПП ${c.kpp}` : ""}{c.status && c.status !== "active" ? ` · ${c.status}` : ""}</div>
            </button>
          ))}
          {!rows.length && <div className="px-2 py-2 text-xs text-muted-foreground">Не найдено{allowCreate ? " — создайте кнопкой +" : ""}</div>}
          {value && <button className="block w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted" onClick={() => (onChange(null), setOpen(false))}>Очистить</button>}
        </div>
      )}
      {creating && (
        <CounterpartyQuickCreate
          initial={/^\d{10,12}$/.test(q.trim()) ? { inn: q.trim() } : q.trim() ? { name: q.trim() } : {}}
          onClose={() => setCreating(false)}
          onCreated={(cp) => {
            setCreating(false)
            setOpen(false)
            onChange(cp)
          }}
        />
      )}
    </div>
  )
}

export type NomItem = { itemCode: string; name: string; sku: string | null; uomCode: string | null; via: string }

/** Поиск номенклатуры WMS: название, артикул, GTIN, алиасы поставщиков. */
export function NomenclatureSearch({ onPick, placeholder = "Номенклатура WMS: название, артикул, GTIN", autoFocus }: { onPick: (it: NomItem) => void; placeholder?: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const dq = useDebounced(q, 250)
  const { data, loading } = useApi<{ items: NomItem[]; available: boolean; error?: string }>(dq.trim().length >= 2 ? `/api/edi/nomenclature/search?q=${encodeURIComponent(dq)}` : null, [dq])
  const box = useRef<HTMLDivElement>(null)
  useOutside(box, () => setOpen(false))
  const items = data?.items ?? []
  return (
    <div ref={box} className="relative">
      <Input
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        onChange={(e) => (setQ(e.target.value), setOpen(true), setHi(0))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHi((h) => Math.min(items.length - 1, h + 1)))
          if (e.key === "ArrowUp") (e.preventDefault(), setHi((h) => Math.max(0, h - 1)))
          if (e.key === "Enter" && items[hi]) (e.preventDefault(), onPick(items[hi]), setQ(""), setOpen(false))
        }}
        aria-label="Поиск номенклатуры"
      />
      {open && dq.trim().length >= 2 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-72 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-xl">
          {data && !data.available && <div className="px-2 py-2 text-xs text-muted-foreground">{data.error}</div>}
          {items.map((it, i) => (
            <button key={it.itemCode} className={cn("block w-full rounded-lg px-2 py-1.5 text-left", i === hi ? "bg-muted" : "hover:bg-muted")} onMouseEnter={() => setHi(i)} onClick={() => (onPick(it), setQ(""), setOpen(false))}>
              <div className="text-[13px]">{it.name}</div>
              <div className="text-[11px] text-muted-foreground"><span className="font-mono">{it.itemCode}</span>{it.sku ? ` · ${it.sku}` : ""} · {it.via}</div>
            </button>
          ))}
          {data?.available && !items.length && !loading && <div className="px-2 py-2 text-xs text-muted-foreground">Ничего не найдено в WMS</div>}
        </div>
      )}
    </div>
  )
}

export function UserSelect({ value, onChange, placeholder = "—", role }: { value: string; onChange: (v: string) => void; placeholder?: string; role?: string }) {
  const { data } = useApi<{ users: Array<{ userId: string; name: string; roles: string[]; department: string | null }> }>("/api/edi/users")
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {data?.users.filter((u) => !role || u.roles.includes(role)).map((u) => (
        <option key={u.userId} value={u.userId}>{u.name}{u.department ? ` · ${u.department}` : ""}</option>
      ))}
    </Select>
  )
}
