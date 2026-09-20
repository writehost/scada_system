"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  BookOpen,
  Download,
  FileUp,
  Loader2,
  MoreHorizontal,
  PenLine,
  Plus,
  Printer,
  RefreshCw,
  ScrollText,
  Search,
  Send,
  Settings,
  Trash2,
  Truck,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { authRequestHeaders } from "@/lib/auth/client-token"
import { getSiteCode } from "@/lib/wms-api"
import { WmsEmptyState, WmsErrorState, WmsLoadingState } from "@/components/wms/wms-shared"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import type { CryptoProCertInfo } from "@/lib/crypto-pro-sign"
import {
  fetchCodesFromSuzOrder,
  loadSuzCertificates,
  signAndFetchCodesForLabelOrder,
} from "@/lib/wms/label-suz-order"
import {
  loadLabelSuzSettings,
  mergeLabelSuzSettings,
  saveLabelSuzSettings,
  type LabelSuzSettings,
} from "@/lib/wms/label-suz-settings"
import { inferSuzGroupFromProductName, parseSuzProductGroup, SUZ_GROUP_LABEL } from "@/lib/wms/label-suz-product-group"
import {
  findMaterialForStickerType,
  loadLabelPrintMaterials,
  stickerTypeRu,
  type LabelPrintMaterial,
} from "@/lib/wms/label-print-material"
import {
  labelOrderAuthorLabel,
  labelOrderOriginLabel,
  listLabelOrderRows,
  saveLabelOrderSettings,
  type LabelOrderRow,
} from "@/lib/wms/label-order-client"
import {
  DEFAULT_LABEL_ORDER_WASTE_SETTINGS,
  fmtInt,
  fmtPercent,
  labelOrderFactVerdict,
  plannedWasteQty,
  summarizeLabelOrderFact,
  type LabelOrderWasteSettings,
} from "@/lib/wms/label-order-waste"
import { LabelOrderCreateDialog } from "@/components/wms/label-order-create-dialog"
import { LabelOrderDocDialog } from "@/components/wms/label-order-doc-dialog"
import { LabelOrderHelpDialog } from "@/components/wms/label-order-help-dialog"
import { LabelOrderSettingsDialog } from "@/components/wms/label-order-settings-dialog"

const REFRESH_MS = 15_000

type FilterKey = "all" | "waiting" | "ready" | "printed" | "needFact"

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "waiting", label: "Ждут коды" },
  { key: "ready", label: "Коды готовы" },
  { key: "printed", label: "В печати" },
  { key: "needFact", label: "Нужен факт" },
]

function statusLabel(s: string): string {
  switch (s) {
    case "new":
      return "Новый"
    case "codes_ready":
      return "Коды готовы"
    case "sent_to_printer":
      return "В печати"
    case "signed":
      return "Подписан"
    case "cancelled":
      return "Отменён"
    case "done":
      return "Готово"
    default:
      return s
  }
}

function statusClass(s: string): string {
  switch (s) {
    case "new":
      return "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
    case "codes_ready":
      return "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
    case "sent_to_printer":
      return "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
    case "signed":
      return "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100"
    default:
      return ""
  }
}

function fmtWhen(iso: string) {
  try {
    const d = new Date(iso)
    return {
      date: d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
      time: d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    }
  } catch {
    return { date: iso, time: "" }
  }
}

function parseSuzOrderIdFromNote(note: string): string | null {
  const m = note.match(/suzOrderId[=:\s]+([0-9a-fA-F-]{36})/i)
  return m?.[1] || null
}

function isPrinted(order: LabelOrderRow): boolean {
  return order.status === "sent_to_printer" || order.status === "done" || Boolean(order.printJobId)
}

function factMissing(order: LabelOrderRow, settings: LabelOrderWasteSettings): boolean {
  if (!settings.requireFactAfterPrint) return false
  return isPrinted(order) && (order.fact?.adjustmentsCount ?? 0) === 0
}

