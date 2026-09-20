"use client"

import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSiteCode } from "@/lib/wms-api"
import type { ShipLotPreview, ShipRuleRow } from "@/lib/wms/ship-rules"
import { cn } from "@/lib/utils"

export function FgShipRulesPanel() {
  const [rules, setRules] = useState<ShipRuleRow[]>([])
  const [ruleCode, setRuleCode] = useState("x5")
  const [lots, setLots] = useState<ShipLotPreview[]>([])
  const [rule, setRule] = useState<ShipRuleRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  async function loadRules() {
    const qp = new URLSearchParams({ siteCode: getSiteCode() })
    const r = await fetch(`/api/wms/directories/ship-rules?${qp}`, { cache: "no-store" })
    const data = (await r.json()) as { rules?: ShipRuleRow[]; error?: string }
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
    setRules(data.rules || [])
    if (data.rules?.length && !data.rules.some((x) => x.code === ruleCode)) {
      setRuleCode(data.rules[0]!.code)
    }
  }

  async function loadLots(code = ruleCode) {
    setLoading(true)
    setError(null)
    try {
      const qp = new URLSearchParams({ siteCode: getSiteCode(), ruleCode: code })
      const r = await fetch(`/api/wms/warehouse/finished-goods/ship-lots?${qp}`, { cache: "no-store" })
      const data = (await r.json()) as { lots?: ShipLotPreview[]; rule?: ShipRuleRow; error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setLots(data.lots || [])
      setRule(data.rule || null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить партии")
      setLots([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadRules()
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось загрузить правила")
      }
      await loadLots()
    })()
  }, [])

  async function mark(lot: ShipLotPreview, clear: boolean) {
    const key = `${lot.itemCode}:${lot.lotCode}`
    setBusyKey(key)
    setError(null)
    try {
      const r = await fetch("/api/wms/warehouse/finished-goods/ship-lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteCode: getSiteCode(),
          itemCode: lot.itemCode,
          lotCode: lot.lotCode,
          ruleCode,
          clear,
        }),
      })
      const data = (await r.json()) as { error?: string }
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`)
      await loadLots()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось пометить партию")
    } finally {
      setBusyKey(null)
    }
  }

  const eligible = lots.filter((x) => x.eligible).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Отгрузка контрагенту</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Пятёрочка и похожие сети: сколько слоёв на палете и сколько дней срока должно остаться. Партию
            помечают под конкретного контрагента — тогда видно, что именно отгружать.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={ruleCode}
            onChange={(e) => {
              setRuleCode(e.target.value)
              void loadLots(e.target.value)
            }}
          >
            {rules.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void loadLots()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Обновить
          </Button>
        </div>
      </div>

      {rule ? (
        <p className="text-sm text-muted-foreground">
          {rule.name}: {rule.requiredLayers != null ? `${rule.requiredLayers} слоя` : "слои не заданы"}
          {rule.minRemainingDays != null ? ` · остаток срока ≥ ${rule.minRemainingDays} дн.` : ""}
          {rule.note ? ` — ${rule.note}` : ""}
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Загрузка партий…</p> : null}
      {!loading ? (
        <p className="text-xs text-muted-foreground">
          Подходит для отгрузки: {eligible} из {lots.length}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/40 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Номенклатура</th>
              <th className="px-3 py-2 font-medium">Партия</th>
              <th className="px-3 py-2 font-medium">Бутылки</th>
              <th className="px-3 py-2 font-medium">Слои</th>
              <th className="px-3 py-2 font-medium">Остаток срока</th>
              <th className="px-3 py-2 font-medium">Метка</th>
              <th className="px-3 py-2 font-medium">Можно</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lots.map((lot) => {
              const key = `${lot.itemCode}:${lot.lotCode}`
              return (
                <tr key={key} className="border-t">
                  <td className="px-3 py-2">{lot.itemName}</td>
                  <td className="px-3 py-2 font-mono text-xs">{lot.lotCode}</td>
                  <td className="px-3 py-2 tabular-nums">{lot.bottles}</td>
                  <td className="px-3 py-2 tabular-nums">{lot.layers ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {lot.remainingDays != null ? `${lot.remainingDays} дн.` : "нет даты"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {lot.reservedRuleName || lot.reservedRuleCode || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn("text-xs", lot.eligible ? "text-emerald-700" : "text-destructive")}>
                      {lot.eligible ? lot.reason || "да" : lot.reason || "нет"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {lot.reservedRuleCode === ruleCode ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busyKey === key}
                        onClick={() => void mark(lot, true)}
                      >
                        Снять
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={busyKey === key}
                        onClick={() => void mark(lot, false)}
                      >
                        Под {rule?.name || ruleCode}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
            {!loading && lots.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-sm text-muted-foreground">
                  Партий с остатком нет — или правило ещё не создано в справочнике.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
