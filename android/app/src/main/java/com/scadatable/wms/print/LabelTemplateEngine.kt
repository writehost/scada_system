package com.scadatable.wms.print

import com.scadatable.wms.receiving.ReceivingStickerPayload
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Переменные для шаблона TSPL (TSC Console / Label Editor → Export TSPL). */
object LabelTemplateVars {
    const val ITEM_NAME = "itemName"
    const val NOMENCLATURE = "nomenclature"
    const val SCANNED_CODE = "scannedCode"
    const val DATAMATRIX = "datamatrix"
    const val GS1_DATAMATRIX = "gs1Datamatrix"
    const val GTIN = "gtin"
    const val QTY = "qty"
    const val BATCH_CODE = "batchCode"
    const val EMISSION_DATE = "emissionDate"
    const val EXPIRY_DATE = "expiryDate"
    const val SHELF_LIFE_DAYS = "shelfLifeDays"
    const val CELL_CODE = "cellCode"
    const val QR_URL = "qrUrl"
    const val PRODUCT_GROUP_LABEL = "productGroupLabel"
    const val SUPPLIER_NAME = "supplierName"
    const val RECEIPT_DOC_DATE = "receiptDocDate"

    val ALL = listOf(
        ITEM_NAME, NOMENCLATURE, SCANNED_CODE, DATAMATRIX, GS1_DATAMATRIX, GTIN, QTY,
        BATCH_CODE, EMISSION_DATE, EXPIRY_DATE, SHELF_LIFE_DAYS, CELL_CODE, QR_URL,
        PRODUCT_GROUP_LABEL, SUPPLIER_NAME, RECEIPT_DOC_DATE,
    )

    fun fromPayload(payload: ReceivingStickerPayload): Map<String, String> {
        val qtyText = if (payload.qty % 1.0 == 0.0) payload.qty.toLong().toString() else payload.qty.toString()
        val rawScanned = payload.scannedCode?.trim().orEmpty().ifBlank { payload.gtin.orEmpty() }
        val compactScanned = com.scadatable.wms.data.CrptCode.normalize(rawScanned)
        return mapOf(
            ITEM_NAME to payload.itemName.trim(),
            NOMENCLATURE to payload.itemName.trim(),
            SCANNED_CODE to compactScanned,
            DATAMATRIX to compactScanned,
            GS1_DATAMATRIX to Gs1DatamatrixFormatter.format(rawScanned),
            GTIN to payload.gtin?.trim().orEmpty(),
            QTY to qtyText,
            BATCH_CODE to payload.batchCode.trim(),
            EMISSION_DATE to formatDate(payload.emissionAt),
            EXPIRY_DATE to formatDate(payload.expiresAt),
            SHELF_LIFE_DAYS to (payload.shelfLifeDays?.toString() ?: "-"),
            CELL_CODE to payload.cellCode?.trim().orEmpty().ifBlank { "-" },
            QR_URL to payload.qrUrl.trim(),
            PRODUCT_GROUP_LABEL to payload.productGroupLabel?.trim().orEmpty(),
            SUPPLIER_NAME to payload.supplierName?.trim().orEmpty(),
            RECEIPT_DOC_DATE to payload.receiptDocDate?.trim().orEmpty(),
        )
    }

    private fun formatDate(ts: Long?): String {
        if (ts == null || ts <= 0L) return "-"
        return SimpleDateFormat("dd.MM.yyyy", Locale("ru")).format(Date(ts))
    }
}

object LabelTemplateDefaults {
    /** Шаблон 58×40 мм — QR WMS (ячейка/партия), не GS1 DataMatrix ЧЗ. */
    val RECEIVING_TSPL: String = """
SIZE 58 mm, 40 mm
GAP 2 mm, 0 mm
DIRECTION 1
CODEPAGE 1251
REFERENCE 0,0
CLS
TEXT 10,10,"3",0,1,1,"{{itemName}}"
TEXT 10,45,"2",0,1,1,"Yach: {{cellCode}}"
TEXT 10,75,"2",0,1,1,"Grp: {{productGroupLabel}}"
TEXT 10,105,"2",0,1,1,"Em: {{emissionDate}}  Goden: {{expiryDate}}"
TEXT 10,135,"2",0,1,1,"Kol: {{qty}}  Part: {{batchCode}}"
TEXT 10,165,"2",0,1,1,"{{batchCode}}"
QRCODE 300,10,L,5,A,0,M2,S7,"{{qrUrl}}"
PRINT 1,1
""".trimIndent()
}

object LabelTemplateEngine {
    /** Подставляет {{var}} и ${var} из карты значений. */
    fun render(template: String, values: Map<String, String>): String {
        var out = template
        for ((key, value) in values) {
            val safe = escapeTsplText(value)
            out = out.replace("{{$key}}", safe)
            out = out.replace("\${" + key + "}", safe)
        }
        return out
    }

    fun renderPayload(template: String, payload: ReceivingStickerPayload): String =
        render(template, LabelTemplateVars.fromPayload(payload))

    /** Убираем кавычки внутри TEXT — ломают TSPL. */
    private fun escapeTsplText(value: String): String =
        value.replace("\"", "'").replace("\r", " ").replace("\n", " ")
}
