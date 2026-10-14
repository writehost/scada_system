import { round2 } from "../money.ts"
import { child, childrenNamed, find, findAll, flatText, path, textOf, type XmlNode } from "./xml.ts"

/**
 * Разбор электронного счёта-фактуры / УПД (КНД 1115131), форматы 5.01 и 5.03.
 * Оригинал файла хранится без изменений; здесь только извлечение реквизитов для карточки,
 * сопоставления и проверок. Формирование исходящих XML ФНС этим модулем не выполняется.
 */

export type Party = {
  name: string
  inn: string | null
  kpp: string | null
  address: string | null
  bankName: string | null
  bankBik: string | null
  bankAccount: string | null
  corrAccount: string | null
  phone: string | null
  email: string | null
  isIp: boolean
}

export type ParsedLine = {
  lineNo: number
  name: string
  supplierCode: string | null
  gtin: string | null
  okei: string | null
  uomName: string | null
  qty: number
  price: number | null
  amountNet: number | null
  vatRate: string | null
  vatAmount: number | null
  amountTotal: number | null
  markingCodes: string[]
  packageCodes: string[]
  country: string | null
  customsDeclaration: string | null
}

export type ParseIssue = { level: "error" | "warning" | "info"; code: string; message: string; line?: number }

export type ParsedUpd = {
  kind: "fns_upd"
  docType: "upd" | "invoice_fact"
  knd: string
  formatVersion: string
  formatCode: string
  fileId: string | null
  function: string | null
  number: string | null
  date: string | null
  currencyCode: string | null
  seller: Party | null
  buyer: Party | null
  shipper: Party | null
  consignee: Party | null
  basis: Array<{ name: string; number: string | null; date: string | null }>
  shipmentDate: string | null
  operation: string | null
  lines: ParsedLine[]
  totals: { amountNet: number | null; vatAmount: number | null; amountTotal: number | null }
  signers: Array<{ name: string; title: string | null; inn: string | null }>
  searchText: string
  issues: ParseIssue[]
}

function n(v: string | undefined | null): number | null {
  if (v == null || v === "") return null
  const x = Number(String(v).replace(",", "."))
  return Number.isFinite(x) ? x : null
}

