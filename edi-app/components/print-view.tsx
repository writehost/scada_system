"use client"

import { fmtDate, fmtMoney, fmtQty } from "./api"
import { rublesAndKopecksToWords } from "@/lib/edi/amount-in-words.ts"
import { docType } from "@/lib/edi/doc-types.ts"

export type Org = { legalName?: string | null; inn?: string | null; kpp?: string | null; address?: string | null; bankName?: string | null; bankBik?: string | null; bankAccount?: string | null; corrAccount?: string | null; director?: string | null; accountant?: string | null; logoFileId?: string | null }
export type PrintDoc = {
  docType: string
  direction: string
  number: string | null
  docDate: string | null
  title: string
  currency: string
  amountNet: string | number | null
  amountVat: string | number | null
  amountTotal: string | number | null
  fields: Record<string, any>
  basis?: string | null
}
export type PrintCp = { name: string; inn: string | null; kpp: string | null; addressLegal?: string | null; bankName?: string | null; bankBik?: string | null; bankAccount?: string | null } | null
export type PrintLine = { lineNo: number; name: string; uomName: string | null; qty: number; price: number | null; vatRate: string | null; vatAmount: number | null; amountTotal: number | null }
export type Layout = { showLogo?: boolean; signatures?: string[]; header?: string; footer?: string; accent?: string }
export type PrintSig = { signerName: string | null; signerTitle: string | null; certSerial: string | null; certValidFrom: string | null; certValidTo: string | null; signedAt: string | null; side: string }

/** Подстановка {{fields.x}}, {{number}}, {{counterparty.name}} в тексте шаблона. */
export function fillTemplate(text: string, ctx: Record<string, any>): string {
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const v = path.split(".").reduce<any>((o, k) => (o == null ? o : o[k]), ctx)
    if (v == null || v === "") return "________"
    return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? fmtDate(String(v)) : String(v)
  })
}

function Party({ title, name, inn, kpp, address, bank }: { title: string; name?: string | null; inn?: string | null; kpp?: string | null; address?: string | null; bank?: string | null }) {
  return (
    <tr>
      <td className="w-32 py-1 pr-3 align-top text-[11px] text-neutral-500">{title}</td>
      <td className="py-1 align-top">
        <b>{name || "________________"}</b>
        {inn && <>, ИНН {inn}</>}
        {kpp && <>, КПП {kpp}</>}
        {address && <>, {address}</>}
        {bank && <div className="text-[11px]">{bank}</div>}
      </td>
    </tr>
  )
}

