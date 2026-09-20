package com.scadatable.wms.receiving

import com.scadatable.wms.data.remote.ProductGroupRow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReceivingGroupMatcherTest {
    @Test
    fun water_does_not_accept_softdrinks_code() {
        assertFalse(
            ReceivingGroupMatcher.groupsMatchForReceiving("water", "softdrinks", "Безалкогольные напитки"),
        )
    }

    @Test
    fun water_accepts_water_code() {
        assertTrue(ReceivingGroupMatcher.groupsMatchForReceiving("water", "water", "Питьевая вода"))
        assertTrue(ReceivingGroupMatcher.groupsMatchForReceiving("water", "13", null))
    }

    @Test
    fun softdrinks_does_not_accept_water_code() {
        assertFalse(ReceivingGroupMatcher.groupsMatchForReceiving("softdrinks", "water", "Питьевая вода"))
    }

    @Test
    fun softdrinks_accepts_softdrinks_code() {
        assertTrue(ReceivingGroupMatcher.groupsMatchForReceiving("softdrinks", "softdrinks", "Напитки"))
        assertTrue(ReceivingGroupMatcher.groupsMatchForReceiving("softdrinks", "23", null))
    }

    @Test
    fun drink_label_with_voda_does_not_match_water_when_code_softdrinks() {
        assertFalse(
            ReceivingGroupMatcher.groupsMatchForReceiving("water", "softdrinks", "Газированная вода"),
        )
    }

    @Test
    fun stickers_category_excludes_water_and_softdrinks() {
        val water = ProductGroupRow(productGroup = "water", name = "Вода")
        val drinks = ProductGroupRow(productGroup = "softdrinks", name = "Напитки")
        val stickers = ProductGroupRow(productGroup = "stickers", name = "Стикеры")
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory(ReceivingProductGroups.STICKERS, water))
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory(ReceivingProductGroups.STICKERS, drinks))
        assertTrue(ReceivingGroupMatcher.matchesReceivingCategory(ReceivingProductGroups.STICKERS, stickers))
    }

    @Test
    fun stickers_ignores_bad_server_links_to_beverages() {
        val water = ProductGroupRow(productGroup = "water", name = "Вода")
        val drinks = ProductGroupRow(productGroup = "softdrinks", name = "Напитки")
        val badLinks = mapOf("stickers" to setOf("water", "softdrinks"))
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory("stickers", water, badLinks))
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory("stickers", drinks, badLinks))
    }

    @Test
    fun packaging_materials_never_shows_beverages_even_with_empty_links() {
        val water = ProductGroupRow(productGroup = "water", name = "Вода")
        val drinks = ProductGroupRow(productGroup = "softdrinks", name = "Напитки")
        val preform = ProductGroupRow(productGroup = "preform", name = "Преформа")
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory("MaterialsFactory", water))
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory("MaterialsFactory", drinks))
        assertTrue(ReceivingGroupMatcher.matchesReceivingCategory("MaterialsFactory", preform))
        assertEquals(
            ReceivingGroupMatcher.CategoryKind.PACKAGING,
            ReceivingGroupMatcher.categoryKind("MaterialsFactory"),
        )
    }

    @Test
    fun stickers_selected_group_rejects_softdrinks_crpt() {
        assertFalse(
            ReceivingGroupMatcher.groupsMatchForReceiving("stickers", "softdrinks", "Напитки"),
        )
        assertFalse(
            ReceivingGroupMatcher.groupsMatchForReceiving("stickers", "water", "Вода"),
        )
    }

    @Test
    fun water_category_includes_only_water() {
        val water = ProductGroupRow(productGroup = "water", name = "Вода")
        val drinks = ProductGroupRow(productGroup = "softdrinks", name = "Напитки")
        assertTrue(ReceivingGroupMatcher.matchesReceivingCategory(ReceivingProductGroups.WATER, water))
        assertTrue(ReceivingGroupMatcher.matchesReceivingCategory(ReceivingProductGroups.WATER, drinks))
    }

    @Test
    fun explicit_category_links_override_legacy_rules() {
        val water = ProductGroupRow(productGroup = "water", name = "Вода")
        val drinks = ProductGroupRow(productGroup = "softdrinks", name = "Напитки")
        val caps = ProductGroupRow(productGroup = "caps", name = "Пробки")
        val links = mapOf("custompack" to setOf("caps"))
        // custompack → OTHER without beverage links filter; caps allowed, water not in links
        assertTrue(ReceivingGroupMatcher.matchesReceivingCategory("custompack", caps, links))
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory("custompack", water, links))
        assertFalse(ReceivingGroupMatcher.matchesReceivingCategory("custompack", drinks, links))
    }
}
