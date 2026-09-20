package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.TnvedNodeRow
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.print.LabelPrintService
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.receiving.ReceivingTnvedHints
import com.scadatable.wms.ui.components.LabelPreviewDialog
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.ReceivingViewModel
import com.scadatable.wms.viewmodel.ReceivingViewModelFactory
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import kotlinx.coroutines.launch

private enum class ManualStep { TNVED, ITEMS, QTY }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualReceivingScreen(
    navController: NavController,
    productGroup: String,
    docId: String,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val app = context.applicationContext as WmsApplication
    val db = remember { com.scadatable.wms.data.local.WmsDatabase.getDatabase(context) }
    val factory = remember { ReceivingViewModelFactory(db.wmsDao(), app.repository) }
    val sessionRoute = remember(productGroup, docId) {
        Screen.ReceivingSession.createRoute(productGroup, docId)
    }
    val sessionEntry = remember(sessionRoute) {
        runCatching { navController.getBackStackEntry(sessionRoute) }.getOrNull()
    }
    val viewModel: ReceivingViewModel = if (sessionEntry != null) {
        viewModel(sessionEntry, factory = factory)
    } else {
        viewModel(factory = factory)
    }
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var previewPayload by remember { mutableStateOf<ReceivingStickerPayload?>(null) }

    val decodedGroup = MaterialWarehouseGroups.decodeRouteKey(productGroup)
    val groupTitle = MaterialWarehouseGroups.titleFor(decodedGroup)

    var step by remember { mutableStateOf(ManualStep.TNVED) }
    var searchQuery by remember { mutableStateOf("") }
    var tnvedNodes by remember { mutableStateOf<List<TnvedNodeRow>>(emptyList()) }
    var tnvedLoading by remember { mutableStateOf(false) }
    var tnvedError by remember { mutableStateOf<String?>(null) }
    var tnvedParent by remember { mutableStateOf<String?>(null) }
    var selectedTnved by remember { mutableStateOf<TnvedNodeRow?>(null) }

    var items by remember { mutableStateOf<List<ItemRow>>(emptyList()) }
    var itemsLoading by remember { mutableStateOf(false) }
    var itemsError by remember { mutableStateOf<String?>(null) }
    var selectedItem by remember { mutableStateOf<ItemRow?>(null) }
    var qtyInput by remember { mutableStateOf("1") }
    var saving by remember { mutableStateOf(false) }

    val hintQueries = remember(groupTitle) { ReceivingTnvedHints.searchQueriesForGroup(groupTitle) }
    val stepLabel = when (step) {
        ManualStep.TNVED -> "1"
        ManualStep.ITEMS -> "2"
        ManualStep.QTY -> "3"
    }

    fun loadTnved(parent: String?, query: String?) {
        scope.launch {
            tnvedLoading = true
            tnvedError = null
            app.repository.fetchTnvedNodes(parent = parent, query = query)
                .onSuccess { tnvedNodes = it }
                .onFailure { tnvedError = it.message ?: "Ошибка загрузки ТН ВЭД" }
            tnvedLoading = false
        }
    }

    fun loadItemsForTnved(code: String) {
        scope.launch {
            itemsLoading = true
            itemsError = null
            val prefix = code.replace(Regex("\\D"), "")
            app.repository.fetchItemsPage(
                productGroup = decodedGroup.takeIf { !MaterialWarehouseGroups.isBareGroup(it) },
                tnvedPrefix = prefix,
                limit = 80,
            ).onSuccess { page ->
                items = page.items
                if (page.items.isEmpty()) {
                    itemsError = "Нет номенклатуры с ТН ВЭД $prefix. Создайте карточку в WMS с этим кодом."
                }
            }.onFailure { itemsError = it.message ?: "Ошибка загрузки номенклатуры" }
            itemsLoading = false
        }
    }

    LaunchedEffect(Unit) {
        viewModel.events.collect { text ->
            snackbarHostState.showSnackbar(text)
        }
    }
    LaunchedEffect(Unit) {
        viewModel.printSticker.collect { payload ->
            previewPayload = payload
        }
    }

    previewPayload?.let { payload ->
        LabelPreviewDialog(
            payload = payload,
            onDismiss = { previewPayload = null },
            onConfirmPrint = {
                scope.launch {
                    LabelPrintService.print(context, app.appPrefs, payload)
                    previewPayload = null
                }
            },
        )
    }

    LaunchedEffect(docId, decodedGroup) {
        loadTnved(parent = null, query = null)
    }

    LaunchedEffect(searchQuery) {
        val q = searchQuery.trim()
        if (q.length >= 2) {
            kotlinx.coroutines.delay(300)
            loadTnved(parent = null, query = q)
        } else if (q.isEmpty()) {
            loadTnved(parent = tnvedParent, query = null)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Приёмка без кода", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("$groupTitle · шаг $stepLabel", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = {
                        when (step) {
                            ManualStep.TNVED -> navController.popBackStack()
                            ManualStep.ITEMS -> step = ManualStep.TNVED
                            ManualStep.QTY -> step = ManualStep.ITEMS
                        }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            when (step) {
                ManualStep.TNVED -> {
                    Text(
                        "Выберите ТН ВЭД — по нему подберём номенклатуру",
                        color = Color(0xFF616161),
                        fontSize = 13.sp,
                        modifier = Modifier.padding(bottom = 8.dp),
                    )
                    OutlinedTextField(
                        value = searchQuery,
                        onValueChange = { searchQuery = it },
                        modifier = Modifier.fillMaxWidth(),
                        placeholder = { Text("Поиск: крышка, преформа, 3923…") },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                    )
                    if (hintQueries.isNotEmpty() && searchQuery.isBlank()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 8.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            hintQueries.take(4).forEach { hint ->
                                SuggestionChip(
                                    onClick = { searchQuery = hint },
                                    label = { Text(hint, fontSize = 11.sp) },
                                )
                            }
                        }
                    }
                    if (tnvedLoading) {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), color = DarkGreen)
                    }
                    tnvedError?.let { Text(it, color = Color(0xFFC62828), fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp)) }
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                        contentPadding = PaddingValues(top = 10.dp, bottom = 16.dp),
                    ) {
                        items(tnvedNodes, key = { "${it.code}-${it.level}" }) { node ->
                            val isLeaf = node.level == "position" || node.code.length >= 6
                            OutlinedCard(
                                onClick = {
                                    if (isLeaf || node.level == "position") {
                                        selectedTnved = node
                                        step = ManualStep.ITEMS
                                        loadItemsForTnved(node.code)
                                    } else {
                                        tnvedParent = node.code
                                        searchQuery = ""
                                        loadTnved(parent = node.code, query = null)
                                    }
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Row(
                                    Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            node.code,
                                            fontFamily = FontFamily.Monospace,
                                            fontWeight = FontWeight.Bold,
                                            color = DarkGreen,
                                            fontSize = 13.sp,
                                        )
                                        Text(node.name, fontSize = 12.sp, color = Color(0xFF424242), maxLines = 3)
                                    }
                                    if (!isLeaf && node.level != "position") {
                                        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color.Gray)
                                    }
                                }
                            }
                        }
                    }
                }
                ManualStep.ITEMS -> {
                    selectedTnved?.let { tnved ->
                        Surface(
                            shape = RoundedCornerShape(12.dp),
                            color = Color(0xFFE8F5E9),
                            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        ) {
                            Column(Modifier.padding(12.dp)) {
                                Text("ТН ВЭД ${tnved.code}", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 13.sp)
                                Text(tnved.name, fontSize = 11.sp, color = Color(0xFF616161), maxLines = 2)
                            }
                        }
                    }
                    if (itemsLoading) {
                        LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
                    }
                    itemsError?.let { Text(it, color = Color(0xFFC62828), fontSize = 12.sp) }
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(items, key = { it.itemCode }) { item ->
                            OutlinedCard(
                                onClick = {
                                    selectedItem = item
                                    qtyInput = "1"
                                    step = ManualStep.QTY
                                },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(item.name, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 14.sp)
                                    Text(item.itemCode, fontSize = 11.sp, color = Color.Gray)
                                }
                            }
                        }
                    }
                }
                ManualStep.QTY -> {
                    selectedItem?.let { item ->
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(bottom = 12.dp),
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                        ) {
                            Column(Modifier.padding(14.dp)) {
                                Text(item.name, fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
                                Text(item.itemCode, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color.Gray)
                                selectedTnved?.let {
                                    Text("ТН ВЭД ${it.code}", fontSize = 11.sp, color = Color(0xFF757575), modifier = Modifier.padding(top = 4.dp))
                                }
                            }
                        }
                        OutlinedTextField(
                            value = qtyInput,
                            onValueChange = { qtyInput = it.filter { ch -> ch.isDigit() || ch == '.' || ch == ',' }.take(12) },
                            label = { Text("Количество") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                        )
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = {
                                val qty = qtyInput.replace(',', '.').toDoubleOrNull()
                                if (qty == null || qty <= 0.0) {
                                    scope.launch { snackbarHostState.showSnackbar("Укажите количество") }
                                    return@Button
                                }
                                saving = true
                                viewModel.printManualReceivingSticker(
                                    itemCode = item.itemCode,
                                    itemName = item.name,
                                    quantity = qty,
                                ) {
                                    saving = false
                                    navController.popBackStack()
                                }
                            },
                            enabled = !saving,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Text(if (saving) "Печать…" else "Печать стикера", color = Color.White)
                        }
                        Text(
                            "Стикер напечатается с кодом STK. Наклейте на партию и отсканируйте его на экране приёмки.",
                            fontSize = 11.sp,
                            color = Color(0xFF9E9E9E),
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                }
            }
        }
    }
}
