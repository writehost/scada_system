import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "EMS | SCADA System",
  description: "SCADA EMS — учёт и анализ потребления электроэнергии, воды и коммунальных платежей",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f4f1ea" }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className="bg-background">
      <body className="font-sans">{children}</body>
    </html>
  )
}
