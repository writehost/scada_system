import type { Metadata, Viewport } from "next"
import "./route.css"

export const metadata: Metadata = {
  title: "SCADA System Forklift",
  description: "Навигатор водителя погрузчика и диспетчерская склада ГП",
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#15181b",
}

export default function RouteLayout({ children }: { children: React.ReactNode }) {
  return children
}
