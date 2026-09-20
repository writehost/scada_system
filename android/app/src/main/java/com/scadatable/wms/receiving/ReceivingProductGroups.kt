package com.scadatable.wms.receiving

import com.scadatable.wms.R

data class ReceivingProductGroupOption(
    val key: String,
    val title: String,
    val subtitle: String,
    val imageRes: Int,
    val imageUrl: String? = null,
    val enabled: Boolean,
)

object ReceivingProductGroups {
    const val STICKERS = "stickers"
    const val WATER = "water"
    const val UNMARKED = "unmarked"
    /** Маршрут списка всех документов приёмки (без фильтра по товарной группе). */
    const val ALL_DOCS = "__all__"

    val options: List<ReceivingProductGroupOption> = listOf(
        ReceivingProductGroupOption(
            key = STICKERS,
            title = "Стикеры",
            subtitle = "Класс A · мелочь / этикетки",
            imageRes = R.drawable.img_receiving_group_stickers,
            enabled = true,
        ),
        ReceivingProductGroupOption(
            key = WATER,
            title = "Вода",
            subtitle = "Товарная группа water",
            imageRes = R.drawable.img_nomenclature_card,
            enabled = true,
        ),
        ReceivingProductGroupOption(
            key = UNMARKED,
            title = "Без кодов",
            subtitle = "ТН ВЭД и номенклатура без маркировки",
            imageRes = R.drawable.img_warehouse_card,
            enabled = true,
        ),
    )

    fun find(key: String): ReceivingProductGroupOption? =
        options.firstOrNull { it.key == key.trim().lowercase() }

    fun titleFor(key: String): String = find(key)?.title ?: key

    fun imageResFor(key: String): Int = find(key)?.imageRes ?: R.drawable.img_nomenclature_card

    fun fromServerCategories(
        categories: List<com.scadatable.wms.data.remote.ReceivingCategoryRow>,
    ): List<ReceivingProductGroupOption> =
        categories
            .filter { it.isActive && it.code.isNotBlank() }
            .sortedWith(compareBy({ it.sortOrder }, { it.name }))
            .map { cat ->
                ReceivingProductGroupOption(
                    key = cat.code.trim().lowercase(),
                    title = cat.name.trim().ifBlank { cat.code },
                    subtitle = cat.description?.trim().orEmpty(),
                    imageRes = imageResFor(cat.code),
                    imageUrl = cat.imageUrl?.trim()?.takeIf { it.isNotEmpty() },
                    enabled = true,
                )
            }
}
