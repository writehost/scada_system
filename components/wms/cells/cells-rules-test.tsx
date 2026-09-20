"use client"

import { useCallback, useState } from "react"
import { FlaskConical, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { matchStorageRules } from "@/lib/wms-api"
import { buildSlotTitle } from "@/lib/storage-slot-ui"
import { storageClassLabel } from "@/lib/wms/physical-profile"

/** Быстрый тест: подходит ли номенклатура под правила, ведущие в эту ячейку */
export function CellsRulesTest({ defaultItemCode = "" }: { defaultItemCode?: string }) {
  const [itemCode, setItemCode] = useState(defaultItemCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileTitle, setProfileTitle] = useState<string | null>(null)
  const [ruleNames, setRuleNames] = useState<string[]>([])

  const run = useCallback(async () => {
    const code = itemCode.trim()
    if (!code) return
    setLoading(true)
    setError(null)
    try {
      const res = await matchStorageRules({ itemCode: code })
      const req = res.requirements
      const cls = req?.physical?.storageClass
        ? storageClassLabel(req.physical.storageClass)
        : null
      const title = req ? buildSlotTitle(req) : null
      setProfileTitle([cls, title && title !== "—" ? title : null].filter(Boolean).join(" · ") || null)
      setRuleNames((res.forItem ?? []).map((r) => r.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
      setRuleNames([])
    } finally {
      setLoading(false)
    }
  }, [itemCode])

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 p-3 space-y-2">
      <p className="flex items-center gap-2 text-xs font-medium">
        <FlaskConical className="h-3.5 w-3.5" />
        Тест правил по номенклатуре
      </p>
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Label className="sr-only">Код товара</Label>
          <Input
            value={itemCode}
            onChange={(e) => setItemCode(e.target.value)}
            className="h-8 rounded-lg font-mono text-xs"
            placeholder="RES-STICKER-0001"
          />
        </div>
        <Button size="sm" className="h-8 rounded-lg shrink-0" onClick={() => void run()} disabled={loading}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Проверить"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {profileTitle && profileTitle !== "—" ? (
        <p className="text-xs text-muted-foreground">
          Профиль партии: <span className="text-foreground">{profileTitle}</span>
        </p>
      ) : null}
      {ruleNames.length > 0 ? (
        <p className="text-xs">
          Сработает: <span className="font-medium">{ruleNames.join(", ")}</span>
        </p>
      ) : !loading && itemCode.trim() ? (
        <p className="text-xs text-muted-foreground">Подходящих активных правил нет</p>
      ) : null}
    </div>
  )
}
