"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Columns3, GripVertical, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { cn } from "@/lib/utils"
import {
  emptyTableLayout,
  layoutStorageKey,
  mergeTableLayout,
  moveColumn,
  type TableColumnLayout,
} from "@/lib/wms/table-column-layout"

type ColumnMeta = { id: string; label: string; locked?: boolean }

export function useTableColumnLayout(
  tableId: string,
  columns: readonly { id: string; label: string; locked?: boolean }[],
  options?: { defaultHidden?: readonly string[] }
) {
  const allIds = useMemo(() => columns.map((c) => c.id), [columns])
  const lockedIds = useMemo(() => columns.filter((c) => c.locked).map((c) => c.id), [columns])
  const defaultHiddenKey = (options?.defaultHidden ?? []).join("\0")
  const defaultHidden = useMemo(
    () => (defaultHiddenKey ? defaultHiddenKey.split("\0") : []),
    [defaultHiddenKey]
  )
  const [layout, setLayout] = useState<TableColumnLayout>(() => emptyTableLayout())
  const [ownerKey, setOwnerKey] = useState("anon")
  const saveTimer = useRef<number | null>(null)
  const prefKey = `table:${tableId}`

  const merged = useMemo(
    () => mergeTableLayout(allIds, lockedIds, layout, defaultHidden),
    [allIds, lockedIds, layout, defaultHidden]
  )

  const persist = useCallback(
    (next: TableColumnLayout, owner: string) => {
      try {
        localStorage.setItem(layoutStorageKey(owner, tableId), JSON.stringify(next))
      } catch {
        /* ignore */
      }
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => {
        void fetch("/api/ui-prefs", {
          method: "PUT",
          credentials: "same-origin",
          headers: authRequestHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ key: prefKey, value: next }),
        }).catch(() => undefined)
      }, 350)
    },
    [prefKey, tableId]
  )

  useEffect(() => {
    let cancelled = false
    void fetch("/api/auth/me", { cache: "no-store", headers: authRequestHeaders() })
      .then(async (res) => {
        if (!res.ok) return "anon"
        const data = (await res.json()) as { user?: { userId?: string; login?: string } }
        if (data.user?.userId) return `user:${data.user.userId}`
        if (data.user?.login) return `login:${data.user.login}`
        return "anon"
      })
      .then(async (owner) => {
        if (cancelled) return
        setOwnerKey(owner)
        let local: TableColumnLayout | null = null
        try {
          const raw = localStorage.getItem(layoutStorageKey(owner, tableId))
          if (raw) local = JSON.parse(raw) as TableColumnLayout
        } catch {
          local = null
        }
        if (local) setLayout(mergeTableLayout(allIds, lockedIds, local, defaultHidden))

        const res = await fetch(`/api/ui-prefs?key=${encodeURIComponent(prefKey)}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: authRequestHeaders(),
        }).catch(() => null)
        if (!res?.ok || cancelled) return
        const data = (await res.json()) as { value?: TableColumnLayout | null }
        if (data.value && typeof data.value === "object") {
          setLayout(mergeTableLayout(allIds, lockedIds, data.value, defaultHidden))
        } else if (local) {
          persist(mergeTableLayout(allIds, lockedIds, local, defaultHidden), owner)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableId])

  const commit = useCallback(
    (patch: Partial<TableColumnLayout>) => {
      setLayout((prev) => {
        const next = mergeTableLayout(allIds, lockedIds, { ...prev, ...patch }, defaultHidden)
        persist({ order: next.order, hidden: next.hidden }, ownerKey)
        return { order: next.order, hidden: next.hidden }
      })
    },
    [allIds, lockedIds, defaultHidden, ownerKey, persist]
  )

  const setHidden = useCallback(
    (id: string, hide: boolean) => {
      if (lockedIds.includes(id)) return
      const hidden = new Set(merged.hidden)
      if (hide) hidden.add(id)
      else hidden.delete(id)
      commit({ hidden: [...hidden] })
    },
    [commit, lockedIds, merged.hidden]
  )

  const reorder = useCallback(
    (fromId: string, toId: string) => {
      if (lockedIds.includes(fromId) || lockedIds.includes(toId)) return
      commit({ order: moveColumn(merged.order, fromId, toId) })
    },
    [commit, lockedIds, merged.order]
  )

  const reset = useCallback(() => {
    const next = emptyTableLayout()
    setLayout(next)
    persist(next, ownerKey)
  }, [ownerKey, persist])

  return { ...merged, setHidden, reorder, reset, columns }
}

export function TableColumnsButton({
  columns,
  order,
  hidden,
  setHidden,
  reorder,
  reset,
}: {
  columns: readonly ColumnMeta[]
  order: string[]
  hidden: string[]
  setHidden: (id: string, hide: boolean) => void
  reorder: (fromId: string, toId: string) => void
  reset: () => void
}) {
  const hiddenSet = new Set(hidden)
  const movable = order
    .map((id) => columns.find((c) => c.id === id))
    .filter((c): c is ColumnMeta => Boolean(c) && !c.locked)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="shrink-0 rounded-lg" title="Колонки таблицы">
          <Columns3 className="mr-1.5 h-3.5 w-3.5" />
          Колонки
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Колонки</p>
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={reset}>
            <RotateCcw className="mr-1 h-3 w-3" />
            Сброс
          </Button>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">Перетащите строку, чтобы поменять порядок. Снимите галочку — колонка скроется.</p>
        <div className="space-y-1">
          {movable.map((col) => (
            <div
              key={col.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", col.id)
                e.dataTransfer.effectAllowed = "move"
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const from = e.dataTransfer.getData("text/plain")
                if (from) reorder(from, col.id)
              }}
              className="flex cursor-grab items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/60 active:cursor-grabbing"
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <Checkbox
                checked={!hiddenSet.has(col.id)}
                onCheckedChange={(v) => setHidden(col.id, v !== true)}
              />
              <span className="min-w-0 truncate text-sm">{col.label}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function DraggableColumnHead({
  id,
  locked,
  className,
  onReorder,
  children,
}: {
  id: string
  locked?: boolean
  className?: string
  onReorder: (fromId: string, toId: string) => void
  children: React.ReactNode
}) {
  return (
    <th
      className={cn(!locked && "cursor-grab active:cursor-grabbing", className)}
      draggable={!locked}
      title={locked ? undefined : "Перетащите, чтобы поменять колонки"}
      onDragStart={(e) => {
        if (locked) return
        e.dataTransfer.setData("text/plain", id)
        e.dataTransfer.effectAllowed = "move"
      }}
      onDragOver={(e) => {
        if (!locked) e.preventDefault()
      }}
      onDrop={(e) => {
        e.preventDefault()
        const from = e.dataTransfer.getData("text/plain")
        if (from) onReorder(from, id)
      }}
    >
      {children}
    </th>
  )
}
