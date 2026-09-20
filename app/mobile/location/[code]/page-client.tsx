"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, Loader2, Lock, MapPin, ScanLine, Shield, Warehouse } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  getWmsLocationDetail,
  moveWmsLotBucket,
  setWmsLocationBlocked,
  updateWmsLot,
  type WmsLocationDetailResponse,
} from "@/lib/wms-api"

function LocationContent() {
  const router = useRouter()
  const params = useParams()
  const raw = typeof params?.code === "string" ? params.code : ""
  const locationCode = raw ? decodeURIComponent(raw) : ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<WmsLocationDetailResponse | null>(null)
  const [busy, setBusy] = useState(false)

  const [lotOpen, setLotOpen] = useState(false)
  const [activeLotId, setActiveLotId] = useState<string | null>(null)
  const [lotSaving, setLotSaving] = useState(false)
  const [lotError, setLotError] = useState<string | null>(null)
  const [lotQaStatusCode, setLotQaStatusCode] = useState("")
  const [lotNote, setLotNote] = useState("")
  const [lotMoveQty, setLotMoveQty] = useState("")

  async function load() {
    if (!locationCode.trim()) return
    setLoading(true)
    setError(null)
    try {
      const d = await getWmsLocationDetail(locationCode)
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить ячейку")
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationCode])

  const loc = data?.location
  const stock = data?.stock || []
  const lots = data?.lots ?? []

  const activeLot = useMemo(() => {
    if (!activeLotId) return null
    return lots.find((x) => String(x.lotId) === activeLotId) ?? null
  }, [lots, activeLotId])

  useEffect(() => {
    if (!lotOpen || !activeLot) return
    setLotError(null)
    setLotQaStatusCode(String(activeLot.qaStatusCode ?? ""))
    setLotNote(String(activeLot.note ?? ""))
    const avail = Number(activeLot.availableQty ?? 0)
    setLotMoveQty(avail > 0 ? String(Math.round(avail)) : "")
  }, [lotOpen, activeLot])

  function openLot(lotId: string) {
    setActiveLotId(lotId)
    setLotOpen(true)
  }

  async function saveLotFields() {
    if (!activeLotId) return
    setLotSaving(true)
    setLotError(null)
    try {
      await updateWmsLot(activeLotId, {
        qaStatusCode: lotQaStatusCode.trim() || null,
        note: lotNote.trim() || null,
      })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось сохранить")
    } finally {
      setLotSaving(false)
    }
  }

  async function toggleLotBlocked() {
    if (!activeLotId || !activeLot) return
    setLotSaving(true)
    setLotError(null)
    try {
      await updateWmsLot(activeLotId, { isBlocked: !Boolean(activeLot.isBlocked) })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Ошибка блокировки")
    } finally {
      setLotSaving(false)
    }
  }

  async function moveLot(fromBucket: "available" | "quarantine", toBucket: "available" | "quarantine") {
    if (!activeLotId) return
    const qty = Number(lotMoveQty)
    if (!(qty > 0)) {
      setLotError("Укажите qty > 0")
      return
    }
    setLotSaving(true)
    setLotError(null)
    try {
      await moveWmsLotBucket({ lotId: activeLotId, fromBucket, toBucket, qty })
      await load()
    } catch (e) {
      setLotError(e instanceof Error ? e.message : "Не удалось переместить")
    } finally {
      setLotSaving(false)
    }
  }

  const totals = useMemo(() => {
    const s = { available: 0, reserved: 0, quarantine: 0, rejected: 0, inProduction: 0 }
    for (const row of stock) {
      s.available += Number(row.availableQty || 0)
      s.reserved += Number(row.reservedQty || 0)
      s.quarantine += Number(row.quarantineQty || 0)
      s.rejected += Number(row.rejectedQty || 0)
      s.inProduction += Number(row.inProductionQty || 0)
    }
    return s
  }, [stock])

  async function toggleBlocked() {
    if (!loc) return
    const isBlocked = String(loc.locationStatus || "").toLowerCase().includes("block")
    setBusy(true)
    setError(null)
    try {
      await setWmsLocationBlocked(loc.locationCode, !isBlocked)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось изменить статус")
    } finally {
      setBusy(false)
    }
  }

  if (!locationCode) {
    return <div className="min-h-screen bg-background p-4 text-destructive">Некорректная ячейка</div>
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="sticky top-0 z-40 bg-card px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold text-foreground flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono">{locationCode}</span>
            </h1>
            <p className="text-xs text-muted-foreground">
              {loc ? `${loc.warehouseCode} / ${loc.zoneCode}` : "—"}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-10 w-10 rounded-xl"
            onClick={() => router.push(`/mobile/scan?prefill=${encodeURIComponent(locationCode)}`)}
          >
            <ScanLine className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {error && (
          <Card className="p-4 bg-destructive/5 rounded-2xl shadow-sm border border-destructive/20">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <div className="text-sm">{error}</div>
            </div>
          </Card>
        )}

        {loading ? (
          <Card className="p-4 rounded-2xl shadow-sm border-0">
            <div className="text-sm text-muted-foreground">Загрузка...</div>
          </Card>
        ) : loc ? (
          <>
            <Card className="p-4 bg-card rounded-2xl shadow-sm border-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm text-muted-foreground">Статусы</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="secondary" className="rounded-lg">
                      <Warehouse className="mr-1 h-3 w-3" />
                      {loc.warehouseCode}
                    </Badge>
                    <Badge variant="secondary" className="rounded-lg">
                      {loc.zoneCode}
                    </Badge>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "rounded-lg",
                        String(loc.locationStatus || "").toLowerCase().includes("block") &&
                          "bg-destructive/10 text-destructive"
                      )}
                    >
                      <Shield className="mr-1 h-3 w-3" />
                      {loc.locationStatus}
                    </Badge>
                    <Badge variant="secondary" className="rounded-lg">
                      {loc.accuracyStatus}
                    </Badge>
                    {loc.isPickFace ? (
                      <Badge variant="secondary" className="rounded-lg">
                        pick-face
                      </Badge>
                    ) : null}
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => void toggleBlocked()}
                  disabled={busy}
                >
                  <Lock className="mr-2 h-4 w-4" />
                  {String(loc.locationStatus || "").toLowerCase().includes("block") ? "Разблок." : "Блок."}
                </Button>
              </div>
            </Card>

            <Card className="p-4 bg-card rounded-2xl shadow-sm border-0">
              <div className="text-sm text-muted-foreground">Итого по ячейке</div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-lg bg-secondary px-2 py-1">avail {Math.round(totals.available)}</span>
                <span className="rounded-lg bg-secondary px-2 py-1">res {Math.round(totals.reserved)}</span>
                <span className="rounded-lg bg-secondary px-2 py-1">quar {Math.round(totals.quarantine)}</span>
                <span className="rounded-lg bg-secondary px-2 py-1">rej {Math.round(totals.rejected)}</span>
                <span className="rounded-lg bg-secondary px-2 py-1">prod {Math.round(totals.inProduction)}</span>
              </div>
            </Card>

            <Card className="p-4 bg-card rounded-2xl shadow-sm border-0">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-foreground">Остатки</div>
                <span className="text-sm text-muted-foreground">{stock.length}</span>
              </div>
              {stock.length === 0 ? (
                <div className="text-sm text-muted-foreground">Пусто</div>
              ) : (
                <div className="space-y-2">
                  {stock.slice(0, 30).map((row) => (
                    <button
                      key={row.itemCode}
                      type="button"
                      className="w-full text-left rounded-xl bg-secondary/50 p-3 hover:bg-secondary/70"
                      onClick={() => router.push(`/nomenclature/${encodeURIComponent(row.itemCode)}?fromLocation=${encodeURIComponent(locationCode)}`)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">{row.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground font-mono">
                            {row.itemCode}{row.barcode ? ` · ${row.barcode}` : ""}
                          </div>
                        </div>
                        <Badge variant="secondary" className="rounded-lg">
                          {row.availableQty} / {row.reservedQty}
                        </Badge>
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground">
                        quar {row.quarantineQty} · rej {row.rejectedQty} · prod {row.inProductionQty}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4 bg-card rounded-2xl shadow-sm border-0">
              <div className="mb-2 flex items-center justify-between">
                <div className="font-semibold text-foreground">Партии</div>
                <span className="text-xs text-muted-foreground">{lots.length}</span>
              </div>
              {lots.length === 0 ? (
                <div className="text-sm text-muted-foreground">Нет партий по строкам</div>
              ) : (
                <div className="space-y-2">
                  {lots.slice(0, 40).map((row) => (
                    <button
                      key={`${row.lotId}-${row.itemCode}`}
                      type="button"
                      className="w-full rounded-xl bg-secondary/50 p-3 text-left hover:bg-secondary/70"
                      onClick={() => openLot(row.lotId)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Link
                            href={`/nomenclature/${encodeURIComponent(row.itemCode)}?fromLocation=${encodeURIComponent(locationCode)}&lotCode=${encodeURIComponent(row.lotCode)}`}
                            className="text-sm font-medium text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.itemCode}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">{row.lotCode}</div>
                        </div>
                        <Badge variant="secondary" className="rounded-lg shrink-0">
                          {Math.round(Number(row.availableQty ?? 0))} / {Math.round(Number(row.quarantineQty ?? 0))}
                        </Badge>
                      </div>
                      {row.isBlocked ? (
                        <div className="mt-2 text-xs text-destructive">заблокирован</div>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Dialog
              open={lotOpen}
              onOpenChange={(v) => {
                setLotOpen(v)
                if (!v) {
                  setActiveLotId(null)
                  setLotError(null)
                  setLotSaving(false)
                }
              }}
            >
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Партия</DialogTitle>
                </DialogHeader>
                {activeLot ? (
                  <div className="space-y-4">
                    {lotError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                        {lotError}
                      </div>
                    ) : null}
                    <div className="grid gap-3">
                      <div>
                        <Label>QA</Label>
                        <Input
                          value={lotQaStatusCode}
                          onChange={(e) => setLotQaStatusCode(e.target.value)}
                          className="mt-1 rounded-xl"
                        />
                      </div>
                      <div>
                        <Label>Заметка</Label>
                        <Textarea
                          value={lotNote}
                          onChange={(e) => setLotNote(e.target.value)}
                          className="mt-1 rounded-xl min-h-20"
                        />
                      </div>
                      <Button
                        variant={Boolean(activeLot.isBlocked) ? "secondary" : "destructive"}
                        className="rounded-xl"
                        onClick={() => void toggleLotBlocked()}
                        disabled={lotSaving}
                      >
                        {Boolean(activeLot.isBlocked) ? "Разблокировать" : "Заблокировать"}
                      </Button>
                      <div>
                        <Label>Кол-во для перемещения</Label>
                        <Input
                          value={lotMoveQty}
                          onChange={(e) => setLotMoveQty(e.target.value)}
                          className="mt-1 rounded-xl"
                          inputMode="decimal"
                        />
                      </div>
                      <Button className="rounded-xl" onClick={() => void moveLot("available", "quarantine")} disabled={lotSaving}>
                        В карантин
                      </Button>
                      <Button
                        variant="secondary"
                        className="rounded-xl"
                        onClick={() => void moveLot("quarantine", "available")}
                        disabled={lotSaving}
                      >
                        Снять карантин
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Загрузка…
                  </div>
                )}
                <DialogFooter className="gap-2 flex-col sm:flex-row">
                  <Button variant="outline" className="rounded-xl" onClick={() => setLotOpen(false)}>
                    Закрыть
                  </Button>
                  <Button className="rounded-xl" onClick={() => void saveLotFields()} disabled={lotSaving || !activeLotId}>
                    Сохранить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Card className="p-4 bg-card rounded-2xl shadow-sm border-0">
              <div className="mb-2 font-semibold text-foreground">История движений</div>
              {(data?.history || []).length === 0 ? (
                <div className="text-sm text-muted-foreground">Нет движений</div>
              ) : (
                <div className="space-y-2">
                  {(data?.history || []).slice(0, 20).map((h, idx) => (
                    <div key={`${h.at}-${idx}`} className="rounded-xl bg-secondary/50 p-3 text-xs text-muted-foreground">
                      <div className="font-mono">{String(h.at)}</div>
                      <div className="mt-1">
                        {h.movementType} · {h.itemCode} · ×{h.qty}
                      </div>
                      <div className="mt-1 font-mono">
                        {h.fromLocationCode ?? "—"} → {h.toLocationCode ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        ) : (
          <Card className="p-4 rounded-2xl shadow-sm border-0">
            <div className="text-sm text-muted-foreground">Ячейка не найдена</div>
          </Card>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4">
        <Button
          className="w-full rounded-xl h-12"
          variant="secondary"
          onClick={() => router.push(`/cells?query=${encodeURIComponent(locationCode)}`)}
        >
          Открыть в веб (ячейки)
        </Button>
      </div>
    </div>
  )
}

export default function MobileLocationPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="h-10 w-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-muted-foreground">Загрузка...</p>
          </div>
        </div>
      }
    >
      <LocationContent />
    </Suspense>
  )
}

