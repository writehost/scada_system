package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.LocationRow
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.receiving.ReceivingGroupMatcher
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
import com.scadatable.wms.warehouse.WarehouseLabels
import kotlinx.coroutines.launch

private enum class WizardDocType(val title: String, val subtitle: String) {
    RECEIVING("Приёмка", "Принять на склад в ячейку"),
    MOVEMENT("Перемещение", "Между ячейками"),
    ISSUE("Выдача", "Со склада получателю"),
    WRITE_OFF("Списание", "Выдача со списанием"),
}

private enum class WizardStep {
    TYPE,
    WAREHOUSE,
    CATEGORY,
    PRODUCT_GROUP,
    LOCATION,
}

private data class WizardWarehouseOption(
    val code: String,
    val title: String,
    val subtitle: String,
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun DocumentWizardScreen(
    navController: NavController,
    presetType: String = "receiving",
) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val scope = rememberCoroutineScope()
    val categoriesVm: ReceivingCategoriesViewModel = viewModel(
        factory = ReceivingCategoriesViewModelFactory(app.repository),
    )
    val groupsVm: MaterialWarehouseGroupsViewModel = viewModel(
        factory = MaterialWarehouseGroupsViewModelFactory(app.repository),
    )
    val categoriesState by categoriesVm.uiState.collectAsState()
    val groupsState by groupsVm.uiState.collectAsState()

    var step by remember {
        mutableStateOf(
            if (presetType.equals("receiving", ignoreCase = true)) WizardStep.TYPE else WizardStep.TYPE,
        )
    }
    var docType by remember {
        mutableStateOf(
            when (presetType.trim().lowercase()) {
                "movement" -> WizardDocType.MOVEMENT
                "issue" -> WizardDocType.ISSUE
                "write_off", "writeoff" -> WizardDocType.WRITE_OFF
                else -> WizardDocType.RECEIVING
            },
        )
    }
    var warehouseCode by remember { mutableStateOf<String?>(null) }
    var categoryKey by remember { mutableStateOf<String?>(null) }
    var productGroup by remember { mutableStateOf<String?>(null) }
    var targetLocation by remember { mutableStateOf<LocationRow?>(null) }
    var warehouseOptions by remember { mutableStateOf<List<WizardWarehouseOption>>(emptyList()) }
    var locations by remember { mutableStateOf<List<LocationRow>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var createLocationOpen by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        groupsVm.refresh()
        categoriesVm.refresh()
    }

    fun loadWarehouses() {
        scope.launch {
            loading = true
            error = null
            val directory = app.repository.fetchWarehouseDirectory().getOrNull().orEmpty()
                .associateBy { it.code.trim() }
            app.repository.fetchLocations()
                .onSuccess { rows ->
                    locations = rows
                    val codes = rows.map { it.warehouseCode.trim() }
                        .filter { it.isNotEmpty() }
                        .distinct()
                        .sorted()
                    warehouseOptions = codes.map { code ->
                        val dir = directory.entries.firstOrNull { it.key.equals(code, ignoreCase = true) }?.value
                        WizardWarehouseOption(
                            code = code,
                            title = WarehouseLabels.titleFor(code, dir?.name, dir?.shortName),
                            subtitle = WarehouseLabels.subtitleFor(code, dir?.warehouseType),
                        )
                    }
                    loading = false
                }
                .onFailure {
                    error = it.message
                    loading = false
                }
        }
    }

    fun loadLocationsForWarehouse(code: String) {
        scope.launch {
            loading = true
            error = null
            app.repository.fetchLocations(warehouseCode = code)
                .onSuccess {
                    locations = it
                    loading = false
                }
                .onFailure {
                    error = it.message
                    loading = false
                }
        }
    }

    val stepTitle = when (step) {
        WizardStep.TYPE -> "Тип документа"
        WizardStep.WAREHOUSE -> "Склад приёмки"
        WizardStep.CATEGORY -> "Тип номенклатуры"
        WizardStep.PRODUCT_GROUP -> "Товарная группа"
        WizardStep.LOCATION -> "Ячейка приёмки"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Новый документ", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(stepTitle, fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(
                        onClick = {
                            when (step) {
                                WizardStep.TYPE -> navController.popBackStack()
                                WizardStep.WAREHOUSE -> step = WizardStep.TYPE
                                WizardStep.CATEGORY -> step = WizardStep.WAREHOUSE
                                WizardStep.PRODUCT_GROUP -> step = WizardStep.CATEGORY
                                WizardStep.LOCATION -> step = WizardStep.PRODUCT_GROUP
                            }
                        },
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            WizardProgress(step = step, receivingOnly = docType == WizardDocType.RECEIVING)
            error?.let { Text(it, color = ErrorRed, fontSize = 12.sp) }
            if (loading) {
                CircularProgressIndicator(color = DarkGreen, modifier = Modifier.size(28.dp))
            }

            when (step) {
                WizardStep.TYPE -> {
                    WizardDocType.entries.forEach { type ->
                        WizardChoiceCard(
                            title = type.title,
                            subtitle = type.subtitle,
                            selected = docType == type,
                            onClick = {
                                docType = type
                                when (type) {
                                    WizardDocType.RECEIVING -> {
                                        step = WizardStep.WAREHOUSE
                                        loadWarehouses()
                                    }
                                    WizardDocType.MOVEMENT -> {
                                        navController.navigate(Screen.Movement.createRoute()) {
                                            popUpTo(Screen.Receiving.route)
                                        }
                                    }
                                    WizardDocType.ISSUE, WizardDocType.WRITE_OFF -> {
                                        navController.navigate(Screen.Issue.route) {
                                            popUpTo(Screen.Receiving.route)
                                        }
                                    }
                                }
                            },
                        )
                    }
                }

                WizardStep.WAREHOUSE -> {
                    if (warehouseOptions.isEmpty() && !loading) {
                        Text("Склады не найдены. Обновите список локаций.", color = Color.Gray)
                        Button(onClick = { loadWarehouses() }, colors = ButtonDefaults.buttonColors(containerColor = DarkGreen)) {
                            Text("Обновить")
                        }
                    }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(warehouseOptions, key = { it.code }) { option ->
                            WizardChoiceCard(
                                title = option.title,
                                subtitle = option.subtitle,
                                selected = warehouseCode == option.code,
                                onClick = {
                                    warehouseCode = option.code
                                    targetLocation = null
                                    step = WizardStep.CATEGORY
                                    loadLocationsForWarehouse(option.code)
                                },
                            )
                        }
                    }
                }

                WizardStep.CATEGORY -> {
                    val options = categoriesState.displayOptions.ifEmpty { ReceivingProductGroups.options }
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(options, key = { it.key }) { opt ->
                            WizardChoiceCard(
                                title = opt.title,
                                subtitle = opt.subtitle,
                                selected = categoryKey == opt.key,
                                onClick = {
                                    categoryKey = opt.key
                                    productGroup = null
                                    scope.launch { app.repository.setActiveReceivingCategory(opt.key) }
                                    step = WizardStep.PRODUCT_GROUP
                                },
                            )
                        }
                    }
                }

                WizardStep.PRODUCT_GROUP -> {
                    val cat = categoryKey.orEmpty()
                    val links = categoriesState.categoryLinks
                    val tiles = groupsState.groups
                        .filter { ReceivingGroupMatcher.matchesReceivingCategory(cat, it, links) }
                    val categoryTitle = categoriesState.displayOptions
                        .firstOrNull { it.key.equals(cat, ignoreCase = true) }?.title
                        ?: ReceivingProductGroups.titleFor(cat)

                    if (tiles.isEmpty() && !groupsState.loading) {
                        WizardChoiceCard(
                            title = categoryTitle,
                            subtitle = "Продолжить · $cat",
                            selected = productGroup == cat,
                            onClick = {
                                productGroup = cat
                                step = WizardStep.LOCATION
                                warehouseCode?.let { loadLocationsForWarehouse(it) }
                            },
                        )
                    } else {
                        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(tiles, key = { it.effectiveCode() }) { group ->
                                val code = group.effectiveCode()
                                WizardChoiceCard(
                                    title = group.displayName().ifBlank { MaterialWarehouseGroups.titleFor(code) },
                                    subtitle = code,
                                    selected = productGroup == code,
                                    onClick = {
                                        productGroup = code
                                        step = WizardStep.LOCATION
                                        warehouseCode?.let { loadLocationsForWarehouse(it) }
                                    },
                                )
                            }
                        }
                    }
                }

                WizardStep.LOCATION -> {
                    val wh = warehouseCode.orEmpty()
                    val filtered = locations.filter {
                        wh.isBlank() || it.warehouseCode.equals(wh, ignoreCase = true)
                    }
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        OutlinedButton(onClick = { warehouseCode?.let { loadLocationsForWarehouse(it) } }) {
                            Text("Обновить")
                        }
                        OutlinedButton(onClick = { createLocationOpen = true }) {
                            Text("Создать ячейку")
                        }
                    }
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        if (filtered.isEmpty() && !loading) {
                            item {
                                Text("Нет ячеек на складе $wh", color = Color.Gray)
                            }
                        }
                        items(filtered, key = { it.locationCode }) { loc ->
                            WizardChoiceCard(
                                title = loc.displayName?.takeIf { it.isNotBlank() } ?: loc.locationCode,
                                subtitle = listOf(loc.locationCode, loc.zoneCode).filter { it.isNotBlank() }.joinToString(" · "),
                                selected = targetLocation?.locationCode == loc.locationCode,
                                onClick = { targetLocation = loc },
                            )
                        }
                    }
                    Button(
                        onClick = {
                            val group = productGroup?.trim().orEmpty()
                            val loc = targetLocation
                            val whCode = warehouseCode
                            if (group.isBlank() || loc == null || whCode.isNullOrBlank()) {
                                error = "Выберите группу и ячейку"
                                return@Button
                            }
                            scope.launch {
                                creating = true
                                error = null
                                runCatching {
                                    val newId = app.repository.startNewReceivingDocument(
                                        productGroup = group,
                                        warehouseId = whCode,
                                        targetLocationCode = loc.locationCode,
                                    )
                                    val groupRoute = MaterialWarehouseGroups.encodeRouteKey(group)
                                    navController.navigate(Screen.ReceivingSession.createRoute(groupRoute, newId)) {
                                        popUpTo(Screen.Receiving.route)
                                    }
                                }.onFailure {
                                    error = it.message ?: "Не удалось создать документ"
                                }
                                creating = false
                            }
                        },
                        enabled = !creating && targetLocation != null && !productGroup.isNullOrBlank(),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    ) {
                        Text(
                            if (creating) "Создаём…" else "Начать сканирование",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }

    if (createLocationOpen) {
        CreateLocationDialog(
            locations = locations,
            preferredWarehouse = warehouseCode,
            onDismiss = { createLocationOpen = false },
            onCreate = { warehouse, zone, locationCode, displayName ->
                scope.launch {
                    app.repository.createLocation(
                        warehouseCode = warehouse,
                        zoneCode = zone,
                        locationCode = locationCode,
                        displayName = displayName,
                    ).onSuccess { created ->
                        locations = (locations + created).distinctBy { it.locationCode }
                        targetLocation = created
                        warehouseCode = created.warehouseCode
                        createLocationOpen = false
                    }.onFailure {
                        error = it.message
                    }
                }
            },
        )
    }
}

