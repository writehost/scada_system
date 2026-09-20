"use client"

import { useEffect, useRef, type ReactNode, type RefObject } from "react"
import { WarehouseBackBar } from "@/components/wms/warehouse-back-bar"

type WarehousePlanFrameProps = {
  src: string
  title: string
  children?: ReactNode
  iframeRef?: RefObject<HTMLIFrameElement | null>
  onIframeReady?: (iframe: HTMLIFrameElement) => void
  backHref?: string
  backLabel?: string
}

export function WarehousePlanFrame({
  src,
  title,
  children,
  iframeRef,
  onIframeReady,
  backHref,
  backLabel,
}: WarehousePlanFrameProps) {
  const innerRef = useRef<HTMLIFrameElement | null>(null)
  const ref = iframeRef ?? innerRef

  useEffect(() => {
    const previousHtmlOverflow = document.documentElement.style.overflow
    const previousBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }
  }, [])

  return (
    <div className="relative flex h-[calc(100dvh-7rem)] min-h-0 min-w-0 flex-col overflow-hidden">
      {backHref && backLabel ? (
        <div className="mb-3 flex shrink-0 items-center">
          <WarehouseBackBar href={backHref} label={backLabel} />
        </div>
      ) : null}
      <iframe
        ref={ref}
        title={title}
        src={src}
        className="min-h-0 w-full flex-1 rounded-2xl border border-border bg-card shadow-sm"
        allow="fullscreen"
        onLoad={() => {
          if (ref.current) onIframeReady?.(ref.current)
        }}
      />
      {children}
    </div>
  )
}
