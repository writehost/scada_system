"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Download, FileText, Loader2, RefreshCw, ScanLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import {
  getFgAprilTagCatalog,
  getFgAprilTagImageUrl,
  getFgAprilTagPackUrl,
  getSiteCode,
  type FgAprilTagCatalog,
  type FgAprilTagFamilyInfo,
} from "@/lib/wms-api"
import { WmsEmptyState, WmsErrorState } from "@/components/wms/wms-shared"

const SIZE_PRESETS = [10, 20, 40, 80] as const
const DPI_PRESETS = [72, 150, 300] as const
const FALLBACK_FAMILIES: FgAprilTagFamilyInfo[] = [
  { id: "tag16h5", bits: 16, hamming: 5, dataSize: 4, tagCells: 6, maxId: 29, count: 30, warehouse: false },
  { id: "tag25h9", bits: 25, hamming: 9, dataSize: 5, tagCells: 7, maxId: 34, count: 35, warehouse: false },
  { id: "tag36h10", bits: 36, hamming: 10, dataSize: 6, tagCells: 8, maxId: 2319, count: 2320, warehouse: false },
  { id: "tag36h11", bits: 36, hamming: 11, dataSize: 6, tagCells: 8, maxId: 586, count: 587, warehouse: true },
]

function sheetSideCm(sizeCm: number, quiet: number, tagCells: number): number {
  return Math.round(((sizeCm * (tagCells + quiet * 2)) / tagCells) * 10) / 10
}

