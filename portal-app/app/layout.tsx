import type { Metadata, Viewport } from "next"
import "@fontsource-variable/manrope"
import "./globals.css"

const base = (process.env.PORTAL_PUBLIC_URL || "https://scadasystem.io").replace(/\/$/, "")
const description =
  "Единая цифровая экосистема для управления бизнесом: склад, производство, транспорт, оборудование, энергоресурсы и цифровая идентификация. Запросите подключение к продуктам SCADA SYSTEM."

export const metadata: Metadata = {
  metadataBase: new URL(base),
  title: {
    default: "SCADA SYSTEM — экосистема промышленного ПО",
    template: "%s · SCADA SYSTEM",
  },
  description,
  applicationName: "SCADA SYSTEM",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ru_RU",
    url: "/",
    siteName: "SCADA SYSTEM",
    title: "SCADA SYSTEM — единая цифровая экосистема для управления бизнесом",
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "SCADA SYSTEM" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: "#071430",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-semibold"
        >
          Перейти к содержимому
        </a>
        {children}
      </body>
    </html>
  )
}
