"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import styles from "@/components/wms/workshop-waiting-cells.module.css"

type Props = {
  active: boolean
  children: ReactNode
}

/** Обёртка ячейки: без blur/scrim; при передаче на линию — только статичная рамка. */
export function WaitingCellProductionGlow({ active, children }: Props) {
  return (
    <div className={cn(styles.cellGlowWrap, active && styles.cellGlowActive)}>
      <div className={styles.cellGlowInner}>
        {active ? <div className={styles.productionGlowOverlay} aria-hidden /> : null}
        {children}
      </div>
    </div>
  )
}
