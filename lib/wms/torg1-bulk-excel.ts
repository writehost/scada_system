import { fetchTorg1ExcelTemplateBytes } from "@/lib/wms-api"
import type { WmsDocumentRow } from "@/lib/wms-api"
import {
  fillTorg1ExcelToBytes,
  buildTorg1PlaceholderTemplate,
  workbookToArrayBuffer,
} from "@/lib/wms/torg1-excel"
import {
  isReceivingDoc,
  loadTorg1FieldsForReceivingDoc,
  torg1ExcelFileName,
} from "@/lib/wms/torg1-receiving-doc"

export type Torg1ExcelTemplateChoice = "custom" | "starter"

export const TORG1_EXCEL_TEMPLATE_STORAGE_KEY = "wms_torg1_excel_template"

export function getStoredTorg1TemplateChoice(): Torg1ExcelTemplateChoice {
  if (typeof window === "undefined") return "custom"
  const v = localStorage.getItem(TORG1_EXCEL_TEMPLATE_STORAGE_KEY)
  return v === "starter" ? "starter" : "custom"
}

export function setStoredTorg1TemplateChoice(choice: Torg1ExcelTemplateChoice) {
  if (typeof window === "undefined") return
  localStorage.setItem(TORG1_EXCEL_TEMPLATE_STORAGE_KEY, choice)
}

export async function resolveTorg1TemplateBytes(
  choice: Torg1ExcelTemplateChoice
): Promise<ArrayBuffer | null> {
  if (choice === "starter") return null
  return fetchTorg1ExcelTemplateBytes({ documentType: "receiving" })
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export type Torg1BulkExportProgress = {
  done: number
  total: number
  label: string
}

/** Массовая выгрузка Excel по шаблону с {{переменными}} — один ZIP. */
export async function bulkExportReceivingTorg1Excel(input: {
  docs: WmsDocumentRow[]
  template: Torg1ExcelTemplateChoice
  zipName?: string
  onProgress?: (p: Torg1BulkExportProgress) => void
}): Promise<{ count: number; zipName: string }> {
  const receiving = input.docs.filter(isReceivingDoc)
  if (!receiving.length) {
    throw new Error("Нет документов приёмки для выгрузки")
  }

  const templateBytes = await resolveTorg1TemplateBytes(input.template)
  if (input.template === "custom" && !templateBytes) {
    throw new Error(
      "Свой шаблон не загружен. Загрузите .xlsx в Настройки → Шаблон ТОРГ-1 или выберите «Стартовый с {{переменными}}»."
    )
  }

  // Прогреваем стартовый шаблон один раз (если нужен).
  if (input.template === "starter") {
    workbookToArrayBuffer(buildTorg1PlaceholderTemplate())
  }

  const { zipSync } = await import("fflate")
  const zipFiles: Record<string, Uint8Array> = {}
  const usedNames = new Set<string>()

  let done = 0
  for (const doc of receiving) {
    done += 1
    input.onProgress?.({
      done,
      total: receiving.length,
      label: doc.documentNo || doc.documentId,
    })

    const fields = await loadTorg1FieldsForReceivingDoc(doc)
    const xlsxBytes = fillTorg1ExcelToBytes(templateBytes, fields)

    let name = `${torg1ExcelFileName(doc)}.xlsx`
    if (usedNames.has(name)) {
      let n = 2
      while (usedNames.has(`${torg1ExcelFileName(doc)}_${n}.xlsx`)) n += 1
      name = `${torg1ExcelFileName(doc)}_${n}.xlsx`
    }
    usedNames.add(name)
    zipFiles[name] = new Uint8Array(xlsxBytes)
  }

  const zipBytes = zipSync(zipFiles, { level: 6 })
  const blob = new Blob([Uint8Array.from(zipBytes)], { type: "application/zip" })
  const stamp = new Date().toISOString().slice(0, 10)
  const zipName = input.zipName || `TORG-1-priemka-${stamp}.zip`
  downloadBlob(blob, zipName)
  return { count: receiving.length, zipName }
}