@Composable
private fun WizardProgress(step: WizardStep, receivingOnly: Boolean) {
    val labels = if (receivingOnly) {
        listOf("Тип", "Склад", "Тип ном.", "Группа", "Ячейка")
    } else {
        listOf("Тип")
    }
    val index = when (step) {
        WizardStep.TYPE -> 0
        WizardStep.WAREHOUSE -> 1
        WizardStep.CATEGORY -> 2
        WizardStep.PRODUCT_GROUP -> 3
        WizardStep.LOCATION -> 4
    }
    LazyRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        contentPadding = PaddingValues(horizontal = 0.dp),
    ) {
        items(labels.size) { i ->
            val label = labels[i]
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = if (i <= index) Color(0xFFE8F5E9) else Color(0xFFF0F0F0),
            ) {
                Row(
                    Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                ) {
                    if (i <= index) {
                        Icon(Icons.Default.Check, null, modifier = Modifier.size(14.dp), tint = DarkGreen)
                    }
                    Text(
                        label,
                        fontSize = 11.sp,
                        color = DarkGreen,
                        maxLines = 1,
                        softWrap = false,
                    )
                }
            }
        }
    }
}

@Composable
private fun WizardChoiceCard(
    title: String,
    subtitle: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (selected) Color(0xFFE8F5E9) else Color.White,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
            Text(subtitle, color = Color(0xFF757575), fontSize = 12.sp)
        }
    }
}

