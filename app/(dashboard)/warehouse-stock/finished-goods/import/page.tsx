"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, FileJson, Loader2, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { getSiteCode, listDirectoryProductionLines } from "@/lib/wms-api"
import type { NestImportPreview, NestImportResult } from "@/lib/wms/marking-nest-import"
import { WmsErrorState } from "@/components/wms/wms-shared"

function fmt(n: number) {
  return n.toLocaleString("ru-RU")
}

async function resolveProductNameFromGtin(gtin: string): Promise<string | null> {
  const g = gtin.trim().padStart(14, "0").slice(-14)
  if (!/^\d{14}$/.test(g)) return null
  // Сначала WMS API (свой Bearer ЧЗ), затем GSMT как запасной путь.
  const endpoints = ["/api/wms/crpt/product-info", "/gsmt/api/crpt/product-info"]
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gtins: [g] }),
      })
      if (!res.ok) continue
      const json = (await res.json()) as {
        results?: Array<{ gtin?: string; name?: string; fullName?: string; level?: string }>
      }
      const results = json.results ?? []
      const hit =
        results.find((r) => (r.gtin ?? "").padStart(14, "0").slice(-14) === g) ??
        results.find((r) => (r.level ?? "").toLowerCase().includes("trade")) ??
        results[0]
      const name = (hit?.name || hit?.fullName || "").trim()
      if (name) return name
    } catch {
      // next endpoint
    }
  }
  return null
}

function pickUnitGtinFromCrpt(doc: {
  aggregationUnits: Array<{ aggregationUnitCapacity?: number; sntins?: string[]; unitSerialNumber?: string }>
}): string | null {
  const units = doc.aggregationUnits
  const byCapacity = [...units].sort(
    (a, b) => (a.aggregationUnitCapacity ?? 9999) - (b.aggregationUnitCapacity ?? 9999)
  )
  for (const u of byCapacity) {
    for (const c of u.sntins ?? []) {
      if (typeof c === "string" && c.startsWith("01") && c.length >= 16) {
        const gtin = c.slice(2, 16)
        if (/^\d{14}$/.test(gtin) && !gtin.startsWith("00")) return gtin
      }
    }
  }
  for (const u of units) {
    const p = String(u.unitSerialNumber ?? "")
    if (p.startsWith("01") && p.length >= 16) {
      const gtin = p.slice(2, 16)
      if (/^\d{14}$/.test(gtin) && !gtin.startsWith("00")) return gtin
    }
  }
  return null
}

