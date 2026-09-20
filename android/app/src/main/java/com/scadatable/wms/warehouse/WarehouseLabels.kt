package com.scadatable.wms.warehouse

/**
 * Человекочитаемые названия складов для ТСД.
 * Справочник с сервера имеет приоритет; иначе — известные коды OS/FG.
 */
object WarehouseLabels {
    fun titleFor(code: String, directoryName: String? = null, shortName: String? = null): String {
        shortName?.trim()?.takeIf { it.isNotEmpty() && !it.equals(code, ignoreCase = true) }?.let { return it }
        directoryName?.trim()?.takeIf { it.isNotEmpty() && !it.equals(code, ignoreCase = true) }?.let { return it }
        return when (code.trim().uppercase()) {
            "OS" -> "Склад материалов"
            "FG" -> "Склад готовой продукции"
            "LINE" -> "Линия сериализации"
            else -> code.trim().ifBlank { "Склад" }
        }
    }

    fun subtitleFor(code: String, warehouseType: String? = null): String {
        val typeHint = when {
            warehouseType.equals("FINISHED_GOODS", ignoreCase = true) -> "Готовая продукция"
            warehouseType.equals("MAIN", ignoreCase = true) -> "Материалы"
            warehouseType.equals("PRODUCTION", ignoreCase = true) -> "Производство"
            else -> when (code.trim().uppercase()) {
                "OS" -> "Материалы"
                "FG" -> "Готовая продукция (ГП)"
                else -> "Склад"
            }
        }
        return "$typeHint · $code"
    }
}
