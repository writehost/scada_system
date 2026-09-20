package com.scadatable.wms.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.receiving.ReceivingDocumentStatus
import com.scadatable.wms.receiving.ReceivingGroupMatcher
import com.scadatable.wms.receiving.ReceivingProductGroupOption
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.MaterialWarehouseGroupsViewModel
import com.scadatable.wms.viewmodel.MaterialWarehouseGroupsViewModelFactory
import com.scadatable.wms.viewmodel.ReceivingCategoriesViewModel
import com.scadatable.wms.viewmodel.ReceivingCategoriesViewModelFactory
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceivingGroupPickerScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val categoriesVm: ReceivingCategoriesViewModel = viewModel(
        factory = ReceivingCategoriesViewModelFactory(app.repository),
    )
    val categoriesState by categoriesVm.uiState.collectAsState()
    val activeDocId by app.appPrefs.activeReceivingDocId.collectAsState(initial = null)
    val activeProductGroup by app.appPrefs.activeReceivingProductGroup.collectAsState(initial = null)
    val displayOptions = categoriesState.displayOptions
    val scope = rememberCoroutineScope()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Приемка", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Выберите группу товаров", fontSize = 12.sp, color = Color(0xFF6B6B6B))
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
                        onClick = { categoriesVm.refresh() },
                        enabled = !categoriesState.loading,
                    ) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить подгруппы", tint = DarkGreen)
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
            if (categoriesState.loading && displayOptions.isEmpty()) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
            }
            categoriesState.error?.let { msg ->
                Text(msg, color = ErrorRed, fontSize = 12.sp)
            }
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Color.White),
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        ReceivingQuickAction(
                            label = "Документы",
                            subtitle = "Все приёмки",
                            icon = Icons.Default.Description,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                navController.navigate(Screen.ReceivingDocuments.allDocumentsRoute())
                            },
                        )
                        ReceivingQuickAction(
                            label = "Новая",
                            subtitle = "Мастер документа",
                            icon = Icons.Default.Add,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                navController.navigate(Screen.DocumentWizard.createRoute("receiving"))
                            },
                        )
                    }
                    Button(
                        onClick = { navController.navigate(Screen.FreeReceiving.createRoute()) },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text("Свободная приёмка · разносорт")
                    }
                    if (!activeDocId.isNullOrBlank()) {
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = LimeAccent.copy(alpha = 0.35f),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Активный документ", fontSize = 11.sp, color = Color(0xFF5A5A5A))
                                    Text(
                                        activeDocId!!.uppercase(),
                                        fontWeight = FontWeight.Bold,
                                        color = DarkGreen,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 18.sp,
                                    )
                                }
                                FilledTonalButton(
                                    onClick = {
                                        val groupRoute = MaterialWarehouseGroups.encodeRouteKey(
                                            activeProductGroup?.takeIf { it.isNotBlank() }
                                                ?: ReceivingProductGroups.STICKERS,
                                        )
                                        navController.navigate(
                                            Screen.ReceivingSession.createRoute(groupRoute, activeDocId!!),
                                        )
                                    },
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = DarkGreen,
                                        contentColor = Color.White,
                                    ),
                                ) {
                                    Text("Продолжить")
                                }
                            }
                        }
                    }
                }
            }

            Text(
                "ЧТО ПРИНИМАЕМ",
                color = DarkGreen,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
            )

            displayOptions.chunked(2).forEach { rowItems ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    rowItems.forEach { option ->
                        SiteModuleCard(
                            label = option.title,
                            subtitle = if (option.enabled) option.subtitle else "Скоро",
                            imageRes = option.imageRes,
                            imageUrl = option.imageUrl,
                            modifier = Modifier.weight(1f),
                            enabled = option.enabled,
                            onClick = {
                                if (option.enabled) {
                                    navController.navigate(
                                        Screen.ReceivingCategory.createRoute(option.key),
                                    )
                                }
                            },
                        )
                    }
                    if (rowItems.size == 1) {
                        Spacer(modifier = Modifier.weight(1f))
                    }
                }
            }

            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFFF4F7F1)),
            ) {
                Row(
                    modifier = Modifier.padding(14.dp),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Default.Inventory, contentDescription = null, tint = DarkGreen)
                    Column {
                        Text("Сканируй код на экране приемки", fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 13.sp)
                        Text(
                            "После выбора «Стикеры» откройте товарную группу, затем создайте или продолжите документ",
                            color = Color(0xFF6B6B6B),
                            fontSize = 11.sp,
                            lineHeight = 15.sp,
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceivingCategoryGroupsScreen(navController: NavController, categoryKey: String) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val groupsVm: MaterialWarehouseGroupsViewModel = viewModel(factory = MaterialWarehouseGroupsViewModelFactory(app.repository))
    val categoriesVm: ReceivingCategoriesViewModel = viewModel(factory = ReceivingCategoriesViewModelFactory(app.repository))
    val groupsState by groupsVm.uiState.collectAsState()
    val categoriesState by categoriesVm.uiState.collectAsState()
    val category = ReceivingProductGroups.find(categoryKey)
        ?: categoriesState.displayOptions.firstOrNull { it.key == categoryKey.trim().lowercase() }?.let {
            ReceivingProductGroupOption(
                key = it.key,
                title = it.title,
                subtitle = it.subtitle,
                imageRes = it.imageRes,
                imageUrl = it.imageUrl,
                enabled = it.enabled,
            )
        }
    val categoryTitle = category?.title
        ?: categoriesState.categories.firstOrNull { it.code.equals(categoryKey, ignoreCase = true) }?.name
        ?: MaterialWarehouseGroups.titleFor(categoryKey)
    val scope = rememberCoroutineScope()
    var searchQuery by remember { mutableStateOf("") }
    val categoryLinks = categoriesState.categoryLinks

    val tiles = groupsState.groups
        .filter { ReceivingGroupMatcher.matchesReceivingCategory(categoryKey, it, categoryLinks) }
        .map { group ->
        val code = group.effectiveCode()
        ReceivingGroupTile(
            routeKey = MaterialWarehouseGroups.encodeRouteKey(code),
            title = group.displayName().ifBlank { MaterialWarehouseGroups.titleFor(code) },
            subtitle = "Выбрать",
            imageRes = MaterialWarehouseGroups.imageFor(code),
            imageUrl = group.imageUrl,
            enabled = true,
        )
    }
    val filteredTiles = remember(tiles, searchQuery) {
        val q = searchQuery.trim()
        if (q.isBlank()) tiles
        else tiles.filter {
            it.title.contains(q, ignoreCase = true) ||
                MaterialWarehouseGroups.decodeRouteKey(it.routeKey).contains(q, ignoreCase = true)
        }
    }

    LaunchedEffect(Unit) {
        groupsVm.refresh()
    }

    LaunchedEffect(categoryKey) {
        app.repository.setActiveReceivingCategory(categoryKey)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(categoryTitle, fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Выберите товарную группу", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
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
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text("Поиск группы…") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
            )
            Spacer(Modifier.height(10.dp))
            if (groupsState.loading && tiles.isEmpty()) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
                Spacer(Modifier.height(8.dp))
            }
            groupsState.error?.let { msg ->
                Text(msg, color = ErrorRed, fontSize = 12.sp, modifier = Modifier.padding(bottom = 8.dp))
            }
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(bottom = 12.dp),
            ) {
                if (filteredTiles.isEmpty() && !groupsState.loading) {
                    item(key = "empty") {
                        val kind = ReceivingGroupMatcher.categoryKind(categoryKey)
                        if (searchQuery.isBlank() &&
                            kind != ReceivingGroupMatcher.CategoryKind.BEVERAGES
                        ) {
                            val routeKey = MaterialWarehouseGroups.encodeRouteKey(categoryKey)
                            SiteModuleCard(
                                label = categoryTitle,
                                subtitle = "Продолжить",
                                imageRes = getDrawableSafely(
                                    category?.imageRes ?: ReceivingProductGroups.imageResFor(categoryKey),
                                ),
                                imageUrl = category?.imageUrl,
                                modifier = Modifier.fillMaxWidth(),
                                enabled = true,
                                onClick = {
                                    scope.launch {
                                        app.repository.setActiveReceivingCategory(categoryKey)
                                    }
                                    navController.navigate(
                                        Screen.ReceivingDocuments.createRoute(routeKey),
                                    )
                                },
                            )
                        } else {
                            Text(
                                if (searchQuery.isBlank()) "Нет товарных групп" else "Ничего не найдено",
                                color = Color(0xFF757575),
                                fontSize = 13.sp,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    }
                } else {
                    filteredTiles.chunked(2).forEach { rowItems ->
                        item(key = rowItems.joinToString("-") { it.routeKey }) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                            ) {
                                rowItems.forEach { tile ->
                                    SiteModuleCard(
                                        label = tile.title,
                                        subtitle = tile.subtitle,
                                        imageRes = getDrawableSafely(tile.imageRes),
                                        imageUrl = tile.imageUrl,
                                        modifier = Modifier.weight(1f),
                                        enabled = tile.enabled,
                                        onClick = {
                                            scope.launch {
                                                app.repository.setActiveReceivingCategory(categoryKey)
                                            }
                                            navController.navigate(
                                                Screen.ReceivingDocuments.createRoute(tile.routeKey),
                                            )
                                        },
                                    )
                                }
                                if (rowItems.size == 1) {
                                    Spacer(modifier = Modifier.weight(1f))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private data class ReceivingGroupTile(
    val routeKey: String,
    val title: String,
    val subtitle: String,
    val imageRes: Int,
    val imageUrl: String?,
    val enabled: Boolean,
)

private fun activeReceivingGroupRoute(productGroup: String?): String =
    MaterialWarehouseGroups.encodeRouteKey(productGroup?.takeIf { it.isNotBlank() } ?: ReceivingProductGroups.STICKERS)

@Composable
private fun ReceivingQuickAction(
    label: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    OutlinedCard(
        onClick = onClick,
        modifier = modifier,
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.outlinedCardColors(containerColor = Color(0xFFFAFCF8)),
    ) {
        Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(icon, contentDescription = null, tint = DarkGreen, modifier = Modifier.size(22.dp))
            Text(label, fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 14.sp)
            Text(subtitle, color = Color(0xFF757575), fontSize = 11.sp, maxLines = 1)
        }
    }
}
