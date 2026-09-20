package com.scadatable.wms.receiving

/** Подсказки поиска ТН ВЭД по названию товарной группы на ТСД. */
object ReceivingTnvedHints {
    fun searchQueriesForGroup(groupName: String): List<String> {
        val g = groupName.trim().lowercase()
        if (g.isBlank()) return emptyList()
        return when {
            g.contains("крыш") || g.contains("колпач") || g.contains("cap") || g.contains("lid") ->
                listOf("крышк", "укупор", "842230", "392350")
            g.contains("преформ") || g.contains("preform") ->
                listOf("преформ", "392330", "3923")
            g.contains("пробк") ->
                listOf("пробк", "4503", "392350")
            g.contains("упаков") || g.contains("packaging") ->
                listOf("упаков", "3923", "4819")
            g.contains("плён") || g.contains("плен") ->
                listOf("плен", "3920", "3921")
            g.contains("этикет") || g.contains("стикер") || g.contains("label") ->
                listOf("этикет", "4811", "4821")
            else -> listOf(g.take(24))
        }.distinct()
    }
}
