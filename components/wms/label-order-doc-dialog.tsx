"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  Check,
  History,
  Loader2,
  RotateCcw,
  ScrollText,
  Undo2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  labelOrderAuthorLabel,
  labelOrderOriginLabel,
  loadLabelOrderDoc,
  revertLabelOrderAdjustmentRequest,
  submitLabelOrderAdjustment,
  type LabelOrderRow,
} from "@/lib/wms/label-order-client"
import type { LabelOrderDoc, LabelOrderEvent } from "@/lib/wms/label-order-docs"
import {
  fmtInt,
  fmtPercent,
  labelOrderFactVerdict,
  plannedWasteQty,
  summarizeLabelOrderFact,
  type LabelOrderAdjustment,
  type LabelOrderFact,
  type LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"
import { stickerTypeRu } from "@/lib/wms/label-print-material"

const EVENT_LABEL: Record<string, string> = {
  created: "Заказ создан",
  suz_signed: "Подписан в СУЗ",
  codes_ready: "Коды получены",
  status: "Смена статуса",
  printed: "Отправлен в печать",
  receiving: "Передан в приёмку",
  adjustment: "Корректировка факта",
  adjustment_reverted: "Корректировка отменена",
  deleted: "Заказ удалён",
}

function fmtStamp(iso: string | null | undefined): string {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  } catch {
    return iso
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 text-right text-xs text-foreground">{value}</span>
    </div>
  )
}

function FactTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string
  value: string
  hint?: string
  tone?: "neutral" | "ok" | "warn" | "danger"
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2",
        tone === "ok" && "border-emerald-500/40 bg-emerald-500/5",
        tone === "warn" && "border-amber-500/40 bg-amber-500/5",
        tone === "danger" && "border-destructive/40 bg-destructive/5",
        tone === "neutral" && "border-border/60 bg-muted/20"
      )}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * Документ заказа и факт печати в одном окне: слева реквизиты и история,
 * справа корректировка — сколько напечатали годных и сколько промотали вхолостую.
 */
