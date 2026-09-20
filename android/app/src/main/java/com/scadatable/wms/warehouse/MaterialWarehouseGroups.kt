package com.scadatable.wms.warehouse

import com.scadatable.wms.R
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

object MaterialWarehouseGroups {
    const val BARE_ROUTE_KEY = "__bare__"

    fun encodeRouteKey(productGroup: String): String {
        val raw = productGroup.trim()
        if (raw.isEmpty() || raw == "—") return BARE_ROUTE_KEY
        return URLEncoder.encode(raw, Charsets.UTF_8.name())
    }

    fun decodeRouteKey(routeKey: String): String {
        val key = routeKey.trim()
        if (key == BARE_ROUTE_KEY) return "—"
        return URLDecoder.decode(key, Charsets.UTF_8.name())
    }

    fun isBareGroup(productGroup: String): Boolean {
        val g = productGroup.trim()
        return g.isEmpty() || g == "—"
    }

    fun titleFor(productGroup: String): String {
        if (isBareGroup(productGroup)) return "Без группы"
        return when (productGroup.lowercase(Locale.ROOT)) {
            "water" -> "Вода"
            "stickers", "sticker" -> "Стикеры"
            "softdrinks" -> "Напитки"
            "milk" -> "Молоко"
            else -> productGroup
        }
    }

    fun imageFor(productGroup: String): Int = when (productGroup.lowercase(Locale.ROOT)) {
        "water" -> R.drawable.img_nomenclature_card
        "stickers", "sticker" -> R.drawable.img_receiving_group_stickers
        else -> R.drawable.img_material_warehouse
    }
}
