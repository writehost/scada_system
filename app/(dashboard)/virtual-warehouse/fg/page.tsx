"use client"

import { useRef } from "react"
import { WarehousePlanFrame } from "@/components/wms/warehouse-plan-frame"
import { FgPlanPlacementOverlay } from "@/components/wms/fg-plan-placement-overlay"

export default function VirtualWarehouseFgPlanPage() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  return (
    <WarehousePlanFrame
      title="Виртуальный склад ГП"
      src="/warehouse-plan/fg/index.html"
      iframeRef={iframeRef}
      backHref="/warehouse-stock/finished-goods"
      backLabel="Назад к складу ГП"
    >
      <FgPlanPlacementOverlay iframeRef={iframeRef} />
    </WarehousePlanFrame>
  )
}
