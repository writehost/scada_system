package com.scadatable.wms.print

import com.scadatable.wms.receiving.ReceivingStickerPayload
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Собственный QR этикетки WMS (не GS1 DataMatrix ЧЗ).
 * Скан даёт быстрый lookup: ячейка + партия + номенклатура.
 *
 * Форматы (оба принимаются парсером):
 * 1) URL: `{base}/api/wms/receiving/batch/{batch}?siteCode=…&cell=…&item=…`
 * 2) Компакт: `WMS1|cell=…|batch=…|item=…|gtin=…|qty=…|site=…`
 */
object WmsLabelQr {
    const val PREFIX = "WMS1"

    fun buildPayload(
        baseUrl: String,
        siteCode: String,
        batchCode: String,
        cellCode: String? = null,
        itemCode: String? = null,
        gtin: String? = null,
        qty: Double? = null,
        preferCompact: Boolean = false,
    ): String {
        val batch = batchCode.trim()
        val site = siteCode.trim().ifBlank { "DEFAULT" }
        val cell = cellCode?.trim().orEmpty()
        val item = itemCode?.trim().orEmpty()
        if (preferCompact || baseUrl.isBlank()) {
            return buildCompact(
                siteCode = site,
                batchCode = batch,
                cellCode = cell,
                itemCode = item,
                gtin = gtin,
                qty = qty,
            )
        }
        val root = baseUrl.trim().trimEnd('/')
        val enc = StandardCharsets.UTF_8.name()
        val q = buildString {
            append("siteCode=").append(URLEncoder.encode(site, enc))
            if (cell.isNotBlank()) append("&cell=").append(URLEncoder.encode(cell, enc))
            if (item.isNotBlank()) append("&item=").append(URLEncoder.encode(item, enc))
            if (!gtin.isNullOrBlank()) append("&gtin=").append(URLEncoder.encode(gtin.trim(), enc))
            if (qty != null && qty > 0) {
                val qtyText = if (qty % 1.0 == 0.0) qty.toLong().toString() else qty.toString()
                append("&qty=").append(URLEncoder.encode(qtyText, enc))
            }
        }
        return "$root/api/wms/receiving/batch/${URLEncoder.encode(batch, enc)}?$q"
    }

    fun buildCompact(
        siteCode: String,
        batchCode: String,
        cellCode: String = "",
        itemCode: String = "",
        gtin: String? = null,
        qty: Double? = null,
    ): String {
        val parts = mutableListOf(PREFIX)
        fun put(key: String, value: String) {
            if (value.isNotBlank()) parts += "$key=$value"
        }
        put("site", siteCode.trim())
        put("batch", batchCode.trim())
        put("cell", cellCode.trim())
        put("item", itemCode.trim())
        put("gtin", gtin?.trim().orEmpty())
        if (qty != null && qty > 0) {
            val qtyText = if (qty % 1.0 == 0.0) qty.toLong().toString() else qty.toString()
            put("qty", qtyText)
        }
        return parts.joinToString("|")
    }

    fun fromPayload(payload: ReceivingStickerPayload, baseUrl: String, siteCode: String): String {
        if (payload.qrUrl.isNotBlank() && !payload.qrUrl.contains("/marking/datamatrix", ignoreCase = true)) {
            return payload.qrUrl
        }
        return buildPayload(
            baseUrl = baseUrl,
            siteCode = siteCode,
            batchCode = payload.batchCode,
            cellCode = payload.cellCode,
            itemCode = null,
            gtin = payload.gtin,
            qty = payload.qty,
        )
    }

    fun parseCompact(raw: String): Map<String, String>? {
        val trimmed = raw.trim()
        if (!trimmed.startsWith("$PREFIX|", ignoreCase = true) &&
            !trimmed.equals(PREFIX, ignoreCase = true)
        ) {
            return null
        }
        return trimmed.split('|')
            .drop(1)
            .mapNotNull { part ->
                val i = part.indexOf('=')
                if (i <= 0) null
                else part.substring(0, i).trim().lowercase() to part.substring(i + 1).trim()
            }
            .toMap()
    }
}
