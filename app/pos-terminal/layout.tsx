import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "POS · расходники",
  description: "Точка выдачи стикеров и запчастей",
}

/** Отдельный экран без сайдбара WMS (сенсорный терминал ~15"). */
export default function PosTerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-background to-muted/40 text-foreground antialiased">
      {children}
    </div>
  )
}
