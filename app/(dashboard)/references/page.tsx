"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

/** Старый URL — перенаправляем в Настройки → Справочники. */
export default function ReferencesRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/settings?section=directories")
  }, [router])
  return (
    <div className="rounded-2xl bg-card p-6 text-sm text-muted-foreground">
      Переход в настройки справочников…
    </div>
  )
}
