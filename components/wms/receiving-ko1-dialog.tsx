"use client"

import { useCallback, useMemo, useState } from "react"
import { Printer } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Ko1PrintSheet, type Ko1PrintData } from "@/components/wms/ko1-print-sheet"
import { rublesAndKopecksToWords } from "@/lib/ko1/amount-in-words-ru"

const LS = {
  org: "wms.ko1.organizationName",
  unit: "wms.ko1.structuralUnit",
  okpo: "wms.ko1.okpoCode",
  debit: "wms.ko1.debitAccount",
  credStruct: "wms.ko1.creditStructuralCode",
  credAcc: "wms.ko1.creditAccount",
  credAn: "wms.ko1.creditAnalyticCode",
  purpose: "wms.ko1.purposeCode",
  received: "wms.ko1.receivedFrom",
  seq: "wms.ko1.docSeq",
} as const

function readLs(key: string, fallback = ""): string {
  if (typeof window === "undefined") return fallback
  return window.localStorage.getItem(key)?.trim() ?? fallback
}

function writeLs(key: string, value: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(key, value.trim())
}

function formatDateRu(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number)
  if (!y || !m || !d) return isoDate
  const dd = String(d).padStart(2, "0")
  const mm = String(m).padStart(2, "0")
  return `${dd}.${mm}.${y}`
}

