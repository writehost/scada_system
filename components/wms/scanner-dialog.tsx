"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { createScannerSession, createWmsCodeList, subscribeScannerSession, type WmsScannerMode, type WmsScannerScanEvent } from "@/lib/wms-api"
import { Loader2, Plug, Radio, ScanBarcode, Smartphone, Usb } from "lucide-react"

type SourceTab = "tsd" | "serial"

function normalizeScanLine(s: string) {
  return (s || "").trim()
}

export interface ScannerDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** Вызывается когда пришёл скан (в режиме info/collect одинаково). */
  onScan?: (ev: { code: string; mode: WmsScannerMode; source: "tsd" | "serial"; atIso: string }) => void
}

export function ScannerDialog({ open, onOpenChange, onScan }: ScannerDialogProps) {
  const [tab, setTab] = useState<SourceTab>("tsd")
  const [mode, setMode] = useState<WmsScannerMode>("info")

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [lastEvent, setLastEvent] = useState<WmsScannerScanEvent | null>(null)
  const [collected, setCollected] = useState<string[]>([])
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const pollAbortRef = useRef<{ aborted: boolean }>({ aborted: false })

  const tsdLink = useMemo(() => {
    if (!sessionId) return null
    return `/mobile/scan?sessionId=${encodeURIComponent(sessionId)}&mode=${encodeURIComponent(mode)}`
  }, [sessionId, mode])

  const startSession = useCallback(async () => {
    setSessionLoading(true)
    setSessionError(null)
    setLastEvent(null)
    setCollected([])
    setSaveError(null)
    setSavedId(null)
    try {
      const s = await createScannerSession()
      setSessionId(s.sessionId)
    } catch (e) {
      setSessionId(null)
      setSessionError(e instanceof Error ? e.message : "Не удалось создать сессию сканера")
    } finally {
      setSessionLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    // создаём сессию при открытии (если ещё нет)
    if (!sessionId && !sessionLoading) void startSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    if (!sessionId) return

    pollAbortRef.current.aborted = false
    const guard = pollAbortRef.current

    const loop = async () => {
      while (!guard.aborted) {
        try {
          const res = await subscribeScannerSession({ sessionId, timeoutSec: 30 })
          if (guard.aborted) return
          const ev = res.event as unknown
          if (ev && typeof ev === "object" && "eventType" in (ev as Record<string, unknown>)) {
            continue
          }
          const data = ev as WmsScannerScanEvent
          if (!data?.code) continue
          setLastEvent(data)
          if (data.mode === "collect") {
            setCollected((prev) => {
              const x = data.code.trim()
              if (!x) return prev
              if (prev.includes(x)) return prev
              return [...prev, x]
            })
          }
          onScan?.({ code: data.code, mode: data.mode, source: data.source, atIso: data.atIso })
        } catch {
          // тихо ждём и пробуем дальше
          await new Promise((r) => setTimeout(r, 800))
        }
      }
    }

    void loop()
    return () => {
      guard.aborted = true
    }
  }, [open, onScan, sessionId])

  // --- Serial (Web Serial API) ---
  const [serialSupported, setSerialSupported] = useState(false)
  const [serialConnected, setSerialConnected] = useState(false)
  const [serialError, setSerialError] = useState<string | null>(null)
  const serialReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const serialPortRef = useRef<SerialPort | null>(null)

  useEffect(() => {
    setSerialSupported(typeof window !== "undefined" && "serial" in navigator)
  }, [])

  const connectSerial = useCallback(async () => {
    setSerialError(null)
    if (typeof window === "undefined" || !("serial" in navigator)) {
      setSerialError("Web Serial не поддерживается этим браузером.")
      return
    }
    try {
      // @ts-expect-error Web Serial typing
      const port: SerialPort = await navigator.serial.requestPort()
      await port.open({ baudRate: 9600 })
      serialPortRef.current = port
      setSerialConnected(true)

      const decoder = new TextDecoder()
      let buf = ""
      const reader = port.readable?.getReader()
      if (!reader) throw new Error("Порт открыт, но readable недоступен")
      serialReaderRef.current = reader

      const readLoop = async () => {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value || new Uint8Array(), { stream: true })
          buf += chunk
          const parts = buf.split(/[\r\n]+/)
          buf = parts.pop() ?? ""
          for (const p of parts) {
            const line = normalizeScanLine(p)
            if (!line) continue
            onScan?.({ code: line, mode, source: "serial", atIso: new Date().toISOString() })
            if (mode === "collect") {
              setCollected((prev) => (prev.includes(line) ? prev : [...prev, line]))
            }
            setLastEvent((prev) => ({
              siteId: prev?.siteId ?? 0,
              siteCode: prev?.siteCode ?? "",
              sessionId: prev?.sessionId ?? "",
              source: "serial",
              mode,
              code: line,
              atIso: new Date().toISOString(),
            }))
          }
        }
      }
      void readLoop()
    } catch (e) {
      setSerialConnected(false)
      setSerialError(e instanceof Error ? e.message : "Не удалось подключиться к COM-сканеру")
    }
  }, [mode, onScan])

  const disconnectSerial = useCallback(async () => {
    try {
      await serialReaderRef.current?.cancel()
    } catch {}
    try {
      serialReaderRef.current?.releaseLock()
    } catch {}
    serialReaderRef.current = null
    try {
      await serialPortRef.current?.close()
    } catch {}
    serialPortRef.current = null
    setSerialConnected(false)
  }, [])

  useEffect(() => {
    if (!open) void disconnectSerial()
  }, [disconnectSerial, open])

  const modeBadge = mode === "info" ? "Инфо" : "Список"

  async function saveCollectedToWms() {
    setSaveLoading(true)
    setSaveError(null)
    setSavedId(null)
    try {
      const deviceUid = lastEvent?.deviceUid?.trim()
      if (!deviceUid) {
        throw new Error("Нет deviceUid ТСД. Откройте ссылку на ТСД из этого окна и отсканируйте хотя бы один код.")
      }
      if (collected.length === 0) {
        throw new Error("Список пуст.")
      }
      const res = await createWmsCodeList({
        deviceUid,
        listType: "scanner_collect",
        entries: collected.map((code) => ({ kind: "code", code })),
      })
      setSavedId(res.codeListId ?? null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Не удалось сохранить список")
    } finally {
      setSaveLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanBarcode className="h-5 w-5" />
            Сканер
          </DialogTitle>
          <DialogDescription>
            Выберите источник (ТСД или COM/USB) и режим. В режиме «Инфо» показываем карточку кода, в «Список» собираем набор
            кодов.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="rounded-lg">
            Режим: <span className="ml-1 font-medium text-foreground">{modeBadge}</span>
          </Badge>
          <Button
            type="button"
            variant={mode === "info" ? "default" : "outline"}
            className="rounded-xl"
            onClick={() => setMode("info")}
          >
            Инфо
          </Button>
          <Button
            type="button"
            variant={mode === "collect" ? "default" : "outline"}
            className="rounded-xl"
            onClick={() => setMode("collect")}
          >
            Список
          </Button>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as SourceTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="tsd" className="gap-2">
              <Smartphone className="h-4 w-4" />
              ТСД
            </TabsTrigger>
            <TabsTrigger value="serial" className="gap-2">
              <Usb className="h-4 w-4" />
              COM/USB
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tsd" className="pt-2">
            <div className="grid gap-3 rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm text-foreground">
                  Сессия:{" "}
                  <span className="font-mono text-xs">{sessionId ?? "—"}</span>
                </div>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => void startSession()} disabled={sessionLoading}>
                  {sessionLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Radio className="mr-2 h-4 w-4" />}
                  Обновить сессию
                </Button>
              </div>

              {sessionError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                  {sessionError}
                </div>
              ) : null}

              <div className="text-sm text-muted-foreground">
                Откройте на ТСД страницу сканирования по ссылке ниже. После скана код прилетит сюда.
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input value={tsdLink ?? ""} readOnly placeholder="Создаю ссылку…" />
                {tsdLink ? (
                  <Button asChild className="rounded-xl">
                    <Link href={tsdLink} target="_blank" rel="noreferrer">
                      <Plug className="mr-2 h-4 w-4" />
                      Открыть на ТСД
                    </Link>
                  </Button>
                ) : (
                  <Button className="rounded-xl" disabled>
                    <Plug className="mr-2 h-4 w-4" />
                    Открыть на ТСД
                  </Button>
                )}
              </div>

              <div className="text-xs text-muted-foreground">
                Примечание: это подключение работает в одной сети и через сервер (long-poll + NOTIFY). Если сканер/ТСД не
                видит сервер — используйте COM/USB.
              </div>
            </div>
          </TabsContent>

          <TabsContent value="serial" className="pt-2">
            <div className="grid gap-3 rounded-xl border border-border p-3">
              {!serialSupported ? (
                <div className="text-sm text-muted-foreground">
                  Этот браузер не поддерживает Web Serial. Попробуйте Chrome/Edge на Windows.
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className={cn("rounded-lg", serialConnected ? "bg-success/10 text-success" : "")}>
                    {serialConnected ? "Подключено" : "Не подключено"}
                  </Badge>
                  {serialConnected ? (
                    <Button variant="outline" className="rounded-xl" onClick={() => void disconnectSerial()}>
                      Отключить
                    </Button>
                  ) : (
                    <Button className="rounded-xl" onClick={() => void connectSerial()}>
                      Подключить COM
                    </Button>
                  )}
                </div>
              )}

              {serialError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                  {serialError}
                </div>
              ) : null}

              <div className="text-xs text-muted-foreground">
                Ожидаем строки, разделённые переводом строки (CR/LF). Многие ручные сканеры в режиме клавиатуры сюда не
                подходят — нужен режим Serial.
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="rounded-xl border border-border bg-card p-3">
          <div className="text-xs font-medium text-muted-foreground">Последний скан</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-lg">
              {lastEvent?.source ?? "—"}
            </Badge>
            <Badge variant="secondary" className="rounded-lg">
              {lastEvent?.mode ?? "—"}
            </Badge>
            <span className={cn("font-mono text-sm", lastEvent?.code ? "text-foreground" : "text-muted-foreground")}>
              {lastEvent?.code ?? "пока нет"}
            </span>
          </div>
        </div>

        {mode === "collect" ? (
          <div className="rounded-xl border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium text-foreground">Список сканов</div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="rounded-lg">
                  {collected.length} шт.
                </Badge>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => {
                    setCollected([])
                    setSavedId(null)
                    setSaveError(null)
                  }}
                  disabled={saveLoading}
                >
                  Очистить
                </Button>
                <Button
                  type="button"
                  className="rounded-xl"
                  onClick={() => void saveCollectedToWms()}
                  disabled={saveLoading || collected.length === 0}
                >
                  {saveLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сохранить в WMS
                </Button>
              </div>
            </div>

            {saveError ? (
              <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
                {saveError}
              </div>
            ) : null}
            {savedId ? (
              <div className="mt-2 rounded-md border border-success/30 bg-success/5 p-2 text-sm text-success">
                Сохранено: <span className="font-mono">{savedId}</span>
              </div>
            ) : null}

            {collected.length > 0 ? (
              <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-border bg-background p-2">
                <div className="space-y-1 text-xs">
                  {collected.slice(-50).reverse().map((c) => (
                    <div key={c} className="font-mono text-foreground">
                      {c}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">Сканируйте — коды будут накапливаться здесь.</div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>
            Закрыть
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