export function FgAprilTagPage() {
  const [catalog, setCatalog] = useState<FgAprilTagCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [manualId, setManualId] = useState("0")
  const [familyId, setFamilyId] = useState<FgAprilTagFamilyInfo["id"]>("tag36h11")
  const [sizeCm, setSizeCm] = useState(80)
  const [dpi, setDpi] = useState(150)
  const [quiet, setQuiet] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getFgAprilTagCatalog()
      setCatalog(next)
      setFamilyId((cur) => (next.families.some((f) => f.id === cur) ? cur : next.family))
      setSelected((cur) => {
        if (cur != null) return cur
        return next.plan[0]?.tagId ?? 0
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить теги плана")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const families = catalog?.families?.length ? catalog.families : FALLBACK_FAMILIES
  const family = families.find((f) => f.id === familyId) ?? families[families.length - 1]!
  const maxId = family.maxId
  const tagCells = family.tagCells
  const previewId = selected ?? Number(manualId)
  const previewOk = Number.isInteger(previewId) && previewId >= 0 && previewId <= maxId
  const print = { family: family.id, sizeCm, dpi, quiet }
  const previewUrl = previewOk ? getFgAprilTagImageUrl({ id: previewId, ...print, preview: true }) : ""
  const pngUrl = previewOk ? getFgAprilTagImageUrl({ id: previewId, ...print }) : ""
  const pdfUrl = previewOk ? getFgAprilTagImageUrl({ id: previewId, ...print, format: "pdf" }) : ""
  const cellCm = Math.round((sizeCm / tagCells) * 10) / 10
  const sheetCm = sheetSideCm(sizeCm, quiet, tagCells)
  const planIds = useMemo(
    () =>
      [...new Set((catalog?.plan ?? []).map((t) => t.tagId))]
        .filter((id) => id >= 0 && id <= maxId)
        .sort((a, b) => a - b),
    [catalog, maxId]
  )
  const planFamily = catalog?.family ?? "tag36h11"
  const compactFamily = family.count <= 40

  function pickFamily(next: FgAprilTagFamilyInfo["id"]) {
    setFamilyId(next)
    const def = families.find((f) => f.id === next)
    if (!def) return
    const id = selected ?? Number(manualId)
    if (!Number.isInteger(id) || id < 0 || id > def.maxId) {
      setSelected(0)
      setManualId("0")
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-4 md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h2 className="text-xl font-semibold tracking-tight">AprilTag</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Обновить план
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/help#apriltag-print">Справка</Link>
          </Button>
        </div>
      </div>

      {error ? <WmsErrorState message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-xl border bg-card p-4">
          <div className="mb-3 text-xs text-muted-foreground">
            Семья
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {families.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={family.id === item.id ? "default" : "outline"}
                  className="h-9 px-2.5 font-mono"
                  onClick={() => pickFamily(item.id)}
                >
                  {item.id}
                </Button>
              ))}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              Номер тега 0…{maxId}
              <Input
                className="mt-1 h-9 w-28"
                value={manualId}
                onChange={(e) => {
                  setManualId(e.target.value)
                  const n = Number(e.target.value)
                  if (Number.isInteger(n)) setSelected(n)
                }}
              />
            </label>
            <div className="text-xs text-muted-foreground">
              Сторона чёрного квадрата, см
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {SIZE_PRESETS.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={sizeCm === n ? "default" : "outline"}
                    className="h-9 px-2.5"
                    onClick={() => setSizeCm(n)}
                  >
                    {n}
                  </Button>
                ))}
                <Input
                  className="h-9 w-20"
                  type="number"
                  min={5}
                  max={200}
                  value={sizeCm}
                  onChange={(e) => setSizeCm(Math.min(200, Math.max(5, Number(e.target.value) || 80)))}
                />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              DPI
              <div className="mt-1 flex flex-wrap items-center gap-1">
                {DPI_PRESETS.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={dpi === n ? "default" : "outline"}
                    className="h-9 px-2.5"
                    onClick={() => setDpi(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
            <label className="text-xs text-muted-foreground">
              Белое поле, клетки
              <Input
                className="mt-1 h-9 w-20"
                type="number"
                min={0}
                max={4}
                value={quiet}
                onChange={(e) => setQuiet(Math.min(4, Math.max(0, Math.round(Number(e.target.value) || 0))))}
              />
            </label>
          </div>

          <p className="mb-3 text-sm text-muted-foreground">
            {family.id} · {family.count} кодов · сетка {tagCells}×{tagCells} · чёрный квадрат {sizeCm}×{sizeCm} см ·
            клетка {cellCm} см · лист {sheetCm}×{sheetCm} см · {dpi} dpi
            {family.warehouse ? "" : ` · ТСД рядов читает ${planFamily}`}
          </p>

          <div className="flex min-h-[280px] items-center justify-center rounded-lg border bg-white p-4">
            {previewOk ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={previewUrl}
                src={previewUrl}
                alt={`${family.id} ${previewId}`}
                className="max-h-[420px] w-auto max-w-full"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Укажите номер 0…{maxId}</p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" asChild disabled={!previewOk}>
              <a href={pngUrl} download>
                <Download className="size-4" />
                PNG {sizeCm} см
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild disabled={!previewOk}>
              <a href={pdfUrl} download>
                <FileText className="size-4" />
                PDF 1:1
              </a>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={planIds.length === 0}
              onClick={() => {
                window.location.href = getFgAprilTagPackUrl({ scope: "plan", kind: "zip", ...print })
              }}
            >
              ZIP PNG с плана ({planIds.length})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={planIds.length === 0}
              onClick={() => {
                window.location.href = getFgAprilTagPackUrl({ scope: "plan", kind: "pdf", ...print })
              }}
            >
              ZIP PDF с плана
            </Button>
            {compactFamily ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  window.location.href = getFgAprilTagPackUrl({ scope: "all", kind: "zip", ...print })
                }}
              >
                ZIP всей семьи ({family.count})
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={planIds.length === 0}
              onClick={() => {
                window.location.href = getFgAprilTagPackUrl({ scope: "plan", kind: "mosaic", ...print })
              }}
            >
              Мозаика
            </Button>
          </div>
        </section>

        <aside className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <ScanLine className="size-4 text-primary" />
            Теги на плане
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            {getSiteCode()} · план {planFamily}
          </p>
          {loading && !catalog ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : (catalog?.plan.length ?? 0) === 0 ? (
            <WmsEmptyState
              title="На плане ещё нет меток"
              description={`Номер 0…${maxId} можно сгенерировать и без плана.`}
            />
          ) : (
            <ul className="max-h-[480px] space-y-1 overflow-auto text-sm">
              {catalog!.plan
                .slice()
                .sort((a, b) => a.tagId - b.tagId)
                .map((tag) => (
                  <li key={tag.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(tag.tagId)
                        setManualId(String(tag.tagId))
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-muted/60",
                        selected === tag.tagId && "bg-primary/10"
                      )}
                    >
                      <span className="font-medium">ID {tag.tagId}</span>
                      <span className="truncate pl-2 text-xs text-muted-foreground">
                        {tag.rows.join(", ") || tag.label || "без ряда"}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
