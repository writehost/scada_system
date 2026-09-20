package com.scadatable.wms.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.ItemStockByLocationRow
import com.scadatable.wms.data.remote.LocationDetailResponse
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.*
import com.scadatable.wms.viewmodel.MaterialStockSort
import com.scadatable.wms.viewmodel.MaterialWarehouseStockViewModel
import com.scadatable.wms.viewmodel.MaterialWarehouseStockViewModelFactory
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import com.scadatable.wms.warehouse.WarehouseKind
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun MaterialWarehouseStockScreen(
    navController: NavController,
    warehouseKindRouteKey: String,
    productGroupRouteKey: String,
) {
    val kind = remember(warehouseKindRouteKey) { WarehouseKind.fromRouteKey(warehouseKindRouteKey) }
    val productGroup = remember(productGroupRouteKey) {
        MaterialWarehouseGroups.decodeRouteKey(productGroupRouteKey)
    }
    val groupTitle = remember(productGroup) { MaterialWarehouseGroups.titleFor(productGroup) }

    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val vm: MaterialWarehouseStockViewModel = viewModel(
        factory = MaterialWarehouseStockViewModelFactory(app.repository, kind, productGroup),
    )
    val state by vm.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val itemSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val locationSheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ScanConsumerEffect(ScanEvents.Consumer.WAREHOUSE)

    LaunchedEffect(Unit) {
        ScanEvents.barcodes.collect { raw ->
            if (!ScanEvents.isActive(ScanEvents.Consumer.WAREHOUSE)) return@collect
            vm.onScanOrSubmit(raw)
        }
    }

    LaunchedEffect(state.scanMessage) {
        val msg = state.scanMessage ?: return@LaunchedEffect
        snackbar.showSnackbar(msg)
        vm.clearScanMessage()
    }

    LaunchedEffect(state.locationError) {
        val msg = state.locationError ?: return@LaunchedEffect
        if (state.locationDetail == null && !state.locationLoading) {
            snackbar.showSnackbar(msg)
        }
    }

    LaunchedEffect(listState, state.displayedItems.size, state.nextCursor, state.loading, state.loadingMore) {
        snapshotFlow {
            val info = listState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            lastVisible >= info.totalItemsCount - 8
        }.collect { nearEnd ->
            if (nearEnd && state.nextCursor != null && !state.loading && !state.loadingMore) {
                vm.loadMore()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(groupTitle, fontWeight = FontWeight.Bold, color = DarkGreen, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(
                            "${state.displayedItems.size} поз. · ${formatWarehouseQty(state.totalAvailable)} шт",
                            fontSize = 11.sp,
                            color = Color(0xFF8A8A8A),
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
                    IconButton(onClick = { vm.refresh() }, enabled = !state.loading) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = DarkGreen)
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 4.dp)
                    .background(Color.White, RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = state.query,
                    onValueChange = { vm.onQueryChange(it) },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = Color(0xFF1A1A1A)),
                    cursorBrush = SolidColor(DarkGreen),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(
                        onSearch = { vm.onScanOrSubmit(state.query) },
                    ),
                    decorationBox = { inner ->
                        if (state.query.isEmpty()) {
                            Text("Поиск / скан GTIN или ячейки", color = Color(0xFFAAAAAA), fontSize = 14.sp)
                        }
                        inner()
                    },
                )
                if (state.query.isNotEmpty()) {
                    IconButton(onClick = { vm.clearQuery() }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.Clear, contentDescription = "Очистить", modifier = Modifier.size(16.dp))
                    }
                }
            }

            LazyRow(
                contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                item {
                    FilterChip(
                        selected = state.sort == MaterialStockSort.IN_STOCK_FIRST,
                        onClick = { vm.setSort(MaterialStockSort.IN_STOCK_FIRST) },
                        label = { Text("С остатком", fontSize = 12.sp) },
                    )
                }
                item {
                    FilterChip(
                        selected = state.sort == MaterialStockSort.NAME,
                        onClick = { vm.setSort(MaterialStockSort.NAME) },
                        label = { Text("По имени", fontSize = 12.sp) },
                    )
                }
                item {
                    FilterChip(
                        selected = state.sort == MaterialStockSort.QTY_DESC,
                        onClick = { vm.setSort(MaterialStockSort.QTY_DESC) },
                        label = { Text("По кол-ву", fontSize = 12.sp) },
                    )
                }
                item {
                    FilterChip(
                        selected = state.inStockOnly,
                        onClick = { vm.setInStockOnly(!state.inStockOnly) },
                        label = { Text("Только в наличии", fontSize = 12.sp) },
                    )
                }
            }

            if (state.loading) {
                LinearWavyProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = DarkGreen,
                    wavelength = 24.dp,
                    waveSpeed = 4.dp,
                    amplitude = 0.5f,
                )
            }

            state.error?.let {
                Text(it, color = ErrorRed, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }

            when {
                state.loading && state.displayedItems.isEmpty() -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularWavyProgressIndicator(
                            color = DarkGreen,
                            modifier = Modifier.size(24.dp),
                            wavelength = 20.dp,
                            waveSpeed = 4.dp,
                            amplitude = 0.5f,
                        )
                    }
                }
                !state.loading && state.displayedItems.isEmpty() -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            when {
                                state.inStockOnly -> "Нет позиций в наличии"
                                state.query.isNotBlank() -> "Ничего не найдено"
                                else -> "В группе нет материалов"
                            },
                            color = Color(0xFF9E9E9E),
                            fontSize = 14.sp,
                        )
                    }
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(state.displayedItems, key = { it.itemCode }) { item ->
                            MaterialWarehouseStockCard(
                                item = item,
                                onClick = { vm.openItem(item) },
                            )
                        }
                        if (state.loadingMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                                    CircularWavyProgressIndicator(
                                        color = DarkGreen,
                                        modifier = Modifier.size(18.dp),
                                        wavelength = 16.dp,
                                        waveSpeed = 3.dp,
                                        amplitude = 0.5f,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (state.selectedItem != null || state.itemDetailLoading) {
        ModalBottomSheet(
            onDismissRequest = { vm.closeItemSheet() },
            sheetState = itemSheetState,
            containerColor = Color.White,
        ) {
            ItemLocationsSheetContent(
                item = state.selectedItem,
                locations = state.itemLocations,
                loading = state.itemDetailLoading,
                error = state.itemDetailError,
                onRefresh = { state.selectedItem?.let { vm.openItem(it) } },
                onOpenLocation = { code ->
                    scope.launch { itemSheetState.hide() }
                    vm.openLocation(code)
                },
                onMove = { itemCode, fromLocation ->
                    scope.launch { itemSheetState.hide() }
                    vm.closeItemSheet()
                    navController.navigate(Screen.Movement.createRoute(itemCode, fromLocation))
                },
            )
        }
    }

    if (state.locationDetail != null || state.locationLoading) {
        ModalBottomSheet(
            onDismissRequest = { vm.closeLocationSheet() },
            sheetState = locationSheetState,
            containerColor = Color.White,
        ) {
            LocationContentsSheetContent(
                detail = state.locationDetail,
                loading = state.locationLoading,
                error = state.locationError,
                onMove = { itemCode, fromLocation ->
                    scope.launch { locationSheetState.hide() }
                    vm.closeLocationSheet()
                    navController.navigate(Screen.Movement.createRoute(itemCode, fromLocation))
                },
                onOpenItem = { itemCode ->
                    val hit = state.displayedItems.firstOrNull { it.itemCode == itemCode }
                        ?: state.items.firstOrNull { it.itemCode == itemCode }
                        ?: ItemRow(itemCode = itemCode, name = itemCode)
                    scope.launch { locationSheetState.hide() }
                    vm.closeLocationSheet()
                    vm.openItem(hit)
                },
            )
        }
    }
}

@Composable
private fun MaterialWarehouseStockCard(
    item: ItemRow,
    onClick: () -> Unit,
) {
    val gtin = remember(item.itemCode) { MaterialWarehouseStockViewModel.displayGtin(item.itemCode) }
    val hasStock = item.availableQty > 0
    val expiry = remember(item) { resolveItemExpiryDisplay(item) }
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    item.name,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFF1A1A1A),
                    lineHeight = 19.sp,
                )
                Text(
                    gtin,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 11.sp,
                    color = Color(0xFF888888),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (expiry != null) {
                    Text(
                        expiry.label,
                        fontSize = 12.sp,
                        fontWeight = if (expiry.emphasis) FontWeight.SemiBold else FontWeight.Normal,
                        color = expiry.color,
                        lineHeight = 15.sp,
                    )
                }
                if (item.reservedQty > 0) {
                    Text(
                        "резерв ${formatWarehouseQty(item.reservedQty)}",
                        fontSize = 11.sp,
                        color = Color(0xFF9E9E9E),
                    )
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    formatWarehouseQty(item.availableQty),
                    fontWeight = FontWeight.Bold,
                    fontSize = 20.sp,
                    color = if (hasStock) DarkGreen else Color(0xFFCFCFCF),
                )
                Text(
                    if (hasStock) "дост." else "нет",
                    fontSize = 10.sp,
                    color = Color(0xFF9E9E9E),
                )
            }
        }
    }
}

