package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.receiving.ReceivingGroupMatcher
import com.scadatable.wms.receiving.ReceivingProductGroupOption
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.MaterialWarehouseGroupsViewModel
import com.scadatable.wms.viewmodel.MaterialWarehouseGroupsViewModelFactory
import com.scadatable.wms.viewmodel.ReceivingCategoriesViewModel
import com.scadatable.wms.viewmodel.ReceivingCategoriesViewModelFactory
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import com.scadatable.wms.warehouse.WarehouseKind

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun MaterialWarehouseGroupPickerScreen(
    navController: NavController,
    kind: WarehouseKind,
) {
    when (kind) {
        WarehouseKind.MATERIALS -> MaterialWarehouseCategoryPicker(
            navController = navController,
            kind = kind,
        )
        WarehouseKind.FINISHED_GOODS -> MaterialWarehouseProductGroupPicker(
            navController = navController,
            kind = kind,
            categoryKey = null,
        )
    }
}

/** Склад материалов: сначала тип (стикеры / наклейки / …), потом товарные группы. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun MaterialWarehouseCategoryPicker(
    navController: NavController,
    kind: WarehouseKind,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val app = context.applicationContext as WmsApplication
    val categoriesVm: ReceivingCategoriesViewModel = viewModel(
        factory = ReceivingCategoriesViewModelFactory(app.repository),
    )
    val state by categoriesVm.uiState.collectAsState()
    val options = state.displayOptions.ifEmpty { ReceivingProductGroups.options.filter { it.enabled } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(kind.pickerTitle, fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(kind.pickerSubtitle, fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                actions = {
                    IconButton(onClick = { categoriesVm.refresh() }, enabled = !state.loading) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = DarkGreen)
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "ТИП МАТЕРИАЛОВ",
                color = DarkGreen,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
            )

            if (state.loading && options.isEmpty()) {
                LinearWavyProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = DarkGreen,
                    wavelength = 24.dp,
                    waveSpeed = 4.dp,
                    amplitude = 0.5f,
                )
            }

            state.error?.let { msg ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE))) {
                    Column(Modifier.padding(12.dp)) {
                        Text(msg, color = ErrorRed, fontSize = 13.sp)
                        TextButton(onClick = { categoriesVm.refresh() }) { Text("Повторить") }
                    }
                }
            }

            options.chunked(2).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    rowItems.forEach { option ->
                        SiteModuleCard(
                            label = option.title,
                            subtitle = option.subtitle.ifBlank { "Выбрать" },
                            imageRes = option.imageRes,
                            imageUrl = option.imageUrl,
                            modifier = Modifier.weight(1f),
                            enabled = option.enabled,
                            onClick = {
                                if (option.enabled) {
                                    navController.navigate(
                                        Screen.MaterialWarehouseCategory.createRoute(
                                            kind.routeKey,
                                            MaterialWarehouseGroups.encodeRouteKey(option.key),
                                        ),
                                    )
                                }
                            },
                        )
                    }
                    if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun MaterialWarehouseCategoryGroupsScreen(
    navController: NavController,
    kindRouteKey: String,
    categoryRouteKey: String,
) {
    val kind = remember(kindRouteKey) { WarehouseKind.fromRouteKey(kindRouteKey) }
    val categoryKey = remember(categoryRouteKey) {
        MaterialWarehouseGroups.decodeRouteKey(categoryRouteKey)
    }
    MaterialWarehouseProductGroupPicker(
        navController = navController,
        kind = kind,
        categoryKey = categoryKey,
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun MaterialWarehouseProductGroupPicker(
    navController: NavController,
    kind: WarehouseKind,
    categoryKey: String?,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val app = context.applicationContext as WmsApplication
    val groupsVm: MaterialWarehouseGroupsViewModel = viewModel(
        factory = MaterialWarehouseGroupsViewModelFactory(app.repository),
    )
    val categoriesVm: ReceivingCategoriesViewModel = viewModel(
        factory = ReceivingCategoriesViewModelFactory(app.repository),
    )
    val state by groupsVm.uiState.collectAsState()
    val categoriesState by categoriesVm.uiState.collectAsState()

    val categoryOption: ReceivingProductGroupOption? = remember(categoryKey, categoriesState.displayOptions) {
        val key = categoryKey?.trim().orEmpty()
        if (key.isBlank()) null
        else ReceivingProductGroups.find(key)
            ?: categoriesState.displayOptions.firstOrNull { it.key.equals(key, ignoreCase = true) }
    }
    val categoryTitle = categoryOption?.title
        ?: categoryKey?.takeIf { it.isNotBlank() }?.let { MaterialWarehouseGroups.titleFor(it) }
        ?: kind.pickerTitle
    val categoryLinks = categoriesState.categoryLinks

    val tiles = remember(state.groups, categoryKey, categoryLinks) {
        val filtered = if (categoryKey.isNullOrBlank()) {
            state.groups
        } else {
            state.groups.filter {
                ReceivingGroupMatcher.matchesReceivingCategory(categoryKey, it, categoryLinks)
            }
        }
        filtered.map { group ->
            val code = group.effectiveCode()
            WarehouseGroupTile(
                routeKey = MaterialWarehouseGroups.encodeRouteKey(code),
                title = group.displayName().ifBlank { MaterialWarehouseGroups.titleFor(code) },
                subtitle = buildString {
                    append("${group.itemCount} поз.")
                    group.displayDescription()?.let { append(" · $it") }
                },
                rawGroup = code,
                imageUrl = group.imageUrl,
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(categoryTitle, fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(
                            if (categoryKey.isNullOrBlank()) kind.pickerSubtitle else "Товарные группы",
                            fontSize = 12.sp,
                            color = Color(0xFF6B6B6B),
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                actions = {
                    IconButton(
                        onClick = {
                            groupsVm.refresh()
                            if (!categoryKey.isNullOrBlank()) categoriesVm.refresh()
                        },
                        enabled = !state.loading,
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = DarkGreen)
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                kind.groupsHeader,
                color = DarkGreen,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
            )

            if (state.loading && tiles.isEmpty()) {
                LinearWavyProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = DarkGreen,
                    wavelength = 24.dp,
                    waveSpeed = 4.dp,
                    amplitude = 0.5f,
                )
            }

            state.error?.let { msg ->
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE))) {
                    Column(Modifier.padding(12.dp)) {
                        Text(msg, color = ErrorRed, fontSize = 13.sp)
                        TextButton(onClick = { groupsVm.refresh() }) { Text("Повторить") }
                    }
                }
            }

            if (!state.loading && tiles.isEmpty() && state.error == null) {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) {
                    Text(
                        if (categoryKey.isNullOrBlank()) {
                            "Группы не найдены. Обновите справочник или проверьте связь с сервером."
                        } else {
                            "В этом типе пока нет товарных групп. Проверьте связи категорий в справочнике."
                        },
                        modifier = Modifier.padding(14.dp),
                        color = Color.Gray,
                        fontSize = 13.sp,
                    )
                }
            }

            tiles.chunked(2).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    rowItems.forEach { tile ->
                        SiteModuleCard(
                            label = tile.title,
                            subtitle = tile.subtitle,
                            imageRes = getDrawableSafely(MaterialWarehouseGroups.imageFor(tile.rawGroup)),
                            imageUrl = tile.imageUrl,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                navController.navigate(
                                    Screen.MaterialWarehouseStock.createRoute(kind.routeKey, tile.routeKey),
                                )
                            },
                        )
                    }
                    if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

private data class WarehouseGroupTile(
    val routeKey: String,
    val title: String,
    val subtitle: String,
    val rawGroup: String,
    val imageUrl: String?,
)
