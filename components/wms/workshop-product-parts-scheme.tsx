"use client"

import { useMemo, useState } from "react"
import { ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  WORKSHOP_PRODUCT_PARTS_DEMO,
  productPartStatusLabel,
  type ProductPartMarker,
  type ProductPartStatus,
  type ProductPartsSchemeConfig,
} from "@/lib/wms/workshop-product-parts-demo"
import styles from "@/components/wms/workshop-product-parts-scheme.module.css"

type Props = {
  config?: ProductPartsSchemeConfig
}

function lineClass(status: ProductPartStatus) {
  if (status === "ok") return styles.overlayLineOk
  if (status === "low") return styles.overlayLineLow
  return styles.overlayLineMissing
}

function anchorClass(status: ProductPartStatus) {
  if (status === "ok") return styles.anchorOk
  if (status === "low") return styles.anchorLow
  return styles.anchorMissing
}

function legendDotClass(status: ProductPartStatus) {
  if (status === "ok") return styles.legendDotOk
  if (status === "low") return styles.legendDotLow
  return styles.legendDotMissing
}

export function WorkshopProductPartsScheme({ config = WORKSHOP_PRODUCT_PARTS_DEMO }: Props) {
  const [activeId, setActiveId] = useState<string | null>(config.parts[0]?.id ?? null)
  const [imageOk, setImageOk] = useState(true)

  const counts = useMemo(() => {
    let ok = 0
    let low = 0
    let missing = 0
    for (const part of config.parts) {
      if (part.status === "ok") ok += 1
      else if (part.status === "low") low += 1
      else missing += 1
    }
    return { ok, low, missing }
  }, [config.parts])

  function renderCallout(part: ProductPartMarker) {
    const active = activeId === part.id
    return (
      <div
        key={`callout-${part.id}`}
        className={cn(
          styles.callout,
          part.calloutSide === "right" ? styles.calloutRight : styles.calloutLeft,
          active ? styles.calloutActive : styles.calloutMuted
        )}
        style={{ left: `${part.calloutX}%`, top: `${part.calloutY}%` }}
        onMouseEnter={() => setActiveId(part.id)}
      >
        <span className={styles.calloutTitle}>{part.label}</span>
        <span className={styles.calloutQty}>
          {part.status === "missing" ? "Нет в наличии" : `В наличии ${part.qtyLabel}`}
        </span>
      </div>
    )
  }

  return (
    <section className={cn("wms-panel", styles.panel)}>
      <div className={styles.header}>
        <div className="min-w-0">
          <h3 className={styles.title}>Схема комплектующих</h3>
          <p className={styles.subtitle}>{config.itemName}</p>
          <span className={styles.code}>{config.itemCode}</span>
        </div>
        <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
          {counts.ok} в наличии · {counts.low} мало · {counts.missing} нет
        </p>
      </div>

      <div className={styles.body}>
        <div className={styles.stage}>
          <div className={styles.canvas}>
            {imageOk ? (
              <img
                src={config.imageUrl}
                alt={config.itemName}
                className={styles.productImage}
                onError={() => setImageOk(false)}
              />
            ) : (
              <div className={styles.imageFallback}>
                <div className={styles.imageFallbackIcon}>
                  <ImageIcon className="h-7 w-7 opacity-50" />
                </div>
                <p className="text-sm">Картинка пока не загружена</p>
                <p className="font-mono text-xs">{config.imageUrl}</p>
              </div>
            )}

            <svg className={styles.overlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              {config.parts.map((part) => (
                <line
                  key={`line-${part.id}`}
                  className={cn(styles.overlayLine, lineClass(part.status))}
                  x1={part.anchorX}
                  y1={part.anchorY}
                  x2={part.calloutX}
                  y2={part.calloutY}
                  opacity={activeId === part.id ? 1 : 0.55}
                />
              ))}
            </svg>

            {config.parts.map((part) => (
              <button
                key={`anchor-${part.id}`}
                type="button"
                className={cn(
                  styles.anchor,
                  anchorClass(part.status),
                  activeId === part.id && styles.anchorActive
                )}
                style={{ left: `${part.anchorX}%`, top: `${part.anchorY}%` }}
                title={`${part.label}: ${part.qtyLabel}`}
                aria-label={part.label}
                onMouseEnter={() => setActiveId(part.id)}
                onFocus={() => setActiveId(part.id)}
                onClick={() => setActiveId(part.id)}
              />
            ))}

            {config.parts.map(renderCallout)}
          </div>
        </div>

        <aside className={styles.legend}>
          <p className={styles.legendTitle}>Что есть / чего нет</p>
          <div className={styles.legendList}>
            {config.parts.map((part) => (
              <button
                key={part.id}
                type="button"
                className={cn(styles.legendItem, activeId === part.id && styles.legendItemActive)}
                onMouseEnter={() => setActiveId(part.id)}
                onFocus={() => setActiveId(part.id)}
                onClick={() => setActiveId(part.id)}
              >
                <span className={cn(styles.legendDot, legendDotClass(part.status))} aria-hidden />
                <span className={styles.legendText}>
                  <span className={styles.legendLabel}>{part.label}</span>
                  <span className={styles.legendMeta}>
                    {productPartStatusLabel(part.status)}
                    {part.status !== "missing" ? ` · ${part.qtyLabel}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            Сейчас схема на статичной картинке. Позже подтянем номенклатуру и остатки из базы.
          </p>
        </aside>
      </div>
    </section>
  )
}