private data class ItemExpiryDisplay(
    val label: String,
    val color: Color,
    val emphasis: Boolean,
)

private fun resolveItemExpiryDisplay(item: ItemRow): ItemExpiryDisplay? {
    val iso = resolveNearestExpiryIso(item)
    if (iso == null) {
        if (!item.isPerishable) return null
        return ItemExpiryDisplay("срок: нет данных", Color(0xFF9E9E9E), false)
    }
    val dateStr = formatWarehouseDate(iso) ?: return ItemExpiryDisplay("срок: нет данных", Color(0xFF9E9E9E), false)
    val days = daysUntilDate(iso)
    return when {
        days == null -> ItemExpiryDisplay("годен до $dateStr", DarkGreen, false)
        days < 0 -> ItemExpiryDisplay("просрочено · $dateStr", Color(0xFFC62828), true)
        days == 0 -> ItemExpiryDisplay("сегодня · $dateStr", Color(0xFFE65100), true)
        else -> {
            val warn = item.expiryWarningDays?.let { days <= it } == true
            val color = when {
                warn -> Color(0xFFE65100)
                days <= 14 -> Color(0xFF1565C0)
                else -> Color(0xFF616161)
            }
            ItemExpiryDisplay("$days ${ruDaysWord(days)} · $dateStr", color, warn || days <= 14)
        }
    }
}

