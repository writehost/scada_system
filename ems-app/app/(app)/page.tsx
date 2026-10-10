"use client"

import { HomeDashboard } from "@/components/ems/home-dashboard"
import { IndustrialDashboard } from "@/components/ems/industrial-dashboard"
import { NeedSite, useApp } from "@/components/ems/shell"

export default function DashboardPage() {
  const { industrial } = useApp()
  return <NeedSite>{() => (industrial ? <IndustrialDashboard /> : <HomeDashboard />)}</NeedSite>
}
