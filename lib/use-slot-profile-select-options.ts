"use client"

import { useEffect, useMemo, useState } from "react"
import {
  listDirectorySlotProfileOptions,
  type SlotProfileOptionDirectoryRow,
} from "@/lib/wms-api"
import { SLOT_SELECT_OPTIONS, type StorageSlotProfile } from "@/lib/storage-slot-ui"

export type SlotProfileSelectOptions = {
  materialType: { value: string; label: string }[]
  processType: { value: string; label: string }[]
  stickerShape: { value: string; label: string }[]
  productGroup: { value: string; label: string }[]
  volume: { value: string; label: string }[]
  applicationPlace: { value: string; label: string }[]
  equipment: { value: string; label: string }[]
}

function buildSelectOptions(rows: SlotProfileOptionDirectoryRow[]): SlotProfileSelectOptions {
  const grouped: Record<string, { value: string; label: string; sortOrder: number }[]> = {}
  for (const row of rows) {
    if (!row.isActive) continue
    const list = grouped[row.fieldKey] ?? (grouped[row.fieldKey] = [])
    list.push({ value: row.code, label: row.name, sortOrder: row.sortOrder })
  }

  const result = { ...SLOT_SELECT_OPTIONS } as SlotProfileSelectOptions
  for (const field of Object.keys(result) as (keyof SlotProfileSelectOptions)[]) {
    const fromDb = grouped[field]
    if (!fromDb?.length) continue
    fromDb.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "ru"))
    const any = fromDb.find((o) => o.value === "ANY")
    const rest = fromDb.filter((o) => o.value !== "ANY")
    result[field] = any ? [...rest, any] : rest
  }
  return result
}

function withProfileValues(
  options: SlotProfileSelectOptions,
  profile?: StorageSlotProfile | null
): SlotProfileSelectOptions {
  if (!profile) return options
  const next = { ...options }
  const fields: (keyof SlotProfileSelectOptions)[] = [
    "materialType",
    "processType",
    "stickerShape",
    "productGroup",
    "volume",
    "applicationPlace",
    "equipment",
  ]
  for (const field of fields) {
    const code = profile[field as keyof StorageSlotProfile]
    if (typeof code !== "string" || !code.trim() || code === "ANY") continue
    const list = [...next[field]]
    if (!list.some((o) => o.value === code)) {
      list.unshift({ value: code, label: `${code} (нет в справочнике — будет добавлено)` })
    }
    next[field] = list
  }
  return next
}

export function useSlotProfileSelectOptions(
  profile?: StorageSlotProfile | null
): SlotProfileSelectOptions {
  const [rows, setRows] = useState<SlotProfileOptionDirectoryRow[] | null>(null)
  const [directoryLoaded, setDirectoryLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listDirectorySlotProfileOptions()
      .then((res) => {
        if (!cancelled) {
          setRows(res.options ?? [])
          setDirectoryLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRows(null)
          setDirectoryLoaded(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return useMemo(() => {
    const base =
      directoryLoaded && rows
        ? buildSelectOptions(rows)
        : (SLOT_SELECT_OPTIONS as SlotProfileSelectOptions)
    return withProfileValues(base, profile)
  }, [rows, directoryLoaded, profile])
}

export function useSlotProfileLabelMap(): Record<string, Record<string, string>> {
  const options = useSlotProfileSelectOptions()
  return useMemo(() => {
    const map: Record<string, Record<string, string>> = {}
    for (const [field, list] of Object.entries(options)) {
      map[field] = Object.fromEntries(list.map((o) => [o.value, o.label]))
    }
    return map
  }, [options])
}