private fun resolveNearestExpiryIso(item: ItemRow): String? {
    item.nearestExpiryAt?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
    val manufactured = item.lotManufacturedAtMin?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val shelf = item.shelfLifeDays?.takeIf { it > 0 } ?: return null
    return runCatching {
        val baseDate = when {
            manufactured.length >= 10 && manufactured[4] == '-' ->
                java.time.LocalDate.parse(manufactured.take(10))
            else -> java.time.Instant.parse(manufactured)
                .atZone(java.time.ZoneId.of("Europe/Moscow"))
                .toLocalDate()
        }
        baseDate.plusDays(shelf.toLong()).toString() + "T00:00:00.000Z"
    }.getOrNull()
}

private fun formatWarehouseDate(iso: String): String? = runCatching {
    val trimmed = iso.trim()
    val m = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(trimmed)
    if (m != null) {
        val (_, y, mo, d) = m.groupValues
        return String.format(java.util.Locale("ru"), "%02d.%02d.%s", d.toInt(), mo.toInt(), y)
    }
    java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy")
        .withZone(java.time.ZoneId.of("Europe/Moscow"))
        .format(java.time.Instant.parse(trimmed))
}.getOrNull()

private fun daysUntilDate(iso: String): Int? = runCatching {
    val end = java.time.LocalDate.parse(iso.trim().take(10))
    val start = java.time.LocalDate.now(java.time.ZoneId.of("Europe/Moscow"))
    java.time.temporal.ChronoUnit.DAYS.between(start, end).toInt()
}.getOrNull()

private fun ruDaysWord(n: Int): String {
    val a = kotlin.math.abs(n) % 100
    val b = a % 10
    return when {
        a in 11..19 -> "дней"
        b == 1 -> "день"
        b in 2..4 -> "дня"
        else -> "дней"
    }
}

