package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.IssueUiState
import com.scadatable.wms.viewmodel.IssueViewModel
import com.scadatable.wms.viewmodel.IssueViewModelFactory
import com.scadatable.wms.viewmodel.ReceivingCategoriesViewModel
import com.scadatable.wms.viewmodel.ReceivingCategoriesViewModelFactory
import com.scadatable.wms.viewmodel.TasksViewModel
import com.scadatable.wms.viewmodel.TasksViewModelFactory
import com.scadatable.wms.warehouse.MaterialWarehouseGroups

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun IssueGroupPickerScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val categoriesVm: ReceivingCategoriesViewModel = viewModel(
        factory = ReceivingCategoriesViewModelFactory(app.repository),
    )
    val categoriesState by categoriesVm.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Выдача", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Выберите группу товаров", fontSize = 12.sp, color = Color(0xFF6B6B6B))
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
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("ЧТО ВЫДАЁМ", color = DarkGreen, fontWeight = FontWeight.Bold, fontSize = 14.sp)
            if (categoriesState.loading && categoriesState.displayOptions.isEmpty()) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
            }
            categoriesState.error?.let { msg ->
                Text(msg, color = Color(0xFFC62828), fontSize = 12.sp)
            }
            val tiles = categoriesState.displayOptions.map { option ->
                IssueGroupTile(
                    routeKey = MaterialWarehouseGroups.encodeRouteKey(option.key),
                    title = option.title,
                    subtitle = option.subtitle.ifBlank { option.key },
                    imageRes = option.imageRes,
                    imageUrl = option.imageUrl,
                    enabled = option.enabled,
                )
            }.ifEmpty {
                ReceivingProductGroups.options.map { option ->
                    IssueGroupTile(
                        routeKey = MaterialWarehouseGroups.encodeRouteKey(option.key),
                        title = option.title,
                        subtitle = option.subtitle,
                        imageRes = option.imageRes,
                        imageUrl = null,
                        enabled = option.enabled,
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
                            subtitle = if (tile.enabled) tile.subtitle else "Скоро",
                            imageRes = getDrawableSafely(tile.imageRes),
                            imageUrl = tile.imageUrl,
                            modifier = Modifier.weight(1f),
                            enabled = tile.enabled,
                            onClick = {
                                navController.navigate(Screen.IssueManual.createRoute(tile.routeKey))
                            },
                        )
                    }
                    if (rowItems.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

private data class IssueGroupTile(
    val routeKey: String,
    val title: String,
    val subtitle: String,
    val imageRes: Int,
    val imageUrl: String?,
    val enabled: Boolean,
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun IssueManualScreen(navController: NavController, productGroup: String) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val decodedProductGroup = remember(productGroup) { MaterialWarehouseGroups.decodeRouteKey(productGroup) }
    val groupTitle = MaterialWarehouseGroups.titleFor(decodedProductGroup)
    val viewModel: IssueViewModel = viewModel(factory = IssueViewModelFactory(app.repository))
    val tasksVm: TasksViewModel = viewModel(factory = TasksViewModelFactory(app.repository))
    ScanConsumerEffect(ScanEvents.Consumer.ISSUE)
    val uiState by viewModel.uiState.collectAsState()
    val recipients by viewModel.recipients.collectAsState()
    val groupItems by viewModel.items.collectAsState()
    val groupItemsLoading by viewModel.itemsLoading.collectAsState()
    val groupItemsError by viewModel.itemsError.collectAsState()
    val pickList by viewModel.pickList.collectAsState()
    val pickListLoading by viewModel.pickListLoading.collectAsState()
    val pickListError by viewModel.pickListError.collectAsState()
    val tasks by tasksVm.tasks.collectAsState()
    val issueTasks = tasks.filter {
        it.taskType.contains("issue", true) ||
            it.taskType.contains("pick", true) ||
            it.taskType.contains("ship", true)
    }

    var barcodeInput by remember { mutableStateOf("") }
    var planCodeInput by remember { mutableStateOf("") }
    var qtyInput by remember { mutableStateOf("1") }
    var locationInput by remember { mutableStateOf("") }
    var recipientExpanded by remember { mutableStateOf(false) }
    var selectedRecipient by remember { mutableStateOf<String?>(null) }
    var manualRecipient by remember { mutableStateOf("") }
    var showTasks by remember { mutableStateOf(false) }

    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    val qtyFocusRequester = remember { FocusRequester() }
    val snackbarHostState = remember { SnackbarHostState() }

    val isConfirming = uiState is IssueUiState.ConfirmIssue ||
        uiState is IssueUiState.Loading ||
        uiState is IssueUiState.Submitting ||
        uiState is IssueUiState.Error
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(Unit) {
        tasksVm.refresh()
        val fallback = runCatching {
            context.assets.open("wms-users.json").bufferedReader().use { it.readText() }
        }.getOrNull()
        viewModel.loadRecipients(fallback)
        viewModel.loadItems(decodedProductGroup)
        locationInput = app.repository.getReceivingTargetLocationCode().orEmpty()
    }

    LaunchedEffect(Unit) {
        viewModel.events.collect { text -> snackbarHostState.showSnackbar(text) }
    }

    LaunchedEffect(isConfirming) {
        if (isConfirming) sheetState.show()
        else if (sheetState.isVisible) sheetState.hide()
    }

    LaunchedEffect(uiState) {
        when (val state = uiState) {
            is IssueUiState.ConfirmIssue -> {
                qtyInput = state.prefilledQty.let {
                    if (it % 1.0 == 0.0) it.toLong().toString() else it.toString()
                }
                locationInput = state.sourceLocationCode.ifBlank { locationInput }
                selectedRecipient = null
                manualRecipient = ""
                qtyFocusRequester.requestFocus()
            }
            is IssueUiState.Idle -> {
                selectedRecipient = null
                manualRecipient = ""
            }
            else -> Unit
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Выдача · $groupTitle", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Скан STK/SKU → FEFO → в цех", fontSize = 12.sp, color = Color(0xFF6B6B6B))
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
                .padding(horizontal = 16.dp)
                .fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(vertical = 16.dp),
        ) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = !showTasks,
                        onClick = { showTasks = false },
                        label = { Text("Свободная") },
                    )
                    FilterChip(
                        selected = showTasks,
                        onClick = { showTasks = true },
                        label = { Text("Задания (${issueTasks.size})") },
                    )
                }
            }
            if (showTasks) {
                if (issueTasks.isEmpty()) {
                    item {
                        Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                            Text("Нет задач выдачи", modifier = Modifier.padding(16.dp), color = Color.Gray)
                        }
                    }
                }
                items(issueTasks) { task -> MovementTaskCard(task = task) }
            } else {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Pick list по плану APS", fontWeight = FontWeight.Bold, color = DarkGreen)
                            Text(
                                "Мульти-SKU: загрузите план → выберите строку → скан ячейки",
                                fontSize = 12.sp,
                                color = Color(0xFF6B6B6B),
                            )
                            OutlinedTextField(
                                value = planCodeInput,
                                onValueChange = { planCodeInput = it },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                                label = { Text("Код плана") },
                                placeholder = { Text("PLAN-…") },
                            )
                            Button(
                                onClick = { viewModel.loadWorkshopPickList(planCodeInput) },
                                enabled = !pickListLoading && planCodeInput.isNotBlank(),
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) {
                                Text(if (pickListLoading) "Загрузка…" else "Загрузить pick list")
                            }
                            when {
                                pickListError != null -> Text(pickListError.orEmpty(), color = Color(0xFFC62828), fontSize = 12.sp)
                                pickList != null && pickList!!.lines.isEmpty() ->
                                    Text("Нет строк к отбору", fontSize = 13.sp, color = Color.Gray)
                                pickList != null -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(
                                        "${pickList!!.planCode} · ${pickList!!.itemName.orEmpty()} · ${pickList!!.totalLines} строк",
                                        fontSize = 12.sp,
                                        color = Color(0xFF6B6B6B),
                                    )
                                    pickList!!.lines.forEach { line ->
                                        Card(
                                            onClick = { viewModel.selectPickListLine(line) },
                                            colors = CardDefaults.cardColors(
                                                containerColor = if (line.enough) Color(0xFFF1F8E9) else Color(0xFFFFF3E0)
                                            ),
                                            shape = RoundedCornerShape(10.dp),
                                        ) {
                                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                                Text(line.itemName?.ifBlank { line.itemCode } ?: line.itemCode, fontWeight = FontWeight.SemiBold)
                                                Text(
                                                    "${line.itemCode} · нужно ${formatReceivingQty(line.needQty)}" +
                                                        (line.suggestedLocationCode?.let { " → $it" } ?: ""),
                                                    fontSize = 12.sp,
                                                    color = Color(0xFF6B6B6B),
                                                )
                                                if (!line.enough) {
                                                    Text("Нехватка на складе", fontSize = 11.sp, color = Color(0xFFEF6C00))
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                item {
                    ReceivingIdleScanZone(
                        barcodeInput = barcodeInput,
                        onBarcodeInputChange = { barcodeInput = it },
                        onSubmitBarcode = {
                            viewModel.onBarcodeScanned(barcodeInput)
                            barcodeInput = ""
                            keyboard?.hide()
                        },
                        focusRequester = focusRequester,
                        keyboard = keyboard,
                    )
                }
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(14.dp)) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text("Номенклатура группы", fontWeight = FontWeight.Bold, color = DarkGreen)
                            when {
                                groupItemsLoading -> LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
                                groupItemsError != null -> Text(groupItemsError.orEmpty(), color = Color(0xFFC62828), fontSize = 12.sp)
                                groupItems.isEmpty() -> Text("В группе нет номенклатуры. Можно отсканировать STK/SKU вручную.", fontSize = 13.sp, color = Color.Gray)
                                else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    groupItems.take(40).forEach { item ->
                                        IssueItemRow(
                                            item = item,
                                            onClick = {
                                                viewModel.onItemSelected(item)
                                            },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (isConfirming && !showTasks) {
        ModalBottomSheet(
            onDismissRequest = {
                if (uiState !is IssueUiState.Submitting) viewModel.cancelConfirmation()
            },
            sheetState = sheetState,
            containerColor = Color.White,
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 28.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when (val state = uiState) {
                    is IssueUiState.Loading -> {
                        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = DarkGreen)
                        }
                    }
                    is IssueUiState.Submitting -> {
                        Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = DarkGreen)
                        }
                    }
                    is IssueUiState.ConfirmIssue -> {
                        ReceivingScanInfoCard(
                            title = state.itemName,
                            documentId = null,
                            gtin = state.gtin,
                            itemStatus = null,
                            stickerStatus = null,
                            nestedItemName = null,
                            code = state.batchCode,
                            expiryMessage = null,
                            secondaryNote = buildString {
                                append("Код: ${state.itemCode}")
                                state.lotCode?.let { append("\nПартия: $it") }
                                if (state.availableQty > 0.0) {
                                    append("\nСклад: ${formatReceivingQty(state.availableQty)} шт")
                                }
                                if (state.inProductionQty > 0.0) {
                                    append("\nВ цехе: ${formatReceivingQty(state.inProductionQty)} шт")
                                }
                                if (state.pickPlan.isNotEmpty()) {
                                    append("\nМаршрут: ")
                                    append(
                                        state.pickPlan
                                            .filter { it.takeQty > 0.0 || it.selected }
                                            .take(3)
                                            .joinToString(" → ") { "${it.locationCode} (${formatReceivingQty(if (it.takeQty > 0.0) it.takeQty else it.availableQty)})" }
                                            .ifBlank { state.sourceLocationCode }
                                    )
                                }
                            },
                            blocked = false,
                            expired = false,
                            warning = false,
                        )
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            FilledTonalIconButton(
                                onClick = {
                                    val c = qtyInput.toDoubleOrNull()?.toInt() ?: 1
                                    qtyInput = (c - 1).coerceAtLeast(1).toString()
                                },
                            ) { Icon(Icons.Default.Remove, null) }
                            OutlinedTextField(
                                value = qtyInput,
                                onValueChange = { qtyInput = it },
                                label = { Text("Кол-во") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                modifier = Modifier.weight(1f).focusRequester(qtyFocusRequester),
                                singleLine = true,
                                textStyle = LocalTextStyle.current.copy(
                                    fontSize = 24.sp,
                                    fontWeight = FontWeight.Bold,
                                    textAlign = TextAlign.Center,
                                ),
                            )
                            FilledTonalIconButton(
                                onClick = {
                                    val c = qtyInput.toDoubleOrNull()?.toInt() ?: 1
                                    qtyInput = (c + 1).toString()
                                },
                            ) { Icon(Icons.Default.Add, null) }
                        }
                        OutlinedTextField(
                            value = locationInput,
                            onValueChange = { locationInput = it },
                            label = { Text("Ячейка линии / цеха") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            supportingText = {
                                Text("Это ячейка, куда кладём выданные стикеры для производства")
                            },
                        )
                        if (state.pickPlan.isNotEmpty()) {
                            val firstSelected = state.pickPlan.firstOrNull { it.takeQty > 0.0 || it.selected }
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)), shape = RoundedCornerShape(14.dp)) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("Откуда брать по FEFO", fontWeight = FontWeight.Bold, color = DarkGreen)
                                    Text(
                                        firstSelected?.let {
                                            "${it.locationCode} · партия ${it.lotCode ?: "—"} · взять ${formatReceivingQty(if (it.takeQty > 0.0) it.takeQty else it.availableQty)}"
                                        } ?: state.sourceLocationCode,
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = DarkGreen,
                                    )
                                }
                            }
                            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFF7F4EA)), shape = RoundedCornerShape(14.dp)) {
                                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                    Text("FEFO-подбор", fontWeight = FontWeight.Bold, color = DarkGreen)
                                    state.pickPlan.take(4).forEachIndexed { index, row ->
                                        val prefix = if (index == 0) "1-я" else "${index + 1}-я"
                                        val selected = row.takeQty > 0.0 || row.selected
                                        Surface(
                                            shape = RoundedCornerShape(10.dp),
                                            color = if (selected) Color(0xFFD7F2D8) else Color.Transparent,
                                            modifier = Modifier.fillMaxWidth(),
                                        ) {
                                            Text(
                                                "$prefix: ${row.locationCode} · стеллаж ${row.rack ?: "—"} · полка ${row.shelf ?: "—"} · доступно ${formatReceivingQty(row.availableQty)}",
                                                fontSize = 12.sp,
                                                fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                                                color = if (selected) DarkGreen else Color(0xFF3F4B3F),
                                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        if (recipients.isEmpty()) {
                            OutlinedTextField(
                                value = manualRecipient,
                                onValueChange = { manualRecipient = it },
                                label = { Text("Получатель") },
                                modifier = Modifier.fillMaxWidth(),
                                singleLine = true,
                            )
                        } else {
                            ExposedDropdownMenuBox(
                                expanded = recipientExpanded,
                                onExpandedChange = { recipientExpanded = it },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                OutlinedTextField(
                                    value = selectedRecipient ?: "",
                                    onValueChange = {},
                                    readOnly = true,
                                    label = { Text("Получатель") },
                                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = recipientExpanded) },
                                    modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
                                )
                                ExposedDropdownMenu(expanded = recipientExpanded, onDismissRequest = { recipientExpanded = false }) {
                                    recipients.forEach { r ->
                                        DropdownMenuItem(
                                            text = { Text(r.displayName) },
                                            onClick = {
                                                selectedRecipient = r.displayName
                                                recipientExpanded = false
                                            },
                                        )
                                    }
                                }
                            }
                        }
                        val parsedQty = qtyInput.toDoubleOrNull()?.takeIf { it > 0.0 } ?: 1.0
                        val recipientName = selectedRecipient?.trim().orEmpty().ifBlank { manualRecipient.trim() }
                        Button(
                            onClick = {
                                viewModel.confirmIssue(state, parsedQty, recipientName, locationInput)
                            },
                            modifier = Modifier.fillMaxWidth().height(56.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            enabled = recipientName.isNotBlank() && locationInput.trim().isNotBlank(),
                        ) {
                            Text("Выдать ${formatReceivingQty(parsedQty)} шт", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                        TextButton(onClick = { viewModel.cancelConfirmation() }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                            Text("Отмена")
                        }
                    }
                    is IssueUiState.Error -> {
                        Text(state.message, color = Color(0xFFC62828))
                        Button(onClick = { viewModel.cancelConfirmation() }, modifier = Modifier.fillMaxWidth()) {
                            Text("Продолжить")
                        }
                    }
                    IssueUiState.Idle -> Unit
                }
            }
        }
    }
}

@Composable
private fun IssueItemRow(item: ItemRow, onClick: () -> Unit) {
    OutlinedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.outlinedCardColors(containerColor = Color(0xFFFAFCF8)),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(item.name, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 13.sp, maxLines = 2)
                Text(item.sku ?: item.itemCode, color = Color.Gray, fontSize = 11.sp, maxLines = 1)
            }
            Text(
                formatReceivingQty(item.availableQty),
                color = if (item.availableQty > 0.0) DarkGreen else Color.Gray,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
