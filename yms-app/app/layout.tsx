import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "YMS | SCADA System",
  description: "Управление территорией, КПП и доками",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
