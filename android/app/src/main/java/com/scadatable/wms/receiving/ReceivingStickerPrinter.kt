package com.scadatable.wms.receiving

import android.content.Context
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class ReceivingStickerPayload(
    val batchCode: String,
    val itemName: String,
    val scannedCode: String? = null,
    val gtin: String?,
    val qty: Double,
    val emissionAt: Long?,
    val expiresAt: Long?,
    val shelfLifeDays: Int?,
    val cellCode: String?,
    val qrUrl: String,
    val productGroupLabel: String? = null,
    val supplierName: String? = null,
    val receiptDocDate: String? = null,
)

object ReceivingStickerPrinter {
    fun printSystem(context: Context, payload: ReceivingStickerPayload) {
        val html = buildHtml(payload)
        val webView = WebView(context)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                val printManager = context.getSystemService(Context.PRINT_SERVICE) as PrintManager
                val adapter: PrintDocumentAdapter = webView.createPrintDocumentAdapter("receiving-sticker")
                printManager.print(
                    "Приёмочный стикер ${payload.batchCode}",
                    adapter,
                    PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A6)
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build(),
                )
            }
        }
        webView.loadDataWithBaseURL(null, html, "text/HTML", "UTF-8", null)
    }

    private fun buildHtml(payload: ReceivingStickerPayload): String {
        val qrBase64 = encodeQrBase64(payload.qrUrl)
        val emission = formatDate(payload.emissionAt)
        val expires = formatDate(payload.expiresAt)
        val shelf = payload.shelfLifeDays?.let { "$it дней" } ?: "—"
        val qtyText = if (payload.qty % 1.0 == 0.0) {
            payload.qty.toLong().toString()
        } else {
            payload.qty.toString()
        }
        val cell = payload.cellCode?.trim().orEmpty().ifBlank { "—" }
        val gtin = payload.gtin?.trim().orEmpty().ifBlank { "—" }
        val productGroup = payload.productGroupLabel?.trim().orEmpty().ifBlank { "—" }
        val supplier = payload.supplierName?.trim().orEmpty()
        val receiptDate = payload.receiptDocDate?.trim().orEmpty()

        return """
            <!DOCTYPE html>
            <html><head><meta charset="utf-8"/>
            <style>
              body { font-family: Arial, sans-serif; margin: 0; padding: 10px; color: #1b1b1b; }
              h1 { font-size: 16px; margin: 0 0 8px; text-align: center; }
              .wrap { display: flex; gap: 10px; }
              .left { flex: 1; font-size: 11px; line-height: 1.35; }
              .right { width: 120px; text-align: center; }
              .row { margin-bottom: 4px; }
              .label { color: #666; }
              .value { font-weight: 700; }
              img { width: 110px; height: 110px; }
              .url { font-size: 8px; word-break: break-all; color: #555; margin-top: 4px; }
              .footer { margin-top: 12px; display: flex; justify-content: space-between; font-size: 10px; }
              .line { border-bottom: 1px solid #999; width: 120px; display: inline-block; }
            </style></head><body>
              <h1>ПАРТИЯ СТИКЕРОВ</h1>
              <div class="wrap">
                <div class="left">
                  <div class="row"><span class="label">Номенклатура:</span> <span class="value">${escape(payload.itemName)}</span></div>
                  <div class="row"><span class="label">GTIN:</span> <span class="value">$gtin</span></div>
                  <div class="row"><span class="label">Группа:</span> <span class="value">${escape(productGroup)}</span></div>
                  <div class="row"><span class="label">Партия:</span> <span class="value">${escape(payload.batchCode)}</span></div>
                  <div class="row"><span class="label">Эмиссия:</span> <span class="value">$emission</span></div>
                  <div class="row"><span class="label">Годен до:</span> <span class="value">$expires</span></div>
                  <div class="row"><span class="label">Срок:</span> <span class="value">$shelf</span></div>
                  <div class="row"><span class="label">Кол-во:</span> <span class="value">$qtyText шт.</span></div>
                  <div class="row"><span class="label">Ячейка:</span> <span class="value">$cell</span></div>
                  ${optionalRow("Контрагент", supplier)}
                  ${optionalRow("Дата документа", receiptDate)}
                </div>
                <div class="right">
                  <img src="data:image/png;base64,$qrBase64" alt="QR"/>
                  <div class="url">${escape(payload.qrUrl)}</div>
                </div>
              </div>
              <div class="footer">
                <div>Принял: <span class="line"></span></div>
                <div>Проверил: <span class="line"></span></div>
              </div>
            </body></html>
        """.trimIndent()
    }

    private fun encodeQrBase64(text: String): String {
        val writer = QRCodeWriter()
        val matrix = writer.encode(text, BarcodeFormat.QR_CODE, 256, 256)
        val width = matrix.width
        val height = matrix.height
        val pixels = IntArray(width * height)
        for (y in 0 until height) {
            for (x in 0 until width) {
                pixels[y * width + x] = if (matrix[x, y]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
            }
        }
        val bitmap = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.ARGB_8888)
        bitmap.setPixels(pixels, 0, width, 0, 0, width, height)
        val stream = java.io.ByteArrayOutputStream()
        bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream)
        return android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP)
    }

    private fun formatDate(ts: Long?): String {
        if (ts == null || ts <= 0L) return "—"
        return SimpleDateFormat("dd.MM.yyyy", Locale("ru")).format(Date(ts))
    }

    private fun escape(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")

    private fun optionalRow(label: String, value: String): String {
        if (value.isBlank()) return ""
        return """<div class="row"><span class="label">$label:</span> <span class="value">${escape(value)}</span></div>"""
    }
}
