package com.scadatable.wms.warehouse

import com.scadatable.wms.R

enum class WarehouseKind(
    val routeKey: String,
    val pickerTitle: String,
    val pickerSubtitle: String,
    val groupsHeader: String,
    val tileImageRes: Int,
    val materialTypeFilter: String?,
) {
    FINISHED_GOODS(
        routeKey = "finished",
        pickerTitle = "Склад готовой продукции",
        pickerSubtitle = "Остатки ГП по группам",
        groupsHeader = "ГРУППЫ ГОТОВОЙ ПРОДУКЦИИ",
        tileImageRes = R.drawable.img_warehouse_card,
        materialTypeFilter = "product",
    ),
    MATERIALS(
        routeKey = "materials",
        pickerTitle = "Склад материалов",
        pickerSubtitle = "Остатки материалов",
        groupsHeader = "ГРУППЫ МАТЕРИАЛОВ",
        tileImageRes = R.drawable.img_material_warehouse,
        materialTypeFilter = "material",
    ),
    ;

    companion object {
        fun fromRouteKey(key: String): WarehouseKind =
            entries.firstOrNull { it.routeKey == key.trim() } ?: MATERIALS
    }
}
