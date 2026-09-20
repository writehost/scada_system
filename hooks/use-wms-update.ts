"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { isWmsAdmin } from "@/lib/wms-admin"

export const WMS_UPDATE_DISMISSED_KEY = "wms_ack_build_id"
const DEFAULT_POLL_MS = 2 * 60 * 1000

export type WmsReleaseInfo = {
  version: string
  buildId: string
  builtAt: string
  changelog: string
  packageUrl?: string | null
  packageName?: string | null
  mandatory?: boolean
}

type UpdateCheckPayload = {
  updateAvailable: boolean
  isTest?: boolean
  release: WmsReleaseInfo | null
  local?: { buildId: string; builtAt?: string | null }
  serverConfigured?: boolean
  remoteError?: string | null
}

function pollIntervalMs(): number {
  const raw = process.env.NEXT_PUBLIC_WMS_UPDATE_POLL_MS
  const n = raw ? Number(raw) : DEFAULT_POLL_MS
  return Number.isFinite(n) && n >= 30000 ? n : DEFAULT_POLL_MS
}

export function readDismissedBuildId(): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(WMS_UPDATE_DISMISSED_KEY)
}

export function useWmsUpdate(options?: { enabled?: boolean; poll?: boolean }) {
  const enabled = options?.enabled ?? true
  const poll = options?.poll ?? true

  const [localBuildId, setLocalBuildId] = useState<string>("")
  const [localBuiltAt, setLocalBuiltAt] = useState<string | null>(null)
  const [release, setRelease] = useState<WmsReleaseInfo | null>(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isTest, setIsTest] = useState(false)
  const [dismissedBuildId, setDismissedBuildId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [statusText, setStatusText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const dismissedRef = useRef<string | null>(null)

  const refreshDismissed = useCallback(() => {
    const value = readDismissedBuildId()
    dismissedRef.current = value
    setDismissedBuildId(value)
  }, [])

  const checkUpdates = useCallback(async () => {
    if (!enabled || !isAdmin) return
    try {
      const res = await fetch("/api/app/update-check", {
        cache: "no-store",
        headers: authRequestHeaders(),
      })
      if (!res.ok) return
      const data = (await res.json()) as UpdateCheckPayload
      setLocalBuildId(data.local?.buildId ?? "")
      setLocalBuiltAt(data.local?.builtAt ?? null)
      if (!data.serverConfigured || data.remoteError) return
      const hasUpdate = Boolean(data.updateAvailable && data.release)
      setUpdateAvailable(hasUpdate)
      setRelease(hasUpdate ? data.release : null)
      setIsTest(Boolean(data.isTest))
      if (!hasUpdate) {
        setError(null)
        setStatusText(null)
        setApplying(false)
      }
    } catch {
      /* offline */
    }
  }, [enabled, isAdmin])

  useEffect(() => {
    refreshDismissed()
    fetch("/api/auth/me", { cache: "no-store", headers: authRequestHeaders() })
      .then(async (res) => {
        if (!res.ok) return null
        return (await res.json()) as { user?: { roleCodes?: string[] } }
      })
      .then((data) => setIsAdmin(isWmsAdmin(data?.user?.roleCodes)))
      .catch(() => setIsAdmin(false))
  }, [refreshDismissed])

  useEffect(() => {
    if (!enabled || !isAdmin) return
    void checkUpdates()
    if (!poll) return
    const timer = window.setInterval(() => void checkUpdates(), pollIntervalMs())
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkUpdates()
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [checkUpdates, enabled, isAdmin, poll])

  const postponedUpdate =
    Boolean(updateAvailable && release) &&
    (dismissedBuildId === release?.buildId || dismissedRef.current === release?.buildId)

  const shouldAutoPrompt =
    Boolean(enabled && isAdmin && updateAvailable && release) &&
    dismissedBuildId !== release?.buildId &&
    dismissedRef.current !== release?.buildId

  async function waitUntilInstalled(targetBuildId: string) {
    const deadline = Date.now() + 10 * 60 * 1000
    while (Date.now() < deadline) {
      const res = await fetch(
        `/api/app/update-status?targetBuildId=${encodeURIComponent(targetBuildId)}`,
        { cache: "no-store", headers: authRequestHeaders() }
      )
      if (res.ok) {
        const data = (await res.json()) as {
          installed?: boolean
          ready?: boolean
          job?: { status?: string; message?: string; log?: string }
        }
        if (data.job?.message) setStatusText(data.job.message)
        if (data.installed || data.ready) return true
        if (data.job?.status === "done") return true
        if (data.job?.status === "failed") {
          const logHint = data.job.log?.trim().slice(-800)
          const msg = data.job.message || "Обновление завершилось с ошибкой"
          throw new Error(
            logHint && !msg.includes(logHint.slice(0, 40))
              ? `${msg}\n\n--- log ---\n${logHint}`
              : msg
          )
        }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    throw new Error("Превышено время ожидания обновления")
  }

  async function applyUpdate(targetRelease?: WmsReleaseInfo | null) {
    const chosen = targetRelease ?? release
    if (!chosen) {
      setError("Релиз обновления не выбран. Обновите страницу и попробуйте снова.")
      return
    }
    if (!isAdmin) {
      setError("Обновление доступно только администратору WMS.")
      return
    }
    setApplying(true)
    setError(null)
    setStatusText("Запуск обновления на сервере…")
    try {
      const res = await fetch("/api/app/apply-update", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ release: chosen }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setStatusText("Установка обновления…")
      await waitUntilInstalled(chosen.buildId)
      sessionStorage.setItem(WMS_UPDATE_DISMISSED_KEY, chosen.buildId)
      refreshDismissed()
      setStatusText("Перезагрузка интерфейса…")
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обновить")
      setApplying(false)
    }
  }

  function dismissUpdate() {
    if (!release || release.mandatory) return
    sessionStorage.setItem(WMS_UPDATE_DISMISSED_KEY, release.buildId)
    refreshDismissed()
  }

  return {
    isAdmin,
    localBuildId,
    localBuiltAt,
    release,
    updateAvailable,
    isTest,
    postponedUpdate,
    shouldAutoPrompt,
    applying,
    statusText,
    error,
    checkUpdates,
    applyUpdate,
    dismissUpdate,
    refreshDismissed,
  }
}
