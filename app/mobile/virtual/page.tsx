"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, Boxes, CheckCircle2, MapPin, ScanLine } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  getVirtualLayoutDetail,
  getVirtualNodeContents,
  listVirtualLayouts,
  resolveVirtualLocation,
  type WmsVirtualLayoutDetail,
  type WmsVirtualLayoutSummary,
  type WmsVirtualNodeContent,
} from "@/lib/wms-api"

export default function MobileVirtualWarehousePage() {
  const [layouts, setLayouts] = useState<WmsVirtualLayoutSummary[]>([])
  const [detail, setDetail] = useState<WmsVirtualLayoutDetail | null>(null)
  const [locationCode, setLocationCode] = useState("")
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [contents, setContents] = useState<WmsVirtualNodeContent[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function loadLayouts() {
    setBusy(true)
    setError(null)
    try {
      const data = await listVirtualLayouts()
      setLayouts(data.layouts || [])
      const first = data.layouts?.[0]
      if (first) await openLayout(first.layoutId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось открыть виртуальный склад")
    } finally {
      setBusy(false)
    }
  }

  async function openLayout(layoutId: string) {
    setBusy(true)
    setError(null)
    try {
      const data = await getVirtualLayoutDetail(layoutId)
      setDetail(data)
      setActiveNodeId(null)
      setContents([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить layout")
    } finally {
      setBusy(false)
    }
  }

  async function openNode(nodeId: string) {
    setBusy(true)
    setError(null)
    try {
      const data = await getVirtualNodeContents(nodeId)
      setActiveNodeId(nodeId)
      setContents(data.contents || [])
      setMessage("Ячейка подтверждена")
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить содержимое узла")
    } finally {
      setBusy(false)
    }
  }

  async function resolveLocation() {
    if (!locationCode.trim()) return
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const resolved = await resolveVirtualLocation(locationCode)
      if (!resolved.layoutId || !resolved.nodeId) {
        setError("Ячейка не привязана к виртуальному складу")
        return
      }
      await openLayout(resolved.layoutId)
      await openNode(resolved.nodeId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить ячейку")
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadLayouts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nodeMap = useMemo(() => new Map((detail?.nodes || []).map((n) => [n.nodeId, n])), [detail])
  const activeNode = activeNodeId ? nodeMap.get(activeNodeId) : null

  return (
    <div className="min-h-screen bg-background pb-28">
      <div className="sticky top-0 z-40 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="font-semibold text-foreground">Виртуальный склад</h1>
            <p className="text-xs text-muted-foreground">Layout, узлы, содержимое ячейки</p>
          </div>
          <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl" asChild>
            <Link href="/mobile/scan"><ScanLine className="h-5 w-5" /></Link>
          </Button>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {error ? (
          <Card className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            <div className="flex gap-2"><AlertTriangle className="h-5 w-5 shrink-0" />{error}</div>
          </Card>
        ) : null}
        {message ? (
          <Card className="rounded-2xl border border-primary/20 bg-primary/10 p-4 text-sm">
            <div className="flex gap-2"><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />{message}</div>
          </Card>
        ) : null}

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <MapPin className="h-4 w-4 text-primary" />
            Скан ячейки
          </div>
          <div className="space-y-3">
            <Input autoFocus value={locationCode} onChange={(e) => setLocationCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter") void resolveLocation() }} placeholder="Код ячейки" className="h-12 rounded-xl font-mono" />
            <Button className="h-12 w-full rounded-xl bg-primary text-primary-foreground" disabled={busy || !locationCode.trim()} onClick={() => void resolveLocation()}>
              Подтвердить ячейку
            </Button>
          </div>
        </Card>

        <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 font-semibold">
            <Boxes className="h-4 w-4 text-primary" />
            Layout
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {layouts.map((layout) => (
              <button
                key={layout.layoutId}
                type="button"
                className="shrink-0 rounded-xl bg-secondary px-3 py-2 text-left text-sm"
                onClick={() => void openLayout(layout.layoutId)}
              >
                <div className="font-medium">{layout.name}</div>
                <div className="text-xs text-muted-foreground">{layout.nodeCount ?? 0} узлов</div>
              </button>
            ))}
            {layouts.length === 0 && <div className="text-sm text-muted-foreground">Нет layout</div>}
          </div>
        </Card>

        {detail ? (
          <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="font-semibold">{detail.layout.name}</div>
                <div className="text-xs text-muted-foreground">{detail.layout.warehouseCode || "—"} / {detail.layout.zoneCode || "—"}</div>
              </div>
              <Badge variant="secondary" className="rounded-lg">{detail.nodes.length}</Badge>
            </div>
            <div className="space-y-2">
              {detail.nodes.slice(0, 80).map((node) => (
                <button
                  key={node.nodeId}
                  type="button"
                  className={`w-full rounded-xl p-3 text-left ${node.nodeId === activeNodeId ? "bg-primary/15" : "bg-secondary/50"}`}
                  onClick={() => void openNode(node.nodeId)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium">{node.label || node.code || node.nodeId}</div>
                    <Badge variant="secondary" className="rounded-lg">{node.nodeType}</Badge>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{node.code || node.nodeId}</div>
                </button>
              ))}
            </div>
          </Card>
        ) : null}

        {activeNode ? (
          <Card className="rounded-2xl border-0 bg-card p-4 shadow-sm">
            <div className="mb-3 font-semibold">Содержимое: {activeNode.label || activeNode.code}</div>
            {contents.length === 0 ? (
              <div className="text-sm text-muted-foreground">Пусто</div>
            ) : (
              <div className="space-y-2">
                {contents.map((row, i) => (
                  <div key={`${row.itemCode}-${row.lotCode}-${i}`} className="rounded-xl bg-secondary/50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-medium">{row.itemName || row.itemCode}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.itemCode}</div>
                      </div>
                      <Badge variant="secondary" className="rounded-lg">{row.qty} {row.uomCode || ""}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">Партия: {row.lotCode || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  )
}
