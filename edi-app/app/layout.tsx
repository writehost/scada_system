import type { Metadata, Viewport } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "EDI | SCADA System",
  description: "Электронный документооборот SCADA System",
  icons: { icon: "/icon.svg" },
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 }

const themeScript = `try{var t=localStorage.getItem("edi:theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