@Composable
private fun ItemLocationsSheetContent(
    item: ItemRow?,
    locations: List<ItemStockByLocationRow>,
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
    onOpenLocation: (String) -> Unit,
    onMove: (itemCode: String, fromLocation: String?) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            item?.name ?: "Материал",
            fontWeight = FontWeight.Bold,
            color = DarkGreen,
            fontSize = 18.sp,
            maxLines = 3,
        )
        if (item != null) {
            Text(
                MaterialWarehouseStockViewModel.displayGtin(item.itemCode),
                fontFamily = FontFamily.Monospace,
                color = Color(0xFF757575),
                fontSize = 12.sp,
            )
            Text(
                "Всего дост.: ${formatWarehouseQty(item.availableQty)}",
                fontWeight = FontWeight.SemiBold,
                color = DarkGreen,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = onRefresh, enabled = !loading) {
                Text("Обновить")
            }
            Button(
                onClick = { item?.let { onMove(it.itemCode, locations.firstOrNull()?.locationCode) } },
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                enabled = item != null,
            ) {
                Text("Переместить")
            }
        }
        if (loading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
        }
        error?.let { Text(it, color = ErrorRed, fontSize = 12.sp) }
        Text("Где лежит", fontWeight = FontWeight.SemiBold, color = DarkGreen)
        if (!loading && locations.isEmpty() && error == null) {
            Text("Нет остатков по ячейкам", color = Color.Gray, fontSize = 13.sp)
        }
        locations.forEach { row ->
            Card(
                onClick = { onOpenLocation(row.locationCode) },
                colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F7F5)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(row.locationCode, fontWeight = FontWeight.Bold, color = DarkGreen)
                        val wh = listOfNotNull(row.warehouseCode, row.zoneCode).joinToString(" · ")
                        if (wh.isNotBlank()) {
                            Text(wh, fontSize = 11.sp, color = Color(0xFF888888))
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(formatWarehouseQty(row.availableQty), fontWeight = FontWeight.Bold, color = DarkGreen)
                        TextButton(
                            onClick = { item?.let { onMove(it.itemCode, row.locationCode) } },
                            contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                        ) {
                            Text("Переместить", fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LocationContentsSheetContent(
    detail: LocationDetailResponse?,
    loading: Boolean,
    error: String?,
    onMove: (itemCode: String, fromLocation: String) -> Unit,
    onOpenItem: (itemCode: String) -> Unit,
) {
    val loc = detail?.location
    val code = loc?.locationCode.orEmpty()
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(bottom = 28.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            loc?.displayName?.takeIf { it.isNotBlank() } ?: code.ifBlank { "Ячейка" },
            fontWeight = FontWeight.Bold,
            color = DarkGreen,
            fontSize = 18.sp,
        )
        val meta = listOfNotNull(loc?.warehouseCode, loc?.zoneCode, code.takeIf { loc?.displayName != null }).joinToString(" · ")
        if (meta.isNotBlank()) {
            Text(meta, fontSize = 12.sp, color = Color(0xFF757575))
        }
        if (loading) {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
        }
        error?.let { Text(it, color = ErrorRed, fontSize = 12.sp) }
        Text("Содержимое", fontWeight = FontWeight.SemiBold, color = DarkGreen)
        val stock = detail?.stock.orEmpty()
        if (!loading && stock.isEmpty() && error == null) {
            Text("Ячейка пуста", color = Color.Gray, fontSize = 13.sp)
        }
        stock.forEach { line ->
            Card(
                onClick = { onOpenItem(line.itemCode) },
                colors = CardDefaults.cardColors(containerColor = Color(0xFFF5F7F5)),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            line.name ?: line.itemCode,
                            fontWeight = FontWeight.SemiBold,
                            color = DarkGreen,
                            lineHeight = 18.sp,
                        )
                        Text(line.itemCode, fontSize = 11.sp, color = Color(0xFF888888), fontFamily = FontFamily.Monospace)
                        line.nearestExpiryAt?.trim()?.takeIf { it.isNotEmpty() }?.let { exp ->
                            val dateStr = formatWarehouseDate(exp)
                            val days = daysUntilDate(exp)
                            val label = when {
                                dateStr == null -> null
                                days == null -> "годен до $dateStr"
                                days < 0 -> "просрочено · $dateStr"
                                days == 0 -> "сегодня · $dateStr"
                                else -> "$days ${ruDaysWord(days)} · $dateStr"
                            }
                            if (label != null) {
                                Text(
                                    label,
                                    fontSize = 11.sp,
                                    color = when {
                                        days != null && days < 0 -> Color(0xFFC62828)
                                        days != null && days <= 14 -> Color(0xFFE65100)
                                        else -> Color(0xFF616161)
                                    },
                                )
                            }
                        }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text(formatWarehouseQty(line.availableQty), fontWeight = FontWeight.Bold, color = DarkGreen)
                        if (code.isNotBlank()) {
                            TextButton(
                                onClick = { onMove(line.itemCode, code) },
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 0.dp),
                            ) {
                                Text("Переместить", fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
        }
    }
}

internal fun formatWarehouseQty(value: Double): String {
    if (value == value.toLong().toDouble()) return value.toLong().toString()
    return "%.1f".format(value).trimEnd('0').trimEnd('.')
}
