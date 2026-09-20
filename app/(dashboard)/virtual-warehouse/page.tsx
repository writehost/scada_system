"use client"

import { Suspense, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Edit3, Eye } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { WarehouseBackBar } from "@/components/wms/warehouse-back-bar"
import { VirtualWarehouseEditor } from "@/components/wms/virtual/virtual-warehouse-editor"
import { VirtualWarehouseViewer } from "@/components/wms/virtual/virtual-warehouse-viewer"
import { listVirtualLayouts, type WmsVirtualLayoutSummary } from "@/lib/wms-api"
import { cn } from "@/lib/utils"

function VirtualWarehousePageContent() {
  const [viewMode, setViewMode] = useState<"editor" | "viewer">("viewer")
  const [layouts, setLayouts] = useState<WmsVirtualLayoutSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false

    async function checkVirtualWarehouse() {
      setLoading(true)
      setError(null)
      try {
        const data = await listVirtualLayouts()
        if (!ignore) setLayouts(data.layouts || [])
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Не удалось проверить виртуальный склад")
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    checkVirtualWarehouse()
    return () => {
      ignore = true
    }
  }, [])

  return (
    <div className="flex h-[calc(100vh-4rem)] min-h-[720px] min-w-0 flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <WarehouseBackBar href="/warehouse-stock/materials" label="Назад к складу материалов" />
        <div className="flex rounded-xl bg-card p-1 shadow-sm">
          <Button
            variant={viewMode === "viewer" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("viewer")}
            className={cn("rounded-lg", viewMode === "viewer" && "bg-primary text-primary-foreground")}
          >
            <Eye className="mr-2 h-4 w-4" />
            Просмотр
          </Button>
          <Button
            variant={viewMode === "editor" ? "default" : "ghost"}
            size="sm"
            onClick={() => setViewMode("editor")}
            className={cn("rounded-lg", viewMode === "editor" && "bg-primary text-primary-foreground")}
          >
            <Edit3 className="mr-2 h-4 w-4" />
            Редактор
          </Button>
        </div>
      </div>
      {error ? (
        <Alert variant="destructive" className="mb-3">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Виртуальный склад материалов недоступен</AlertTitle>
          <AlertDescription>
            {error}. Проверьте `PG_URL`/`DATABASE_URL`, миграции и `WMS_BACKEND_URL`.
          </AlertDescription>
        </Alert>
      ) : loading ? (
        <Alert className="mb-3">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Проверяем подключение</AlertTitle>
          <AlertDescription>Запрашиваем layouts из WMS API.</AlertDescription>
        </Alert>
      ) : layouts.length === 0 ? (
        <Alert className="mb-3">
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Подключение есть</AlertTitle>
          <AlertDescription>Layouts пока нет — создайте первый в редакторе.</AlertDescription>
        </Alert>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-card shadow-sm">
        {viewMode === "viewer" ? <VirtualWarehouseViewer /> : <VirtualWarehouseEditor />}
      </div>
    </div>
  )
}

export default function VirtualWarehousePage() {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-muted-foreground">Загрузка...</div>}>
      <VirtualWarehousePageContent />
    </Suspense>
  )
}
