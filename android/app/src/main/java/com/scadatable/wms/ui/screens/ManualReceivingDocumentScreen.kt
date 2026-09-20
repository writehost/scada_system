package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.LocationRow
import com.scadatable.wms.data.remote.ManualReceivingDocumentLineRequest
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

private data class ManualDocLine(
    val key: String,
    val itemCode: String,
    val itemName: String,
    val qty: Double,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualReceivingDocumentScreen(
    navController: NavController,
    productGroup: String,
) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    val decodedGroup = remember(productGroup) { MaterialWarehouseGroups.decodeRouteKey(productGroup) }
    val groupTitle = remember(decodedGroup) { MaterialWarehouseGroups.titleFor(decodedGroup) }

    var items by remember { mutableStateOf<List<ItemRow>>(emptyList()) }
    var itemsLoading by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var selectedItem by remember { mutableStateOf<ItemRow?>(null) }
    var qtyInput by remember { mutableStateOf("1") }
    var comment by remember { mutableStateOf("") }
    var lines by remember { mutableStateOf<List<ManualDocLine>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var createdDocId by remember { mutableStateOf<String?>(null) }

    var targetLocation by remember { mutableStateOf("") }
    var locations by remember { mutableStateOf<List<LocationRow>>(emptyList()) }
    var locationsLoading by remember { mutableStateOf(false) }
    var locationPickerOpen by remember { mutableStateOf(false) }
    var createLocationOpen by remember { mutableStateOf(false) }

    fun loadItems(query: String? = null) {
        scope.launch {
            itemsLoading = true
            val names = buildList {
                if (!MaterialWarehouseGroups.isBareGroup(decodedGroup)) {
                    add(decodedGroup)
                    if (groupTitle != decodedGroup) add(groupTitle)
                }
            }.distinct()
            val res = if (query != null && query.length >= 2) {
                app.repository.fetchItemsPage(query = query, limit = 80)
            } else if (names.isEmpty()) {
                app.repository.fetchItemsPage(limit = 80, bareProductGroup = true)
            } else {
                app.repository.fetchItemsPage(productGroups = names, limit = 120)
            }
            items = res.getOrNull()?.items.orEmpty()
            itemsLoading = false
        }
    }

    fun loadLocations(selectCode: String? = null) {
        scope.launch {
            locationsLoading = true
            app.repository.fetchLocations().onSuccess { loaded ->
                locations = loaded
                val requested = selectCode?.trim().orEmpty()
                if (requested.isNotEmpty() && loaded.any { it.locationCode == requested }) {
                    targetLocation = requested
                } else if (targetLocation.isBlank() && loaded.size == 1) {
                    targetLocation = loaded.first().locationCode
                }
            }.onFailure { err ->
                snackbarHostState.showSnackbar(err.message ?: "Не удалось загрузить ячейки")
            }
            locationsLoading = false
        }
    }

    LaunchedEffect(decodedGroup) {
        targetLocation = app.repository.getReceivingTargetLocationCode().orEmpty()
        loadItems()
        loadLocations(targetLocation)
    }

    LaunchedEffect(searchQuery) {
        val q = searchQuery.trim()
        if (q.length >= 2) {
            kotlinx.coroutines.delay(300)
            loadItems(q)
        } else if (q.isEmpty()) {
            loadItems()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Ручной документ", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("$groupTitle · без скана", fontSize = 12.sp, color = Color(0xFF6B6B6B))
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
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
        ) {
            item {
                val selectedLocation = locations.firstOrNull { it.locationCode == targetLocation }
                OutlinedCard(
                    onClick = { locationPickerOpen = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Default.LocationOn, contentDescription = null, tint = DarkGreen)
                        Column(Modifier.weight(1f)) {
                            Text(
                                selectedLocation?.displayName ?: targetLocation.ifBlank { "Выберите ячейку приёмки" },
                                fontWeight = FontWeight.SemiBold,
                                color = DarkGreen,
                            )
                            Text(
                                selectedLocation?.let {
                                    "${it.locationCode} · ${it.warehouseCode} / ${it.zoneCode}"
                                } ?: "Поиск по названию, коду, складу или зоне",
                                fontSize = 11.sp,
                                color = Color.Gray,
                            )
                        }
                        if (locationsLoading) {
                            CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.dp)
                        } else {
                            Text("Выбрать", color = DarkGreen, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Поиск: название, артикул") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                )
            }
            item {
                Text(
                    "Номенклатура · ${items.size} поз.",
                    fontWeight = FontWeight.SemiBold,
                    color = DarkGreen,
                    fontSize = 14.sp,
                )
                if (itemsLoading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 6.dp), color = DarkGreen)
                } else if (items.isEmpty()) {
                    Text(
                        "В группе пусто. Укажите «Группа товаров» в карточке WMS или найдите по поиску.",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
            items(items.take(60), key = { it.itemCode }) { item ->
                val selected = selectedItem?.itemCode == item.itemCode
                OutlinedCard(
                    onClick = {
                        selectedItem = item
                        qtyInput = "1"
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.outlinedCardColors(
                        containerColor = if (selected) Color(0xFFE8F5E9) else Color.White,
                    ),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(item.name, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 14.sp)
                        Text(item.itemCode, fontSize = 11.sp, color = Color.Gray)
                    }
                }
            }
            item {
                selectedItem?.let { item ->
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                    ) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Позиция: ${item.name}", fontWeight = FontWeight.Bold, color = DarkGreen)
                            OutlinedTextField(
                                value = qtyInput,
                                onValueChange = { qtyInput = it.filter { ch -> ch.isDigit() || ch == '.' || ch == ',' }.take(12) },
                                label = { Text("Количество") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Button(
                                onClick = {
                                    val qty = qtyInput.replace(',', '.').toDoubleOrNull()
                                    if (qty == null || qty <= 0.0) {
                                        scope.launch { snackbarHostState.showSnackbar("Укажите количество") }
                                        return@Button
                                    }
                                    lines = lines + ManualDocLine(
                                        key = "${System.currentTimeMillis()}-${item.itemCode}",
                                        itemCode = item.itemCode,
                                        itemName = item.name,
                                        qty = qty,
                                    )
                                    selectedItem = null
                                    qtyInput = "1"
                                },
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) {
                                Text("Добавить строку", color = Color.White)
                            }
                        }
                    }
                }
            }
            if (lines.isNotEmpty()) {
                item {
                    Text(
                        "Строки документа · ${lines.size}",
                        fontWeight = FontWeight.Bold,
                        color = DarkGreen,
                        fontSize = 14.sp,
                    )
                }
                items(lines, key = { it.key }) { line ->
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(line.itemName, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                Text("${line.qty} шт · ${line.itemCode}", fontSize = 11.sp, color = Color.Gray)
                            }
                            IconButton(onClick = { lines = lines.filter { it.key != line.key } }) {
                                Icon(Icons.Default.Delete, contentDescription = "Удалить", tint = Color(0xFFC62828))
                            }
                        }
                    }
                }
            }
            item {
                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    label = { Text("Комментарий") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    shape = RoundedCornerShape(14.dp),
                )
            }
            item {
                Button(
                    onClick = {
                        val loc = targetLocation.trim()
                        if (loc.isBlank()) {
                            scope.launch { snackbarHostState.showSnackbar("Укажите ячейку приёмки") }
                            return@Button
                        }
                        if (lines.isEmpty()) {
                            scope.launch { snackbarHostState.showSnackbar("Добавьте хотя бы одну строку") }
                            return@Button
                        }
                        saving = true
                        scope.launch {
                            val day = DateTimeFormatter.ofPattern("yyyyMMdd").format(Instant.now().atZone(java.time.ZoneOffset.UTC))
                            val reqLines = lines.map { line ->
                                ManualReceivingDocumentLineRequest(
                                    itemCode = line.itemCode,
                                    qty = line.qty,
                                    batchLabel = "RCV-$day-${line.itemCode.take(20)}",
                                    comment = "Без кода · ТСД",
                                )
                            }
                            app.repository.postManualReceivingDocument(
                                targetLocationCode = loc,
                                groupCode = decodedGroup.takeIf { !MaterialWarehouseGroups.isBareGroup(it) },
                                groupName = groupTitle,
                                comment = comment.trim().ifBlank { null },
                                lines = reqLines,
                            ).onSuccess { res ->
                                createdDocId = res.documentId
                                lines = emptyList()
                                snackbarHostState.showSnackbar("Документ ${res.documentId} проведён · ${res.totalQty} шт")
                            }.onFailure { err ->
                                snackbarHostState.showSnackbar(err.message ?: "Ошибка создания документа")
                            }
                            saving = false
                        }
                    },
                    enabled = !saving && lines.isNotEmpty(),
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Text(if (saving) "Создаём…" else "Создать и провести", color = Color.White, fontWeight = FontWeight.Bold)
                }
            }
            createdDocId?.let { docId ->
                item {
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = Color(0xFFE8F5E9),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(
                            "Создан документ $docId",
                            modifier = Modifier.padding(12.dp),
                            color = DarkGreen,
                            fontSize = 13.sp,
                        )
                    }
                }
            }
        }
    }

    if (locationPickerOpen) {
        LocationPickerDialog(
            locations = locations,
            selectedCode = targetLocation,
            loading = locationsLoading,
            onDismiss = { locationPickerOpen = false },
            onRefresh = { loadLocations() },
            onCreate = {
                locationPickerOpen = false
                createLocationOpen = true
            },
            onSelect = {
                targetLocation = it.locationCode
                locationPickerOpen = false
            },
        )
    }

    if (createLocationOpen) {
        CreateLocationDialog(
            locations = locations,
            onDismiss = { createLocationOpen = false },
            onCreate = { warehouseCode, zoneCode, locationCode, displayName ->
                scope.launch {
                    app.repository.createLocation(
                        warehouseCode = warehouseCode,
                        zoneCode = zoneCode,
                        locationCode = locationCode,
                        displayName = displayName,
                    ).onSuccess { created ->
                        locations = (locations + created).distinctBy { it.locationCode }
                        targetLocation = created.locationCode
                        createLocationOpen = false
                        snackbarHostState.showSnackbar("Ячейка ${created.locationCode} создана и выбрана")
                    }.onFailure { err ->
                        snackbarHostState.showSnackbar(err.message ?: "Не удалось создать ячейку")
                    }
                }
            },
        )
    }
}

