"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { X, Flashlight, FlashlightOff, RotateCcw, Keyboard, CameraOff } from "lucide-react"
import { Input } from "@/components/ui/input"
import { emitScannerSessionScan, type WmsScannerMode } from "@/lib/wms-api"
import { appendTsdScanHistory } from "@/lib/tsd-offline-store"
import { WMS_ANDROID_BARCODE_BROADCAST_ACTION } from "@/lib/wms-native-barcode"

export default function ScanPage() {
  const router = useRouter()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [mode, setMode] = useState<WmsScannerMode>("info")
  const [flashOn, setFlashOn] = useState(false)
  const [showManualInput, setShowManualInput] = useState(false)
  const [manualCode, setManualCode] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)

  const normalizedManualCode = useMemo(() => manualCode.trim(), [manualCode])
  const lastScanAtRef = useRef<number>(0)
  const [hardwareScannerHint, setHardwareScannerHint] = useState(false)

  const processScannedCode = useCallback(
    async (raw: string) => {
      const code = raw.trim()
      if (!code) return
      const now = Date.now()
      if (now - lastScanAtRef.current < 800) return
      lastScanAtRef.current = now

      if (sessionId) {
        const deviceUid = localStorage.getItem("tsd_device_id")?.trim() || undefined
        await emitScannerSessionScan({ sessionId, code, mode, source: "tsd", deviceUid }).catch(() => undefined)
        if (mode === "collect") return
      }
      controlsRef.current?.stop()
      controlsRef.current = null
      appendTsdScanHistory(code)
      router.replace(`/mobile/scan/result?code=${encodeURIComponent(code)}`)
    },
    [sessionId, mode, router],
  )

  const handleManualSubmit = () => {
    if (!normalizedManualCode) return
    void (async () => {
      await processScannedCode(normalizedManualCode)
      if (sessionId && mode === "collect") setManualCode("")
    })()
  }

  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search)
      const sid = q.get("sessionId")?.trim()
      const m = (q.get("mode")?.trim() || "info") as WmsScannerMode
      setSessionId(sid || null)
      setMode(m === "collect" ? "collect" : "info")
    } catch {
      setSessionId(null)
      setMode("info")
    }
  }, [])

  useEffect(() => {
    void import("@capacitor/core").then(({ Capacitor }) => {
      setHardwareScannerHint(Capacitor.getPlatform() === "android")
    })
  }, [])

  useEffect(() => {
    let remove: (() => Promise<void>) | null = null
    void import("@/lib/wms-native-barcode").then((m) => {
      void m.addNativeBarcodeListener((code) => {
        void processScannedCode(code)
      }).then((h) => {
        if (h) remove = h.remove
      })
    })
    return () => {
      void remove?.()
    }
  }, [processScannedCode])

  useEffect(() => {
    let cancelled = false

    async function start() {
      setError(null)
      setCameraReady(false)
      setTorchSupported(false)

      if (showManualInput) return
      if (!videoRef.current) return

      try {
        const mod = await import("@zxing/browser")
        const lib = await import("@zxing/library")
        if (cancelled) return

        const hints = new Map()
        hints.set(lib.DecodeHintType.POSSIBLE_FORMATS, [
          lib.BarcodeFormat.DATA_MATRIX,
          lib.BarcodeFormat.QR_CODE,
          lib.BarcodeFormat.CODE_128,
          lib.BarcodeFormat.EAN_13,
          lib.BarcodeFormat.EAN_8,
        ])

        const reader = new mod.BrowserMultiFormatReader(hints)
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoRef.current,
          (result, err, controls) => {
            if (cancelled) return
            if (result) {
              const text = result.getText?.() || ""
              const code = (text || "").trim()
              if (code) void processScannedCode(code)
            }
          }
        )
        controlsRef.current = controls
        setCameraReady(true)

        const track = videoRef.current.srcObject instanceof MediaStream
          ? videoRef.current.srcObject.getVideoTracks?.()[0]
          : undefined
        const caps = track?.getCapabilities?.() as MediaTrackCapabilities | undefined
        setTorchSupported(Boolean(caps && "torch" in caps))
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Не удалось запустить камеру. Проверьте разрешения браузера."
        setError(msg)
      }
    }

    void start()
    return () => {
      cancelled = true
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [mode, processScannedCode, router, sessionId, showManualInput])

  useEffect(() => {
    async function applyTorch() {
      if (!videoRef.current) return
      const stream = videoRef.current.srcObject
      if (!(stream instanceof MediaStream)) return
      const track = stream.getVideoTracks?.()[0]
      if (!track) return
      const caps = track.getCapabilities?.() as MediaTrackCapabilities | undefined
      if (!caps || !("torch" in caps)) return
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await track.applyConstraints({ advanced: [{ torch: flashOn } as any] })
      } catch {}
    }
    void applyTorch()
  }, [flashOn])

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div className="relative h-full w-full">
        <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" muted playsInline />

        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            <div className="relative h-64 w-64">
              <div className="absolute left-0 top-0 h-8 w-8 rounded-tl-lg border-l-4 border-t-4 border-primary" />
              <div className="absolute right-0 top-0 h-8 w-8 rounded-tr-lg border-r-4 border-t-4 border-primary" />
              <div className="absolute bottom-0 left-0 h-8 w-8 rounded-bl-lg border-l-4 border-b-4 border-primary" />
              <div className="absolute bottom-0 right-0 h-8 w-8 rounded-br-lg border-r-4 border-b-4 border-primary" />
              {!showManualInput && (
                <div className="animate-scan-line absolute left-2 right-2 h-0.5 bg-primary" />
              )}
            </div>

            <p className="mt-6 text-center text-sm text-white/80">
              QR, Data Matrix, EAN или маркировка СКИТ (строка с разделителем $)
            </p>
            {hardwareScannerHint && (
              <p className="mt-2 max-w-[22rem] text-center text-xs text-white/55">
                ТСД: настройте DataWedge Intent → broadcast, action{" "}
                <span className="font-mono text-white/70">{WMS_ANDROID_BARCODE_BROADCAST_ACTION}</span>, данные в{" "}
                <span className="font-mono text-white/70">com.symbol.datawedge.data_string</span>.
              </p>
            )}

            {!showManualInput && error && (
              <div className="mt-4 max-w-[20rem] rounded-xl bg-black/60 p-3 text-sm text-white/90">
                <div className="flex items-center gap-2">
                  <CameraOff className="h-4 w-4 text-destructive" />
                  <span>{error}</span>
                </div>
              </div>
            )}

            {!showManualInput && !error && !cameraReady && (
              <div className="mt-4 max-w-[20rem] rounded-xl bg-black/60 p-3 text-sm text-white/90">
                Запуск камеры…
              </div>
            )}
          </div>
        </div>

        <div className="absolute left-0 right-0 top-0 flex items-center justify-between p-4 pt-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={() => router.back()}
          >
            <X className="h-6 w-6" />
          </Button>

          <div className="text-center">
            <h1 className="text-lg font-semibold text-white">Сканирование</h1>
            <p className="text-xs text-white/60">Камера или ввод строки</p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-12 w-12 rounded-full bg-black/50 text-white hover:bg-black/70"
            onClick={() => setFlashOn(!flashOn)}
            disabled={!torchSupported || showManualInput}
          >
            {flashOn ? (
              <Flashlight className="h-6 w-6 text-primary" />
            ) : (
              <FlashlightOff className="h-6 w-6" />
            )}
          </Button>
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-6 pb-10">
          {showManualInput ? (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Input
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder="Вставьте строку с метки или штрихкод"
                  className="border-white/20 bg-white/10 text-white placeholder:text-white/50"
                  autoFocus
                />
                <Button
                  onClick={handleManualSubmit}
                  className="bg-primary text-primary-foreground"
                  disabled={!normalizedManualCode}
                >
                  Далее
                </Button>
              </div>
              <Button
                variant="ghost"
                className="w-full text-white/80"
                onClick={() => {
                  setShowManualInput(false)
                }}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Снова камера
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-8">
              <Button
                variant="ghost"
                className="flex flex-col items-center gap-1 text-white/80 hover:text-white"
                onClick={() => {
                  setShowManualInput(true)
                }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                  <Keyboard className="h-6 w-6" />
                </div>
                <span className="text-xs">Вручную</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes scan-line {
          0%,
          100% {
            top: 8px;
          }
          50% {
            top: calc(100% - 8px);
          }
        }
        .animate-scan-line {
          animation: scan-line 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}
