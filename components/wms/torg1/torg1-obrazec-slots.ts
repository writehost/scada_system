import type { Torg1Fields } from "@/lib/wms/torg1"

export type Torg1ObrazecSlot =
  | {
      kind: "field"
      row: number
      col: number
      key: keyof Torg1Fields
      align?: "left" | "center" | "right"
    }
  | {
      kind: "datePart"
      row: number
      col: number
      key: keyof Torg1Fields
      part: "day" | "month" | "year" | "monthWord" | "yearShort"
      align?: "left" | "center" | "right"
    }
  | { kind: "orgLine"; row: number; col: number }

/** Координаты переменных в сетке образца (0-based row/col). */
export const TORG1_OBRAZEC_FIELD_SLOTS: Torg1ObrazecSlot[] = [
  { kind: "orgLine", row: 6, col: 0 },
  { kind: "field", row: 5, col: 86, key: "okud", align: "center" },
  { kind: "field", row: 6, col: 86, key: "okpo", align: "center" },
  { kind: "field", row: 8, col: 0, key: "structuralUnit" },
  { kind: "field", row: 9, col: 86, key: "okdp", align: "center" },
  { kind: "field", row: 10, col: 86, key: "cameraNo", align: "center" },
  { kind: "field", row: 11, col: 86, key: "sectionNo", align: "center" },
  { kind: "field", row: 12, col: 32, key: "basisDoc" },
  { kind: "field", row: 12, col: 86, key: "basisNo", align: "center" },
  { kind: "datePart", row: 13, col: 86, key: "basisDate", part: "day", align: "center" },
  { kind: "datePart", row: 13, col: 93, key: "basisDate", part: "month", align: "center" },
  { kind: "datePart", row: 13, col: 100, key: "basisDate", part: "year", align: "center" },
  { kind: "field", row: 14, col: 86, key: "operationKind", align: "center" },
  { kind: "field", row: 17, col: 78, key: "approveTitle" },
  { kind: "field", row: 18, col: 50, key: "documentNo", align: "center" },
  { kind: "field", row: 18, col: 62, key: "composedAt", align: "center" },
  { kind: "field", row: 19, col: 75, key: "approveSign", align: "center" },
  { kind: "field", row: 19, col: 88, key: "approveName" },
  { kind: "datePart", row: 21, col: 81, key: "approveDate", part: "day", align: "center" },
  { kind: "datePart", row: 21, col: 86, key: "approveDate", part: "monthWord", align: "center" },
  { kind: "datePart", row: 21, col: 96, key: "approveDate", part: "yearShort", align: "center" },
  { kind: "field", row: 23, col: 25, key: "place" },
  { kind: "datePart", row: 24, col: 63, key: "commissionDate", part: "day", align: "center" },
  { kind: "datePart", row: 24, col: 70, key: "commissionDate", part: "monthWord", align: "center" },
  { kind: "datePart", row: 24, col: 96, key: "commissionDate", part: "year", align: "center" },
  { kind: "field", row: 25, col: 37, key: "accompanyingDocs" },
  { kind: "field", row: 30, col: 0, key: "representativeCall" },
  { kind: "field", row: 30, col: 54, key: "callDocNo", align: "center" },
  { kind: "datePart", row: 30, col: 77, key: "callDocDate", part: "day", align: "center" },
  { kind: "field", row: 33, col: 20, key: "shipper" },
  { kind: "field", row: 35, col: 17, key: "manufacturer" },
  { kind: "field", row: 37, col: 13, key: "supplier" },
  { kind: "field", row: 40, col: 20, key: "insurer" },
  { kind: "field", row: 42, col: 45, key: "contractNo", align: "center" },
  { kind: "datePart", row: 42, col: 65, key: "contractDate", part: "day", align: "center" },
  { kind: "datePart", row: 42, col: 72, key: "contractDate", part: "monthWord", align: "center" },
  { kind: "datePart", row: 42, col: 84, key: "contractDate", part: "year", align: "center" },
  { kind: "field", row: 43, col: 20, key: "invoiceNo", align: "center" },
  { kind: "datePart", row: 43, col: 40, key: "invoiceDate", part: "day", align: "center" },
  { kind: "datePart", row: 43, col: 47, key: "invoiceDate", part: "monthWord", align: "center" },
  { kind: "datePart", row: 43, col: 59, key: "invoiceDate", part: "year", align: "center" },
  { kind: "field", row: 44, col: 20, key: "commercialAct", align: "center" },
  { kind: "datePart", row: 44, col: 44, key: "commercialActDate", part: "day", align: "center" },
  { kind: "field", row: 45, col: 47, key: "vetCert", align: "center" },
  { kind: "datePart", row: 45, col: 71, key: "vetCertDate", part: "day", align: "center" },
  { kind: "field", row: 46, col: 30, key: "railWaybill", align: "center" },
  { kind: "datePart", row: 46, col: 54, key: "railWaybillDate", part: "day", align: "center" },
  { kind: "field", row: 48, col: 19, key: "deliveryMethod" },
  { kind: "field", row: 48, col: 93, key: "vehicleNo", align: "center" },
  { kind: "datePart", row: 51, col: 29, key: "shipDate", part: "day", align: "center" },
  { kind: "datePart", row: 51, col: 36, key: "shipDate", part: "monthWord", align: "center" },
  { kind: "datePart", row: 51, col: 48, key: "shipDate", part: "year", align: "center" },
  { kind: "field", row: 52, col: 0, key: "fromStation" },
  { kind: "field", row: 54, col: 36, key: "fromStationOrWarehouse" },
  { kind: "field", row: 56, col: 57, key: "meatTemp", align: "center" },
  { kind: "field", row: 61, col: 0, key: "arrivedAt", align: "center" },
  { kind: "field", row: 61, col: 21, key: "acceptStart", align: "center" },
  { kind: "field", row: 61, col: 42, key: "acceptPause", align: "center" },
  { kind: "field", row: 61, col: 64, key: "acceptResume", align: "center" },
  { kind: "field", row: 61, col: 86, key: "acceptEnd", align: "center" },
  { kind: "field", row: 62, col: 0, key: "arrivedTime", align: "center" },
  { kind: "field", row: 62, col: 21, key: "acceptStartTime", align: "center" },
  { kind: "field", row: 62, col: 42, key: "acceptPauseTime", align: "center" },
  { kind: "field", row: 62, col: 64, key: "acceptResumeTime", align: "center" },
  { kind: "field", row: 62, col: 86, key: "acceptEndTime", align: "center" },
]

export function obrazecSlotAt(row: number, col: number): Torg1ObrazecSlot | undefined {
  return TORG1_OBRAZEC_FIELD_SLOTS.find((s) => s.row === row && s.col === col)
}
