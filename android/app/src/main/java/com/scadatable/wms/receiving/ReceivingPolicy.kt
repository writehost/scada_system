package com.scadatable.wms.receiving

object ReceivingDocumentStatus {
    const val ACTIVE = "active"
    const val CLOSED = "closed"
    const val PAUSED = "paused"

    fun label(status: String?): String = when (status?.lowercase()) {
        ACTIVE -> "Активный"
        CLOSED -> "Закрыт"
        PAUSED -> "Приостановлен"
        else -> "Черновик"
    }

    fun displayLabel(status: String?, isActiveSession: Boolean, lineCount: Int): String {
        if (isActiveSession) return "Активен ($lineCount)"
        return when (status?.lowercase()) {
            ACTIVE -> if (lineCount > 0) "В работе ($lineCount)" else "Новый"
            PAUSED -> "Пауза ($lineCount)"
            CLOSED -> "Закрыт ($lineCount)"
            else -> "Новый"
        }
    }
}

data class ReceivingScanGate(
    val allowed: Boolean,
    val blocked: Boolean,
    val reason: String? = null,
    val expired: Boolean = false,
    val warning: Boolean = false,
)

fun crptStatusRu(code: String?): String {
    if (code.isNullOrBlank()) return "—"
    return when (code.uppercase()) {
        "INTRODUCED" -> "В обороте"
        "APPLIED" -> "Нанесён"
        "EMITTED" -> "Эмитирован"
        "WRITTEN_OFF" -> "Списан"
        "RETIRED", "WITHDRAWN" -> "Выведен"
        else -> code
    }
}

fun evaluateReceivingScanGate(
    crptStatus: String?,
    expiryState: String?,
    itemStatus: String?,
): ReceivingScanGate {
    val statusKey = crptStatus?.trim()?.uppercase().orEmpty()
    val expired = expiryState == "expired" || itemStatus == "просрочен"
    val warning = expiryState == "warning" || itemStatus == "истекает"

    if (expired) {
        return ReceivingScanGate(
            allowed = false,
            blocked = true,
            reason = "Код просрочен — приёмка заблокирована",
            expired = true,
        )
    }

    when (statusKey) {
        "EMITTED" -> Unit
        "" -> Unit
        "APPLIED" -> return ReceivingScanGate(
            allowed = false,
            blocked = true,
            reason = "Код нанесён, но не эмитирован — приёмка заблокирована",
        )
        "INTRODUCED" -> return ReceivingScanGate(
            allowed = false,
            blocked = true,
            reason = "Код уже в обороте — приёмка заблокирована",
        )
        "WRITTEN_OFF", "RETIRED", "WITHDRAWN" -> return ReceivingScanGate(
            allowed = false,
            blocked = true,
            reason = "Код в ЧЗ: ${crptStatusRu(statusKey)} — приёмка заблокирована",
        )
        else -> return ReceivingScanGate(
            allowed = false,
            blocked = true,
            reason = "Статус ЧЗ «${crptStatusRu(statusKey)}» — приёмка заблокирована",
        )
    }

    return ReceivingScanGate(
        allowed = true,
        blocked = false,
        warning = warning,
        reason = if (warning) "Срок годности истекает" else null,
    )
}

fun extractReceivingBatchCode(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isBlank()) return null
    val direct = Regex("""STK-\d{8}-\d{14}-\d{3}""").find(trimmed)?.value
    if (direct != null) return direct
    val fromUrl = Regex("""/receiving/batch/([^/?#]+)""").find(trimmed)?.groupValues?.getOrNull(1)
    if (!fromUrl.isNullOrBlank()) {
        return java.net.URLDecoder.decode(fromUrl.trim(), Charsets.UTF_8.name())
    }
    val compact = com.scadatable.wms.print.WmsLabelQr.parseCompact(trimmed)
    return compact?.get("batch")?.takeIf { it.isNotBlank() }
}

fun buildReceivingBatchCode(gtin: String?, emissionAt: Long?): String {
    return buildReceivingBatchCodeForItem(itemCode = null, gtin = gtin, emissionAt = emissionAt)
}

/** STK-код партии: GTIN если есть, иначе цифры/хеш кода номенклатуры. */
fun buildReceivingBatchCodeForItem(itemCode: String?, gtin: String?, emissionAt: Long?): String {
    val date = java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US)
        .format(java.util.Date(emissionAt ?: System.currentTimeMillis()))
    val gtinPart = when {
        !gtin.isNullOrBlank() -> gtin.filter { it.isDigit() }.takeLast(14).padStart(14, '0')
        !itemCode.isNullOrBlank() -> {
            val digits = itemCode.filter { it.isDigit() }
            if (digits.length >= 4) {
                digits.takeLast(14).padStart(14, '0')
            } else {
                kotlin.math.abs(itemCode.hashCode()).toString().padStart(14, '0').takeLast(14)
            }
        }
        else -> "00000000000000"
    }
    val seq = (System.currentTimeMillis() % 1000L).toString().padStart(3, '0')
    return "STK-$date-$gtinPart-$seq"
}

fun buildReceivingBatchQrUrl(
    baseUrl: String,
    siteCode: String,
    batchCode: String,
    cellCode: String? = null,
    itemCode: String? = null,
    gtin: String? = null,
    qty: Double? = null,
): String =
    com.scadatable.wms.print.WmsLabelQr.buildPayload(
        baseUrl = baseUrl,
        siteCode = siteCode,
        batchCode = batchCode,
        cellCode = cellCode,
        itemCode = itemCode,
        gtin = gtin,
        qty = qty,
    )

