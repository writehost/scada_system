/**
 * Тестовый файл УПД (СЧФДОП) в структуре формата 5.03, кодировка windows-1251, как у реальных файлов ФНС.
 * Синтетический: реквизиты вымышленные, ИНН с корректной контрольной суммой.
 */

export function encodeCp1251(text: string): Uint8Array {
  const dec = new TextDecoder("windows-1251")
  const map = new Map<string, number>()
  for (let b = 0; b < 256; b++) map.set(dec.decode(new Uint8Array([b])), b)
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = map.get(text[i])
    if (code == null) throw new Error(`symbol not in cp1251: ${text[i]}`)
    out[i] = code
  }
  return out
}

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")

export type UpdLine = { name: string; code: string; gtin?: string; okei: string; uom: string; qty: number; price: number; vat: "20%" | "10%" | "без НДС"; kiz?: string[] }

export function buildUpd(opts: {
  version?: "5.03" | "5.01"
  number: string
  date: string // ДД.ММ.ГГГГ
  seller: { name: string; inn: string; kpp: string }
  buyer: { name: string; inn: string; kpp: string }
  lines: UpdLine[]
  basis?: { name: string; number: string; date: string }
}): string {
  const v = opts.version ?? "5.03"
  const numAttr = v === "5.03" ? `НомерДок="${opts.number}" ДатаДок="${opts.date}"` : `НомерСчФ="${opts.number}" ДатаСчФ="${opts.date}" КодОКВ="643"`
  let totalNet = 0
  let totalVat = 0
  const rows = opts.lines
    .map((l, i) => {
      const net = Math.round(l.qty * l.price * 100) / 100
      const vat = l.vat === "без НДС" ? 0 : Math.round(net * (l.vat === "20%" ? 0.2 : 0.1) * 100) / 100
      totalNet += net
      totalVat += vat
      const sumNal = l.vat === "без НДС" ? `<СумНал><БезНДС>без НДС</БезНДС></СумНал>` : `<СумНал><СумНал>${vat.toFixed(2)}</СумНал></СумНал>`
      const kiz = l.kiz?.length ? `<НомСредИдентТов>${l.kiz.map((k) => `<КИЗ>${k}</КИЗ>`).join("")}</НомСредИдентТов>` : ""
      const extra = l.gtin ? `<ИнфПолФХЖ2 Идентиф="ГТИН" Значен="${l.gtin}"/>` : ""
      return `<СведТов НомСтр="${i + 1}" НаимТов="${esc(l.name)}" ОКЕИ_Тов="${l.okei}" НаимЕдИзм="${l.uom}" КолТов="${l.qty}" ЦенаТов="${l.price.toFixed(2)}" СтТовБезНДС="${net.toFixed(2)}" НалСт="${l.vat}" СтТовУчНал="${(net + vat).toFixed(2)}">
        <Акциз><БезАкциз>без акциза</БезАкциз></Акциз>${sumNal}
        <ДопСведТов ПрТовРаб="1" КодТов="${l.code}">${kiz}</ДопСведТов>${extra}
      </СведТов>`
    })
    .join("\n      ")
  const basis = opts.basis ? `<ОснПер НаимОсн="${esc(opts.basis.name)}" НомОсн="${opts.basis.number}" ДатаОсн="${opts.basis.date}"/>` : `<ОснПер НаимОсн="Без документа-основания"/>`
  const ul = (p: { name: string; inn: string; kpp: string }) =>
    `<ИдСв><СвЮЛУч НаимОрг="${esc(p.name)}" ИННЮЛ="${p.inn}" КПП="${p.kpp}"/></ИдСв><Адрес><АдрИнф КодСтр="643" НаимСтран="Россия" АдрТекст="г. Москва, ул. Тестовая, д. 1"/></Адрес>`
  return `<?xml version="1.0" encoding="windows-1251"?>
<Файл ИдФайл="ON_NSCHFDOPPR_2BM-${opts.buyer.inn}-${opts.buyer.kpp}_2BM-${opts.seller.inn}-${opts.seller.kpp}_20260901_test" ВерсФорм="${v}" ВерсПрог="Test 1.0">
  <Документ КНД="1115131" Функция="СЧФДОП" ПоФактХЖ="Документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)" НаимДокОпр="Счет-фактура и документ об отгрузке товаров (выполнении работ), передаче имущественных прав (документ об оказании услуг)" ДатаИнфПр="${opts.date}" ВремИнфПр="10.00.00" НаимЭконСубСост="${esc(opts.seller.name)}">
    <СвСчФакт ${numAttr}>
      <СвПрод>${ul(opts.seller)}<БанкРекв НомерСчета="40702810900000000001"><СвБанк НаимБанк="ПАО ТЕСТБАНК" БИК="044525000" КорСчет="30101810400000000225"/></БанкРекв></СвПрод>
      <ГрузОт><ОнЖе>он же</ОнЖе></ГрузОт>
      <ГрузПолуч>${ul(opts.buyer)}</ГрузПолуч>
      <СвПокуп>${ul(opts.buyer)}</СвПокуп>
      ${v === "5.03" ? `<ДенИзм КодОКВ="643" НаимОКВ="Российский рубль"/>` : ""}
    </СвСчФакт>
    <ТаблСчФакт>
      ${rows}
      <ВсегоОпл СтТовБезНДСВсего="${totalNet.toFixed(2)}" СтТовУчНалВсего="${(totalNet + totalVat).toFixed(2)}"><СумНалВсего><СумНал>${totalVat.toFixed(2)}</СумНал></СумНалВсего></ВсегоОпл>
    </ТаблСчФакт>
    <СвПродПер>
      <СвПер СодОпер="Товары переданы" ДатаПер="${opts.date}">${basis}</СвПер>
    </СвПродПер>
    <Подписант СпосПодтПолном="1"><ФЛ><ФИО Фамилия="Иванов" Имя="Иван" Отчество="Иванович"/></ФЛ></Подписант>
  </Документ>
</Файл>
`
}
