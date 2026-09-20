"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  Flag,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Sparkles,
  Undo2,
  XCircle,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  assignWmsTaskDevice,
  cancelWmsTask,
  claimWmsTask,
  completeWmsTask,
  getWmsTaskDetail,
  listDevices,
  recommendWmsPutaway,
  releaseWmsTaskToQueue,
  reportWmsTaskException,
  resumeWmsTask,
  startWmsTask,
  suspendWmsTask,
  type WmsDeviceRow,
  type WmsPutawayRecommendation,
} from "@/lib/wms-api"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export default function TaskDetailPage() {
  const params = useParams()
  const raw = typeof params?.taskId === "string" ? params.taskId : ""
  const taskId = raw ? decodeURIComponent(raw) : ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{
    task: Record<string, unknown>
    movements: unknown[]
  } | null>(null)
  const [actionBusy, setActionBusy] = useState(false)

  const [confirmedQty, setConfirmedQty] = useState("")
  const [targetLocationCode, setTargetLocationCode] = useState("")
  const [completeNote, setCompleteNote] = useState("")
  const [exceptionCode, setExceptionCode] = useState("short_pick")
  const [exceptionNote, setExceptionNote] = useState("")
  const [cancelNote, setCancelNote] = useState("")

  const [putawayBusy, setPutawayBusy] = useState(false)
  const [putawayRecs, setPutawayRecs] = useState<WmsPutawayRecommendation[]>([])
  const [putawayErr, setPutawayErr] = useState<string | null>(null)

  const [devices, setDevices] = useState<WmsDeviceRow[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [assignDeviceUid, setAssignDeviceUid] = useState("")
  const [dispatchNote, setDispatchNote] = useState("")
  const [assignHint, setAssignHint] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    setError(null)
    try {
      const d = await getWmsTaskDetail(taskId)
      setDetail(d)
      const t = d.task as Record<string, unknown>
      setConfirmedQty(
        t.plannedQty != null && String(t.plannedQty) !== "" ? String(t.plannedQty) : ""
      )
      const tl = String(t.targetLocationCode ?? "").trim()
      setTargetLocationCode(tl)
      const currentUid = String(t.assignedDeviceUid ?? "").trim()
      setAssignDeviceUid((prev) => prev || currentUid)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки")
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    let cancelled = false
    setDevicesLoading(true)
    setDevicesError(null)
    listDevices({ query: "" })
      .then((r) => {
        if (cancelled) return
        const rows = [...(r.devices ?? [])].sort((a, b) => {
          const ao = deviceIsOnline(a) ? 0 : 1
          const bo = deviceIsOnline(b) ? 0 : 1
          if (ao !== bo) return ao - bo
          return (a.deviceName || "").localeCompare(b.deviceName || "", "ru")
        })
        setDevices(rows)
      })
      .catch((e) => {
        if (cancelled) return
        setDevices([])
        setDevicesError(e instanceof Error ? e.message : "Не удалось загрузить терминалы")
      })
      .finally(() => {
        if (!cancelled) setDevicesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const t = detail?.task as Record<string, unknown> | undefined
  const status = String(t?.taskStatus ?? "")
  const taskTypeLc = String(t?.taskType ?? "").toLowerCase()
  const isPutawayTask = taskTypeLc === "putaway"
  const putawayItemCode = String(t?.itemCode ?? "").trim()

  async function fetchPutawayRecommendations() {
    if (!putawayItemCode) {
      setPutawayErr("Нет itemCode в задании")
      return
    }
    setPutawayBusy(true)
    setPutawayErr(null)
    try {
      const qty =
        Number(confirmedQty.trim()) ||
        (t?.plannedQty != null ? Number(t.plannedQty) : NaN) ||
        1
      const lotRaw = t?.lotCode
      const lotCode =
        typeof lotRaw === "string" && lotRaw.trim() ? lotRaw.trim() : null
      const res = await recommendWmsPutaway({
        itemCode: putawayItemCode,
        lotCode,
        qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
        limit: 8,
      })
      setPutawayRecs(res.recommendations || [])
    } catch (e) {
      setPutawayRecs([])
      setPutawayErr(e instanceof Error ? e.message : "Не удалось получить рекомендации")
    } finally {
      setPutawayBusy(false)
    }
  }

  function applyRecommendedLocation(code: string) {
    setTargetLocationCode(code)
  }

  function fillQtyFromPlan() {
    if (t?.plannedQty != null && String(t.plannedQty) !== "") {
      setConfirmedQty(String(t.plannedQty))
    }
  }

  async function completeWithTopRecommendation() {
    const ok = putawayRecs.find((r) => !r.forbidden)
    if (!ok?.locationCode) {
      setPutawayErr("Нет допустимой рекомендации — запросите список или укажите ячейку вручную")
      return
    }
    setTargetLocationCode(ok.locationCode)
    setActionBusy(true)
    setError(null)
    try {
      await completeWmsTask(taskId, {
        confirmedQty: confirmedQty.trim() ? Number(confirmedQty) : undefined,
        targetLocationCode: ok.locationCode,
        note: completeNote.trim() || undefined,
      })
      await load()
      setPutawayRecs([])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionBusy(false)
    }
  }

  async function onClaim() {
    if (!taskId) return
    setActionBusy(true)
    setError(null)
    try {
      await claimWmsTask(taskId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionBusy(false)
    }
  }

  async function onStart() {
    if (!taskId) return
    setActionBusy(true)
    setError(null)
    try {
      await startWmsTask(taskId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionBusy(false)
    }
  }

  async function onComplete() {
    if (!taskId) return
    setActionBusy(true)
    setError(null)
    try {
      await completeWmsTask(taskId, {
        confirmedQty: confirmedQty.trim() ? Number(confirmedQty) : undefined,
        targetLocationCode: targetLocationCode.trim() || undefined,
        note: completeNote.trim() || undefined,
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionBusy(false)
    }
  }

  async function onException() {
    if (!taskId) return
    if (!exceptionCode.trim()) {
      setError("Укажите код исключения")
      return
    }
    setActionBusy(true)
    setError(null)
    try {
      await reportWmsTaskException(taskId, exceptionCode.trim(), exceptionNote.trim() || undefined)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionBusy(false)
    }
  }

  async function onCancel() {
    if (!taskId) return
    if (!window.confirm("Отменить задание? (статус cancelled)")) return
    setActionBusy(true)
    setError(null)
    try {
      await cancelWmsTask(taskId, cancelNote.trim() || undefined)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка")
    } finally {
      setActionBusy(false)
    }
  }

  async function onAssignDevice() {
    const currentUid = String(t?.assignedDeviceUid ?? "").trim()
    const uid = assignDeviceUid.trim() || currentUid
    if (!taskId || !uid) {
      setError("Выберите терминал в списке")
      return
    }
    const picked = devices.find((d) => d.deviceUid === uid)
    if (picked && !deviceIsOnline(picked)) {
      setAssignHint(
        `${picked.deviceName} сейчас офлайн. Задание всё равно назначим — оно появится, когда терминал выйдет на связь.`
      )
    } else {
      setAssignHint(null)
    }
    setActionBusy(true)
    setError(null)
    try {
      await assignWmsTaskDevice(taskId, uid)
      setAssignDeviceUid(uid)
      await load()
      setAssignHint((prev) => prev || `Назначено на ${picked?.deviceName || uid}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось назначить")
    } finally {
      setActionBusy(false)
    }
  }

  async function onReleaseToQueue() {
    if (!taskId) return
    if (
      !window.confirm(
        "Вернуть задание в общую очередь? Снимется назначение терминала и исполнителя."
      )
    ) {
      return
    }
    setActionBusy(true)
    setError(null)
    try {
      await releaseWmsTaskToQueue(taskId, dispatchNote.trim() || undefined)
      setDispatchNote("")
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось вернуть в очередь")
    } finally {
      setActionBusy(false)
    }
  }

  async function onSuspend() {
    if (!taskId) return
    setActionBusy(true)
    setError(null)
    try {
      await suspendWmsTask(taskId, dispatchNote.trim() || undefined)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось приостановить")
    } finally {
      setActionBusy(false)
    }
  }

  async function onResume() {
    if (!taskId) return
    setActionBusy(true)
    setError(null)
    try {
      await resumeWmsTask(taskId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось возобновить")
    } finally {
      setActionBusy(false)
    }
  }

  if (!taskId) {
    return <p className="p-6 text-destructive">Некорректный id задания</p>
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Загрузка…
      </div>
    )
  }

  if (!t) {
    return (
      <div className="p-6">
        {error && <p className="text-destructive">{error}</p>}
        <Link href="/tasks" className="text-sm text-muted-foreground">
          Назад к списку
        </Link>
      </div>
    )
  }

  const canAct =
    status === "open" ||
    status === "claimed" ||
    status === "in_progress" ||
    status === "exception" ||
    status === "on_hold"
  const isFinal = status === "completed" || status === "cancelled" || status === "failed"
  const canRelease =
    status === "claimed" || status === "in_progress" || status === "exception" || status === "on_hold"
  const canSuspend = status === "claimed" || status === "in_progress"
  const isOnHold = status === "on_hold"

  return (
    <div>
      <Link
        href="/tasks"
        className="mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        К очереди
      </Link>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{String(t.taskCode ?? "—")}</h1>
          <p className="text-sm text-muted-foreground">
            {String(t.itemName ?? t.itemCode ?? "—")} {t.documentNo ? `· ${String(t.documentNo)}` : ""}
          </p>
          {isPutawayTask && putawayItemCode ? (
            <p className="mt-1 text-xs text-muted-foreground font-mono">
              putaway · {putawayItemCode}
              {typeof t.lotCode === "string" && t.lotCode.trim() ? ` · ${t.lotCode}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary" className="rounded-lg">
            {String(t.taskType ?? "—")}
          </Badge>
          <Badge
            className={cn("rounded-lg", isFinal && "bg-secondary text-muted-foreground")}
            variant="secondary"
          >
            {status === "on_hold" ? "пауза" : status}
          </Badge>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {t.sourceLocationCode || t.targetLocationCode ? (
        <p className="mb-4 text-sm text-muted-foreground">
          {String(t.sourceLocationCode ?? "—")} → {String(t.targetLocationCode ?? "—")}
        </p>
      ) : null}

      {!isFinal && (
        <div className="mb-6 max-w-lg space-y-3 rounded-xl border border-border bg-card/40 p-4">
          <h3 className="text-sm font-medium text-foreground">Терминал и диспетчеризация</h3>
          <p className="text-xs text-muted-foreground">
            Сейчас:{" "}
            <span className="font-medium text-foreground">
              {typeof t.assignedDevice === "string" && t.assignedDevice.trim()
                ? t.assignedDevice
                : "не назначен"}
            </span>
          </p>
          {isOnHold ? (
            <p className="text-sm text-amber-800 dark:text-amber-200/90">
              Задание на паузе
              {t.exceptionNote != null && String(t.exceptionNote).trim() ? ` — ${String(t.exceptionNote)}` : ""}
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm font-medium text-foreground">
              Назначить на терминал
              <select
                className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={assignDeviceUid}
                onChange={(e) => setAssignDeviceUid(e.target.value)}
                disabled={actionBusy || devicesLoading}
              >
                <option value="">— выберите ТСД —</option>
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceUid}>
                    {deviceIsOnline(d) ? "онлайн" : "офлайн"} · {d.deviceName} ({d.deviceUid})
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              className="rounded-xl sm:mb-0"
              disabled={actionBusy || !(assignDeviceUid.trim() || String(t.assignedDeviceUid ?? "").trim())}
              onClick={() => void onAssignDevice()}
            >
              <Smartphone className="mr-2 h-4 w-4" />
              Назначить
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Выберите живой ТСД и нажмите «Назначить». Сейчас в сети только терминалы с пометкой «онлайн».
          </p>
          {assignHint ? <p className="text-xs text-foreground">{assignHint}</p> : null}
          {devicesLoading ? (
            <p className="text-xs text-muted-foreground">Загрузка списка терминалов…</p>
          ) : devicesError ? (
            <p className="text-xs text-destructive">{devicesError}</p>
          ) : devices.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Нет терминалов — зарегистрируйте ТСД в разделе «Терминалы».
            </p>
          ) : null}

          <div>
            <Label className="text-xs">Комментарий (для возврата в очередь / приостановки)</Label>
            <Textarea
              value={dispatchNote}
              onChange={(e) => setDispatchNote(e.target.value)}
              className="mt-1 rounded-xl"
              rows={2}
              placeholder="Необязательно"
              disabled={actionBusy}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {isOnHold && (
              <Button
                type="button"
                variant="default"
                className="rounded-xl"
                disabled={actionBusy}
                onClick={() => void onResume()}
              >
                {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                <span className="ml-1">Возобновить</span>
              </Button>
            )}
            {canSuspend && !isOnHold && (
              <Button
                type="button"
                variant="secondary"
                className="rounded-xl"
                disabled={actionBusy}
                onClick={() => void onSuspend()}
              >
                {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
                <span className="ml-1">Приостановить</span>
              </Button>
            )}
            {canRelease && (
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                disabled={actionBusy}
                onClick={() => void onReleaseToQueue()}
              >
                {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                <span className="ml-1">Вернуть в очередь</span>
              </Button>
            )}
          </div>
        </div>
      )}

      {!isFinal && canAct && (
        <div className="mb-6 flex flex-wrap gap-2">
          {status === "open" && (
            <Button
              onClick={() => void onClaim()}
              disabled={actionBusy}
              className="rounded-xl"
            >
              {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="ml-1">Взять</span>
            </Button>
          )}
          {status === "claimed" && !isOnHold && (
            <Button
              onClick={() => void onStart()}
              disabled={actionBusy}
              className="rounded-xl"
            >
              {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              <span className="ml-1">В работу</span>
            </Button>
          )}
          {(status === "claimed" || status === "in_progress" || status === "exception") && !isOnHold && (
            <>
              <div className="w-full" />
              <div className="w-full min-w-[280px] max-w-md space-y-2 rounded-xl border border-border p-4">
                <h3 className="text-sm font-medium">Завершить</h3>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="rounded-xl"
                    onClick={() => fillQtyFromPlan()}
                    disabled={actionBusy || t.plannedQty == null}
                  >
                    Qty = план
                  </Button>
                  {isPutawayTask && putawayItemCode ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="rounded-xl"
                      onClick={() => void fetchPutawayRecommendations()}
                      disabled={actionBusy || putawayBusy}
                    >
                      {putawayBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      <span className="ml-1">Рекомендация ячейки</span>
                    </Button>
                  ) : null}
                </div>
                {putawayErr ? (
                  <p className="text-xs text-destructive">{putawayErr}</p>
                ) : null}
                {isPutawayTask && putawayRecs.length > 0 ? (
                  <div className="rounded-lg border border-border/80 bg-secondary/20 p-2 text-xs">
                    <div className="mb-2 font-medium text-foreground">Варианты размещения</div>
                    <ul className="max-h-48 space-y-2 overflow-auto">
                      {putawayRecs.map((r) => (
                        <li
                          key={r.locationCode}
                          className="flex flex-col gap-1 rounded-md border border-border/60 bg-background p-2 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <span className="font-mono font-medium">{r.locationCode}</span>
                            <span className="ml-2 text-muted-foreground">{r.reason}</span>
                            {r.forbidden ? (
                              <span className="ml-2 text-destructive">запрет</span>
                            ) : null}
                            {r.details ? (
                              <div className="text-muted-foreground">{r.details}</div>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="shrink-0 rounded-lg"
                            disabled={r.forbidden || actionBusy}
                            onClick={() => applyRecommendedLocation(r.locationCode)}
                          >
                            В целевую
                          </Button>
                        </li>
                      ))}
                    </ul>
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      className="mt-2 w-full rounded-xl"
                      disabled={actionBusy || !putawayRecs.some((x) => !x.forbidden)}
                      onClick={() => void completeWithTopRecommendation()}
                    >
                      Завершить с лучшей ячейкой
                    </Button>
                  </div>
                ) : null}
                <div>
                  <Label className="text-xs">Подтверждённое кол-во</Label>
                  <Input
                    value={confirmedQty}
                    onChange={(e) => setConfirmedQty(e.target.value)}
                    className="mt-1 rounded-xl"
                    inputMode="decimal"
                  />
                </div>
                <div>
                  <Label className="text-xs">Целевая ячейка (если отличается)</Label>
                  <Input
                    value={targetLocationCode}
                    onChange={(e) => setTargetLocationCode(e.target.value)}
                    className="mt-1 rounded-xl"
                  />
                </div>
                <div>
                  <Label className="text-xs">Примечание</Label>
                  <Textarea
                    value={completeNote}
                    onChange={(e) => setCompleteNote(e.target.value)}
                    className="mt-1 rounded-xl"
                    rows={2}
                  />
                </div>
                <Button
                  onClick={() => void onComplete()}
                  disabled={actionBusy}
                  className="rounded-xl"
                >
                  {actionBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  <span className="ml-1">Завершить</span>
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {!isFinal && canAct && (
        <div className="mb-6 grid max-w-md gap-4">
          <div className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm font-medium">Исключение</h3>
            <Input
              value={exceptionCode}
              onChange={(e) => setExceptionCode(e.target.value)}
              className="mb-2 rounded-xl"
              placeholder="Код, например short_pick"
            />
            <Textarea
              value={exceptionNote}
              onChange={(e) => setExceptionNote(e.target.value)}
              className="mb-2 rounded-xl"
              rows={2}
              placeholder="Описание"
            />
            <Button variant="secondary" onClick={() => void onException()} disabled={actionBusy} className="rounded-xl">
              {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
              <span className="ml-1">Зарегистрировать</span>
            </Button>
          </div>
          <div className="rounded-xl border border-border p-4">
            <h3 className="mb-2 text-sm font-medium">Отмена задания</h3>
            <Textarea
              value={cancelNote}
              onChange={(e) => setCancelNote(e.target.value)}
              className="mb-2 rounded-xl"
              rows={2}
              placeholder="Причина (необязательно)"
            />
            <Button variant="destructive" onClick={() => void onCancel()} disabled={actionBusy} className="rounded-xl">
              {actionBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
              <span className="ml-1">Отменить</span>
            </Button>
          </div>
        </div>
      )}

      {t.exceptionCode != null &&
      String(t.exceptionCode) !== "" &&
      String(t.exceptionCode) !== "on_hold" ? (
        <div className="mb-4 rounded-xl border border-border bg-card p-4 text-sm">
          <span className="font-medium">Исключение: {String(t.exceptionCode)}</span>
          {t.exceptionNote != null && String(t.exceptionNote) !== "" ? (
            <p className="text-muted-foreground">{String(t.exceptionNote)}</p>
          ) : null}
        </div>
      ) : null}

      <h2 className="mb-2 text-lg font-semibold">Движения (по документу)</h2>
      {detail?.movements?.length ? (
        <ul className="space-y-2 text-sm text-muted-foreground">
          {detail.movements.map((m) => {
            const r = m as Record<string, unknown>
            return (
              <li
                key={String(r.movementId ?? r.at)}
                className="rounded-lg border border-border/60 p-2"
              >
                {String(r.at)} · {String(r.movementType)} · {String(r.fromLocationCode ?? "—")} →{" "}
                {String(r.toLocationCode ?? "—")} (×{String(r.qty ?? "")})
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Пока нет движений</p>
      )}
    </div>
  )
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000

function deviceIsOnline(row: WmsDeviceRow): boolean {
  const status = (row.deviceStatus || "").toLowerCase()
  if (status === "blocked" || status === "retired") return false
  const seen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0
  if (!seen || Number.isNaN(seen)) return false
  return Date.now() - seen <= ONLINE_WINDOW_MS
}
