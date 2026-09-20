"use client"

import Image from "next/image"
import { cn } from "@/lib/utils"

const GSMT_HREF =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_GSMT_APP_URL?.trim()) ||
  "http://10.26.30.36:3000/gsmt"

/**
 * FAB с логотипом GSMT: слева экрана, только на странице логина (см. login/page.tsx).
 */
export function LoginGsmtFab({ className }: { className?: string }) {
  return (
    <a
      href={GSMT_HREF}
      className={cn(
        "fixed bottom-6 left-6 z-50 block h-16 w-16 overflow-hidden rounded-full",
        "shadow-lg shadow-black/20 transition-transform hover:scale-105 active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "md:bottom-8 md:left-8 md:h-[4.5rem] md:w-[4.5rem]",
        className
      )}
      title="Анализ DataMatrix в Честном ЗНАКе"
      aria-label="Открыть анализ DataMatrix кодов в Честном ЗНАКе"
    >
      <Image
        src="/wms/gsmt-fab.png"
        alt=""
        width={72}
        height={72}
        className="h-full w-full object-cover"
        priority
      />
    </a>
  )
}
