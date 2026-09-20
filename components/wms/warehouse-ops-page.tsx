"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, RefreshCw, Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  getWarehouseOpsInbox,
  postWarehouseOpsAction,
  type WarehouseOpsInbox,
} from "@/lib/wms-api"
import { WmsEmptyState, WmsErrorState } from "@/components/wms/wms-shared"

function fmtQty(n: number) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n)
}

function fmtWhen(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

const REASON_RU: Record<string, string> = {
  kanban: "e-Kanban",
  "two-bin": "Two-bin",
  starvation: "Линия пустая",
  below_min: "Ниже min",
}

export function WarehouseOpsPage() {
  const [inbox, setInbox] = useState<WarehouseOpsInbox | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [fefoItem, setFefoItem] = useState("")
  const [fefoLot, setFefoLot] = useState("")
  const [fefoReason, setFefoReason] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getWarehouseOpsInbox()
      setInbox(res.inbox)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить очередь методов")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: Parameters<typeof postWarehouseOpsAction>[0], okText: string) {
    setBusy(action.action)
    setMsg(null)
    try {
      const res = await postWarehouseOpsAction(action)
      const extra =
        res.created?.documentId != null
          ? ` Документ ${res.created.documentId}, заданий ${res.created.taskCount}.`
          : res.waveId
            ? ` Волна ${res.waveId}.`
            : ""
      setMsg(okText + extra)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Действие не выполнено")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Методы склада</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Пополнение линии с OS в ячейки цеха, рейс тягача, волны отбора и журнал отклонений FEFO.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-8 rounded-md" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
            Обновить
          </Button>
          <Button size="sm" className="h-8 rounded-md" asChild>
            <Link href="/help#warehouse-ops-inbox">Как это работает</Link>
          </Button>
        </div>
      </div>

      {error ? <WmsErrorState title="Очередь методов" message={error} /> : null}
      {msg ? <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-sm">{msg}</p> : null}

      {loading && !inbox ? (
        <p className="text-sm text-muted-foreground">Считаем остатки, расход и открытые задания…</p>
      ) : inbox ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">Пополнение линии</h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-8 rounded-md"
                  disabled={!inbox.replenish.length || busy != null}
                  onClick={() => void run({ action: "milk-run" }, "Milk run собран.")}
                >
                  {busy === "milk-run" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Route className="mr-1 h-3.5 w-3.5" />}
                  Рейс к линии
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-md"
                  disabled={!inbox.replenish.length || busy != null}
                  onClick={() => void run({ action: "tugger" }, "Рейс тягача собран.")}
                >
                  {busy === "tugger" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                  Тягач
                </Button>
              </div>
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Открытых заданий пополнения: {inbox.openReplenishTasks}. Остановок в рейсе: {inbox.milkRun.stopCount},{" "}
              {fmtQty(inbox.milkRun.qty)} ед. Петель тягача: {inbox.tugger?.loops?.length ?? 0}.
            </p>
            {inbox.replenish.length === 0 ? (
              <WmsEmptyState
                title="Линию сейчас нечем пополнять"
                description="Kanban и two-bin появятся, когда на OS есть запас, а у линии меньше min или пусто при живом расходе."
              />
            ) : (
              <ul className="space-y-2">
                {inbox.replenish.map((row) => (
                  <li key={row.itemCode} className="rounded-xl border px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium leading-snug">{row.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {REASON_RU[row.reason] ?? row.reason} · {row.fromLocation || "OS"} → {row.toLocation || "цех"} ·{" "}
                          {fmtQty(row.qty)}
                          {row.loopLabel ? ` · ${row.loopLabel}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-md text-xs"
                        disabled={busy != null}
                        onClick={() =>
                          void run({ action: "replenish", itemCodes: [row.itemCode] }, `Пополнение ${row.itemCode}.`)
                        }
                      >
                        Задание
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-medium">Волны отбора</h2>
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-md"
                disabled={!inbox.waves.some((w) => w.tasks.length > 1) || busy != null}
                onClick={() => {
                  const ids = inbox.waves.flatMap((w) => w.tasks.map((t) => t.taskId))
                  void run({ action: "wave", taskIds: ids }, "Открытые задания собраны в волну.")
                }}
              >
                Собрать волну
              </Button>
            </div>
            {inbox.waves.length === 0 ? (
              <WmsEmptyState
                title="Нет открытого отбора"
                description="Волна появится, когда есть открытый отбор, отгрузка, пополнение или выдача в цех."
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {inbox.waves.map((w) => (
                  <li key={w.waveId} className="rounded-xl border px-3 py-2">
                    <div className="font-medium">{w.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {w.taskCount} зад. · qty {fmtQty(w.qty)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-medium">Потери и точность</h2>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-xl border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Списания, 180 дн.</dt>
                <dd className="font-medium">{fmtQty(inbox.shrinkage.totalQty)}</dd>
              </div>
              <div className="rounded-xl border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Бой и повреждение</dt>
                <dd className="font-medium">{fmtQty(inbox.damage.totalQty)}</dd>
              </div>
              <div className="rounded-xl border px-3 py-2">
                <dt className="text-xs text-muted-foreground">Точность учёта</dt>
                <dd className="font-medium">{inbox.accuracy.scorePct == null ? "—" : `${inbox.accuracy.scorePct}%`}</dd>
              </div>
              <div className="rounded-xl border px-3 py-2">
                <dt className="text-xs text-muted-foreground">От приёмки до ячейки</dt>
                <dd className="font-medium">
                  {inbox.dockToStockHours == null ? "—" : `${inbox.dockToStockHours} ч`}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">{inbox.accuracy.note}</p>
            {inbox.shrinkage.rows[0] ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Последнее списание: {inbox.shrinkage.rows[0].itemName} · {fmtQty(inbox.shrinkage.rows[0].qty)} ·{" "}
                {fmtWhen(inbox.shrinkage.rows[0].at)}
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-medium">Календарь, поставщики, тепло</h2>
            {inbox.docks.length === 0 && inbox.suppliers.length === 0 && inbox.heatmap.length === 0 ? (
              <p className="text-sm text-muted-foreground">Календарь и приёмки поставщиков пока пустые.</p>
            ) : (
              <div className="space-y-3 text-sm">
                {inbox.docks.length ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Календарь (план / мойка / окна, 180 дн.)</div>
                    {inbox.docks.slice(0, 6).map((d) => (
                      <div key={`${d.title}-${d.startsAt}`} className="flex justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{d.title}</span>
                        <span className="shrink-0 text-muted-foreground">{fmtWhen(d.startsAt)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {inbox.supplierQuality.length ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Поставщики / приёмка</div>
                    {inbox.supplierQuality.map((s) => (
                      <div key={s.name} className="text-xs">
                        {s.name}: {s.receipts} док.
                        {s.scorePct != null ? ` · балл ${s.scorePct}` : ""}
                        <div className="text-muted-foreground">{s.note}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {inbox.heatmap.length ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">Тепло ячеек, 30 дн.</div>
                    {inbox.heatmap.slice(0, 8).map((h) => (
                      <div key={h.locationCode} className="flex justify-between gap-2 text-xs">
                        <span className="font-mono">{h.locationCode}</span>
                        <span className="text-muted-foreground">{h.moves} движ.</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-medium">Аналоги и сертификаты</h2>
            {inbox.substitutes.length === 0 && inbox.certificates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Алиасы штрихкода и ссылка на сертификат задаются на карточке, вкладки «Склад» и «Качество».
              </p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {inbox.substitutes.map((s) => (
                  <li key={`${s.itemCode}-${s.aliasSku}-${s.gtin}`}>
                    {s.itemName}: {s.aliasSku || s.gtin}
                    {s.mateCode ? ` → ${s.mateName} (${fmtQty(s.mateQty)})` : ""}
                  </li>
                ))}
                {inbox.certificates.map((c) => (
                  <li key={c.itemCode}>
                    <a href={c.url} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
                      COA {c.name}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-medium">Отклонение от FEFO</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Журнал: артикул, партия и причина. Блок выдачи более ранней партии не снимается.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={fefoItem} onChange={(e) => setFefoItem(e.target.value)} placeholder="Артикул" className="h-8 text-sm" />
              <Input value={fefoLot} onChange={(e) => setFefoLot(e.target.value)} placeholder="Партия" className="h-8 text-sm" />
              <Input
                value={fefoReason}
                onChange={(e) => setFefoReason(e.target.value)}
                placeholder="Причина (брак этикетки, заказ сети…)"
                className="h-8 text-sm sm:col-span-2"
              />
            </div>
            <Button
              size="sm"
              className="mt-2 h-8 rounded-md"
              disabled={busy != null || fefoItem.trim().length < 2 || fefoReason.trim().length < 3}
              onClick={() =>
                void run(
                  { action: "fefo-exception", itemCode: fefoItem, lotCode: fefoLot, reason: fefoReason },
                  "Исключение FEFO записано."
                )
              }
            >
              Записать исключение
            </Button>
            {inbox.fefoExceptions[0] ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Последнее: {inbox.fefoExceptions[0].itemCode} · {inbox.fefoExceptions[0].reason}
              </p>
            ) : null}
          </section>

          <section className={cn("rounded-2xl border bg-card p-4 lg:col-span-2")}>
            <h2 className="mb-3 font-medium">Расход партий в производство</h2>
            {inbox.genealogy.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет выдачи или расхода в производство с указанием партии.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 font-medium">Когда</th>
                      <th className="py-1 font-medium">Материал</th>
                      <th className="py-1 font-medium">Партия</th>
                      <th className="py-1 font-medium">Кол-во</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inbox.genealogy.map((g, i) => (
                      <tr key={`${g.at}-${i}`} className="border-t">
                        <td className="py-1.5">{fmtWhen(g.at)}</td>
                        <td className="py-1.5">{g.itemName}</td>
                        <td className="py-1.5 font-mono">{g.lotCode || "—"}</td>
                        <td className="py-1.5">{fmtQty(g.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