@Composable
private fun LocationPickerDialog(
    locations: List<LocationRow>,
    selectedCode: String,
    loading: Boolean,
    onDismiss: () -> Unit,
    onRefresh: () -> Unit,
    onCreate: () -> Unit,
    onSelect: (LocationRow) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    val cleanQuery = query.trim()
    val filtered = remember(locations, cleanQuery) {
        if (cleanQuery.isBlank()) locations else locations.filter {
            listOf(it.locationCode, it.displayName.orEmpty(), it.warehouseCode, it.zoneCode)
                .any { value -> value.contains(cleanQuery, ignoreCase = true) }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Ячейка приёмки", color = DarkGreen, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Код, название, склад или зона") },
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    singleLine = true,
                )
                if (loading) {
                    LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
                }
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    items(filtered, key = { it.locationCode }) { location ->
                        OutlinedCard(
                            onClick = { onSelect(location) },
                            colors = CardDefaults.outlinedCardColors(
                                containerColor = if (location.locationCode == selectedCode) {
                                    Color(0xFFE8F5E9)
                                } else {
                                    Color.White
                                },
                            ),
                        ) {
                            Column(Modifier.fillMaxWidth().padding(10.dp)) {
                                Text(
                                    location.displayName ?: location.locationCode,
                                    fontWeight = FontWeight.SemiBold,
                                    color = DarkGreen,
                                )
                                Text(
                                    "${location.locationCode} · ${location.warehouseCode} / ${location.zoneCode}",
                                    fontSize = 11.sp,
                                    color = Color.Gray,
                                )
                            }
                        }
                    }
                    if (!loading && filtered.isEmpty()) {
                        item {
                            Text(
                                "Подходящих ячеек нет. Создайте новую.",
                                modifier = Modifier.padding(vertical = 12.dp),
                                color = Color.Gray,
                            )
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onCreate) {
                Icon(Icons.Default.Add, contentDescription = null)
                Spacer(Modifier.width(4.dp))
                Text("Создать ячейку")
            }
        },
        dismissButton = {
            TextButton(onClick = if (locations.isEmpty()) onRefresh else onDismiss) {
                Text(if (locations.isEmpty()) "Обновить" else "Закрыть")
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateLocationDialog(
    locations: List<LocationRow>,
    onDismiss: () -> Unit,
    onCreate: (warehouseCode: String, zoneCode: String, locationCode: String, displayName: String) -> Unit,
) {
    val placements = remember(locations) {
        locations.map { it.warehouseCode to it.zoneCode }.distinct().sortedWith(
            compareBy<Pair<String, String>> { it.first }.thenBy { it.second }
        )
    }
    var placement by remember(placements) { mutableStateOf(placements.firstOrNull()) }
    var placementExpanded by remember { mutableStateOf(false) }
    var locationCode by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var submitted by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Новая ячейка", color = DarkGreen, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (placements.isEmpty()) {
                    Text(
                        "Сначала создайте склад и зону в веб-интерфейсе. Без них ячейку нельзя корректно привязать.",
                        color = Color(0xFFC62828),
                    )
                } else {
                    ExposedDropdownMenuBox(
                        expanded = placementExpanded,
                        onExpandedChange = { placementExpanded = !placementExpanded },
                    ) {
                        OutlinedTextField(
                            value = placement?.let { "${it.first} / ${it.second}" }.orEmpty(),
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("Склад / зона") },
                            trailingIcon = {
                                ExposedDropdownMenuDefaults.TrailingIcon(expanded = placementExpanded)
                            },
                            modifier = Modifier.fillMaxWidth().menuAnchor(),
                        )
                        ExposedDropdownMenu(
                            expanded = placementExpanded,
                            onDismissRequest = { placementExpanded = false },
                        ) {
                            placements.forEach { option ->
                                DropdownMenuItem(
                                    text = { Text("${option.first} / ${option.second}") },
                                    onClick = {
                                        placement = option
                                        placementExpanded = false
                                    },
                                )
                            }
                        }
                    }
                    OutlinedTextField(
                        value = locationCode,
                        onValueChange = {
                            locationCode = it.uppercase().filter { ch ->
                                ch.isLetterOrDigit() || ch in "._/-"
                            }.take(120)
                        },
                        label = { Text("Код ячейки") },
                        supportingText = { Text("Например: RECV-RACK-01-SHELF-02") },
                        isError = submitted && locationCode.isBlank(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = displayName,
                        onValueChange = { displayName = it.take(160) },
                        label = { Text("Понятное название") },
                        supportingText = { Text("Например: Приёмка · стеллаж 1 · полка 2") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    submitted = true
                    val selected = placement ?: return@Button
                    if (locationCode.isBlank()) return@Button
                    onCreate(selected.first, selected.second, locationCode, displayName)
                },
                enabled = placements.isNotEmpty(),
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
            ) {
                Text("Создать", color = Color.White)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена") }
        },
    )
}