function parseAmountToMinor(amountStr: string): { rubles: number; kopecks: number } | null {
  const cleaned = amountStr.replace(/\s/g, "").replace(",", ".")
  if (cleaned === "") return null
  const n = Number(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  const cents = Math.round(n * 100)
  return { rubles: Math.floor(cents / 100), kopecks: cents % 100 }
}

function formatDigitsRubKop(rubles: number, kopecks: number): { rub: string; kop: string } {
  const rub = rubles.toLocaleString("ru-RU").replace(/\u00a0/g, " ")
  return { rub, kop: String(kopecks).padStart(2, "0") }
}

function previewNextDocNo(): string {
  const lastPrinted = parseInt(readLs(LS.seq, "0"), 10) || 0
  return String(lastPrinted + 1).padStart(6, "0")
}

export function ReceivingKo1Dialog({
  suggestedBasis,
  suggestedReceivedFrom,
}: {
  suggestedBasis?: string
  suggestedReceivedFrom?: string
}) {
  const [open, setOpen] = useState(false)
  const [organizationName, setOrganizationName] = useState("")
  const [structuralUnit, setStructuralUnit] = useState("")
  const [okpoCode, setOkpoCode] = useState("")
  const [documentNo, setDocumentNo] = useState("")
  const [documentDateIso, setDocumentDateIso] = useState("")
  const [debitAccount, setDebitAccount] = useState("")
  const [creditStructuralCode, setCreditStructuralCode] = useState("")
  const [creditAccount, setCreditAccount] = useState("")
  const [creditAnalyticCode, setCreditAnalyticCode] = useState("")
  const [amountStr, setAmountStr] = useState("")
  const [purposeCode, setPurposeCode] = useState("")
  const [receivedFrom, setReceivedFrom] = useState("")
  const [basis, setBasis] = useState("")
  const [includingLine, setIncludingLine] = useState("")
  const [attachment, setAttachment] = useState("")
  const [amountError, setAmountError] = useState<string | null>(null)

  const resetFormForDialog = useCallback(() => {
    setOrganizationName(readLs(LS.org))
    setStructuralUnit(readLs(LS.unit))
    setOkpoCode(readLs(LS.okpo))
    setDebitAccount(readLs(LS.debit))
    setCreditStructuralCode(readLs(LS.credStruct))
    setCreditAccount(readLs(LS.credAcc))
    setCreditAnalyticCode(readLs(LS.credAn))
    setPurposeCode(readLs(LS.purpose))
    setReceivedFrom(suggestedReceivedFrom?.trim() || readLs(LS.received))
    setBasis(suggestedBasis?.trim() || "")
    setDocumentNo(previewNextDocNo())
    const t = new Date()
    setDocumentDateIso(t.toISOString().slice(0, 10))
    setAmountStr("")
    setIncludingLine("")
    setAttachment("")
    setAmountError(null)
  }, [suggestedBasis, suggestedReceivedFrom])

  const persistDefaults = useCallback(() => {
    writeLs(LS.org, organizationName)
    writeLs(LS.unit, structuralUnit)
    writeLs(LS.okpo, okpoCode)
    writeLs(LS.debit, debitAccount)
    writeLs(LS.credStruct, creditStructuralCode)
    writeLs(LS.credAcc, creditAccount)
    writeLs(LS.credAn, creditAnalyticCode)
    writeLs(LS.purpose, purposeCode)
    writeLs(LS.received, receivedFrom)
  }, [
    organizationName,
    structuralUnit,
    okpoCode,
    debitAccount,
    creditStructuralCode,
    creditAccount,
    creditAnalyticCode,
    purposeCode,
    receivedFrom,
  ])

  const printData: Ko1PrintData | null = useMemo(() => {
    const minor = parseAmountToMinor(amountStr)
    if (!minor) return null
    const words = rublesAndKopecksToWords(minor.rubles, minor.kopecks)
    const { rub, kop } = formatDigitsRubKop(minor.rubles, minor.kopecks)
    return {
      organizationName,
      structuralUnit,
      okpoCode: okpoCode || undefined,
      documentNo,
      documentDateDisplay: formatDateRu(documentDateIso),
      debitAccount,
      creditStructuralCode,
      creditAccount,
      creditAnalyticCode,
      amountDigitsRub: rub,
      amountDigitsKop: kop,
      amountWords: words,
      purposeCode,
      receivedFrom,
      basis,
      includingLine,
      attachment,
    }
  }, [
    amountStr,
    organizationName,
    structuralUnit,
    okpoCode,
    documentNo,
    documentDateIso,
    debitAccount,
    creditStructuralCode,
    creditAccount,
    creditAnalyticCode,
    purposeCode,
    receivedFrom,
    basis,
    includingLine,
    attachment,
  ])

  function handlePrint() {
    const minor = parseAmountToMinor(amountStr)
    if (!minor) {
      setAmountError("Укажите сумму (рубли с копейками)")
      return
    }
    setAmountError(null)
    persistDefaults()
    document.documentElement.classList.add("ko1-printing")
    const cleanup = () => {
      document.documentElement.classList.remove("ko1-printing")
      window.removeEventListener("afterprint", cleanup)
    }
    window.addEventListener(
      "afterprint",
      () => {
        const userNo = parseInt(documentNo.replace(/\D/g, ""), 10)
        const lastPrinted = parseInt(readLs(LS.seq, "0"), 10) || 0
        const storedNo = Number.isFinite(userNo) ? userNo : lastPrinted + 1
        writeLs(LS.seq, String(storedNo))
        cleanup()
      },
      { once: true }
    )
    requestAnimationFrame(() => window.print())
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) resetFormForDialog()
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="rounded-xl gap-2">
          <Printer className="h-4 w-4" />
          Приходный ордер (КО-1)
        </Button>
      </DialogTrigger>
      <DialogContent className="no-print max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Приходный кассовый ордер (форма КО-1)</DialogTitle>
          <DialogDescription>
            Заполните реквизиты для бухгалтерии и распечатайте документ. Сумма прописью формируется автоматически. Номер
            документа подставляется при открытии окна (счётчик в браузере).
          </DialogDescription>
        </DialogHeader>

        <div className="no-print grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ko1-org">Организация</Label>
            <Input
              id="ko1-org"
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder="Полное наименование"
              className="rounded-xl"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ko1-unit">Структурное подразделение</Label>
            <Input
              id="ko1-unit"
              value={structuralUnit}
              onChange={(e) => setStructuralUnit(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <Label htmlFor="ko1-okpo">ОКПО (если есть)</Label>
            <Input id="ko1-okpo" value={okpoCode} onChange={(e) => setOkpoCode(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div>
            <Label htmlFor="ko1-docno">Номер документа</Label>
            <Input id="ko1-docno" value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div>
            <Label htmlFor="ko1-date">Дата</Label>
            <Input
              id="ko1-date"
              type="date"
              value={documentDateIso}
              onChange={(e) => setDocumentDateIso(e.target.value)}
              className="rounded-xl"
            />
          </div>
          <div>
            <Label htmlFor="ko1-amount">Сумма, руб.</Label>
            <Input
              id="ko1-amount"
              inputMode="decimal"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value)
                setAmountError(null)
              }}
              placeholder="Например 12500 или 12500,50"
              className="rounded-xl font-mono"
            />
            {amountError && <p className="mt-1 text-xs text-destructive">{amountError}</p>}
          </div>
          <div>
            <Label htmlFor="ko1-debit">Дебет (счёт)</Label>
            <Input id="ko1-debit" value={debitAccount} onChange={(e) => setDebitAccount(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div>
            <Label htmlFor="ko1-cs">Кредит: код подразделения</Label>
            <Input id="ko1-cs" value={creditStructuralCode} onChange={(e) => setCreditStructuralCode(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div>
            <Label htmlFor="ko1-ca">Кредит: счёт, субсчёт</Label>
            <Input id="ko1-ca" value={creditAccount} onChange={(e) => setCreditAccount(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div>
            <Label htmlFor="ko1-can">Кредит: код аналитики</Label>
            <Input id="ko1-can" value={creditAnalyticCode} onChange={(e) => setCreditAnalyticCode(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div>
            <Label htmlFor="ko1-purpose">Код целевого назначения</Label>
            <Input id="ko1-purpose" value={purposeCode} onChange={(e) => setPurposeCode(e.target.value)} className="rounded-xl font-mono" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ko1-from">Принято от</Label>
            <Input id="ko1-from" value={receivedFrom} onChange={(e) => setReceivedFrom(e.target.value)} className="rounded-xl" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ko1-basis">Основание</Label>
            <Input id="ko1-basis" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Накладная, договор, акт приёмки..." className="rounded-xl" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ko1-inc">В том числе (НДС и т.п.)</Label>
            <Input id="ko1-inc" value={includingLine} onChange={(e) => setIncludingLine(e.target.value)} className="rounded-xl" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ko1-att">Приложение</Label>
            <Input id="ko1-att" value={attachment} onChange={(e) => setAttachment(e.target.value)} className="rounded-xl" />
          </div>
        </div>

        <div className="no-print rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          Предпросмотр — ниже. При печати будет видна только форма (альбомная ориентация).
        </div>

        <div id="ko1-print-area" className="overflow-x-auto rounded-xl border border-border bg-white p-4 print:border-0 print:p-0">
          {printData ? (
            <Ko1PrintSheet data={printData} />
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">Введите сумму — появится предпросмотр КО-1 с суммой прописью.</div>
          )}
        </div>

        <DialogFooter className="no-print gap-2 sm:justify-end">
          <Button type="button" variant="secondary" className="rounded-xl" onClick={() => setOpen(false)}>
            Закрыть
          </Button>
          <Button type="button" className="rounded-xl gap-2" disabled={!printData} onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            Печать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
