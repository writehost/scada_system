package com.scadatable.wms.receiving

import com.scadatable.wms.data.remote.ProductGroupRow
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import java.util.Locale

/**
 * Строгое сопоставление товарных групп приёмки (без подстрок вроде «вод» в «напитках»).
 *
 * Важно: серверные linkedGroupCodes иногда ошибочны (у stickers были water/softdrinks).
 * Клиент дополнительно фильтрует по «типу» категории.
 */
object ReceivingGroupMatcher {
    enum class CategoryKind {
        STICKERS,
        BEVERAGES,
        PACKAGING,
        UNMARKED,
        OTHER,
    }

    private val numericToCode = mapOf(
        "13" to "water",
        "23" to "softdrinks",
    )

    private val codeAliases = mapOf(
        "water" to setOf("water", "13", "вода"),
        "softdrinks" to setOf("softdrinks", "23", "beverage", "beverages", "drinks", "напитки"),
        "stickers" to setOf("stickers", "sticker", "labels", "label", "стикеры", "этикетки"),
    )

    fun categoryKind(categoryKey: String): CategoryKind {
        val key = categoryKey.trim().lowercase(Locale.ROOT)
        if (key.isBlank()) return CategoryKind.OTHER
        if (key == ReceivingProductGroups.UNMARKED) return CategoryKind.UNMARKED
        if (key == ReceivingProductGroups.STICKERS || key.contains("sticker") || key.contains("этикет") || key.contains("стил")) {
            return CategoryKind.STICKERS
        }
        if (key == ReceivingProductGroups.WATER ||
            key == "softdrinks" ||
            key.contains("напит") ||
            key.contains("drink") ||
            key.contains("beverage")
        ) {
            return CategoryKind.BEVERAGES
        }
        if (key.contains("material") ||
            key.contains("factory") ||
            key.contains("pack") ||
            key.contains("упаков") ||
            key.contains("преформ") ||
            key.contains("пробк")
        ) {
            return CategoryKind.PACKAGING
        }
        return CategoryKind.OTHER
    }

    fun normalizeGroupToken(value: String): String {
        val raw = value.trim().lowercase(Locale.ROOT)
        if (raw.isBlank() || raw == "—") return ""
        numericToCode[raw]?.let { return it }
        codeAliases.entries.firstOrNull { (canonical, aliases) ->
            raw == canonical || raw in aliases
        }?.key?.let { return it }
        return raw
    }

    fun groupsMatchForReceiving(
        selectedGroup: String,
        crptGroup: String?,
        crptGroupLabel: String?,
    ): Boolean {
        val selected = selectedGroup.trim()
        if (selected.isBlank() || selected == ReceivingProductGroups.ALL_DOCS) return true

        val selectedNorm = normalizeGroupToken(selected)
        val actualNorm = normalizeGroupToken(crptGroup.orEmpty())
            .ifBlank { normalizeGroupToken(crptGroupLabel.orEmpty()) }

        if (selectedNorm.isNotBlank() && actualNorm.isNotBlank()) {
            if (selectedNorm == actualNorm) return true
            // Категории приёмки (не товарная группа ЧЗ): стикеры/упаковка не принимают воду/напитки.
            return when (categoryKind(selected)) {
                CategoryKind.STICKERS,
                CategoryKind.PACKAGING,
                -> !isBeverageCanonical(actualNorm)
                else -> false
            }
        }

        val actualRaw = listOf(crptGroup, crptGroupLabel)
            .map { it?.trim()?.lowercase(Locale.ROOT).orEmpty() }
            .firstOrNull { it.isNotBlank() }
            .orEmpty()
        if (actualRaw.isBlank()) return true

        return selectedNorm == actualRaw || selected.trim().lowercase(Locale.ROOT) == actualRaw
    }

    fun mismatchMessage(
        selectedGroup: String,
        crptGroup: String?,
        crptGroupLabel: String?,
    ): String? {
        if (groupsMatchForReceiving(selectedGroup, crptGroup, crptGroupLabel)) return null
        val actual = crptGroupLabel?.trim().takeUnless { it.isNullOrBlank() }
            ?: crptGroup?.trim().takeUnless { it.isNullOrBlank() }
            ?: "—"
        val selectedTitle = MaterialWarehouseGroups.titleFor(selectedGroup)
        return "Группа кода ЧЗ «$actual» не совпадает с выбранной группой «$selectedTitle»"
    }

