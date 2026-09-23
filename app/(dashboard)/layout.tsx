"use client"

import { Suspense, useState } from "react"
import { usePathname } from "next/navigation"
import { Sidebar } from "@/components/wms/sidebar"
import { Header } from "@/components/wms/header"
import { SupportPresenceRoot } from "@/components/wms/support-presence"
import { Toaster } from "@/components/ui/toaster"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const pathname = usePathname()
  const lockPane =
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname === "/warehouse-stock/finished-goods" ||
    pathname === "/yms" ||
    pathname.startsWith("/yms/")

  return (
    <Suspense fallback={null}>
      <SupportPresenceRoot>
        <div className="h-screen overflow-hidden bg-background">
          <Sidebar collapsed={sidebarCollapsed} onCollapsedChange={setSidebarCollapsed} />
          <Header sidebarCollapsed={sidebarCollapsed} />
          <main
            className={`absolute bottom-0 top-16 overflow-hidden transition-all duration-300 ${
              sidebarCollapsed ? "left-16 right-0" : "left-64 right-0"
            }`}
          >
            <div className={lockPane ? "h-full min-h-0 overflow-hidden" : "h-full overflow-y-auto"}>
              <div className={lockPane ? "h-full min-h-0 overflow-hidden" : "mx-auto max-w-[1600px] p-6"}>{children}</div>
            </div>
          </main>
          <Toaster />
        </div>
      </SupportPresenceRoot>
    </Suspense>
  )
}