export function PrintView({ doc, cp, lines, org, layout, signatures = [] }: { doc: PrintDoc; cp: PrintCp; lines: PrintLine[]; org: Org | null; layout?: Layout; signatures?: PrintSig[] }) {
  const t = docType(doc.docType)
  const ours = { name: org?.legalName, inn: org?.inn, kpp: org?.kpp, address: org?.address, bank: org?.bankAccount ? `р/с ${org.bankAccount} в ${org.bankName ?? ""}, БИК ${org.bankBik ?? ""}, к/с ${org.corrAccount ?? ""}` : null }
  const theirs = cp ? { name: cp.name, inn: cp.inn, kpp: cp.kpp, address: cp.addressLegal, bank: cp.bankAccount ? `р/с ${cp.bankAccount} в ${cp.bankName ?? ""}, БИК ${cp.bankBik ?? ""}` : null } : null
  const seller = doc.direction === "incoming" ? theirs : ours
  const buyer = doc.direction === "incoming" ? ours : theirs
  const total = Number(doc.amountTotal ?? 0)
  const body = typeof doc.fields?.templateBody === "string" ? doc.fields.templateBody : null
  const ctx = { ...doc, fields: doc.fields, counterparty: cp, org }
  const accent = layout?.accent || "#24300a"
  return (
    <article className="mx-auto w-full max-w-[210mm] bg-white p-[12mm] text-[12px] leading-snug text-neutral-900 shadow-sm print:shadow-none" style={{ fontFamily: "Inter, Arial, sans-serif" }}>
      <header className="mb-4 flex items-start justify-between gap-4 border-b-2 pb-3" style={{ borderColor: accent }}>
        <div>
          {layout?.showLogo !== false && org?.logoFileId && <img src={`/api/edi/files/${org.logoFileId}?inline=1`} alt="" className="mb-2 max-h-12" />}
          <div className="font-semibold">{org?.legalName}</div>
          {layout?.header && <div className="whitespace-pre-wrap text-[11px] text-neutral-500">{fillTemplate(layout.header, ctx)}</div>}
        </div>
        <div className="text-right text-[11px] text-neutral-500">
          {org?.inn && <div>ИНН {org.inn}{org.kpp ? ` / КПП ${org.kpp}` : ""}</div>}
          {org?.address && <div className="max-w-64">{org.address}</div>}
        </div>
      </header>

      {t?.code === "invoice" && org?.bankAccount && (
        <table className="mb-4 w-full border border-neutral-400 text-[11px]">
          <tbody>
            <tr><td className="border border-neutral-400 p-1" colSpan={2}>{org.bankName}</td><td className="border border-neutral-400 p-1">БИК</td><td className="border border-neutral-400 p-1">{org.bankBik}</td></tr>
            <tr><td className="border border-neutral-400 p-1">ИНН {org.inn}</td><td className="border border-neutral-400 p-1">КПП {org.kpp}</td><td className="border border-neutral-400 p-1">Сч. №</td><td className="border border-neutral-400 p-1">{org.bankAccount}</td></tr>
            <tr><td className="border border-neutral-400 p-1" colSpan={2}>Получатель: {org.legalName}</td><td className="border border-neutral-400 p-1">Сч. №</td><td className="border border-neutral-400 p-1">{org.corrAccount}</td></tr>
          </tbody>
        </table>
      )}

      <h1 className="mb-3 text-[16px] font-bold">
        {t?.name ?? doc.title} № {doc.number || "____"} от {doc.docDate ? fmtDate(doc.docDate) : "____"}
      </h1>

      {t?.hasCounterparty && (
        <table className="mb-3 w-full">
          <tbody>
            <Party title={doc.docType === "act_works" || doc.docType === "act_services" ? "Исполнитель" : "Поставщик"} {...(seller ?? {})} />
            <Party title={doc.docType === "act_works" || doc.docType === "act_services" ? "Заказчик" : "Покупатель"} {...(buyer ?? {})} />
            {(doc.basis || doc.fields?.contractNumber) && (
              <tr>
                <td className="py-1 pr-3 text-[11px] text-neutral-500">Основание</td>
                <td className="py-1">{doc.basis || `Договор № ${doc.fields.contractNumber}`}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {doc.fields?.addressee && <p className="mb-3 text-right">{doc.fields.addressee}</p>}

      {body && <div className="mb-4 whitespace-pre-wrap">{fillTemplate(body, ctx)}</div>}
      {!body && typeof doc.fields?.body === "string" && <div className="mb-4 whitespace-pre-wrap">{doc.fields.body}</div>}

      {lines.length > 0 && (
        <table className="mb-2 w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-neutral-100">
              {["№", "Наименование", "Кол-во", "Ед.", "Цена", "НДС", "Сумма"].map((h) => <th key={h} className="border border-neutral-400 p-1 font-semibold">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="border border-neutral-400 p-1 text-center">{l.lineNo}</td>
                <td className="border border-neutral-400 p-1">{l.name}</td>
                <td className="border border-neutral-400 p-1 text-right">{fmtQty(l.qty)}</td>
                <td className="border border-neutral-400 p-1 text-center">{l.uomName ?? "шт"}</td>
                <td className="border border-neutral-400 p-1 text-right">{l.price != null ? fmtMoney(l.price, doc.currency).replace(" ₽", "") : ""}</td>
                <td className="border border-neutral-400 p-1 text-center">{l.vatRate ?? ""}</td>
                <td className="border border-neutral-400 p-1 text-right">{fmtMoney(l.amountTotal, doc.currency).replace(" ₽", "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {total > 0 && (
        <div className="mb-4 text-right">
          <div>Итого без НДС: {fmtMoney(doc.amountNet, doc.currency)}</div>
          <div>НДС: {Number(doc.amountVat ?? 0) > 0 ? fmtMoney(doc.amountVat, doc.currency) : "без НДС"}</div>
          <div className="font-bold">Всего к оплате: {fmtMoney(total, doc.currency)}</div>
          {doc.currency === "RUB" && <div className="mt-1 text-left text-[11px]">Сумма прописью: {rublesAndKopecksToWords(Math.floor(total), Math.round((total - Math.floor(total)) * 100))}</div>}
        </div>
      )}
      {doc.fields?.paymentDue && <p className="mb-3">Оплатить до {fmtDate(doc.fields.paymentDue)}.</p>}

      <footer className="mt-8 grid grid-cols-2 gap-6">
        {(layout?.signatures ?? ["Руководитель", "Главный бухгалтер"]).map((s) => (
          <div key={s}>
            <div className="text-[11px] text-neutral-500">{s}</div>
            <div className="mt-6 border-b border-neutral-500" />
            <div className="text-[10px] text-neutral-500">подпись / расшифровка</div>
          </div>
        ))}
      </footer>
      {signatures.length > 0 && (
        <section className="mt-6 grid gap-2 sm:grid-cols-2">
          {signatures.map((s) => (
            <div key={`${s.certSerial}-${s.signedAt}`} className="rounded border-2 p-2 text-[10px]" style={{ borderColor: accent }}>
              <div className="font-bold uppercase tracking-wide">Документ подписан электронной подписью</div>
              <div>Владелец: {s.signerName}{s.signerTitle ? `, ${s.signerTitle}` : ""}</div>
              <div className="break-all">Сертификат: {s.certSerial}</div>
              <div>Действителен: {fmtDate(s.certValidFrom)} — {fmtDate(s.certValidTo)}</div>
              <div>Подписано: {s.signedAt ? new Date(s.signedAt).toLocaleString("ru-RU") : "—"}</div>
            </div>
          ))}
        </section>
      )}
      {layout?.footer && <p className="mt-6 whitespace-pre-wrap text-[10px] text-neutral-500">{fillTemplate(layout.footer, ctx)}</p>}
      <p className="mt-6 text-[9px] text-neutral-400">Печатная форма электронного документа SCADA EDI. Юридическую силу имеет электронный документ с электронной подписью, если он ею подписан; изображение подписи на печатной форме подписью не является.</p>
    </article>
  )
}
