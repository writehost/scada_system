"use client"

import type { CSSProperties } from "react"

/** Данные для печати унифицированной формы № КО-1 (приходный кассовый ордер). */
export type Ko1PrintData = {
  organizationName: string
  structuralUnit: string
  okpoCode?: string
  okudCode?: string
  documentNo: string
  documentDateDisplay: string
  debitAccount: string
  creditStructuralCode: string
  creditAccount: string
  creditAnalyticCode: string
  /** Сумма цифрами, например «12 345» или «12 345,67» */
  amountDigitsRub: string
  amountDigitsKop: string
  amountWords: string
  purposeCode: string
  receivedFrom: string
  basis: string
  includingLine: string
  attachment: string
}

const cell: CSSProperties = {
  border: "0.5pt solid #000",
  padding: "2px 4px",
  verticalAlign: "top",
  fontSize: "9pt",
  lineHeight: 1.2,
}

const th: CSSProperties = {
  ...cell,
  textAlign: "center",
  fontWeight: 700,
  fontSize: "8pt",
}

export function Ko1PrintSheet({ data, id }: { data: Ko1PrintData; id?: string }) {
  const okud = data.okudCode?.trim() || "0310001"
  const okpo = data.okpoCode?.trim() || "______"

  return (
    <div
      id={id}
      className="ko1-print-sheet bg-white text-black"
      style={{
        fontFamily: '"Times New Roman", Times, serif',
        fontSize: "9pt",
        lineHeight: 1.15,
        width: "100%",
        maxWidth: "297mm",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      <div className="flex flex-row" style={{ gap: 0 }}>
        {/* Левая часть — ордер */}
        <div style={{ flex: "1 1 62%", minWidth: 0, paddingRight: "6px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
            <div style={{ fontSize: "7.5pt", maxWidth: "68%" }}>
              Унифицированная форма № КО-1
              <br />
              Утверждена постановлением Госкомстата России от 18.08.98 № 88
            </div>
            <table style={{ borderCollapse: "collapse", fontSize: "8pt" }}>
              <tbody>
                <tr>
                  <td style={{ ...cell, borderBottom: "none" }}>Форма по ОКУД</td>
                  <td style={{ ...cell, borderBottom: "none", textAlign: "center", minWidth: "52px" }}>{okud}</td>
                </tr>
                <tr>
                  <td style={cell}>по ОКПО</td>
                  <td style={{ ...cell, textAlign: "center" }}>{okpo}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "6px", borderBottom: "1px solid #000", minHeight: "14px", fontSize: "9pt" }}>
            {data.organizationName || "(организация)"}
          </div>
          <div style={{ fontSize: "7pt", marginTop: "1px" }}>(организация)</div>

          <div style={{ marginTop: "4px", borderBottom: "1px solid #000", minHeight: "14px", fontSize: "9pt" }}>
            {data.structuralUnit || "(структурное подразделение)"}
          </div>
          <div style={{ fontSize: "7pt", marginTop: "1px" }}>(структурное подразделение)</div>

          <div
            style={{
              marginTop: "10px",
              textAlign: "center",
              fontWeight: 700,
              fontSize: "11pt",
              letterSpacing: "0.02em",
            }}
          >
            ПРИХОДНЫЙ КАССОВЫЙ ОРДЕР
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "8px", fontSize: "9pt" }}>
            <tbody>
              <tr>
                <td style={{ ...cell, width: "50%" }}>
                  <div style={{ fontSize: "7pt", marginBottom: "2px" }}>Номер документа</div>
                  <div style={{ minHeight: "16px", fontWeight: 600 }}>{data.documentNo}</div>
                </td>
                <td style={{ ...cell, width: "50%" }}>
                  <div style={{ fontSize: "7pt", marginBottom: "2px" }}>Дата составления</div>
                  <div style={{ minHeight: "16px", fontWeight: 600 }}>{data.documentDateDisplay}</div>
                </td>
              </tr>
            </tbody>
          </table>

          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0", fontSize: "8pt" }}>
            <thead>
              <tr>
                <th style={{ ...th, width: "14%" }} rowSpan={2}>
                  Дебет
                </th>
                <th style={{ ...th }} colSpan={3}>
                  Кредит
                </th>
                <th style={{ ...th, width: "16%" }} rowSpan={2}>
                  Сумма,
                  <br />
                  руб. коп.
                </th>
                <th style={{ ...th, width: "14%" }} rowSpan={2}>
                  Код целевого назначения
                </th>
              </tr>
              <tr>
                <th style={{ ...th, fontSize: "7pt" }}>код структурного подразделения</th>
                <th style={{ ...th, fontSize: "7pt" }}>корреспондирующий счёт, субсчёт</th>
                <th style={{ ...th, fontSize: "7pt" }}>код аналитического учёта</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...cell, minHeight: "36px", fontFamily: "monospace" }}>{data.debitAccount}</td>
                <td style={{ ...cell, fontFamily: "monospace", fontSize: "8pt" }}>{data.creditStructuralCode}</td>
                <td style={{ ...cell, fontFamily: "monospace", fontSize: "8pt" }}>{data.creditAccount}</td>
                <td style={{ ...cell, fontFamily: "monospace", fontSize: "8pt" }}>{data.creditAnalyticCode}</td>
                <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap", fontFamily: "monospace" }}>
                  {data.amountDigitsRub}
                  <span style={{ marginLeft: "4px" }} />
                  {data.amountDigitsKop}
                </td>
                <td style={{ ...cell, textAlign: "center", fontFamily: "monospace" }}>{data.purposeCode}</td>
              </tr>
            </tbody>
          </table>

          <div style={{ marginTop: "8px", fontSize: "9pt" }}>
            <span style={{ fontWeight: 600 }}>Принято от </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "72%", paddingLeft: "4px" }}>
              {data.receivedFrom}
            </span>
          </div>

          <div style={{ marginTop: "6px", fontSize: "9pt" }}>
            <span style={{ fontWeight: 600 }}>Основание </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "78%", paddingLeft: "4px", minHeight: "14px" }}>
              {data.basis}
            </span>
          </div>

          <div style={{ marginTop: "10px", fontSize: "9pt" }}>
            <span style={{ fontWeight: 600 }}>Сумма </span>
            <span style={{ borderBottom: "1px solid #000", display: "block", marginTop: "4px", minHeight: "28px", padding: "2px 4px" }}>
              {data.amountWords}
            </span>
            <div style={{ fontSize: "7pt", marginTop: "2px" }}>прописью</div>
          </div>

          <div style={{ marginTop: "8px", fontSize: "9pt" }}>
            <span style={{ fontWeight: 600 }}>В том числе </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "72%", paddingLeft: "4px", minHeight: "14px" }}>
              {data.includingLine}
            </span>
          </div>

          <div style={{ marginTop: "8px", fontSize: "9pt" }}>
            <span style={{ fontWeight: 600 }}>Приложение </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "74%", paddingLeft: "4px", minHeight: "14px" }}>
              {data.attachment}
            </span>
          </div>

          <div style={{ marginTop: "22px", display: "flex", justifyContent: "space-between", gap: "16px", fontSize: "9pt" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: "18px" }}>Главный бухгалтер</div>
              <div style={{ borderBottom: "1px solid #000", height: "14px", marginBottom: "4px" }} />
              <div style={{ fontSize: "7pt" }}>подпись</div>
              <div style={{ borderBottom: "1px solid #000", height: "14px", marginTop: "12px", marginBottom: "4px" }} />
              <div style={{ fontSize: "7pt" }}>расшифровка подписи</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, marginBottom: "18px" }}>Получил кассир</div>
              <div style={{ borderBottom: "1px solid #000", height: "14px", marginBottom: "4px" }} />
              <div style={{ fontSize: "7pt" }}>подпись</div>
              <div style={{ borderBottom: "1px solid #000", height: "14px", marginTop: "12px", marginBottom: "4px" }} />
              <div style={{ fontSize: "7pt" }}>расшифровка подписи</div>
            </div>
          </div>
        </div>

        {/* Линия отреза + квитанция */}
        <div
          style={{
            flex: "0 0 38%",
            minWidth: 0,
            borderLeft: "1px dashed #333",
            paddingLeft: "8px",
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: "-7px",
              top: "45%",
              transform: "rotate(-90deg)",
              transformOrigin: "center",
              fontSize: "7pt",
              color: "#444",
              whiteSpace: "nowrap",
            }}
          >
            линия отреза
          </div>

          <div style={{ borderBottom: "1px solid #000", minHeight: "14px", fontSize: "9pt", marginBottom: "4px" }}>
            {data.organizationName || "(организация)"}
          </div>
          <div style={{ fontSize: "7pt", marginBottom: "8px" }}>(организация)</div>

          <div style={{ textAlign: "center", fontWeight: 700, fontSize: "11pt", marginBottom: "8px" }}>КВИТАНЦИЯ</div>
          <div style={{ fontSize: "8pt", textAlign: "center", marginBottom: "10px", lineHeight: 1.35 }}>
            к приходному кассовому ордеру № <span style={{ fontWeight: 600 }}>{data.documentNo}</span> от «___» _______
            20__ г.
            <div style={{ fontSize: "7pt", marginTop: "4px", color: "#333" }}>(дата: {data.documentDateDisplay})</div>
          </div>

          <div style={{ fontSize: "9pt", marginBottom: "6px" }}>
            <span style={{ fontWeight: 600 }}>Принято от </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "65%", paddingLeft: "4px" }}>
              {data.receivedFrom}
            </span>
          </div>

          <div style={{ fontSize: "9pt", marginBottom: "6px" }}>
            <span style={{ fontWeight: 600 }}>Основание </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "72%", paddingLeft: "4px", minHeight: "28px" }}>
              {data.basis}
            </span>
          </div>

          <div style={{ fontSize: "9pt", marginBottom: "6px" }}>
            <span style={{ fontWeight: 600 }}>Сумма </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "36px", textAlign: "right", marginRight: "4px" }}>
              {data.amountDigitsRub}
            </span>
            руб.
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "22px", textAlign: "center", marginLeft: "6px" }}>
              {data.amountDigitsKop}
            </span>
            коп.
          </div>

          <div style={{ borderBottom: "1px solid #000", minHeight: "36px", padding: "2px 4px", fontSize: "8pt", marginBottom: "10px" }}>
            {data.amountWords}
          </div>

          <div style={{ fontSize: "9pt", marginBottom: "12px" }}>
            <span style={{ fontWeight: 600 }}>В том числе </span>
            <span style={{ borderBottom: "1px solid #000", display: "inline-block", minWidth: "62%", paddingLeft: "4px", minHeight: "14px" }}>
              {data.includingLine}
            </span>
          </div>

          <div style={{ fontSize: "9pt", marginBottom: "18px" }}>
            «___» ______________ 20__ г.
            <span style={{ fontSize: "7pt", display: "block", marginTop: "4px", color: "#333" }}>(дата документа: {data.documentDateDisplay})</span>
          </div>

          <div style={{ border: "1px dashed #888", borderRadius: "50%", width: "72px", height: "72px", margin: "12px auto", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8pt", textAlign: "center" }}>
            М.П.
            <br />
            (штамп)
          </div>

          <div style={{ marginTop: "16px", fontSize: "9pt" }}>
            <div style={{ fontWeight: 600, marginBottom: "12px" }}>Главный бухгалтер</div>
            <div style={{ borderBottom: "1px solid #000", height: "14px", marginBottom: "4px" }} />
            <div style={{ fontSize: "7pt", marginBottom: "12px" }}>подпись</div>
            <div style={{ fontWeight: 600, marginBottom: "12px" }}>Кассир</div>
            <div style={{ borderBottom: "1px solid #000", height: "14px", marginBottom: "4px" }} />
            <div style={{ fontSize: "7pt" }}>подпись</div>
          </div>
        </div>
      </div>
    </div>
  )
}
