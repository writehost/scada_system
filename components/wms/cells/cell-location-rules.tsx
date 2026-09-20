"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Plus, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import { matchStorageRules, type WmsStorageRule } from "@/lib/wms-api"
import { slotLabel } from "@/lib/storage-slot-ui"
import { useCellsRequestGuard } from "./cells-request-guard"

type Props = {
  locationCode: string
  locationId?: string | null
}

function ruleCriteria(rule: WmsStorageRule): string {
  const parts: string[] = []
  if (rule.storageClass) parts.push(rule.storageClass)
  if (rule.criteria?.handling) parts.push(rule.criteria.handling)
  if (rule.materialType) parts.push(slotLabel("materialType", rule.materialType))
  if (rule.processType) parts.push(slotLabel("processType", rule.processType))
  if (rule.productGroup) parts.push(slotLabel("productGroup", rule.productGroup))
  if (rule.volume) parts.push(slotLabel("volume", rule.volume))
  return parts.length ? parts.join(" · ") : "Любая партия"
}

export function CellLocationRules({ locationCode, locationId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rules, setRules] = useState<WmsStorageRule[]>([])
  const { nextGeneration, isCurrent } = useCellsRequestGuard()

  const fetchRules = useCallback(async () => {
    const code = locationCode.trim()
    if (!code) return
    const generation = nextGeneration()
    setLoading(true)
    setError(null)
    try {
      const res = await matchStorageRules({ locationCode: code })
      if (!isCurrent(generation)) return
      setRules(res.forLocation ?? [])
    } catch (e) {
      if (!isCurrent(generation)) return
      setError(e instanceof Error ? e.message : "Не удалось загрузить правила")
      setRules([])
    } finally {
      if (isCurrent(generation)) setLoading(false)
    }
  }, [locationCode, nextGeneration, isCurrent])

  useEffect(() => {
    void fetchRules()
  }, [fetchRules])

  const createHref = `/cells/rules?new=1${
    locationId ? `&locationId=${encodeURIComponent(locationId)}` : ""
  }&locationCode=${encodeURIComponent(locationCode)}`

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Scale className="h-4 w-4 shrink-0 text-primary" />
          Правила
        </p>
        <Button variant="outline" size="sm" className="rounded-lg" asChild>
          <Link href={createHref}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Создать правило
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Загрузка…
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {!loading && rules.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-3 py-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          Правил нет.{" "}
          <Link href={createHref} className="text-emerald-800 hover:underline">
            Создать
          </Link>
        </p>
      ) : null}

      {rules.length > 0 ? (
        <ul className="space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.ruleId}
              className="min-w-0 rounded-xl border border-border/60 bg-secondary/20 px-3 py-2 text-xs"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 [overflow-wrap:anywhere]">
                <span className="font-medium">{rule.name}</span>
                <span className="text-muted-foreground">приоритет {rule.priority}</span>
                {!rule.isActive ? <span className="text-amber-700">выкл</span> : null}
              </div>
              <p className="mt-0.5 leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                {ruleCriteria(rule)}
              </p>
              <Link href="/cells/rules" className="mt-1 inline-block text-primary hover:underline">
                Все правила →
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
