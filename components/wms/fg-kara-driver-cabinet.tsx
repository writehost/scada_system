"use client"

import { useMemo, useState } from "react"
import { CheckCircle2, Loader2, Play, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  advanceFgMission,
  dispatchFgKara,
  type FgKaraDriver,
  type FgKaraFleetSnapshot,
  type FgKaraMission,
  type FgKaraUnit,
} from "@/lib/wms-api"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

const KIND_LABEL: Record<string, string> = {
  main: "Основное",
  interleave: "Попутно",
  urgent: "Срочно",
}

const STATUS_LABEL: Record<string, string> = {
  queued: "В очереди",
  active: "В работе",
  done: "Сдано",
  cancelled: "Отменено",
  refused: "Отказ",
}

type Props = {
  fleet: FgKaraFleetSnapshot | null
  onFleet: (next: FgKaraFleetSnapshot) => void
  onReload: () => Promise<void>
}

export function FgKaraDriverCabinet({ fleet, onFleet, onReload }: Props) {
  const { toast } = useToast()
  const drivers = fleet?.drivers ?? []
  const missions = fleet?.missions ?? []
  const karas = fleet?.karas ?? []

  const [driverId, setDriverId] = useState(drivers[0]?.id || "")
  const [busyId, setBusyId] = useState<string | null>(null)

  // dispatcher quick create
  const [kind, setKind] = useState<"main" | "interleave" | "urgent">("main")
  const [karaId, setKaraId] = useState("")
  const [lotCode, setLotCode] = useState("")
  const [palletId, setPalletId] = useState("")
  const [targetRowId, setTargetRowId] = useState("")
  const [creating, setCreating] = useState(false)

  const driver: FgKaraDriver | null = useMemo(
    () => drivers.find((d) => d.id === driverId) || null,
    [drivers, driverId]
  )

  const myMissions = useMemo(() => {
    const list = missions.filter((m) => {
      if (driverId && m.driverId === driverId) return true
      if (driver?.karaId && m.karaId === driver.karaId && !m.driverId) return true
      if (!driverId) return m.status === "queued" || m.status === "active"
      return false
    })
    return [...list].sort((a, b) => {
      const pr = (b.priority ?? 0) - (a.priority ?? 0)
      if (pr !== 0) return pr
      return (b.createdAt || "").localeCompare(a.createdAt || "")
    })
  }, [missions, driverId, driver])

  const karaMap = useMemo(() => {
    const m = new Map<string, FgKaraUnit>()
    for (const k of karas) m.set(k.id, k)
    return m
  }, [karas])

  async function act(missionId: string, action: "accept" | "complete" | "refuse" | "wrong_row") {
    setBusyId(missionId)
    try {
      const reason = action === "refuse" ? prompt("Причина отказа") || "отказ" : null
      const actualRowId =
        action === "wrong_row" ? prompt("В какой ряд поставил фактически?") || null : null
      const res = await advanceFgMission(missionId, action, {
        driverId: driverId || null,
        refuseReason: reason,
        actualRowId,
      })
      if (res.fleet) {
        onFleet({ ...res.fleet, tags: fleet?.tags || [], pathTags: fleet?.pathTags })
      } else {
        await onReload()
      }
      toast({
        title:
          action === "accept"
            ? "Задание взято"
            : action === "complete"
              ? res.interleave
                ? "Палета сдана · есть попутное"
                : "Палета сдана"
              : action === "wrong_row"
                ? "Нарушение: не тот ряд"
                : "Отказ зафиксирован",
        description:
          action === "complete" && res.interleave ? res.interleave.reason : undefined,
      })
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "не удалось",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  async function createTask() {
    const kId = karaId || driver?.karaId || ""
    if (!kId) {
      toast({ title: "Укажите кару", variant: "destructive" })
      return
    }
    setCreating(true)
    try {
      const res = await dispatchFgKara({
        karaId: kId,
        kind,
        source: "manual",
        driverId: driverId || null,
        lotCode: lotCode || null,
        palletId: palletId || null,
        targetRowId: targetRowId || null,
        startStatus: "queued",
        note:
          kind === "urgent"
            ? "Срочный забор (ручное задание)"
            : kind === "interleave"
              ? "Попутное задание"
              : "Основное задание",
        stops: [
          { tagId: 1, kind: "pickup", label: "Погрузка" },
          {
            tagId: 0,
            kind: "drop",
            label: targetRowId ? `Ряд ${targetRowId}` : "Выгрузка",
            rowId: targetRowId || undefined,
          },
        ],
      })
      if (res.fleet) {
        onFleet({ ...res.fleet, tags: fleet?.tags || [], pathTags: fleet?.pathTags })
      } else {
        await onReload()
      }
      setLotCode("")
      setPalletId("")
      toast({ title: "Задание создано", description: KIND_LABEL[kind] })
    } catch (e) {
      toast({
        title: "Не удалось создать",
        description: e instanceof Error ? e.message : "ошибка",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  function missionCard(m: FgKaraMission) {
    const kara = karaMap.get(m.karaId)
    const busy = busyId === m.id
    return (
      <article
        key={m.id}
        className={cn(
          "rounded-xl border border-border bg-card p-4",
          m.kind === "urgent" && "border-destructive/40 bg-destructive/5",
          m.kind === "interleave" && "border-amber-500/30"
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap gap-1">
              <Badge variant={m.kind === "urgent" ? "destructive" : "secondary"}>
                {KIND_LABEL[m.kind || "main"] || m.kind}
              </Badge>
              <Badge variant="outline">{STATUS_LABEL[m.status] || m.status}</Badge>
              {m.source ? <Badge variant="outline">{m.source}</Badge> : null}
            </div>
            <div className="mt-2 font-medium">{m.routeName}</div>
            <p className="text-xs text-muted-foreground">
              {kara ? kara.boardName || kara.name : m.karaId}
              {m.lineCode ? ` · линия ${m.lineCode}` : ""}
              {m.lotCode ? ` · партия ${m.lotCode}` : ""}
              {m.palletId ? ` · палета ${m.palletId}` : ""}
              {m.targetRowId ? ` · ряд ${m.targetRowId}` : ""}
            </p>
            {m.note ? <p className="mt-1 text-xs text-muted-foreground">{m.note}</p> : null}
            {m.refuseReason ? (
              <p className="mt-1 text-xs text-destructive">Отказ: {m.refuseReason}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {(m.status === "queued" || (m.status === "active" && !m.acceptedAt)) && (
              <Button size="sm" disabled={busy} onClick={() => void act(m.id, "accept")}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
                Взял
              </Button>
            )}
            {m.status === "active" && (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act(m.id, "complete")}>
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
                  Сдал
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(m.id, "wrong_row")}>
                  Не тот ряд
                </Button>
              </>
            )}
            {(m.status === "queued" || m.status === "active") && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(m.id, "refuse")}>
                <XCircle className="mr-1 h-3.5 w-3.5" />
                Отказ
              </Button>
            )}
          </div>
        </div>
      </article>
    )
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Кабинет карщика</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Выберите себя из списка (пока без отдельного логина). Здесь — взять задание, сдать палету или
          зафиксировать отказ. Подтверждение «сдал» пока ручное: на вилах нет идентификации палеты.
        </p>
        <label className="block max-w-md space-y-1 text-sm">
          <span className="text-muted-foreground">Карщик</span>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={driverId}
            onChange={(e) => setDriverId(e.target.value)}
          >
            <option value="">все открытые задания</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.fullName}
                {d.shiftCode ? ` · смена ${d.shiftCode}` : ""}
                {d.lineCode ? ` · ${d.lineCode}` : ""}
              </option>
            ))}
          </select>
        </label>
        {driver ? (
          <p className="mt-2 text-xs text-muted-foreground">
            График:{" "}
            {driver.schedule.length
              ? driver.schedule
                  .map((s) => ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][s.weekday] + ` ${s.from}-${s.to}`)
                  .join(", ")
              : "не задан"}
          </p>
        ) : null}
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-2 text-sm font-medium">Создать задание (диспетчер / тест)</div>
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <select
            className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="main">Основное</option>
            <option value="interleave">Попутно</option>
            <option value="urgent">Срочно</option>
          </select>
          <select
            className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
            value={karaId}
            onChange={(e) => setKaraId(e.target.value)}
          >
            <option value="">кара из профиля</option>
            {karas.map((k) => (
              <option key={k.id} value={k.id}>
                {k.boardName || k.name}
              </option>
            ))}
          </select>
          <input
            className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
            placeholder="Партия"
            value={lotCode}
            onChange={(e) => setLotCode(e.target.value)}
          />
          <input
            className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
            placeholder="№ палеты"
            value={palletId}
            onChange={(e) => setPalletId(e.target.value)}
          />
          <input
            className="flex h-10 rounded-md border border-input bg-background px-2 text-sm"
            placeholder="Ряд (цель)"
            value={targetRowId}
            onChange={(e) => setTargetRowId(e.target.value)}
          />
          <Button disabled={creating} onClick={() => void createTask()}>
            {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Создать
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Мои задания ({myMissions.length})</div>
        {myMissions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Нет заданий. Создайте тестовое выше или дождитесь сигнала с линии.
          </div>
        ) : (
          myMissions.map(missionCard)
        )}
      </div>
    </div>
  )
}