export function LabelCodeOrdersPage() {
  const { toast } = useToast()
  const [orders, setOrders] = useState<LabelOrderRow[]>([])
  const [materials, setMaterials] = useState<LabelPrintMaterial[]>([])
  const [wasteSettings, setWasteSettings] = useState<LabelOrderWasteSettings>(
    DEFAULT_LABEL_ORDER_WASTE_SETTINGS
  )
  const [author, setAuthor] = useState<{ fio: string; position: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<FilterKey>("all")

  const [createOpen, setCreateOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [docOrder, setDocOrder] = useState<LabelOrderRow | null>(null)
  const [docTab, setDocTab] = useState<"doc" | "fact">("doc")

  const [attachOpen, setAttachOpen] = useState(false)
  const [attachOrder, setAttachOrder] = useState<LabelOrderRow | null>(null)
  const [codesText, setCodesText] = useState("")

  const [signOpen, setSignOpen] = useState(false)
  const [signOrder, setSignOrder] = useState<LabelOrderRow | null>(null)
  const [certs, setCerts] = useState<CryptoProCertInfo[]>([])
  const [certThumb, setCertThumb] = useState("")
  const [certsLoading, setCertsLoading] = useState(false)
  const [signBusy, setSignBusy] = useState(false)

  const [deleteUnlocked, setDeleteUnlocked] = useState(false)
  const [masterOpen, setMasterOpen] = useState(false)
  const [masterCode, setMasterCode] = useState("")
  const [masterError, setMasterError] = useState("")
  const [masterBusy, setMasterBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<LabelOrderRow | null>(null)

  const load = useCallback(async () => {
    try {
      const [res, mats] = await Promise.all([
        listLabelOrderRows(100),
        loadLabelPrintMaterials().catch(() => [] as LabelPrintMaterial[]),
      ])
      setOrders(res.orders)
      if (res.settings) setWasteSettings(res.settings)
      if (res.suzSettings) {
        saveLabelSuzSettings(mergeLabelSuzSettings(res.suzSettings))
      }
      setMaterials(mats)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const dialogOpen =
    createOpen ||
    settingsOpen ||
    helpOpen ||
    Boolean(docOrder) ||
    attachOpen ||
    signOpen ||
    masterOpen ||
    Boolean(deleteTarget)

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (dialogOpen) return
    const t = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [load, dialogOpen])

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store", headers: authRequestHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { fio?: string; position?: string } } | null) => {
        if (data?.user) {
          setAuthor({ fio: data.user.fio ?? "", position: data.user.position ?? "" })
        }
      })
      .catch(() => undefined)
  }, [])

  const counts = useMemo(() => {
    const byFilter: Record<FilterKey, number> = {
      all: orders.length,
      waiting: 0,
      ready: 0,
      printed: 0,
      needFact: 0,
    }
    for (const o of orders) {
      if (!o.hasCodes && o.status !== "cancelled") byFilter.waiting += 1
      if (o.hasCodes && !isPrinted(o)) byFilter.ready += 1
      if (isPrinted(o)) byFilter.printed += 1
      if (factMissing(o, wasteSettings)) byFilter.needFact += 1
    }
    return byFilter
  }, [orders, wasteSettings])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const digits = needle.replace(/\D/g, "")
    return orders.filter((o) => {
      if (filter === "waiting" && (o.hasCodes || o.status === "cancelled")) return false
      if (filter === "ready" && (!o.hasCodes || isPrinted(o))) return false
      if (filter === "printed" && !isPrinted(o)) return false
      if (filter === "needFact" && !factMissing(o, wasteSettings)) return false
      if (!needle) return true
      const haystack = [
        o.doc?.docNo ?? "",
        o.nomenclatureName ?? "",
        o.gtin ?? "",
        o.doc?.authorFio ?? "",
        o.doc?.authorLogin ?? "",
        o.doc?.comment ?? "",
        o.note ?? "",
        o.deviceId ?? "",
      ]
        .join(" ")
        .toLowerCase()
      if (haystack.includes(needle)) return true
      return digits.length >= 3 && (o.gtin ?? "").includes(digits)
    })
  }, [orders, query, filter, wasteSettings])

  const openSettings = () => setSettingsOpen(true)

  const persistSettings = async (next: LabelOrderWasteSettings, suz: LabelSuzSettings) => {
    try {
      const saved = await saveLabelOrderSettings(next, suz)
      setWasteSettings(saved.settings)
      saveLabelSuzSettings(mergeLabelSuzSettings(saved.suzSettings, suz))
      toast({ title: "Настройки заказов сохранены" })
    } catch (e) {
      toast({
        title: "Не удалось сохранить настройки",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
      throw e
    }
  }

  const refreshCerts = async (preferThumb?: string) => {
    setCertsLoading(true)
    try {
      const list = await loadSuzCertificates()
      setCerts(list)
      const settings = loadLabelSuzSettings()
      const pick =
        preferThumb ||
        settings.lastCertThumbprint ||
        list.find((c) => c.isValid)?.thumbprint ||
        list[0]?.thumbprint ||
        ""
      setCertThumb(pick)
    } catch (e) {
      setCerts([])
      toast({
        title: "КриптоПро",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setCertsLoading(false)
    }
  }

  const openSign = async (o: LabelOrderRow) => {
    const settings = loadLabelSuzSettings()
    if (!settings.clientToken.trim() || !settings.omsId.trim()) {
      toast({
        title: "Сначала заполните настройки СУЗ",
        description: "omsId и clientToken обязательны",
        variant: "destructive",
      })
      openSettings()
      return
    }
    setSignOrder(o)
    setSignOpen(true)
    await refreshCerts(settings.lastCertThumbprint)
  }

  const patchOrder = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/wms/label-code-orders", {
      method: "POST",
      headers: authRequestHeaders({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify({ siteCode: getSiteCode(), ...body }),
    })
    const data = (await res.json()) as { error?: string }
    if (!res.ok) throw new Error(data.error || res.statusText)
  }

  const runSign = async () => {
    if (!signOrder) return
    setSignBusy(true)
    setBusyId(signOrder.id)
    try {
      const result = await signAndFetchCodesForLabelOrder({
        gtin: signOrder.gtin,
        quantity: signOrder.quantity,
        stickerType: signOrder.stickerType,
        thumbprint: certThumb,
        productGroupHints: [
          signOrder.nomenclatureName,
          signOrder.doc?.nomenclatureName,
        ],
      })
      const note = `suzOrderId=${result.upstreamOrderId}`
      if (result.codes.length > 0) {
        await patchOrder({
          action: "patch",
          id: signOrder.id,
          codes: result.codes,
          status: "codes_ready",
          note,
        })
        toast({
          title: "Заказ подписан, коды получены",
          description: `СУЗ ${result.upstreamOrderId.slice(0, 8)}… · ${result.productGroup} · КМ: ${result.codes.length}`,
        })
      } else {
        await patchOrder({ action: "patch", id: signOrder.id, status: "signed", note })
        toast({
          title: "Заказ создан в СУЗ",
          description: "Буфер КМ ещё не готов — нажмите «Получить КМ» через минуту.",
        })
      }
      setSignOpen(false)
      await load()
    } catch (e) {
      toast({
        title: "Не удалось подписать / заказать коды",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setSignBusy(false)
      setBusyId(null)
    }
  }

  const fetchKmOnly = async (o: LabelOrderRow) => {
    const suzId = parseSuzOrderIdFromNote(o.note || "")
    if (!suzId) {
      toast({
        title: "Нет suzOrderId",
        description: "Сначала нажмите «Подписать»",
        variant: "destructive",
      })
      return
    }
    const settings = loadLabelSuzSettings()
    if (!settings.lastCertThumbprint && !certThumb) {
      await openSign(o)
      return
    }
    setBusyId(o.id)
    try {
      if (!certs.length) await refreshCerts(settings.lastCertThumbprint)
      const thumb = certThumb || settings.lastCertThumbprint
      const codes = await fetchCodesFromSuzOrder({
        orderId: suzId,
        gtin: o.gtin,
        quantity: o.quantity,
        thumbprint: thumb,
      })
      await patchOrder({
        action: "patch",
        id: o.id,
        codes,
        status: "codes_ready",
        note: o.note || `suzOrderId=${suzId}`,
      })
      toast({ title: "Коды получены из СУЗ", description: `КМ: ${codes.length}` })
      await load()
    } catch (e) {
      toast({
        title: "Не удалось получить КМ",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const openAttach = (o: LabelOrderRow) => {
    setAttachOrder(o)
    setCodesText("")
    setAttachOpen(true)
  }

  const saveCodes = async () => {
    if (!attachOrder) return
    setBusyId(attachOrder.id)
    try {
      await patchOrder({
        action: "patch",
        id: attachOrder.id,
        codes: codesText,
        status: "codes_ready",
      })
      toast({ title: "Коды прикреплены к заказу" })
      setAttachOpen(false)
      await load()
    } catch (e) {
      toast({
        title: "Не удалось сохранить коды",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const sendToPrinter = async (o: LabelOrderRow) => {
    setBusyId(o.id)
    try {
      const res = await fetch("/api/wms/label-code-orders", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({
          action: "print",
          id: o.id,
          autoStart: true,
          siteCode: getSiteCode(),
        }),
      })
      const data = (await res.json()) as {
        error?: string
        printJobId?: string
        codesCount?: number
        receiving?: { documentId?: string; already?: boolean }
        receivingError?: string
      }
      if (!res.ok) throw new Error(data.error || res.statusText)
      const recv = data.receiving?.documentId
        ? data.receiving.already
          ? ` · в приёмке уже ${data.receiving.documentId}`
          : ` · в приёмке ${data.receiving.documentId}`
        : data.receivingError
          ? ` · приход: ${data.receivingError}`
          : ""
      toast({
        title: "Задание ушло в очередь печати",
        description: `Кодов: ${data.codesCount ?? "—"}${recv}. После печати внесите факт — «Факт печати».`,
      })
      await load()
    } catch (e) {
      toast({
        title: "Не удалось отправить на принтер",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const downloadCodes = (o: LabelOrderRow) => {
    window.open(`/api/wms/label-code-orders/${encodeURIComponent(o.id)}?download=1`, "_blank")
  }

  const requestDeleteUnlock = (allow: boolean) => {
    if (!allow) {
      setDeleteUnlocked(false)
      return
    }
    if (deleteUnlocked) return
    setMasterCode("")
    setMasterError("")
    setMasterOpen(true)
  }

  const confirmMasterCode = async () => {
    setMasterBusy(true)
    setMasterError("")
    try {
      await patchOrder({ action: "unlock-delete", masterCode })
      setDeleteUnlocked(true)
      setMasterOpen(false)
      toast({ title: "Удаление строк разрешено" })
    } catch (e) {
      setMasterError(e instanceof Error ? e.message : String(e))
    } finally {
      setMasterBusy(false)
    }
  }

  const sendToReceiving = async (o: LabelOrderRow) => {
    setBusyId(o.id)
    try {
      const res = await fetch("/api/wms/label-code-orders", {
        method: "POST",
        headers: authRequestHeaders({ "Content-Type": "application/json" }),
        credentials: "same-origin",
        body: JSON.stringify({ action: "to-receiving", id: o.id, siteCode: getSiteCode() }),
      })
      const data = (await res.json()) as {
        error?: string
        documentId?: string
        codesCount?: number
        already?: boolean
      }
      if (!res.ok) throw new Error(data.error || res.statusText)
      toast({
        title: data.already ? "Коды уже в приёмке" : "Коды ушли в приход",
        description: `${data.documentId ?? ""} · ${data.codesCount ?? o.codesCount} шт. Откройте «Приёмка».`,
      })
    } catch (e) {
      toast({
        title: "Не удалось отправить в приход",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const deleteOrder = async (o: LabelOrderRow) => {
    setBusyId(o.id)
    try {
      await patchOrder({ action: "delete", id: o.id, masterCode })
      toast({ title: "Заказ удалён" })
      setDeleteTarget(null)
      await load()
    } catch (e) {
      toast({
        title: "Не удалось удалить заказ",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const openDoc = (o: LabelOrderRow, tab: "doc" | "fact") => {
    setDocTab(tab)
    setDocOrder(o)
  }

  const rows = useMemo(
    () =>
      visible.map((o) => {
        const fact = o.fact ?? summarizeLabelOrderFact([])
        const planWaste = o.doc?.plannedWasteQty ?? plannedWasteQty(o.quantity, wasteSettings)
        return {
          o,
          fact,
          planWaste,
          hasSuz: Boolean(parseSuzOrderIdFromNote(o.note || "")),
          when: fmtWhen(o.doc?.createdAt || o.createdAt),
          material: findMaterialForStickerType(materials, o.stickerType),
          needFact: factMissing(o, wasteSettings),
          verdict: labelOrderFactVerdict(
            {
              quantity: o.doc?.quantity || o.quantity,
              plannedWasteQty: planWaste,
              wastePercent: o.doc?.wastePercent ?? wasteSettings.wastePercent,
            },
            fact,
            wasteSettings
          ),
        }
      }),
    [visible, materials, wasteSettings]
  )

  const primaryAction = (o: LabelOrderRow, hasSuz: boolean, full = false) => {
    const busy = busyId === o.id
    const cls = cn("h-8 text-xs", full && "min-w-0")
    if (o.hasCodes) {
      return (
        <Button
          type="button"
          size="sm"
          className={cls}
          disabled={busy}
          onClick={() => void sendToPrinter(o)}
        >
          {busy ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Printer className="mr-1 size-3.5" />
          )}
          На принтер
        </Button>
      )
    }
    if (hasSuz) {
      return (
        <Button
          type="button"
          size="sm"
          className={cls}
          disabled={busy}
          onClick={() => void fetchKmOnly(o)}
        >
          {busy ? (
            <Loader2 className="mr-1 size-3.5 animate-spin" />
          ) : (
            <Download className="mr-1 size-3.5" />
          )}
          Получить КМ
        </Button>
      )
    }
    return (
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className={cls}
        disabled={busy}
        onClick={() => void openSign(o)}
        title="УКЭП → заказ в СУЗ → получение КМ"
      >
        <PenLine className="mr-1 size-3.5" />
        Подписать
      </Button>
    )
  }

  const rowMenu = (o: LabelOrderRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8 shrink-0"
          disabled={busyId === o.id}
          aria-label="Ещё действия"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => openDoc(o, "doc")}>
          <ScrollText className="mr-2 size-3.5" />
          Документ и история
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openDoc(o, "fact")}>
          <PenLine className="mr-2 size-3.5" />
          Факт печати
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openAttach(o)}>
          <FileUp className="mr-2 size-3.5" />
          Файл / коды
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!o.hasCodes} onSelect={() => downloadCodes(o)}>
          <Download className="mr-2 size-3.5" />
          Скачать коды
        </DropdownMenuItem>
        {o.hasCodes ? (
          <DropdownMenuItem onSelect={() => void sendToReceiving(o)}>
            <Truck className="mr-2 size-3.5" />
            В приход
          </DropdownMenuItem>
        ) : null}
        {o.hasCodes ? (
          <DropdownMenuItem onSelect={() => void openSign(o)}>
            <PenLine className="mr-2 size-3.5" />
            Подписать заново
          </DropdownMenuItem>
        ) : null}
        {deleteUnlocked ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onSelect={() => setDeleteTarget(o)}>
              <Trash2 className="mr-2 size-3.5" />
              Удалить заказ
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="min-w-0">
      <div className="space-y-2.5">
        <div className="wms-panel sticky top-0 z-30 rounded-2xl px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <h1 className="text-sm font-semibold tracking-tight text-foreground">Заказы кодов</h1>
            <div className="relative min-w-[10rem] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Документ, номенклатура, GTIN, автор"
                className="h-8 pl-8 text-xs"
              />
            </div>
            <div className="order-last flex w-full flex-wrap items-center gap-1.5 sm:order-none sm:ml-auto sm:w-auto sm:flex-nowrap sm:justify-end">
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg text-xs"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="mr-1 size-3.5" />
                Новый заказ
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 rounded-lg"
                onClick={() => void load()}
                disabled={loading}
                title="Обновить список"
                aria-label="Обновить список"
              >
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8 rounded-lg"
                onClick={() => setHelpOpen(true)}
                title="Как работают заказы и погрешность"
                aria-label="Справка"
              >
                <BookOpen className="size-4" />
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-8 rounded-lg"
                    title="Настройки страницы"
                    aria-label="Настройки"
                  >
                    <Settings className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel>Заказы кодов</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
                    Погрешность печати и СУЗ
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={deleteUnlocked}
                    onCheckedChange={(v) => requestDeleteUnlock(Boolean(v))}
                    onSelect={(e) => e.preventDefault()}
                  >
                    Разрешить удаление
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="-mx-1 flex w-full min-w-0 items-center gap-1 overflow-x-auto px-1 sm:mx-0 sm:w-auto sm:px-0">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs transition-colors",
                    filter === f.key
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border/60 text-muted-foreground hover:text-foreground"
                  )}
                >
                  {f.label}
                  <span
                    className={cn(
                      "tabular-nums",
                      f.key === "needFact" && counts.needFact > 0
                        ? "font-semibold text-amber-700"
                        : "text-muted-foreground"
                    )}
                  >
                    {counts[f.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && orders.length === 0 ? (
          <WmsLoadingState label="Загрузка заказов кодов…" />
        ) : error && orders.length === 0 ? (
          <WmsErrorState message={error} onRetry={() => void load()} />
        ) : orders.length === 0 ? (
          <WmsEmptyState
            title="Заказов пока нет"
            description="Нажмите «Новый заказ» или закажите коды на терминале у принтера — заявка появится здесь."
          />
        ) : visible.length === 0 ? (
          <WmsEmptyState
            title="Ничего не найдено"
            description="Поменяйте фильтр или поисковый запрос — заказы никуда не делись."
          />
        ) : (
          <div className="wms-panel hidden min-w-0 overflow-hidden rounded-2xl xl:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="w-[10rem] px-3 py-2 text-left font-medium">Документ</th>
                    <th className="px-3 py-2 text-left font-medium">Номенклатура</th>
                    <th className="w-[7rem] px-3 py-2 text-right font-medium">План</th>
                    <th className="w-[8.5rem] px-3 py-2 text-right font-medium">Факт печати</th>
                    <th className="w-[6rem] px-3 py-2 text-left font-medium">Статус</th>
                    <th className="w-[11.5rem] px-3 py-2 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map(({ o, fact, planWaste, hasSuz, when, material, needFact, verdict }) => {
                    return (
                      <tr key={o.id} className="align-top hover:bg-muted/20">
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => openDoc(o, "doc")}
                            className="font-mono text-xs font-semibold text-foreground underline-offset-2 hover:underline"
                            title="Открыть документ заказа"
                          >
                            {o.doc?.docNo || "без номера"}
                          </button>
                          <div className="text-[11px] tabular-nums text-muted-foreground">
                            {when.date} · {when.time}
                          </div>
                          <div className="line-clamp-1 text-[11px] text-foreground/75">
                            {labelOrderAuthorLabel(o.doc)}
                          </div>
                          <div className="line-clamp-1 text-[11px] text-muted-foreground">
                            {labelOrderOriginLabel(o.doc, o)}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="line-clamp-2 text-xs font-medium text-foreground/90">
                            {o.nomenclatureName || "—"}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                            <span className="font-mono">{o.gtin}</span>
                            <span>{stickerTypeRu(o.stickerType)}</span>
                          </div>
                          <div className="line-clamp-1 text-[11px] text-muted-foreground/80">
                            {material
                              ? `материал: ${material.name} · остаток ${fmtInt(material.availableQty)}`
                              : "материал не привязан — включите «Расходник для печати стикеров»"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="text-xs font-semibold tabular-nums text-foreground">
                            {fmtInt(o.quantity)}
                          </div>
                          <div className="text-[11px] tabular-nums text-muted-foreground">
                            хвост {fmtInt(planWaste)}
                          </div>
                          <div className="text-[11px] tabular-nums text-muted-foreground">
                            {o.codesCount > 0 ? `КМ ${fmtInt(o.codesCount)}` : "КМ нет"}
                          </div>
                          {o.codesCount > 0 && o.quantity > 0 && o.codesCount !== o.quantity ? (
                            <div className="text-[10px] font-medium text-amber-700">
                              заказ {fmtInt(o.quantity)}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {fact.adjustmentsCount > 0 ? (
                            <button
                              type="button"
                              onClick={() => openDoc(o, "fact")}
                              className="w-full text-right"
                              title="Корректировки факта печати"
                            >
                              <div className="text-xs tabular-nums text-foreground">
                                {fmtInt(fact.printedQty)} + {fmtInt(fact.wasteQty)}
                              </div>
                              <div
                                className={cn(
                                  "text-[11px] font-medium tabular-nums",
                                  verdict.tone === "ok" && "text-emerald-700",
                                  verdict.tone === "warn" && "text-amber-700",
                                  verdict.tone === "danger" && "text-destructive",
                                  verdict.tone === "empty" && "text-muted-foreground"
                                )}
                              >
                                {fmtPercent(fact.wastePercent)}
                              </div>
                              <div className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                                {verdict.text}
                              </div>
                            </button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant={needFact ? "secondary" : "ghost"}
                              className="h-7 px-2 text-[11px]"
                              onClick={() => openDoc(o, "fact")}
                            >
                              {needFact ? (
                                <AlertTriangle className="mr-1 size-3 text-amber-700" />
                              ) : null}
                              Внести факт
                            </Button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={cn("font-normal", statusClass(o.status))}>
                            {statusLabel(o.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            {primaryAction(o, hasSuz)}
                            {rowMenu(o)}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows.length > 0 ? (
          <div className="grid gap-2 md:grid-cols-2 xl:hidden">
            {rows.map(({ o, fact, planWaste, hasSuz, when, material, needFact, verdict }) => (
              <article key={o.id} className="wms-panel flex h-full flex-col rounded-2xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openDoc(o, "doc")}
                      className="font-mono text-xs font-semibold text-foreground underline-offset-2 hover:underline"
                    >
                      {o.doc?.docNo || "без номера"}
                    </button>
                    <p className="text-[11px] tabular-nums text-muted-foreground">
                      {when.date} · {when.time} · {labelOrderAuthorLabel(o.doc)}
                    </p>
                  </div>
                  <Badge className={cn("shrink-0 font-normal", statusClass(o.status))}>
                    {statusLabel(o.status)}
                  </Badge>
                </div>

                <p className="mt-2 text-xs font-medium leading-snug text-foreground/90">
                  {o.nomenclatureName || "—"}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className="font-mono">{o.gtin}</span>
                  <span>{stickerTypeRu(o.stickerType)}</span>
                  {material ? <span>остаток {fmtInt(material.availableQty)}</span> : null}
                </p>

                <dl className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-muted/25 p-2 text-center">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      План
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums text-foreground">
                      {fmtInt(o.quantity)}
                    </dd>
                    <dd className="text-[10px] tabular-nums text-muted-foreground">
                      хвост {fmtInt(planWaste)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Коды
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums text-foreground">
                      {o.codesCount > 0 ? fmtInt(o.codesCount) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      Факт
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums text-foreground">
                      {fact.adjustmentsCount > 0 ? fmtInt(fact.printedQty) : "—"}
                    </dd>
                    <dd
                      className={cn(
                        "text-[10px] tabular-nums",
                        verdict.tone === "ok" && "text-emerald-700",
                        verdict.tone === "warn" && "text-amber-700",
                        verdict.tone === "danger" && "text-destructive",
                        verdict.tone === "empty" && "text-muted-foreground"
                      )}
                    >
                      {fact.adjustmentsCount > 0 ? fmtPercent(fact.wastePercent) : "нет данных"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-auto grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1.5 pt-2">
                  {primaryAction(o, hasSuz, true)}
                  <Button
                    type="button"
                    size="sm"
                    variant={needFact ? "secondary" : "outline"}
                    className="h-8 min-w-0 text-xs"
                    onClick={() => openDoc(o, "fact")}
                  >
                    {needFact ? (
                      <AlertTriangle className="mr-1 size-3 shrink-0 text-amber-700" />
                    ) : null}
                    <span className="truncate">Факт</span>
                  </Button>
                  {rowMenu(o)}
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <LabelOrderCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        settings={wasteSettings}
        materials={materials}
        author={author}
        onCreated={(message) => {
          toast({ title: "Заказ создан", description: message })
          void load()
        }}
      />

      <LabelOrderDocDialog
        order={docOrder}
        open={Boolean(docOrder)}
        onOpenChange={(open) => {
          if (!open) setDocOrder(null)
        }}
        settings={wasteSettings}
        defaultTab={docTab}
        onChanged={() => void load()}
      />

      <LabelOrderSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        waste={wasteSettings}
        onSave={persistSettings}
      />

      <LabelOrderHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      <Dialog open={attachOpen} onOpenChange={setAttachOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-lg flex-col gap-3 overflow-hidden sm:max-w-xl">
          <DialogHeader className="shrink-0">
            <DialogTitle>Прикрепить коды к заказу</DialogTitle>
          </DialogHeader>
          <p className="shrink-0 text-xs text-muted-foreground">
            {attachOrder?.nomenclatureName || "—"} · GTIN {attachOrder?.gtin} · нужно ~
            {attachOrder?.quantity}
            {codesText.trim()
              ? ` · в окне: ${codesText.split(/\r?\n/).filter((l) => l.trim()).length}`
              : ""}
          </p>
          <Textarea
            value={codesText}
            onChange={(e) => setCodesText(e.target.value)}
            placeholder={"Один КИ на строку\n01…21…"}
            className="min-h-[160px] max-h-[min(50vh,420px)] flex-1 overflow-y-auto font-mono text-xs [field-sizing:fixed]"
          />
          <DialogFooter className="shrink-0 gap-2 sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setAttachOpen(false)}>
              Отмена
            </Button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!codesText.trim() || busyId === attachOrder?.id}
                onClick={() => void saveCodes()}
              >
                <Send className="mr-1.5 size-3.5" />
                Сохранить
              </Button>
              {attachOrder?.hasCodes ? (
                <Button
                  type="button"
                  disabled={busyId === attachOrder?.id}
                  onClick={() => {
                    setAttachOpen(false)
                    void sendToPrinter(attachOrder)
                  }}
                >
                  <Printer className="mr-1.5 size-3.5" />
                  На принтер
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={masterOpen}
        onOpenChange={(open) => {
          setMasterOpen(open)
          if (!open) setMasterError("")
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Мастер-код</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Чтобы разрешить удаление строк на этой странице, введите мастер-код.
          </p>
          <Input
            type="password"
            inputMode="numeric"
            autoFocus
            value={masterCode}
            onChange={(e) => setMasterCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmMasterCode()
            }}
            placeholder="Мастер-код"
          />
          {masterError ? <p className="text-xs text-destructive">{masterError}</p> : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setMasterOpen(false)}
              disabled={masterBusy}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={!masterCode.trim() || masterBusy}
              onClick={() => void confirmMasterCode()}
            >
              {masterBusy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
              Разрешить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить заказ кодов?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget?.doc?.docNo ? `${deleteTarget.doc.docNo} · ` : ""}
            {deleteTarget?.nomenclatureName || "—"} · GTIN {deleteTarget?.gtin} ·{" "}
            {deleteTarget?.quantity} шт. Строка исчезнет из очереди, документ и корректировки
            останутся в истории.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!deleteTarget || busyId === deleteTarget?.id}
              onClick={() => deleteTarget && void deleteOrder(deleteTarget)}
            >
              {busyId === deleteTarget?.id ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 size-3.5" />
              )}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Подписать заказ в СУЗ</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              {signOrder?.nomenclatureName || "—"}
              <br />
              GTIN <span className="font-mono">{signOrder?.gtin}</span> · кол-во{" "}
              <strong>{signOrder?.quantity}</strong>
              {(() => {
                const group =
                  parseSuzProductGroup(signOrder?.nomenclatureName) ||
                  inferSuzGroupFromProductName(signOrder?.nomenclatureName)
                return group ? (
                  <>
                    {" "}
                    · ЧЗ {SUZ_GROUP_LABEL[group]}
                  </>
                ) : null
              })()}
            </p>
            <label className="grid gap-1">
              <span className="text-xs text-muted-foreground">Сертификат УКЭП (КриптоПро)</span>
              <div className="flex gap-2">
                <select
                  className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                  value={certThumb}
                  onChange={(e) => setCertThumb(e.target.value)}
                  disabled={certsLoading || signBusy}
                >
                  <option value="">Выберите сертификат</option>
                  {certs.map((c) => (
                    <option key={c.thumbprint} value={c.thumbprint}>
                      {c.name || c.subjectName} {c.isValid ? "" : "(недействителен)"}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={certsLoading || signBusy}
                  onClick={() => void refreshCerts()}
                >
                  {certsLoading ? <Loader2 className="size-3.5 animate-spin" /> : "Обновить"}
                </Button>
              </div>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSignOpen(false)} disabled={signBusy}>
              Отмена
            </Button>
            <Button type="button" disabled={!certThumb || signBusy} onClick={() => void runSign()}>
              {signBusy ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <PenLine className="mr-1.5 size-3.5" />
              )}
              Подписать и заказать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
