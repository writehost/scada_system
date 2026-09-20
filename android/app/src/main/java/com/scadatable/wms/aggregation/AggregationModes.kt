package com.scadatable.wms.aggregation

import com.scadatable.wms.R
import com.scadatable.wms.viewmodel.AggregationMode

data class AggregationModeOption(
    val mode: AggregationMode,
    val routeKey: String,
    val title: String,
    val subtitle: String,
    val imageRes: Int,
    val enabled: Boolean = true,
)

object AggregationModes {
    val options: List<AggregationModeOption> = listOf(
        AggregationModeOption(
            mode = AggregationMode.BLOCK,
            routeKey = "block",
            title = "Собрать блок",
            subtitle = "Код блока → продукты",
            imageRes = R.drawable.img_aggregation_block,
            enabled = true,
        ),
        AggregationModeOption(
            mode = AggregationMode.PALLET,
            routeKey = "pallet",
            title = "Собрать паллет",
            subtitle = "Код паллеты → блоки",
            imageRes = R.drawable.img_aggregation_card,
            enabled = true,
        ),
        AggregationModeOption(
            mode = AggregationMode.EXTRACT,
            routeKey = "extract",
            title = "Изъять с паллеты",
            subtitle = "Паллета → коды изъятия",
            imageRes = R.drawable.img_aggregation_extract,
            enabled = true,
        ),
    )

    fun fromRouteKey(key: String): AggregationMode =
        options.firstOrNull { it.routeKey == key.trim().lowercase() }?.mode ?: AggregationMode.BLOCK

    fun titleFor(mode: AggregationMode): String =
        options.firstOrNull { it.mode == mode }?.title ?: mode.name

    fun titleForRouteKey(key: String): String = titleFor(fromRouteKey(key))

    fun optionFor(mode: AggregationMode): AggregationModeOption? =
        options.firstOrNull { it.mode == mode }

    fun parentLabel(mode: AggregationMode): String = when (mode) {
        AggregationMode.BLOCK -> "Блок"
        AggregationMode.PALLET -> "Паллета"
        AggregationMode.EXTRACT -> "Паллета"
    }

    fun childLabel(mode: AggregationMode): String = when (mode) {
        AggregationMode.BLOCK -> "Продукт"
        AggregationMode.PALLET -> "Блок"
        AggregationMode.EXTRACT -> "Код"
    }

    /** Короткая подсказка: одно слово / короткая фраза. */
    fun parentScanHint(mode: AggregationMode): String = parentLabel(mode)

    fun childScanHint(mode: AggregationMode): String = childLabel(mode)

    fun groupsSectionTitle(mode: AggregationMode): String = when (mode) {
        AggregationMode.BLOCK -> "Собранные блоки"
        AggregationMode.PALLET -> "Собранные паллеты"
        AggregationMode.EXTRACT -> "Паллеты с изъятиями"
    }

    fun groupDoneMessage(mode: AggregationMode): String = when (mode) {
        AggregationMode.BLOCK -> "Блок собран"
        AggregationMode.PALLET -> "Паллета собрана"
        AggregationMode.EXTRACT -> "Изъятие сохранено"
    }

    fun qtyDialogTitle(mode: AggregationMode): String = when (mode) {
        AggregationMode.BLOCK -> "Кодов в блоке"
        AggregationMode.PALLET -> "Блоков в паллете"
        AggregationMode.EXTRACT -> "Лимит изъятий"
    }

    fun needsTargetQty(mode: AggregationMode): Boolean =
        mode == AggregationMode.BLOCK || mode == AggregationMode.PALLET
}