export function LabelOrderDocDialog({
  order,
  open,
  onOpenChange,
  settings,
  defaultTab = "doc",
  onChanged,
}: {
  order: LabelOrderRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  settings: LabelOrderWasteSettings
  defaultTab?: "doc" | "fact"
  onChanged: () => void
}) {
  const [tab, setTab] = useState<string>(defaultTab)
  const [loading, setLoading] = useState(false)
  const [doc, setDoc] = useState<LabelOrderDoc | null>(null)
  const [events, setEvents] = useState<LabelOrderEvent[]>([])
  const [adjustments, setAdjustments] = useState<LabelOrderAdjustment[]>([])
  const [fact, setFact] = useState<LabelOrderFact>(summarizeLabelOrderFact([]))
  const [printed, setPrinted] = useState("")
  const [spooled, setSpooled] = useState("")
  const [defect, setDefect] = useState("")
  const [comment, setComment] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const orderId = order?.id ?? ""

  const load = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    setError(null)
    try {
      const data = await loadLabelOrderDoc(orderId)
      setDoc(data.doc ?? null)
      setEvents(data.events ?? [])
      setAdjustments(data.adjustments ?? [])
      setFact(data.fact ?? summarizeLabelOrderFact(data.adjustments ?? []))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => {
    if (!open) return
    setTab(defaultTab)
    setPrinted("")
    setSpooled("")
    setDefect("")
    setComment("")
    void load()
  }, [open, defaultTab, load])

  const plan = useMemo(() => {
    const quantity = doc?.quantity || order?.quantity || 0
    const wastePercent = doc?.wastePercent ?? settings.wastePercent
    return {
      quantity,
      plannedWasteQty: doc?.plannedWasteQty ?? plannedWasteQty(quantity, settings),
      wastePercent,
    }
  }, [doc, order?.quantity, settings])

  const verdict = labelOrderFactVerdict(plan, fact, settings)

  const draftPrinted = Number(printed) || 0
  const draftSpooled = Number(spooled) || 0
  const draftDefect = Number(defect) || 0
  const draftTotal = draftPrinted + draftSpooled + draftDefect
  const draftWastePercent =
    draftPrinted > 0 ? ((draftSpooled + draftDefect) / draftPrinted) * 100 : 0

  const fillByPlan = () => {
    setPrinted(String(plan.quantity))
    setSpooled(String(plan.plannedWasteQty))
    setDefect("")
  }

  const submit = async () => {
    if (!orderId || draftTotal < 1) return
    setSaving(true)
    setError(null)
    try {
      const result = await submitLabelOrderAdjustment({
        id: orderId,
        printedQty: draftPrinted,
        spooledQty: draftSpooled,
        defectQty: draftDefect,
        comment: comment.trim(),
      })
      setFact(result.fact)
      setAdjustments(result.adjustments)
      setEvents(result.events)
      setPrinted("")
      setSpooled("")
      setDefect("")
      setComment("")
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const revert = async (adjustmentId: string) => {
    setSaving(true)
    setError(null)
    try {
      await revertLabelOrderAdjustmentRequest(adjustmentId)
      await load()
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-3 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <ScrollText className="size-4" />
            <span className="font-mono">{doc?.docNo || "Документ заказа"}</span>
            {loading ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
          </DialogTitle>
          <DialogDescription className="line-clamp-2">
            {order?.nomenclatureName || doc?.nomenclatureName || "—"} · GTIN{" "}
            <span className="font-mono">{order?.gtin || doc?.gtin || "—"}</span>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="doc" className="flex-1">
              Документ
            </TabsTrigger>
            <TabsTrigger value="fact" className="flex-1">
              Факт печати
              {fact.adjustmentsCount > 0 ? (
                <Badge variant="secondary" className="ml-1.5 rounded px-1 py-0 text-[10px]">
                  {fact.adjustmentsCount}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="doc" className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="rounded-lg border border-border/60 p-2.5">
              <div className="divide-y divide-border/40">
                <Row label="Создан" value={fmtStamp(doc?.createdAt || order?.createdAt)} />
                <Row
                  label="Автор"
                  value={
                    <>
                      {labelOrderAuthorLabel(doc)}
                      {doc?.authorPosition ? (
                        <span className="text-muted-foreground"> · {doc.authorPosition}</span>
                      ) : null}
                    </>
                  }
                />
                <Row label="Откуда" value={labelOrderOriginLabel(doc, order ?? undefined)} />
                <Row
                  label="Заказано"
                  value={`${fmtInt(plan.quantity)} кодов · ${stickerTypeRu(
                    doc?.stickerType || order?.stickerType
                  )}`}
                />
                <Row
                  label="План погрешности"
                  value={`${fmtInt(plan.plannedWasteQty)} шт (${fmtPercent(plan.wastePercent)})`}
                />
                <Row
                  label="Расход этикетки по плану"
                  value={`${fmtInt(plan.quantity + plan.plannedWasteQty)} шт`}
                />
                <Row
                  label="Коды в заказе"
                  value={order?.codesCount ? fmtInt(order.codesCount) : "не получены"}
                />
                {order?.printJobId ? (
                  <Row
                    label="Задание печати"
                    value={<span className="font-mono">{order.printJobId.slice(0, 8)}…</span>}
                  />
                ) : null}
                {order?.note ? <Row label="Примечание очереди" value={order.note} /> : null}
                {doc?.comment ? <Row label="Комментарий" value={doc.comment} /> : null}
              </div>
            </div>

            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <History className="size-3.5" />
                История
              </p>
              {events.length === 0 ? (
                <p className="rounded-lg border border-border/60 p-2.5 text-xs text-muted-foreground">
                  По этому заказу событий ещё нет.
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {events.map((event) => (
                    <li
                      key={event.eventId}
                      className="rounded-lg border border-border/50 bg-muted/15 px-2.5 py-1.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="text-xs font-medium text-foreground">
                          {EVENT_LABEL[event.kind] ?? event.kind}
                        </span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {fmtStamp(event.at)}
                        </span>
                      </div>
                      {event.detail ? (
                        <p className="text-[11px] leading-snug text-foreground/80">{event.detail}</p>
                      ) : null}
                      <p className="text-[11px] text-muted-foreground">
                        {event.authorFio || event.authorLogin || "система"}
                        {event.origin ? ` · ${event.origin}` : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </TabsContent>

          <TabsContent value="fact" className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <FactTile label="Годных" value={fmtInt(fact.printedQty)} hint={`план ${fmtInt(plan.quantity)}`} />
              <FactTile
                label="Промотано"
                value={fmtInt(fact.spooledQty)}
                hint={`план ${fmtInt(plan.plannedWasteQty)}`}
              />
              <FactTile label="Брак" value={fmtInt(fact.defectQty)} />
              <FactTile
                label="Погрешность"
                value={fact.adjustmentsCount ? fmtPercent(fact.wastePercent) : "—"}
                hint={verdict.text}
                tone={
                  verdict.tone === "empty"
                    ? "neutral"
                    : verdict.tone === "ok"
                      ? "ok"
                      : verdict.tone === "warn"
                        ? "warn"
                        : "danger"
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Всего с рулона по факту: {fmtInt(fact.labelsQty)} этикеток
              {fact.lastAt ? ` · последняя запись ${fmtStamp(fact.lastAt)}` : ""}
              {fact.lastAuthor ? ` · ${fact.lastAuthor}` : ""}
            </p>

            <div className="space-y-2 rounded-lg border border-border/60 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">Внести факт печати</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-xs"
                  onClick={fillByPlan}
                >
                  <RotateCcw className="mr-1 size-3" />
                  По плану
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted-foreground">Напечатано годных</span>
                  <Input
                    value={printed}
                    inputMode="numeric"
                    onChange={(e) => setPrinted(e.target.value.replace(/[^\d]/g, ""))}
                    className="h-9 tabular-nums"
                    placeholder="100"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted-foreground">Промотано вхолостую</span>
                  <Input
                    value={spooled}
                    inputMode="numeric"
                    onChange={(e) => setSpooled(e.target.value.replace(/[^\d]/g, ""))}
                    className="h-9 tabular-nums"
                    placeholder="30"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] text-muted-foreground">Брак</span>
                  <Input
                    value={defect}
                    inputMode="numeric"
                    onChange={(e) => setDefect(e.target.value.replace(/[^\d]/g, ""))}
                    className="h-9 tabular-nums"
                    placeholder="0"
                  />
                </label>
              </div>
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: рулон закончился на 640-й этикетке, дальше печатали со второго"
                className="min-h-[54px] text-xs"
              />
              {draftTotal > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  Спишется с рулона {fmtInt(draftTotal)} этикеток · погрешность записи{" "}
                  {fmtPercent(draftWastePercent)}
                  {draftPrinted > 0 && draftPrinted !== plan.quantity
                    ? ` · расхождение с заказом ${fmtInt(plan.quantity - draftPrinted)}`
                    : ""}
                </p>
              ) : null}
              {error ? (
                <p className="flex items-start gap-1.5 text-[11px] text-destructive">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  {error}
                </p>
              ) : null}
              <Button
                type="button"
                className="w-full"
                disabled={draftTotal < 1 || saving}
                onClick={() => void submit()}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : (
                  <Check className="mr-1.5 size-3.5" />
                )}
                Записать корректировку
              </Button>
            </div>

            {adjustments.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold text-foreground">Корректировки</p>
                {adjustments.map((adj) => (
                  <div
                    key={adj.adjustmentId}
                    className={cn(
                      "rounded-lg border px-2.5 py-1.5",
                      adj.revertedAt
                        ? "border-border/40 bg-muted/20 opacity-70"
                        : "border-border/60 bg-card"
                    )}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                      <span className="text-xs tabular-nums text-foreground">
                        годных {fmtInt(adj.printedQty)} · промотано {fmtInt(adj.spooledQty)}
                        {adj.defectQty ? ` · брак ${fmtInt(adj.defectQty)}` : ""}
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {fmtStamp(adj.createdAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <span className="text-[11px] text-muted-foreground">
                        {adj.authorFio || adj.authorLogin || "—"}
                        {adj.revertedAt ? ` · отменил ${adj.revertedBy ?? "—"}` : ""}
                      </span>
                      {adj.revertedAt ? (
                        <span className="text-[11px] text-muted-foreground">отменена</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[11px] text-muted-foreground"
                          disabled={saving}
                          onClick={() => void revert(adj.adjustmentId)}
                        >
                          <Undo2 className="mr-1 size-3" />
                          Отменить
                        </Button>
                      )}
                    </div>
                    {adj.comment ? (
                      <p className="text-[11px] leading-snug text-foreground/75">{adj.comment}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </TabsContent>
        </Tabs>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
