"use client"

import { StyledQrCode } from "@/components/wms/styled-qr-code"
import { cn } from "@/lib/utils"
import {
  QR_VISUAL_LOGOS,
  QR_VISUAL_PRESETS,
  readQrVisualLogoId,
  readQrVisualStyleId,
  writeQrVisualLogoId,
  writeQrVisualStyleId,
  type QrVisualLogoId,
  type QrVisualStyleId,
} from "@/lib/qr-visual-style"
import { useEffect, useState } from "react"

const PREVIEW_PAYLOAD = "WMS-CELL-DEMO"

export function SettingsQrVisual() {
  const [selected, setSelected] = useState<QrVisualStyleId>("classic")
  const [logo, setLogo] = useState<QrVisualLogoId>("none")

  useEffect(() => {
    setSelected(readQrVisualStyleId())
    setLogo(readQrVisualLogoId())
  }, [])

  function chooseStyle(id: QrVisualStyleId) {
    setSelected(id)
    writeQrVisualStyleId(id)
  }

  function chooseLogo(id: QrVisualLogoId) {
    setLogo(id)
    writeQrVisualLogoId(id)
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Стиль QR-кода</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Форма модулей как в react-native-qrcode-styled: круги, склейка, жидкие перемычки, срез
          углов, дождь, глазки. Не только цвет.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {QR_VISUAL_PRESETS.map((preset) => {
          const active = selected === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => chooseStyle(preset.id)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/60 bg-secondary/20 hover:bg-secondary/40"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{preset.label}</div>
                  <div className="text-[11px] text-muted-foreground">{preset.hint}</div>
                </div>
                {active ? (
                  <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    выбрано
                  </span>
                ) : null}
              </div>
              <div className="rounded-lg bg-white p-2">
                <StyledQrCode
                  data={PREVIEW_PAYLOAD}
                  size={140}
                  styleId={preset.id}
                  logoId="none"
                  className="max-w-[140px]"
                />
              </div>
            </button>
          )
        })}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-foreground">Логотип товарной группы</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Значок в центре QR. Для стикеров — вырубная рамка, как на этикетке. Коррекция H, код остаётся читаемым.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {QR_VISUAL_LOGOS.map((item) => {
          const active = logo === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => chooseLogo(item.id)}
              className={cn(
                "rounded-xl border p-3 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border/60 bg-secondary/20 hover:bg-secondary/40"
              )}
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-medium text-foreground">{item.label}</div>
                  <div className="text-[11px] text-muted-foreground">{item.hint}</div>
                </div>
                {active ? (
                  <span className="rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
                    выбрано
                  </span>
                ) : null}
              </div>
              <div className="rounded-lg bg-white p-2">
                <StyledQrCode
                  data={PREVIEW_PAYLOAD}
                  size={140}
                  styleId={selected}
                  logoId={item.id}
                  className="max-w-[140px]"
                />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