@Composable
private fun CreateLocationDialog(
    locations: List<LocationRow>,
    preferredWarehouse: String?,
    onDismiss: () -> Unit,
    onCreate: (warehouseCode: String, zoneCode: String, locationCode: String, displayName: String) -> Unit,
) {
    val warehouseOptions = remember(locations, preferredWarehouse) {
        val fromLoc = locations.map { it.warehouseCode.trim() }.filter { it.isNotEmpty() }.distinct()
        if (preferredWarehouse.isNullOrBlank()) fromLoc else listOf(preferredWarehouse) + fromLoc.filter { !it.equals(preferredWarehouse, true) }
    }.distinct()
    var warehouse by remember(preferredWarehouse) {
        mutableStateOf(preferredWarehouse?.takeIf { it.isNotBlank() } ?: warehouseOptions.firstOrNull().orEmpty())
    }
    val zoneOptions = remember(locations, warehouse) {
        locations.filter { it.warehouseCode.equals(warehouse, ignoreCase = true) }
            .map { it.zoneCode.trim() }
            .filter { it.isNotEmpty() }
            .distinct()
            .ifEmpty { listOf("RECV") }
    }
    var zone by remember(zoneOptions) { mutableStateOf(zoneOptions.firstOrNull() ?: "RECV") }
    var locationCode by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Новая ячейка", fontWeight = FontWeight.Bold, color = DarkGreen) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = warehouse,
                    onValueChange = { warehouse = it },
                    label = { Text("Склад") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = zone,
                    onValueChange = { zone = it },
                    label = { Text("Зона") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = locationCode,
                    onValueChange = { locationCode = it.uppercase() },
                    label = { Text("Код ячейки") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = displayName,
                    onValueChange = { displayName = it },
                    label = { Text("Название (опц.)") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val code = locationCode.trim()
                    if (warehouse.isBlank() || zone.isBlank() || code.isBlank()) return@TextButton
                    onCreate(warehouse.trim(), zone.trim(), code, displayName.trim().ifBlank { code })
                },
            ) { Text("Создать") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена") }
        },
    )
}
