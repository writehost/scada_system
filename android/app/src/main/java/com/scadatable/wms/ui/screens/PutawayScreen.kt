package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.data.remote.LocationRow
import com.scadatable.wms.data.remote.ReceivingBatchLookupResponse
import com.scadatable.wms.data.remote.StorageRecommendRowDto
import com.scadatable.wms.data.remote.WmsHttpException
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import kotlinx.coroutines.launch

private fun placeErrorMessage(error: Throwable): String {
    val http = error as? WmsHttpException
    val base = error.message?.takeIf { it.isNotBlank() } ?: "Не удалось разместить партию"
    return when (http?.code) {
        "zone_forbidden" -> "Запрещена зона: $base"
        "home_bin_required" -> "Только home-bin: $base"
        else -> if (!http?.code.isNullOrBlank()) "${http!!.code}: $base" else base
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PutawayScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    ScanConsumerEffect(ScanEvents.Consumer.PUTAWAY)

    var batchInput by remember { mutableStateOf("") }
    var batchLookup by remember { mutableStateOf<ReceivingBatchLookupResponse?>(null) }
    var locations by remember { mutableStateOf<List<LocationRow>>(emptyList()) }
    var recommendations by remember { mutableStateOf<List<StorageRecommendRowDto>>(emptyList()) }
    var locationQuery by remember { mutableStateOf("") }
    var selectedLocation by remember { mutableStateOf<LocationRow?>(null) }
    var busy by remember { mutableStateOf(false) }
    var overrideDialogOpen by remember { mutableStateOf(false) }
    var overrideReason by remember { mutableStateOf("") }
    var pendingOverrideMessage by remember { mutableStateOf<String?>(null) }

    fun applyRecommendedLocation(rows: List<StorageRecommendRowDto>, locs: List<LocationRow>) {
        val top = rows.firstOrNull { !it.forbidden && !it.locationCode.isNullOrBlank() }
            ?: rows.firstOrNull { !it.locationCode.isNullOrBlank() }
        val code = top?.locationCode?.trim().orEmpty()
        if (code.isBlank()) return
        val match = locs.firstOrNull { it.locationCode.equals(code, ignoreCase = true) }
        if (match != null) {
            selectedLocation = match
            locationQuery = match.locationCode
        } else {
            locationQuery = code
            selectedLocation = LocationRow(
                locationCode = code,
                displayName = top?.displayName ?: code,
                warehouseCode = "",
                zoneCode = top?.zoneCode.orEmpty(),
                locationStatus = "ACTIVE",
            )
        }
    }

    fun runPlace(override: String? = null) {
        val batch = batchLookup?.batch?.batchCode ?: batchInput
        val target = selectedLocation ?: return
        val recommended = recommendations.firstOrNull { !it.forbidden && !it.locationCode.isNullOrBlank() }
            ?.locationCode
        scope.launch {
            busy = true
            app.repository.placeReceivingBatch(
                batch,
                target.locationCode,
                override,
                recommended,
            )
                .onSuccess { result ->
                    overrideDialogOpen = false
                    overrideReason = ""
                    pendingOverrideMessage = null
                    snackbar.showSnackbar(
                        if (result.alreadyPlaced) {
                            "Партия уже находится в ${result.targetLocationCode}"
                        } else {
                            "Размещено ${result.qty} шт · ${result.targetLocationCode}"
                        }
                    )
                    batchLookup = null
                    batchInput = ""
                    selectedLocation = null
                    locationQuery = ""
                    recommendations = emptyList()
                }
                .onFailure { error ->
                    val http = error as? WmsHttpException
                    val message = placeErrorMessage(error)
                    if (http?.status == 409 && http.code == "home_bin_required" && override.isNullOrBlank()) {
                        pendingOverrideMessage = message
                        overrideReason = ""
                        overrideDialogOpen = true
                    } else {
                        snackbar.showSnackbar(message)
                    }
                }
            busy = false
        }
    }

    fun loadBatch(raw: String) {
        val code = raw.trim()
        if (code.isBlank() || busy) return
        scope.launch {
            busy = true
            app.repository.lookupReceivingBatch(code).onSuccess { result ->
                batchInput = code
                batchLookup = result
                selectedLocation = null
                locationQuery = ""
                recommendations = emptyList()
                val locs = app.repository.fetchLocations().getOrDefault(emptyList())
                locations = locs
                val itemCode = result.batch?.itemCode.orEmpty()
                val qty = result.batch?.qty ?: 1.0
                app.repository.recommendReceivingStorageLocation(
                    itemCode = itemCode,
                    qty = qty,
                    preferReceiving = false,
                    batchCode = code,
                    lpnCode = code,
                ).onSuccess { rec ->
                    recommendations = rec.recommendations.filter { !it.locationCode.isNullOrBlank() }
                    applyRecommendedLocation(recommendations, locs)
                    snackbar.showSnackbar(
                        if (recommendations.isNotEmpty()) {
                            val best = recommendations.firstOrNull { !it.forbidden }
                                ?: recommendations.first()
                            "LPN/партия найдена. Рекомендуем ${best.locationCode}"
                        } else {
                            "LPN/партия найдена. Выберите ячейку."
                        }
                    )
                }.onFailure {
                    snackbar.showSnackbar("Партия найдена. Сканируйте или выберите ячейку.")
                }
            }.onFailure { error ->
                snackbar.showSnackbar(error.message ?: "Код LPN / партии не найден")
            }
            busy = false
        }
    }

    LaunchedEffect(Unit) {
        ScanEvents.barcodes.collect { raw ->
            if (!ScanEvents.isActive(ScanEvents.Consumer.PUTAWAY)) return@collect
            if (batchLookup == null) {
                loadBatch(raw)
            } else {
                val location = locations.firstOrNull {
                    it.locationCode.equals(raw.trim(), ignoreCase = true)
                }
                if (location != null) {
                    selectedLocation = location
                    locationQuery = location.locationCode
                    snackbar.showSnackbar("Ячейка ${location.locationCode} выбрана")
                } else {
                    snackbar.showSnackbar("Ячейка с кодом ${raw.trim()} не найдена")
                }
            }
        }
    }

    val filteredLocations = remember(locations, locationQuery) {
        val query = locationQuery.trim()
        if (query.isBlank()) locations.take(80) else locations.filter { location ->
            listOf(
                location.locationCode,
                location.displayName.orEmpty(),
                location.warehouseCode,
                location.zoneCode,
                location.virtualPath.orEmpty(),
                location.slotTitle.orEmpty(),
            ).any { it.contains(query, ignoreCase = true) }
        }.take(80)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Размещение", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("LPN / партия → ячейка", fontSize = 12.sp, color = Color.Gray)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).fillMaxSize().padding(horizontal = 14.dp),
            contentPadding = PaddingValues(top = 10.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(16.dp),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("1. Сканируйте LPN / код принятого объёма", fontWeight = FontWeight.Bold, color = DarkGreen)
                        OutlinedTextField(
                            value = batchInput,
                            onValueChange = { batchInput = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("LPN / STK / этикетка партии") },
                            singleLine = true,
                            enabled = batchLookup == null && !busy,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { loadBatch(batchInput) }),
                        )
                        if (batchLookup == null) {
                            Button(
                                onClick = { loadBatch(batchInput) },
                                modifier = Modifier.fillMaxWidth(),
                                enabled = batchInput.isNotBlank() && !busy,
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) {
                                Text(if (busy) "Проверяем…" else "Найти LPN / партию", color = Color.White)
                            }
                        } else {
                            BatchPutawayCard(batchLookup!!)
                            OutlinedButton(
                                onClick = {
                                    batchLookup = null
                                    batchInput = ""
                                    selectedLocation = null
                                    locationQuery = ""
                                    recommendations = emptyList()
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text("Сканировать другой код")
                            }
                        }
                    }
                }
            }

            if (batchLookup != null && recommendations.isNotEmpty()) {
                item {
                    Text("Рекомендуемые ячейки", fontWeight = FontWeight.Bold, color = DarkGreen)
                }
                items(recommendations.take(4), key = { it.locationCode + it.score }) { row ->
                    val code = row.locationCode.orEmpty()
                    val selected = selectedLocation?.locationCode.equals(code, ignoreCase = true)
                    OutlinedCard(
                        onClick = {
                            if (row.forbidden) {
                                scope.launch {
                                    snackbar.showSnackbar(
                                        row.reasons.firstOrNull()
                                            ?: "Ячейка запрещена политикой размещения"
                                    )
                                }
                            }
                            applyRecommendedLocation(listOf(row), locations)
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.outlinedCardColors(
                            containerColor = when {
                                row.forbidden -> Color(0xFFFFEBEE)
                                selected -> Color(0xFFE8F5E9)
                                else -> Color.White
                            },
                        ),
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                buildString {
                                    append(row.displayName ?: code)
                                    append(" · score ${row.score.toInt()}")
                                    if (row.forbidden) append(" · ЗАПРЕЩЕНО")
                                },
                                fontWeight = FontWeight.SemiBold,
                                color = if (row.forbidden) Color(0xFFB71C1C) else DarkGreen,
                            )
                            Text(code, fontSize = 12.sp, color = Color.Gray)
                            row.reasons.take(2).forEach { reason ->
                                Text(reason, fontSize = 11.sp, color = Color(0xFF616161))
                            }
                        }
                    }
                }
            }

            if (batchLookup != null) {
                item {
                    Text("2. Сканируйте или выберите ячейку", fontWeight = FontWeight.Bold, color = DarkGreen)
                    OutlinedTextField(
                        value = locationQuery,
                        onValueChange = {
                            locationQuery = it
                            selectedLocation = locations.firstOrNull { row ->
                                row.locationCode.equals(it.trim(), ignoreCase = true)
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Код, название, стеллаж или полка") },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        singleLine = true,
                    )
                }
                items(filteredLocations, key = { it.locationCode }) { location ->
                    val selected = selectedLocation?.locationCode == location.locationCode
                    OutlinedCard(
                        onClick = {
                            selectedLocation = location
                            locationQuery = location.locationCode
                        },
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.outlinedCardColors(
                            containerColor = if (selected) Color(0xFFE8F5E9) else Color.White,
                        ),
                    ) {
                        Row(
                            Modifier.fillMaxWidth().padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(Icons.Default.LocationOn, contentDescription = null, tint = DarkGreen)
                            Column(Modifier.weight(1f)) {
                                Text(
                                    location.displayName ?: location.locationCode,
                                    fontWeight = FontWeight.SemiBold,
                                    color = DarkGreen,
                                )
                                Text(
                                    location.virtualPath?.takeIf { it.isNotBlank() }
                                        ?: location.slotTitle?.takeIf { it.isNotBlank() && it != "—" }
                                        ?: "Обычная ячейка, без привязки к стеллажу",
                                    fontSize = 11.sp,
                                    color = Color(0xFF6B6B6B),
                                )
                                Text(
                                    "${location.locationCode} · ${location.warehouseCode} / ${location.zoneCode}",
                                    fontSize = 10.sp,
                                    color = Color.Gray,
                                )
                            }
                        }
                    }
                }
                item {
                    Button(
                        onClick = { runPlace() },
                        enabled = selectedLocation != null && !busy,
                        modifier = Modifier.fillMaxWidth().height(54.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(if (busy) "Размещаем…" else "Разместить весь объём", color = Color.White, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }

        if (overrideDialogOpen) {
            AlertDialog(
                onDismissRequest = {
                    if (!busy) {
                        overrideDialogOpen = false
                        pendingOverrideMessage = null
                    }
                },
                title = { Text("Только домашняя ячейка") },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            pendingOverrideMessage
                                ?: "Политика требует home-bin. Укажите причину, чтобы разместить в выбранную ячейку.",
                        )
                        OutlinedTextField(
                            value = overrideReason,
                            onValueChange = { overrideReason = it },
                            modifier = Modifier.fillMaxWidth(),
                            label = { Text("Причина override") },
                            singleLine = false,
                            minLines = 2,
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            val reason = overrideReason.trim()
                            if (reason.isBlank()) {
                                scope.launch {
                                    snackbar.showSnackbar("Укажите причину override")
                                }
                                return@TextButton
                            }
                            runPlace(reason)
                        },
                        enabled = !busy,
                    ) {
                        Text("Разместить с override")
                    }
                },
                dismissButton = {
                    TextButton(
                        onClick = {
                            overrideDialogOpen = false
                            pendingOverrideMessage = null
                            overrideReason = ""
                        },
                        enabled = !busy,
                    ) {
                        Text("Отмена")
                    }
                },
            )
        }
    }
}

@Composable
private fun BatchPutawayCard(lookup: ReceivingBatchLookupResponse) {
    val batch = lookup.batch
    Surface(shape = RoundedCornerShape(12.dp), color = Color(0xFFF2F7ED)) {
        Row(
            Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Inventory2, contentDescription = null, tint = DarkGreen)
            Column {
                Text(
                    batch?.itemName ?: batch?.itemCode ?: "LPN / партия",
                    fontWeight = FontWeight.Bold,
                    color = DarkGreen,
                )
                Text(
                    "LPN ${batch?.batchCode ?: "—"} · ${batch?.qty ?: "?"} шт",
                    fontSize = 12.sp,
                    color = Color(0xFF616161),
                )
            }
        }
    }
}