export function ruDateToIso(v: string | undefined | null): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((v ?? "").trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

function addressOf(node: XmlNode | null): string | null {
  if (!node) return null
  const text = find(node, "АдрИнф")?.attrs["АдрТекст"] || node.attrs["АдрТекст"]
  if (text) return text
  const parts: string[] = []
  const skip = /^(Код|ИдНом|Вид|Тип)/
  const walk = (x: XmlNode) => {
    for (const [k, v] of Object.entries(x.attrs)) if (!skip.test(k) && v.trim()) parts.push(v.trim())
    for (const c of x.children) walk(c)
  }
  walk(node)
  return parts.length ? parts.join(", ") : null
}

function partyOf(node: XmlNode | null): Party | null {
  if (!node) return null
  const idSv = child(node, "ИдСв")
  const ul = find(idSv, "СвЮЛУч")
  const ip = find(idSv, "СвИП")
  const fl = find(idSv, "СвФЛУч")
  const fio = find(ip ?? fl, "ФИО")
  const fioText = fio ? [fio.attrs["Фамилия"], fio.attrs["Имя"], fio.attrs["Отчество"]].filter(Boolean).join(" ") : ""
  const bank = child(node, "БанкРекв")
  const svBank = child(bank, "СвБанк")
  const contact = child(node, "Контакт")
  const name =
    ul?.attrs["НаимОрг"] ||
    (ip ? `ИП ${fioText}`.trim() : "") ||
    fioText ||
    find(idSv, "НеУч")?.attrs["НаимОрг"] ||
    ""
  return {
    name,
    inn: ul?.attrs["ИННЮЛ"] || ip?.attrs["ИННФЛ"] || fl?.attrs["ИННФЛ"] || null,
    kpp: ul?.attrs["КПП"] || null,
    address: addressOf(child(node, "Адрес")),
    bankName: svBank?.attrs["НаимБанк"] || null,
    bankBik: svBank?.attrs["БИК"] || null,
    bankAccount: bank?.attrs["НомерСчета"] || null,
    corrAccount: svBank?.attrs["КорСчет"] || null,
    phone: contact?.attrs["Тлф"] || textOf(child(contact, "Тлф")) || null,
    email: contact?.attrs["ЭлПочта"] || textOf(child(contact, "ЭлПочта")) || null,
    isIp: Boolean(ip),
  }
}

/** GTIN из кода маркировки DataMatrix: «01» + 14 цифр. */
export function gtinFromMarking(code: string): string | null {
  const m = /^\(?01\)?(\d{14})/.exec(code.replace(/^\u001d/, ""))
  return m ? m[1] : null
}

function lineOf(node: XmlNode, issues: ParseIssue[]): ParsedLine {
  const a = node.attrs
  const lineNo = Number(a["НомСтр"]) || 0
  const dop = child(node, "ДопСведТов")
  const sumNal = child(node, "СумНал")
  const vatAmount = n(textOf(child(sumNal, "СумНал")))
  const noVat = child(sumNal, "БезНДС")
  const ident = findAll(node, "НомСредИдентТов")
  const markingCodes = ident.flatMap((x) => childrenNamed(x, "КИЗ").map(textOf)).filter(Boolean)
  const packageCodes = ident.flatMap((x) => [...childrenNamed(x, "НомУпак").map(textOf), x.attrs["ИдентТрансУпак"] || ""]).filter(Boolean)
  const extraInfo = findAll(node, "ИнфПолФХЖ2").map((x) => ({ id: x.attrs["Идентиф"] || "", value: x.attrs["Значен"] || "" }))
  const gtinAttr = Object.entries({ ...a, ...(dop?.attrs ?? {}) }).find(([k]) => /^(ГТИН|GTIN)$/i.test(k))?.[1]
  const gtinInfo = extraInfo.find((x) => /gtin|гтин|штрих/i.test(x.id))?.value
  const gtin = (gtinAttr || gtinInfo || markingCodes.map(gtinFromMarking).find(Boolean) || "").replace(/\D/g, "") || null
  const supplierCode =
    dop?.attrs["КодТов"] || dop?.attrs["АртикулТов"] || a["КодТов"] || extraInfo.find((x) => /^(код|артикул)/i.test(x.id))?.value || null
  const svTD = child(node, "СвТД")
  const line: ParsedLine = {
    lineNo,
    name: a["НаимТов"] || "",
    supplierCode,
    gtin: gtin && /^\d{8,14}$/.test(gtin) ? gtin.padStart(14, "0") : null,
    okei: a["ОКЕИ_Тов"] || null,
    uomName: a["НаимЕдИзм"] || dop?.attrs["НаимЕдИзм"] || null,
    qty: n(a["КолТов"]) ?? 0,
    price: n(a["ЦенаТов"]),
    amountNet: n(a["СтТовБезНДС"]),
    vatRate: a["НалСт"] || (noVat ? "без НДС" : null),
    vatAmount: noVat ? 0 : vatAmount,
    amountTotal: n(a["СтТовУчНал"]),
    markingCodes,
    packageCodes,
    country: dop?.attrs["КрНаимСтрПр"] || svTD?.attrs["КодПроисх"] || null,
    customsDeclaration: svTD?.attrs["НомерТД"] || null,
  }
  if (!line.name) issues.push({ level: "error", code: "line_no_name", line: lineNo, message: `Строка ${lineNo}: нет наименования` })
  if (line.price != null && line.amountNet != null && line.qty > 0 && Math.abs(round2(line.qty * line.price) - line.amountNet) > 0.02 + line.qty * 0.005) {
    issues.push({ level: "warning", code: "line_math", line: lineNo, message: `Строка ${lineNo}: количество × цена ≠ стоимость без НДС` })
  }
  if (line.amountNet != null && line.amountTotal != null && Math.abs(round2(line.amountNet + (line.vatAmount ?? 0)) - line.amountTotal) > 0.02) {
    issues.push({ level: "warning", code: "line_vat_math", line: lineNo, message: `Строка ${lineNo}: стоимость без НДС + НДС ≠ стоимость с НДС` })
  }
  return line
}

export function isFnsInvoiceXml(root: XmlNode): boolean {
  const doc = child(root, "Документ")
  return root.name === "Файл" && Boolean(doc) && ["1115131", "1115133"].includes(doc!.attrs["КНД"] || "")
}

export function parseUpd(root: XmlNode): ParsedUpd {
  const issues: ParseIssue[] = []
  const doc = child(root, "Документ")
  if (root.name !== "Файл" || !doc) throw new Error("Это не файл обмена ФНС (ожидался корневой элемент Файл/Документ)")
  const knd = doc.attrs["КНД"] || ""
  const version = (root.attrs["ВерсФорм"] || "").trim()
  if (knd === "1115133") {
    issues.push({ level: "error", code: "ukd_unsupported", message: "Корректировочный документ (УКД, КНД 1115133) пока не разбирается: файл сохранится как оригинал без извлечения строк" })
  } else if (knd !== "1115131") {
    issues.push({ level: "error", code: "knd_unknown", message: `Неизвестный КНД ${knd}` })
  }
  if (version !== "5.03" && version !== "5.01") {
    issues.push({ level: "warning", code: "version_unknown", message: `Версия формата «${version || "не указана"}» не поддерживается разбором; реквизиты могут быть неполными` })
  }
  const fn = doc.attrs["Функция"] || null
  const sv = child(doc, "СвСчФакт")
  const number = sv?.attrs["НомерДок"] || sv?.attrs["НомерСчФ"] || null
  const date = ruDateToIso(sv?.attrs["ДатаДок"] || sv?.attrs["ДатаСчФ"])
  const currencyCode = sv?.attrs["КодОКВ"] || child(sv, "ДенИзм")?.attrs["КодОКВ"] || null
  const seller = partyOf(child(sv, "СвПрод"))
  const buyer = partyOf(child(sv, "СвПокуп"))
  const shipper = partyOf(child(child(sv, "ГрузОт"), "ГрузОтпр"))
  const consignee = partyOf(child(sv, "ГрузПолуч"))
  const table = child(doc, "ТаблСчФакт")
  const lines = childrenNamed(table, "СведТов").map((x) => lineOf(x, issues))
  const all = child(table, "ВсегоОпл")
  const totals = {
    amountNet: n(all?.attrs["СтТовБезНДСВсего"]),
    vatAmount: n(textOf(path(all, "СумНалВсего", "СумНал"))) ?? (path(all, "СумНалВсего", "БезНДС") ? 0 : null),
    amountTotal: n(all?.attrs["СтТовУчНалВсего"]),
  }
  const transfer = path(doc, "СвПродПер", "СвПер")
  const basis = childrenNamed(transfer, "ОснПер").map((b) => ({
    name: b.attrs["НаимОсн"] || "",
    number: b.attrs["НомОсн"] || null,
    date: ruDateToIso(b.attrs["ДатаОсн"]),
  }))
  const signers = childrenNamed(doc, "Подписант").map((p) => {
    const fio = find(p, "ФИО")
    return {
      name: fio ? [fio.attrs["Фамилия"], fio.attrs["Имя"], fio.attrs["Отчество"]].filter(Boolean).join(" ") : "",
      title: find(p, "ЮЛ")?.attrs["Должн"] || p.attrs["Должн"] || null,
      inn: find(p, "ЮЛ")?.attrs["ИННЮЛ"] || find(p, "ИП")?.attrs["ИННФЛ"] || null,
    }
  })

  if (!number) issues.push({ level: "error", code: "no_number", message: "Не найден номер документа" })
  if (!date) issues.push({ level: "error", code: "no_date", message: "Не найдена дата документа" })
  if (!seller?.inn) issues.push({ level: "error", code: "no_seller_inn", message: "Не найден ИНН продавца" })
  if (knd === "1115131" && fn !== "СЧФ" && lines.length === 0) issues.push({ level: "error", code: "no_lines", message: "Нет товарных строк" })
  if (currencyCode && currencyCode !== "643") issues.push({ level: "info", code: "currency", message: `Валюта документа: код ОКВ ${currencyCode}` })
  const sum = lines.reduce((s, l) => s + (l.amountTotal ?? 0), 0)
  if (totals.amountTotal != null && lines.length && Math.abs(round2(sum) - totals.amountTotal) > 0.05) {
    issues.push({ level: "warning", code: "total_math", message: `Сумма строк ${round2(sum)} не совпадает с итогом ${totals.amountTotal}` })
  }
  const seenNo = new Set<number>()
  for (const l of lines) {
    if (seenNo.has(l.lineNo)) issues.push({ level: "warning", code: "dup_line_no", line: l.lineNo, message: `Повтор номера строки ${l.lineNo}` })
    seenNo.add(l.lineNo)
  }

  return {
    kind: "fns_upd",
    docType: fn === "СЧФ" ? "invoice_fact" : "upd",
    knd,
    formatVersion: version,
    formatCode: version === "5.01" ? "fns_upd_5_01" : "fns_upd_5_03",
    fileId: root.attrs["ИдФайл"] || null,
    function: fn,
    number,
    date,
    currencyCode,
    seller,
    buyer,
    shipper,
    consignee,
    basis,
    shipmentDate: ruDateToIso(transfer?.attrs["ДатаПер"]),
    operation: transfer?.attrs["СодОпер"] || null,
    lines,
    totals,
    signers,
    searchText: flatText(root),
    issues,
  }
}
