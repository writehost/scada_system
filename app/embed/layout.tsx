import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "WMS Dashboard Embed",
  description: "Компактный дашборд WMS для встраивания в 1С",
}

/** Без сайдбара и шапки — для iframe в 1С. */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground antialiased">
      {children}
    </div>
  )
}