    fun buildCategoryLinks(
        categories: List<com.scadatable.wms.data.remote.ReceivingCategoryRow>,
    ): Map<String, Set<String>> =
        categories.associate { cat ->
            cat.code.trim().lowercase(Locale.ROOT) to
                cat.linkedGroupCodes
                    .map { it.trim().lowercase(Locale.ROOT) }
                    .filter { it.isNotEmpty() }
                    .toSet()
        }

    /**
     * @return товарные группы, допустимые для выбранного типа приёмки.
     * Пустой список = отдельной группы ЧЗ нет → мастер продолжает с кодом категории.
     */
    fun matchesReceivingCategory(
        categoryKey: String,
        group: ProductGroupRow,
        categoryLinks: Map<String, Set<String>>? = null,
    ): Boolean {
        val key = categoryKey.trim().lowercase(Locale.ROOT)
        val kind = categoryKind(key)
        val code = group.effectiveCode().trim().lowercase(Locale.ROOT)
        val name = group.displayName().trim().lowercase(Locale.ROOT)

        when (kind) {
            CategoryKind.UNMARKED -> return false
            CategoryKind.BEVERAGES -> return isWaterGroup(code, name) || isSoftdrinksGroup(code, name)
            CategoryKind.STICKERS -> {
                if (isBeverageGroup(code, name)) return false
                val links = sanitizeLinks(kind, categoryLinks?.get(key))
                if (!links.isNullOrEmpty()) return code in links
                // Нет валидных связей — не подсовываем воду/напитки «всё подряд».
                return isStickersNamed(code, name)
            }
            CategoryKind.PACKAGING -> {
                if (isBeverageGroup(code, name)) return false
                val links = sanitizeLinks(kind, categoryLinks?.get(key))
                if (!links.isNullOrEmpty()) return code in links
                return isPackagingNamed(code, name)
            }
            CategoryKind.OTHER -> {
                val links = sanitizeLinks(kind, categoryLinks?.get(key))
                if (!links.isNullOrEmpty()) return code in links
                // Неизвестный тип без связей: не показываем напитки «по умолчанию».
                return !isBeverageGroup(code, name)
            }
        }
    }

    private fun sanitizeLinks(kind: CategoryKind, links: Set<String>?): Set<String>? {
        if (links.isNullOrEmpty()) return null
        val filtered = when (kind) {
            CategoryKind.STICKERS, CategoryKind.PACKAGING, CategoryKind.OTHER ->
                links.filterNot { isBeverageCanonical(normalizeGroupToken(it)) }.toSet()
            CategoryKind.BEVERAGES ->
                links.filter { isBeverageCanonical(normalizeGroupToken(it)) }.toSet()
            CategoryKind.UNMARKED -> emptySet()
        }
        return filtered.takeIf { it.isNotEmpty() }
    }

    private fun isBeverageCanonical(norm: String): Boolean =
        norm == "water" || norm == "softdrinks"

    private fun isBeverageGroup(code: String, name: String): Boolean =
        isWaterGroup(code, name) || isSoftdrinksGroup(code, name)

    private fun isWaterGroup(code: String, name: String): Boolean {
        if (code == "water" || code == "13") return true
        if (name == "вода" || name.contains("питьевая вода")) return true
        return false
    }

    private fun isSoftdrinksGroup(code: String, name: String): Boolean {
        if (code == "softdrinks" || code == "23") return true
        if (code == "beverage" || code == "beverages" || code == "drinks") return true
        if (name.contains("напит") || name.contains("beverage") || name.contains("soft drink")) return true
        return false
    }

    private fun isStickersNamed(code: String, name: String): Boolean {
        val blob = "$code $name"
        return blob.contains("sticker") ||
            blob.contains("label") ||
            blob.contains("стикер") ||
            blob.contains("этикет") ||
            blob.contains("мелоч")
    }

    private fun isPackagingNamed(code: String, name: String): Boolean {
        val blob = "$code $name"
        return blob.contains("pack") ||
            blob.contains("упаков") ||
            blob.contains("преформ") ||
            blob.contains("пробк") ||
            blob.contains("плён") ||
            blob.contains("плен") ||
            blob.contains("крыш") ||
            blob.contains("material") ||
            blob.contains("factory")
    }
}