async function readApiJson<T extends { error?: string }>(res: Response): Promise<T> {
  const text = await res.text()
  const trimmed = text.trim()
  if (trimmed.startsWith("<") || res.status === 413) {
    throw new Error(
      res.status === 413 || /413|Request Entity Too Large/i.test(text)
        ? "Файл слишком большой для прокси (nginx 413). Лимит тела запроса нужно увеличить на сервере."
        : `Сервер вернул HTML вместо JSON (HTTP ${res.status}). Проверьте маршрут API.`
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Некорректный ответ API (HTTP ${res.status}): ${trimmed.slice(0, 120)}`)
  }
}

/** Локальный превью ЧЗ без тяжёлого PUT на сервер. */
function previewCrptDocument(doc: {
  aggregationUnits: Array<{ unitSerialNumber?: string; sntins?: string[] }>
}): NestImportPreview {
  const units = doc.aggregationUnits
  const parents = new Set(
    units.map((u) => String(u.unitSerialNumber ?? "").trim()).filter(Boolean)
  )
  let pallets = 0
  let blocks = 0
  const codes = new Set<string>()
  const gtins = new Set<string>()
  for (const u of units) {
    const parent = String(u.unitSerialNumber ?? "").trim()
    if (!parent) continue
    const children = (u.sntins ?? []).map((c) => String(c).trim()).filter(Boolean)
    const isPallet = /^00\d{18}$/.test(parent) || children.some((c) => parents.has(c))
    if (isPallet) pallets += 1
    else blocks += 1
    codes.add(parent)
    if (/^00\d{18}$/.test(parent)) gtins.add(parent.slice(0, 14))
    else if (parent.startsWith("01") && parent.length >= 16) gtins.add(parent.slice(2, 16))
    for (const c of children) {
      codes.add(c)
      if (c.startsWith("01") && c.length >= 16) gtins.add(c.slice(2, 16))
    }
  }
  const unitsCount = Math.max(0, codes.size - pallets - blocks)
  return {
    pallets,
    blocks,
    units: unitsCount,
    total: codes.size,
    gtins: [...gtins].sort(),
    productTypeLevels: { PALLET: "pallet", BLOCK: "block", UNIT: "unit" },
    skippedTemp: 0,
    parseErrors: [],
  }
}

export default function FinishedGoodsImportPage() {
  const [fileName, setFileName] = useState<string | null>(null)
  /** Nest-массив или документ ЧЗ { aggregationUnits }. */
  const [payload, setPayload] = useState<unknown | null>(null)
  const [preview, setPreview] = useState<NestImportPreview | null>(null)
  const [result, setResult] = useState<NestImportResult | null>(null)
  const [batchLabel, setBatchLabel] = useState("")
  const [locationCode, setLocationCode] = useState("")
  const [productItemCode, setProductItemCode] = useState("")
  const [productName, setProductName] = useState("")
  const [productGtin, setProductGtin] = useState("")
  const [productionLineCode, setProductionLineCode] = useState("")
  const [productionLines, setProductionLines] = useState<Array<{ code: string; displayName: string }>>([])
  const [nameLookup, setNameLookup] = useState<"idle" | "loading" | "ok" | "fail">("idle")
  const [relinking, setRelinking] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameManualRef = useRef(false)

  const siteCode = useMemo(() => getSiteCode(), [])

  useEffect(() => {
    let cancelled = false
    listDirectoryProductionLines({ activeOnly: true })
      .then((res) => {
        if (cancelled) return
        setProductionLines(
          (res.lines ?? []).map((l) => ({ code: l.code, displayName: l.displayName || l.code }))
        )
      })
      .catch(() => {
        if (!cancelled) setProductionLines([])
      })
    return () => {
      cancelled = true
    }
  }, [])
  const hasPayload = useMemo(() => {
    if (payload == null) return false
    if (Array.isArray(payload)) return payload.length > 0
    if (typeof payload === "object") {
      const units = (payload as { aggregationUnits?: unknown }).aggregationUnits
      return Array.isArray(units) && units.length > 0
    }
    return false
  }, [payload])

  const fillNameFromGtin = useCallback(async (gtin: string, force = false) => {
    const g = gtin.trim().padStart(14, "0").slice(-14)
    if (!/^\d{14}$/.test(g)) return
    if (!force && nameManualRef.current) return
    setNameLookup("loading")
    const resolved = await resolveProductNameFromGtin(g)
    if (resolved) {
      setProductName(resolved)
      nameManualRef.current = false
      setNameLookup("ok")
    } else {
      setNameLookup("fail")
    }
  }, [])

  useEffect(() => {
    const g = productGtin.trim()
    if (!/^\d{14}$/.test(g)) {
      setNameLookup("idle")
      return
    }
    if (nameManualRef.current) return
    const t = window.setTimeout(() => {
      void fillNameFromGtin(g)
    }, 250)
    return () => window.clearTimeout(t)
  }, [productGtin, fillNameFromGtin])

  const loadPreview = useCallback(async (data: unknown) => {
    setLoadingPreview(true)
    setError(null)
    setResult(null)
    try {
      // ЧЗ-документ: превью локально (файл ~1–3 МБ, nginx раньше резал на 1 МБ → HTML 413).
      if (
        data &&
        typeof data === "object" &&
        !Array.isArray(data) &&
        Array.isArray((data as { aggregationUnits?: unknown }).aggregationUnits)
      ) {
        const previewLocal = previewCrptDocument(
          data as { aggregationUnits: Array<{ unitSerialNumber?: string; sntins?: string[] }> }
        )
        setPreview(previewLocal)
        const unitGtin = pickUnitGtinFromCrpt(
          data as {
            aggregationUnits: Array<{
              aggregationUnitCapacity?: number
              sntins?: string[]
              unitSerialNumber?: string
            }>
          }
        )
        const candidates = previewLocal.gtins.filter((g) => /^\d{14}$/.test(g) && !g.startsWith("00"))
        const preferred = unitGtin || (candidates.length ? [...candidates].sort((a, b) => a.localeCompare(b))[0]! : "")
        if (preferred) setProductGtin((prev) => prev.trim() || preferred)
        return
      }

      const body = Array.isArray(data) ? { entries: data } : { document: data }
      const res = await fetch("/api/wms/marking/nest-import", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await readApiJson<{ preview?: NestImportPreview; error?: string }>(res)
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setPreview(json.preview ?? null)
      const candidates = (json.preview?.gtins ?? []).filter((g) => /^\d{14}$/.test(g) && !g.startsWith("00"))
      if (candidates.length) {
        const preferred = [...candidates].sort((a, b) => a.localeCompare(b))[0]!
        setProductGtin((prev) => prev.trim() || preferred)
      }
    } catch (e) {
      setPreview(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingPreview(false)
    }
  }, [])

  const onFile = useCallback(
    async (file: File | null) => {
      if (!file) return
      setFileName(file.name)
      setError(null)
      setResult(null)
      setProductName("")
      setProductGtin("")
      nameManualRef.current = false
      setNameLookup("idle")
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as unknown
        if (Array.isArray(parsed)) {
          setPayload(parsed)
          setBatchLabel((prev) => prev || file.name.replace(/\.json$/i, ""))
          await loadPreview(parsed)
          return
        }
        if (
          parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { aggregationUnits?: unknown }).aggregationUnits)
        ) {
          const unitGtin = pickUnitGtinFromCrpt(
            parsed as {
              aggregationUnits: Array<{
                aggregationUnitCapacity?: number
                sntins?: string[]
                unitSerialNumber?: string
              }>
            }
          )
          if (unitGtin) setProductGtin(unitGtin)
          setBatchLabel((prev) => prev || file.name.replace(/\.json$/i, ""))
          setPayload(parsed)
          await loadPreview(parsed)
          return
        }
        throw new Error(
          "Файл: JSON-массив nest-записей или документ с aggregationUnits (выгрузка ЧЗ/СЕЗАКМ)"
        )
      } catch (e) {
        setPayload(null)
        setPreview(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [loadPreview]
  )

  const runImport = useCallback(async () => {
    if (!hasPayload) return
    setImporting(true)
    setError(null)
    try {
      let resolvedName = productName.trim()
      const gtinForName = productGtin.trim()
      if (!resolvedName && gtinForName) {
        resolvedName = (await resolveProductNameFromGtin(gtinForName)) || ""
        if (resolvedName) setProductName(resolvedName)
      }
      const body: Record<string, unknown> = {
        siteCode,
        batchLabel: batchLabel.trim() || undefined,
        locationCode: locationCode.trim() || undefined,
        createMissingItems: true,
        productItemCode: productItemCode.trim() || undefined,
        productName: resolvedName || undefined,
        productGtin: gtinForName || undefined,
        productionLineCode: productionLineCode.trim() || undefined,
      }
      if (Array.isArray(payload)) body.entries = payload
      else body.document = payload
      const res = await fetch("/api/wms/marking/nest-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await readApiJson<{
        preview?: NestImportPreview
        result?: NestImportResult
        error?: string
        detail?: string
      }>(res)
      if (!res.ok) throw new Error(json.detail ? `${json.error}: ${json.detail}` : json.error || `HTTP ${res.status}`)
      setPreview(json.preview ?? preview)
      setResult(json.result ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }, [
    batchLabel,
    hasPayload,
    locationCode,
    payload,
    preview,
    productGtin,
    productItemCode,
    productName,
    productionLineCode,
    siteCode,
  ])

  const runRelink = useCallback(async () => {
    setRelinking(true)
    setError(null)
    try {
      const res = await fetch("/api/wms/marking/nest-import/relink", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteCode,
          productItemCode: productItemCode.trim() || undefined,
          productName: productName.trim() || undefined,
          productGtin: productGtin.trim() || undefined,
        }),
      })
      const json = (await res.json()) as { error?: string; relinked?: number }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setResult({
        inserted: 0,
        existing: 0,
        linked: json.relinked ?? 0,
        itemsCreated: 0,
        stockAdjusted: 0,
        errors: [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRelinking(false)
    }
  }, [productGtin, productItemCode, productName, siteCode])

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" asChild className="mt-0.5 shrink-0">
          <Link href="/warehouse-stock/finished-goods" aria-label="Назад к складу ГП">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Импорт кодов маркировки</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Выгрузка ЧЗ/СЕЗАКМ (<span className="font-mono text-xs">aggregationUnits</span>) или nest JSON:
            палета → блок → бутылка. ГП хранится <span className="text-foreground">палетами в рядах</span> (ярусы —
            по необходимости), не в ячейках как материалы. Без ряда коды просто попадут в реестр и на склад ГП;
            размещение по ряду можно указать сразу или позже.
          </p>
        </div>
      </div>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <label className="text-sm font-medium">Файл JSON</label>
            <Input
              type="file"
              accept=".json,application/json"
              onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
            />
            {fileName ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <FileJson className="h-3.5 w-3.5" />
                {fileName}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            disabled={!hasPayload || importing}
            onClick={() => void runImport()}
          >
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {importing ? "Импорт…" : "Импортировать"}
          </Button>
        </div>

        {importing && preview ? (
          <p className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            Импорт {fmt(preview.total)} кодов — обычно 1–3 минуты. Не закрывайте вкладку.
          </p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Код номенклатуры</label>
            <Input
              value={productItemCode}
              onChange={(e) => setProductItemCode(e.target.value)}
              placeholder="Пусто — создастся FG-&#123;GTIN&#125;"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Название (из ЧЗ / GSMT)</label>
            <Input
              value={productName}
              onChange={(e) => {
                nameManualRef.current = true
                setProductName(e.target.value)
                setNameLookup("idle")
              }}
              placeholder="Подставится по GTIN"
            />
            <p className="text-[11px] text-muted-foreground">
              {nameLookup === "loading"
                ? "Запрос названия в ЧЗ…"
                : nameLookup === "ok"
                  ? "Название получено из Честного знака"
                  : nameLookup === "fail"
                    ? "Не удалось получить название по GTIN — введите вручную или нажмите «Подтянуть»"
                    : "После выбора файла название подтягивается по GTIN бутылки"}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">GTIN бутылки</label>
            <div className="flex gap-2">
              <Input
                value={productGtin}
                onChange={(e) => {
                  nameManualRef.current = false
                  setProductGtin(e.target.value.trim())
                }}
                placeholder="04607017160190"
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={nameLookup === "loading" || !/^\d{14}$/.test(productGtin.trim())}
                onClick={() => {
                  nameManualRef.current = false
                  void fillNameFromGtin(productGtin, true)
                }}
              >
                {nameLookup === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Подтянуть"}
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Партия (pool)</label>
            <Input
              value={batchLabel}
              onChange={(e) => setBatchLabel(e.target.value)}
              placeholder="Необязательно"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Линия производства</label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={productionLineCode}
              onChange={(e) => setProductionLineCode(e.target.value)}
            >
              <option value="">Не указана</option>
              {productionLines.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.displayName}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Из справочника «Линии производства» (Sipa, JR, Devin…). Сохранится на карточке ГП.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-sm font-medium">Ряд (необязательно)</label>
            <Input
              value={locationCode}
              onChange={(e) => setLocationCode(e.target.value)}
              placeholder="Например A-1 — ряд с плана ГП"
            />
            <p className="text-[11px] text-muted-foreground">
              Ряд склада ГП как на плане (A-1, B-12, C-15). Ячейка создастся по каталогу плана, не как отдельный
              FG-R01. Можно оставить пустым — палеты заведутся без позиции в ряду.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={relinking} onClick={() => void runRelink()}>
            {relinking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Перепривязать уже импортированные коды
          </Button>
        </div>
      </section>

      {loadingPreview ? (
        <p className="text-sm text-muted-foreground">Разбор файла…</p>
      ) : null}

      {error ? <WmsErrorState message={error} onRetry={() => payload && void loadPreview(payload)} /> : null}

      {preview ? (
        <section className="rounded-xl border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-medium">Предпросмотр</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge variant="secondary">Палеты: {fmt(preview.pallets)}</Badge>
            <Badge variant="secondary">Блоки: {fmt(preview.blocks)}</Badge>
            <Badge variant="secondary">Единицы: {fmt(preview.units)}</Badge>
            <Badge variant="outline">Всего: {fmt(preview.total)}</Badge>
            {preview.skippedTemp > 0 ? (
              <Badge variant="outline">Пропущено temp: {fmt(preview.skippedTemp)}</Badge>
            ) : null}
          </div>
          {preview.gtins.length > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              GTIN в файле: {preview.gtins.slice(0, 8).join(", ")}
              {preview.gtins.length > 8 ? ` … (+${preview.gtins.length - 8})` : ""}
            </p>
          ) : null}
          {preview.parseErrors.length > 0 ? (
            <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {preview.parseErrors.slice(0, 5).map((msg) => (
                <p key={msg}>{msg}</p>
              ))}
              {preview.parseErrors.length > 5 ? (
                <p>…ещё {preview.parseErrors.length - 5} ошибок разбора</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {result ? (
        <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <h2 className="text-lg font-medium">Импорт завершён</h2>
          <ul className="mt-2 space-y-1 text-sm">
            <li>Новых кодов: {fmt(result.inserted)}</li>
            <li>Уже были в БД: {fmt(result.existing)}</li>
            <li>Привязано к номенклатуре ГП: {fmt(result.linked)}</li>
            <li>Создано позиций номенклатуры: {fmt(result.itemsCreated)}</li>
            {result.stockAdjusted > 0 ? (
              <li>Остатки увеличены: {fmt(result.stockAdjusted)}</li>
            ) : null}
          </ul>
          {result.errors.length > 0 ? (
            <div className="mt-3 text-xs text-destructive">
              {result.errors.slice(0, 8).map((msg) => (
                <p key={msg}>{msg}</p>
              ))}
            </div>
          ) : null}
          <Button className="mt-4" asChild variant="outline">
            <Link href="/warehouse-stock/finished-goods">Открыть склад ГП</Link>
          </Button>
        </section>
      ) : null}

      <section className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Формат файла</p>
        <p className="mt-1">
          Массив объектов с полями <code>IdentificationCode</code>, <code>Parent</code>,{" "}
          <code>ChildrenIdentificationCodes</code>, <code>ProductTypeId</code>. Палеты — SSCC (начинаются с{" "}
          <code>00</code>), блоки и единицы — GS1 DataMatrix (<code>01…21…93…</code>).
        </p>
        <p className="mt-2">
          Номенклатура сопоставляется по GTIN (штрихкод). Если позиции нет — создаётся заглушка{" "}
          <code>finished_goods</code>; позже можно заменить на полные данные из справочника.
        </p>
      </section>
    </div>
  )
}
