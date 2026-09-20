"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { StatsCard } from "@/components/wms/stats-card"
import { OccupancyWidget } from "@/components/wms/occupancy-widget"
import { OperationsChart } from "@/components/wms/operations-chart"
import { TaskList } from "@/components/wms/task-list"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { ClipboardList, Package, Truck, Warehouse } from "lucide-react"
import {
  getWarehouseOccupancy,
  listDocuments,
  listTasks,
  setSiteCode,
  type WmsDocumentRow,
  type WmsTaskRow,
  type WmsWarehouseOccupancyResponse,
} from "@/lib/wms-api"
import type { OccupancyItem } from "@/components/wms/occupancy-widget"
import type { OperationsChartPoint } from "@/components/wms/operations-chart"
import type { Task } from "@/components/wms/task-list"

const colors = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"]

function isToday(value?: string | null) {
  if (!value) return false
  const date = new Date(value)
  return date.toDateString() === new Date().toDateString()
}

function classifyOperation(code?: string | null) {
  const value = (code || "").toLowerCase()
  if (value.includes("receipt") || value.includes("receiv")) return "receiving"
  if (value.includes("issue") || value.includes("ship")) return "issue"
  return "movement"
}

function isActiveTask(task: WmsTaskRow) {
  const status = task.taskStatus.toLowerCase()
  return !["completed", "complete", "done", "cancelled", "canceled", "closed"].some((done) => status.includes(done))
}

function mapTask(task: WmsTaskRow): Task {
  return {
    id: String(task.taskId ?? task.id ?? ""),
    type: task.taskType || "Задание",
    title: task.itemName || task.itemCode || "—",
    location: task.locationCode || "—",
    priority: "medium",
    category: "other",
    workStatus: task.startedAt ? "in_progress" : "pending",
  }
}

function buildChartData(documents: WmsDocumentRow[]): OperationsChartPoint[] {
  const hours = Array.from({ length: 12 }, (_, index) => index * 2)
  return hours.map((hour) => {
    const receiving = documents.filter(
      (d) => isToday(d.createdAt) && classifyOperation(d.documentType) === "receiving" && new Date(d.createdAt!).getHours() >= hour && new Date(d.createdAt!).getHours() < hour + 2
    ).length
    const shipping = documents.filter(
      (d) => isToday(d.createdAt) && classifyOperation(d.documentType) === "issue" && new Date(d.createdAt!).getHours() >= hour && new Date(d.createdAt!).getHours() < hour + 2
    ).length
    const movement = documents.filter(
      (d) => isToday(d.createdAt) && classifyOperation(d.documentType) === "movement" && new Date(d.createdAt!).getHours() >= hour && new Date(d.createdAt!).getHours() < hour + 2
    ).length
    return { time: `${String(hour).padStart(2, "0")}:00`, receiving, shipping, movement }
  })
}

function buildOccupancyItems(occupancy: WmsWarehouseOccupancyResponse | null): OccupancyItem[] {
  return (occupancy?.zones || []).map((zone, index) => ({
    name: zone.zoneCode,
    value: zone.nonEmptyCount,
    total: Math.max(1, zone.locationCount),
    color: colors[index % colors.length],
  }))
}

function EmbedDashboardInner() {
  const searchParams = useSearchParams()
  const siteCode = (searchParams.get("siteCode") || "DEFAULT").trim() || "DEFAULT"
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tasks, setTasks] = useState<WmsTaskRow[]>([])
  const [documents, setDocuments] = useState<WmsDocumentRow[]>([])
  const [occupancy, setOccupancy] = useState<WmsWarehouseOccupancyResponse | null>(null)

  useEffect(() => {
    setSiteCode(siteCode)
  }, [siteCode])

  useEffect(() => {
    let ignore = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [tasksRes, docsRes, occRes] = await Promise.all([
          listTasks({ limit: 50 }),
          listDocuments({ limit: 80 }),
          getWarehouseOccupancy(),
        ])
        if (!ignore) {
          setTasks(tasksRes.tasks || [])
          setDocuments(docsRes.documents || [])
          setOccupancy(occRes)
        }
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Ошибка загрузки")
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    const timer = setInterval(load, 30000)
    return () => {
      ignore = true
      clearInterval(timer)
    }
  }, [siteCode])

  const view = useMemo(() => {
    const activeTasks = tasks.filter(isActiveTask)
    const totals = occupancy?.totals
    const cells = totals?.locationCount || 0
    const occupied = totals?.nonEmptyCount || 0
    return {
      activeTasks: activeTasks.slice(0, 8).map(mapTask),
      chart: buildChartData(documents),
      occupancyItems: buildOccupancyItems(occupancy),
      stats: {
        docs: documents.length,
        tasks: activeTasks.length,
        stock: totals?.totalAvailableQty || 0,
        occupancy: cells > 0 ? Math.round((occupied / cells) * 100) : 0,
      },
    }
  }, [tasks, documents, occupancy])

  return (
    <div className="p-4 md:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Дашборд WMS</h1>
          <p className="text-sm text-muted-foreground">Площадка {siteCode}</p>
        </div>
        <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-medium text-primary">
          {loading ? "обновление…" : "онлайн"}
        </span>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>WMS недоступен</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatsCard title="Документы" value={view.stats.docs} icon={Package} iconColor="bg-primary/15 text-primary" />
          <StatsCard title="Активные задания" value={view.stats.tasks} icon={ClipboardList} iconColor="bg-chart-2/10 text-chart-2" />
          <StatsCard title="Остаток, шт" value={view.stats.stock} icon={Warehouse} iconColor="bg-chart-3/10 text-chart-3" />
          <StatsCard title="Заполненность" value={`${view.stats.occupancy}%`} icon={Truck} iconColor="bg-chart-4/10 text-chart-4" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <OccupancyWidget data={view.occupancyItems} />
        <OperationsChart data={view.chart} />
      </div>

      <div className="mt-4">
        <TaskList tasks={view.activeTasks} />
      </div>
    </div>
  )
}

export default function EmbedDashboardPage() {
  return (
    <Suspense fallback={<div className="p-5 text-sm text-muted-foreground">Загрузка дашборда…</div>}>
      <EmbedDashboardInner />
    </Suspense>
  )
}
