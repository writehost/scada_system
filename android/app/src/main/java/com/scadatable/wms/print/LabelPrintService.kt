package com.scadatable.wms.print

import android.content.Context
import com.scadatable.wms.data.AppPrefs
import com.scadatable.wms.receiving.ReceivingStickerPayload
import kotlinx.coroutines.flow.first

enum class PrinterBackend(val prefValue: String) {
    TSC_BLUETOOTH("tsc_bluetooth"),
    SYSTEM("system");

    companion object {
        fun fromPref(value: String?): PrinterBackend =
            entries.firstOrNull { it.prefValue == value?.trim() } ?: TSC_BLUETOOTH
    }
}

object LabelPrintService {
    fun samplePayload(): ReceivingStickerPayload {
        val batch = "STK-TEST-001"
        val cell = "RECV-1"
        val qr = WmsLabelQr.buildPayload(
            baseUrl = "https://scada25.ru",
            siteCode = "DEFAULT",
            batchCode = batch,
            cellCode = cell,
            itemCode = "PREFORM-38",
            gtin = "04607017164372",
            qty = 1000.0,
        )
        return ReceivingStickerPayload(
            batchCode = batch,
            itemName = "Преформа PET 38 мм",
            scannedCode = null,
            gtin = "04607017164372",
            qty = 1000.0,
            emissionAt = System.currentTimeMillis(),
            expiresAt = System.currentTimeMillis() + 365L * 24 * 3600 * 1000,
            shelfLifeDays = 365,
            cellCode = cell,
            qrUrl = qr,
            productGroupLabel = "Материалы упаковки",
        )
    }

    suspend fun print(context: Context, prefs: AppPrefs, payload: ReceivingStickerPayload): Result<String> {
        val backend = PrinterBackend.fromPref(prefs.printerBackend.first())
        return when (backend) {
            PrinterBackend.TSC_BLUETOOTH -> printTsc(context, prefs, payload)
            PrinterBackend.SYSTEM -> {
                com.scadatable.wms.receiving.ReceivingStickerPrinter.printSystem(context, payload)
                Result.success("Отправлено в системную печать")
            }
        }
    }

    suspend fun testPrint(context: Context, prefs: AppPrefs): Result<String> =
        print(context, prefs, samplePayload())


    private suspend fun printTsc(context: Context, prefs: AppPrefs, payload: ReceivingStickerPayload): Result<String> {
        val rawTemplate = prefs.labelTemplateTspl.first().ifBlank { LabelTemplateDefaults.RECEIVING_TSPL }
        val template = migrateTemplateToWmsQr(rawTemplate)
        val tspl = LabelTemplateEngine.renderPayload(template, payload)
        val mac = prefs.printerBluetoothMac.first()
        return TscBluetoothPrinter.printTspl(context, mac, tspl).map { "Напечатано на TSC ($mac)" }
    }

    /** Старые шаблоны с GS1 DataMatrix → QR WMS с ячейкой/партией. */
    private fun migrateTemplateToWmsQr(template: String): String {
        if (template.contains("QRCODE", ignoreCase = true) &&
            !template.contains("DMATRIX", ignoreCase = true)
        ) {
            return template
        }
        var out = template
        out = out.replace(
            Regex("""DMATRIX[^\n]*""", RegexOption.IGNORE_CASE),
            """QRCODE 300,10,L,5,A,0,M2,S7,"{{qrUrl}}"""",
        )
        if (!out.contains("CODEPAGE", ignoreCase = true)) {
            out = out.replaceFirst(Regex("(?i)CLS"), "CODEPAGE 1251\nCLS")
        }
        return out
    }
}
