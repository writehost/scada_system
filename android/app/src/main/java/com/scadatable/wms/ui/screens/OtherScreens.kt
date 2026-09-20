package com.scadatable.wms.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import kotlinx.coroutines.launch
import com.scadatable.wms.data.local.ReceivingItem
import com.scadatable.wms.data.local.ReceivingDocument
import com.scadatable.wms.data.local.TaskCache
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.viewmodel.*
import com.scadatable.wms.ui.theme.*
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.receiving.ReceivingDocumentStatus
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.print.LabelPrintService
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.ui.components.LabelPreviewDialog
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.automirrored.filled.ArrowBack

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ReceivingScreen(navController: NavController, productGroup: String, docId: String) {
    val context = LocalContext.current
    val app = context.applicationContext as com.scadatable.wms.WmsApplication
    val scope = rememberCoroutineScope()
    val normalizedGroup = MaterialWarehouseGroups.decodeRouteKey(productGroup).trim()
        .ifBlank { com.scadatable.wms.receiving.ReceivingProductGroups.STICKERS }
    val normalizedDocId = docId.trim()
    var sessionGroup by remember(normalizedDocId) { mutableStateOf(normalizedGroup) }
    LaunchedEffect(normalizedGroup) { sessionGroup = normalizedGroup }
    val groupTitle = MaterialWarehouseGroups.titleFor(sessionGroup)
    var targetLocationLabel by remember { mutableStateOf<String?>(null) }
    var showGroupPicker by remember { mutableStateOf(false) }
    var availableGroups by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    val db = remember { WmsDatabase.getDatabase(context) }
    val viewModel: ReceivingViewModel = viewModel(factory = ReceivingViewModelFactory(db.wmsDao(), app.repository))
    val tasksVm: TasksViewModel = viewModel(factory = TasksViewModelFactory(app.repository))
    ScanConsumerEffect(ScanEvents.Consumer.RECEIVING)
    val currentDocId by viewModel.currentDocId.collectAsState()
    val viewOnlyDocId by viewModel.viewOnlyDocId.collectAsState()
    val isViewOnlySession = viewOnlyDocId != null
    val sessionDocId = currentDocId ?: viewOnlyDocId
    val lastClosedDocId by viewModel.lastClosedDocId.collectAsState()
    val uiState by viewModel.uiState.collectAsState()
    val items by viewModel.items.collectAsState()
    val storageRecommendation by viewModel.storageRecommendation.collectAsState()
    val pendingStickerBatch by viewModel.pendingStickerBatch.collectAsState()
    val allTasks by tasksVm.tasks.collectAsState()
    val tasksState by tasksVm.uiState.collectAsState()
    val receivingTasks = remember(allTasks) {
        allTasks.filter {
            val t = it.taskType.lowercase()
            t.contains("receipt") || t.contains("receiving")
        }
    }
    var selectedTaskId by remember { mutableStateOf<String?>(null) }
    val selectedTask = remember(receivingTasks, selectedTaskId) {
        receivingTasks.firstOrNull { it.taskId == selectedTaskId } ?: receivingTasks.firstOrNull()
    }
    val showExpandedTasksBlock = false
    var showCloseConfirm by remember { mutableStateOf(false) }
    var barcodeInput by remember { mutableStateOf("") }
    var qtyInput by remember { mutableStateOf("1") }
    var showDocActionsMenu by remember { mutableStateOf(false) }
    var deletePositionsMode by remember { mutableStateOf(false) }
    var reprintMode by remember { mutableStateOf(false) }
    var tasksExpanded by remember { mutableStateOf(false) }
    val selectedForDelete = remember { mutableStateListOf<Long>() }
    val selectedForReprint = remember { mutableStateListOf<Long>() }
    var reprintTemplate by remember { mutableStateOf(ReceivingViewModel.ReprintTemplate.BASIC) }
    var reprintSupplierName by remember { mutableStateOf("") }
    var reprintReceiptDate by remember { mutableStateOf("") }
    var showReprintConfirm by remember { mutableStateOf(false) }
    var editItem by remember { mutableStateOf<com.scadatable.wms.data.local.ReceivingItemView?>(null) }
    var editQtyInput by remember { mutableStateOf("") }
    var showPositionsList by remember { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    val qtyFocusRequester = remember { FocusRequester() }
    val snackbarHostState = remember { SnackbarHostState() }
    var sessionStockPosted by remember { mutableStateOf(false) }
    var previewPayload by remember { mutableStateOf<ReceivingStickerPayload?>(null) }
    val scrollState = rememberScrollState()
    val showsConfirmSheet = uiState is ReceivingUiState.ConfirmQuantity ||
        uiState is ReceivingUiState.Loading ||
        uiState is ReceivingUiState.MissingProduct ||
        uiState is ReceivingUiState.Error
    val hidesWorkBottomBar = uiState is ReceivingUiState.ConfirmQuantity ||
        uiState is ReceivingUiState.Loading
    val preventSheetDismiss = uiState is ReceivingUiState.ConfirmQuantity ||
        uiState is ReceivingUiState.Loading
    val preventSheetDismissState = remember { mutableStateOf(false) }
    preventSheetDismissState.value = preventSheetDismiss

    LaunchedEffect(sessionGroup) {
        app.repository.setActiveReceivingProductGroup(sessionGroup)
    }
    LaunchedEffect(normalizedDocId) {
        if (normalizedDocId.isNotBlank()) {
            if (normalizedDocId == "new") {
                viewModel.createDocument(sessionGroup)
            } else {
                viewModel.setActiveDocument(normalizedDocId, sessionGroup)
            }
            val doc = db.wmsDao().getReceivingDocumentById(normalizedDocId)
            targetLocationLabel = doc?.targetLocationCode
            doc?.productGroup?.trim()?.takeIf { it.isNotBlank() }?.let { sessionGroup = it }
        }
    }
    LaunchedEffect(showGroupPicker) {
        if (!showGroupPicker) return@LaunchedEffect
        app.repository.fetchProductGroups().onSuccess { rows ->
            availableGroups = rows.map { it.effectiveCode() to it.displayName() }
                .filter { it.first.isNotBlank() }
                .distinctBy { it.first }
                .sortedBy { it.second.lowercase() }
        }
    }
    LaunchedEffect(Unit) {
        viewModel.events.collect { text ->
            snackbarHostState.showSnackbar(text)
        }
    }
    LaunchedEffect(Unit) {
        viewModel.printSticker.collect { payload ->
            if (reprintMode) {
                previewPayload = payload
            } else {
                LabelPrintService.print(context, app.appPrefs, payload)
            }
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

    val sheetState = rememberModalBottomSheetState(
        skipPartiallyExpanded = true,
        confirmValueChange = { targetValue ->
            targetValue != SheetValue.Hidden || !preventSheetDismissState.value
        },
    )
    LaunchedEffect(showsConfirmSheet) {
        if (showsConfirmSheet) {
            sheetState.show()
        } else if (sheetState.isVisible) {
            sheetState.hide()
        }
    }
    BackHandler(enabled = preventSheetDismiss) {
        // Не закрывать форму кол-ва случайной кнопкой «Назад» — только «Отмена».
    }
    LaunchedEffect(receivingTasks) {
        if (selectedTaskId == null || receivingTasks.none { it.taskId == selectedTaskId }) {
            selectedTaskId = receivingTasks.firstOrNull()?.taskId
        }
    }
    LaunchedEffect(sessionDocId) {
        val id = sessionDocId?.trim()?.uppercase().orEmpty()
        sessionStockPosted = if (id.isBlank()) {
            false
        } else {
            app.repository.fetchStockPostedDocumentIds().getOrNull()?.contains(id) == true
        }
    }
    LaunchedEffect(uiState) {
        val state = uiState
        if (state is ReceivingUiState.ConfirmQuantity) {
            qtyInput = state.prefilledQty?.let {
                if (it % 1.0 == 0.0) it.toLong().toString() else it.toString()
            } ?: "0"
            if (!state.blocked) {
                qtyFocusRequester.requestFocus()
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            "Приемка · $groupTitle",
                            fontWeight = FontWeight.Bold,
                            color = DarkGreen,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (isViewOnlySession) "Просмотр документа" else "Сканирование",
                            fontSize = 12.sp,
                            color = Color(0xFF6B6B6B),
                            maxLines = 1,
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
                    FilledTonalIconButton(
                        onClick = { navController.navigate(Screen.ReceivingDocuments.createRoute(sessionGroup)) },
                        colors = IconButtonDefaults.filledTonalIconButtonColors(
                            containerColor = Color(0xFFEAF3FF),
                            contentColor = DarkGreen,
                        )
                    ) {
                        Icon(Icons.Default.Description, contentDescription = "Документы приемки")
                    }
                    IconButton(onClick = { showDocActionsMenu = true }) {
                        Icon(Icons.Default.MoreVert, contentDescription = "Действия", tint = DarkGreen)
                    }
                    DropdownMenu(
                        expanded = showDocActionsMenu,
                        onDismissRequest = { showDocActionsMenu = false }
                    ) {
                        if (sessionDocId != null && !isViewOnlySession) {
                            DropdownMenuItem(
                                text = { Text("Сменить группу") },
                                onClick = {
                                    showDocActionsMenu = false
                                    showGroupPicker = true
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("Приостановить документ") },
                                onClick = {
                                    showDocActionsMenu = false
                                    viewModel.pauseActiveDocument()
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Закрыть документ") },
                                onClick = {
                                    showDocActionsMenu = false
                                    viewModel.clearActiveDocument()
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Удалить позиции в документе") },
                                onClick = {
                                    showDocActionsMenu = false
                                    deletePositionsMode = true
                                    reprintMode = false
                                    selectedForDelete.clear()
                                    showPositionsList = true
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Повторная печать позиций") },
                                onClick = {
                                    showDocActionsMenu = false
                                    reprintMode = true
                                    showReprintConfirm = false
                                    deletePositionsMode = false
                                    selectedForDelete.clear()
                                    selectedForReprint.clear()
                                    showPositionsList = true
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Удалить документ") },
                                onClick = {
                                    showDocActionsMenu = false
                                    viewModel.deleteCurrentDocument()
                                }
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Выгрузить отложенную номенклатуру") },
                            onClick = {
                                showDocActionsMenu = false
                                viewModel.syncNomenclatureOutbox()
                            }
                        )
                    }
                }
            )
        },
        bottomBar = {
            Column {
                if (sessionDocId != null && !isViewOnlySession && !hidesWorkBottomBar) {
                    ReceivingWorkBottomBar(
                        onCloseDocument = { showCloseConfirm = true },
                        onOpenDocuments = {
                            navController.navigate(Screen.ReceivingDocuments.createRoute(normalizedGroup))
                        }
                    )
                }
                WmsBottomBar(navController)
            }
        },
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        containerColor = SoftWhiteBackground
    ) { padding ->
        if (sessionDocId != null) {
            val totalQty = remember(items) { items.sumOf { it.quantity } }
            Column(
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                val isNewDoc = items.isEmpty()
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (!isNewDoc) {
                                Modifier.clickable { showPositionsList = true }
                            } else {
                                Modifier
                            }
                        ),
                    colors = CardDefaults.cardColors(
                        containerColor = if (isNewDoc) Color(0xFFFFF8E1) else Color.White,
                    ),
                    shape = RoundedCornerShape(14.dp),
                ) {
                    Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                        if (isNewDoc) {
                            Surface(
                                shape = RoundedCornerShape(999.dp),
                                color = Color(0xFFE65100),
                                modifier = Modifier.padding(bottom = 8.dp),
                            ) {
                                Text(
                                    "НОВЫЙ ДОКУМЕНТ",
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                    color = Color.White,
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("$groupTitle · документ", color = Color(0xFF6B6B6B), fontSize = 11.sp)
                                Text(
                                    sessionDocId!!.uppercase(),
                                    color = DarkGreen,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 22.sp,
                                    fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                                )
                                targetLocationLabel?.takeIf { it.isNotBlank() }?.let { loc ->
                                    Spacer(Modifier.height(6.dp))
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = Color(0xFFE8F5E9),
                                    ) {
                                        Text(
                                            "Ячейка · $loc",
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                            color = DarkGreen,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                    }
                                }
                                if (isNewDoc) {
                                    Text(
                                        "Сканируйте первый код — документ появится в веб-морде",
                                        color = Color(0xFF8A8A8A),
                                        fontSize = 11.sp,
                                    )
                                }
                            }
                            if (isNewDoc) {
                                AssistChip(
                                    onClick = {},
                                    enabled = false,
                                    label = {
                                        Text(
                                            ReceivingDocumentStatus.displayLabel(
                                                ReceivingDocumentStatus.ACTIVE,
                                                isActiveSession = true,
                                                lineCount = items.size,
                                            ),
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                    },
                                    colors = AssistChipDefaults.assistChipColors(
                                        disabledContainerColor = Color(0xFFFFE0B2),
                                        disabledLabelColor = Color(0xFFE65100),
                                    ),
                                )
                            } else {
                                FilledTonalButton(
                                    onClick = { showPositionsList = true },
                                    colors = ButtonDefaults.filledTonalButtonColors(
                                        containerColor = Color(0xFFE8F5E9),
                                        contentColor = DarkGreen,
                                    ),
                                    shape = RoundedCornerShape(12.dp),
                                ) {
                                    Text("Позиции · ${items.size}", fontWeight = FontWeight.Bold)
                                    Icon(
                                        Icons.Default.ChevronRight,
                                        contentDescription = null,
                                        modifier = Modifier.size(18.dp),
                                    )
                                }
                            }
                        }
                        if (!isNewDoc) {
                            ReceivingPlacementRecommendationCard(
                                recommendation = storageRecommendation,
                                modifier = Modifier.padding(top = 10.dp),
                            )
                        }
                    }
                }

                if (isViewOnlySession) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0)),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(
                                "Документ закрыт — только просмотр",
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFFE65100),
                            )
                            Text(
                                if (sessionStockPosted) {
                                    "Проведён на остаток. Чтобы снова сканировать — «Открыть снова»."
                                } else {
                                    "Не проведён на остаток. Проведите здесь или в списке «Закрытые»."
                                },
                                fontSize = 12.sp,
                                color = Color(0xFF6B6B6B),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (!sessionStockPosted && items.isNotEmpty()) {
                                    Button(
                                        onClick = {
                                            viewModel.postDocumentToStock(viewOnlyDocId!!, normalizedGroup)
                                            scope.launch {
                                                kotlinx.coroutines.delay(800)
                                                sessionStockPosted =
                                                    app.repository.fetchStockPostedDocumentIds()
                                                        .getOrNull()
                                                        ?.contains(viewOnlyDocId!!.uppercase()) == true
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF5D4037)),
                                        shape = RoundedCornerShape(10.dp),
                                    ) {
                                        Text("Провести на остаток", color = Color.White, fontSize = 12.sp)
                                    }
                                }
                                Button(
                                    onClick = { viewModel.reopenDocument(viewOnlyDocId!!, normalizedGroup) },
                                    colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                                    shape = RoundedCornerShape(10.dp),
                                ) {
                                    Text("Открыть снова", color = Color.White)
                                }
                            }
                        }
                    }
                }

                if (showsConfirmSheet && uiState is ReceivingUiState.Loading) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Обработка скана…",
                        color = Color(0xFF757575),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(vertical = 24.dp),
                    )
                } else if (!isViewOnlySession) {
                if (showExpandedTasksBlock) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                        onClick = { tasksExpanded = !tasksExpanded },
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                "Задачи приемки · ${receivingTasks.size}",
                                color = DarkGreen,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp,
                            )
                            Text(if (tasksExpanded) "Свернуть" else "Открыть", color = DarkGreen, fontSize = 11.sp)
                        }
                    }
                    if (tasksExpanded) {
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 6.dp),
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (tasksState.error != null) {
                                    Text(tasksState.error ?: "", color = ErrorRed, fontSize = 12.sp)
                                }
                                selectedTask?.let { task ->
                                    Text("${task.taskCode} · ${task.taskStatus}", color = DarkGreen, fontWeight = FontWeight.Medium)
                                    Text(
                                        "${task.itemName ?: task.itemCode ?: "—"} · план: ${task.plannedQty ?: 0.0}",
                                        color = Color(0xFF5A5A5A),
                                        fontSize = 12.sp,
                                    )
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        if (task.taskStatus.equals("open", true)) {
                                            Button(
                                                onClick = { tasksVm.claim(task) },
                                                shape = RoundedCornerShape(10.dp),
                                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                                            ) { Text("Взять", color = Color.White) }
                                        }
                                        if (task.taskStatus.equals("claimed", true)) {
                                            Button(
                                                onClick = { tasksVm.start(task) },
                                                shape = RoundedCornerShape(10.dp),
                                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2F64C8)),
                                            ) { Text("Старт", color = Color.White) }
                                        }
                                        if (
                                            task.taskStatus.equals("claimed", true) ||
                                            task.taskStatus.equals("in_progress", true) ||
                                            task.taskStatus.equals("started", true)
                                        ) {
                                            OutlinedButton(onClick = { tasksVm.complete(task) }, shape = RoundedCornerShape(10.dp)) {
                                                Text("Завершить")
                                            }
                                        }
                                    }
                                }
                                TextButton(onClick = { tasksVm.refresh() }) { Text("Обновить задачи") }
                            }
                        }
                    }
                }

                Spacer(Modifier.height(8.dp))
                if (deletePositionsMode) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 10.dp, vertical = 8.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                "Выбрано: ${selectedForDelete.size}",
                                color = DarkGreen,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(
                                    onClick = {
                                        deletePositionsMode = false
                                        selectedForDelete.clear()
                                    }
                                ) { Text("Отмена") }
                                Button(
                                    enabled = selectedForDelete.isNotEmpty(),
                                    onClick = {
                                        selectedForDelete.toList().forEach { id ->
                                            viewModel.deleteReceivingItem(id)
                                        }
                                        selectedForDelete.clear()
                                        deletePositionsMode = false
                                    },
                                    colors = ButtonDefaults.buttonColors(containerColor = ErrorRed),
                                    shape = RoundedCornerShape(10.dp)
                                ) {
                                    Text("Удалить")
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                if (reprintMode) {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 10.dp, vertical = 10.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                "Повторная печать позиций",
                                color = DarkGreen,
                                fontWeight = FontWeight.SemiBold,
                                fontSize = 13.sp
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                FilterChip(
                                    selected = reprintTemplate == ReceivingViewModel.ReprintTemplate.BASIC,
                                    onClick = { reprintTemplate = ReceivingViewModel.ReprintTemplate.BASIC },
                                    label = { Text("Базовый") }
                                )
                                FilterChip(
                                    selected = reprintTemplate == ReceivingViewModel.ReprintTemplate.INCOMING_ORDER,
                                    onClick = { reprintTemplate = ReceivingViewModel.ReprintTemplate.INCOMING_ORDER },
                                    label = { Text("Приходный ордер") }
                                )
                            }
                            if (reprintTemplate == ReceivingViewModel.ReprintTemplate.INCOMING_ORDER) {
                                OutlinedTextField(
                                    value = reprintSupplierName,
                                    onValueChange = { reprintSupplierName = it },
                                    label = { Text("Контрагент (для шаблона)") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth()
                                )
                                OutlinedTextField(
                                    value = reprintReceiptDate,
                                    onValueChange = { reprintReceiptDate = it },
                                    label = { Text("Дата приемки по документу") },
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth()
                                )
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "Выбрано: ${selectedForReprint.size}",
                                    color = Color(0xFF5A5A5A),
                                    fontSize = 12.sp
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(
                                        onClick = {
                                            reprintMode = false
                                            showReprintConfirm = false
                                            selectedForReprint.clear()
                                        }
                                    ) { Text("Отмена") }
                                    Button(
                                        enabled = selectedForReprint.isNotEmpty(),
                                        onClick = {
                                            showReprintConfirm = true
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                                        shape = RoundedCornerShape(10.dp)
                                    ) {
                                        Text("Печатать ${selectedForReprint.size}", color = Color.White)
                                    }
                                }
                            }
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                if (!isViewOnlySession && !hidesWorkBottomBar) {
                    if (items.isEmpty()) {
                        ReceivingIdleScanZone(
                            barcodeInput = barcodeInput,
                            onBarcodeInputChange = { barcodeInput = it },
                            onSubmitBarcode = {
                                viewModel.onBarcodeScanned(barcodeInput)
                                barcodeInput = ""
                            },
                            focusRequester = focusRequester,
                            keyboard = keyboard,
                            pendingStickerBatch = pendingStickerBatch,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    } else {
                        ReceivingCompactScanBar(
                            barcodeInput = barcodeInput,
                            onBarcodeInputChange = { barcodeInput = it },
                            onSubmitBarcode = {
                                viewModel.onBarcodeScanned(barcodeInput)
                                barcodeInput = ""
                            },
                            focusRequester = focusRequester,
                            keyboard = keyboard,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                    sessionDocId?.let { activeDoc ->
                        OutlinedButton(
                            onClick = {
                                navController.navigate(
                                    Screen.ManualReceiving.createRoute(productGroup, activeDoc),
                                )
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 8.dp),
                            shape = RoundedCornerShape(14.dp),
                        ) {
                            Text("Принять без кода · по ТН ВЭД", color = DarkGreen, fontWeight = FontWeight.SemiBold)
                        }
                    }
                } else if (uiState is ReceivingUiState.Loading) {
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFF0F7EA)),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Text(
                            "Обработка скана…",
                            modifier = Modifier.padding(16.dp),
                            color = DarkGreen,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }
                if (items.isNotEmpty() && (deletePositionsMode || reprintMode)) {
                    Spacer(Modifier.height(8.dp))
                    Text("Принятые позиции", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 14.sp)
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(bottom = 8.dp),
                    ) {
                        items(items, key = { it.id }) { item ->
                            Card(
                                modifier = Modifier.fillMaxWidth(),
                                colors = CardDefaults.cardColors(containerColor = Color.White),
                                shape = RoundedCornerShape(12.dp),
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    if (deletePositionsMode) {
                                        Checkbox(
                                            checked = selectedForDelete.contains(item.id),
                                            onCheckedChange = { checked ->
                                                if (checked) {
                                                    if (!selectedForDelete.contains(item.id)) selectedForDelete.add(item.id)
                                                } else {
                                                    selectedForDelete.remove(item.id)
                                                }
                                            },
                                        )
                                    } else if (reprintMode) {
                                        Checkbox(
                                            checked = selectedForReprint.contains(item.id),
                                            onCheckedChange = { checked ->
                                                if (checked) {
                                                    if (!selectedForReprint.contains(item.id)) selectedForReprint.add(item.id)
                                                } else {
                                                    selectedForReprint.remove(item.id)
                                                }
                                            },
                                        )
                                    }
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            item.productName.ifBlank { item.productBarcode },
                                            fontWeight = FontWeight.SemiBold,
                                            color = DarkGreen,
                                        )
                                        Text(
                                            "×${formatReceivingQty(item.quantity)}",
                                            color = Color(0xFF5A5A5A),
                                            fontSize = 12.sp,
                                        )
                                    }
                                }
                            }
                        }
                    }
                } else if (items.isNotEmpty() && !reprintMode && !deletePositionsMode) {
                    ReceivingNextStepsHint(
                        positionCount = items.size,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    Spacer(Modifier.weight(1f))
                }

                val currentEditItem = editItem
                if (currentEditItem != null) {
                    AlertDialog(
                        onDismissRequest = {
                            editItem = null
                            keyboard?.hide()
                        },
                        title = { Text("Изменить количество") },
                        text = {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(currentEditItem.productBarcode, color = Color(0xFF5A5A5A), fontSize = 12.sp)
                                OutlinedTextField(
                                    value = editQtyInput,
                                    onValueChange = { editQtyInput = it },
                                    label = { Text("Количество") },
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                                    singleLine = true,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        },
                        confirmButton = {
                            Button(
                                onClick = {
                                    val q = editQtyInput.toDoubleOrNull()
                                    if (q != null && q > 0.0) {
                                        viewModel.updateReceivingItemQuantity(currentEditItem.id, q)
                                    }
                                    editItem = null
                                    keyboard?.hide()
                                },
                            ) { Text("Сохранить") }
                        },
                        dismissButton = {
                            TextButton(onClick = {
                                editItem = null
                                keyboard?.hide()
                            }) { Text("Отмена") }
                        },
                    )
                }
                }
            }
        } else {
            Column(
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(horizontal = 16.dp, vertical = 24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Default.Inventory, contentDescription = null, tint = DarkGreen, modifier = Modifier.size(48.dp))
                Spacer(Modifier.height(12.dp))
                Text("Документ не выбран", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 18.sp)
                Text(
                    "Вернитесь к списку документов и создайте новый или откройте существующий",
                    color = Color.Gray,
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 6.dp, bottom = 16.dp),
                )
                Button(
                    onClick = { navController.navigate(Screen.ReceivingDocuments.createRoute(normalizedGroup)) },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    shape = RoundedCornerShape(14.dp),
                ) { Text("Список документов", color = Color.White) }
            }
        }
    }

    if (showsConfirmSheet) {
        ModalBottomSheet(
            onDismissRequest = {
                if (!preventSheetDismiss) {
                    viewModel.cancelConfirmation()
                }
            },
            sheetState = sheetState,
            containerColor = Color.White,
            dragHandle = {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    BottomSheetDefaults.DragHandle()
                    if (preventSheetDismiss) {
                        Text(
                            "Свайп вниз отключён — отмена только кнопкой «Отмена»",
                            fontSize = 10.sp,
                            color = Color(0xFF9E9E9E),
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    }
                }
            },
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            ) {
                ReceivingConfirmPanel(
                    uiState = uiState,
                    currentDocId = currentDocId,
                    normalizedGroup = normalizedGroup,
                    qtyInput = qtyInput,
                    onQtyInputChange = { qtyInput = it },
                    qtyFocusRequester = qtyFocusRequester,
                    viewModel = viewModel,
                    focusRequester = focusRequester,
                    barcodeInput = barcodeInput,
                    onBarcodeInputChange = { barcodeInput = it },
                    keyboard = keyboard,
                )
                Spacer(Modifier.height(24.dp))
            }
        }
    }

    if (showPositionsList && sessionDocId != null) {
        ReceivingPositionsDialog(
            documentId = sessionDocId!!,
            items = items,
            totalQty = items.sumOf { it.quantity },
            onDismiss = { showPositionsList = false },
            onEditItem = { item ->
                showPositionsList = false
                editItem = item
                editQtyInput =
                    if (item.quantity % 1.0 == 0.0) item.quantity.toLong().toString()
                    else item.quantity.toString()
            },
            onReprint = if (!isViewOnlySession) {
                { item ->
                    showPositionsList = false
                    reprintMode = false
                    deletePositionsMode = false
                    selectedForReprint.clear()
                    selectedForReprint.add(item.id)
                    showReprintConfirm = true
                }
            } else {
                null
            },
            deletePositionsMode = deletePositionsMode,
            selectedForDelete = selectedForDelete.toList(),
            onToggleDelete = { id ->
                if (selectedForDelete.contains(id)) selectedForDelete.remove(id)
                else selectedForDelete.add(id)
            },
            reprintMode = reprintMode,
            selectedForReprint = selectedForReprint.toList(),
            onToggleReprint = { id ->
                if (selectedForReprint.contains(id)) selectedForReprint.remove(id)
                else selectedForReprint.add(id)
            },
            onConfirmReprint = {
                showPositionsList = false
                reprintMode = false
                showReprintConfirm = selectedForReprint.isNotEmpty()
            },
            onCancelMode = {
                reprintMode = false
                showReprintConfirm = false
                selectedForReprint.clear()
                showPositionsList = false
            },
        )
    }

    if (showReprintConfirm) {
        ReprintConfirmDialog(
            selectedCount = selectedForReprint.size,
            template = reprintTemplate,
            onTemplateChange = { reprintTemplate = it },
            supplierName = reprintSupplierName,
            onSupplierNameChange = { reprintSupplierName = it },
            receiptDate = reprintReceiptDate,
            onReceiptDateChange = { reprintReceiptDate = it },
            onDismiss = {
                showReprintConfirm = false
                reprintMode = false
                selectedForReprint.clear()
            },
            onPrint = {
                val ids = selectedForReprint.toList()
                if (ids.isNotEmpty()) {
                    viewModel.reprintSelectedItems(
                        itemIds = ids,
                        template = reprintTemplate,
                        supplierName = reprintSupplierName,
                        receiptDocDate = reprintReceiptDate,
                    )
                }
                showReprintConfirm = false
                reprintMode = false
                selectedForReprint.clear()
            },
        )
    }

    if (showGroupPicker) {
        AlertDialog(
            onDismissRequest = { showGroupPicker = false },
            title = { Text("Сменить товарную группу", fontWeight = FontWeight.Bold, color = DarkGreen) },
            text = {
                Column(
                    modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "Текущая: $groupTitle. Уже отсканированные строки останутся в документе.",
                        fontSize = 12.sp,
                        color = Color(0xFF757575),
                    )
                    availableGroups.forEach { (code, name) ->
                        OutlinedCard(
                            onClick = {
                                sessionGroup = code
                                viewModel.switchProductGroup(code)
                                showGroupPicker = false
                            },
                            colors = CardDefaults.outlinedCardColors(
                                containerColor = if (code.equals(sessionGroup, ignoreCase = true)) {
                                    Color(0xFFE8F5E9)
                                } else {
                                    Color.White
                                },
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(Modifier.padding(10.dp)) {
                                Text(name, fontWeight = FontWeight.SemiBold, color = DarkGreen)
                                Text(code, fontSize = 11.sp, color = Color.Gray)
                            }
                        }
                    }
                    if (availableGroups.isEmpty()) {
                        Text("Загрузка групп…", color = Color.Gray, fontSize = 12.sp)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showGroupPicker = false }) { Text("Закрыть") }
            },
        )
    }

    if (showCloseConfirm) {
        AlertDialog(
            onDismissRequest = { showCloseConfirm = false },
            title = { Text("Завершить приёмку?") },
            text = {
                Text(
                    "Документ ${sessionDocId.orEmpty().uppercase()} будет закрыт на ТСД. " +
                        "Сессия появится на веб-морде как завершённая (${items.size} поз., " +
                        "${formatReceivingQty(items.sumOf { it.quantity })} шт.)."
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showCloseConfirm = false
                        viewModel.clearActiveDocument()
                        navController.navigate(Screen.ReceivingDocuments.createRoute(sessionGroup)) {
                            popUpTo(Screen.ReceivingDocuments.createRoute(sessionGroup)) { inclusive = false }
                        }
                    },
                ) { Text("Завершить") }
            },
            dismissButton = {
                TextButton(onClick = { showCloseConfirm = false }) { Text("Отмена") }
            },
        )
    }
}

@Composable
private fun ReprintConfirmDialog(
    selectedCount: Int,
    template: ReceivingViewModel.ReprintTemplate,
    onTemplateChange: (ReceivingViewModel.ReprintTemplate) -> Unit,
    supplierName: String,
    onSupplierNameChange: (String) -> Unit,
    receiptDate: String,
    onReceiptDateChange: (String) -> Unit,
    onDismiss: () -> Unit,
    onPrint: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("Повторная печать", color = DarkGreen, fontWeight = FontWeight.Bold)
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Выбрано позиций: $selectedCount",
                    color = Color(0xFF5A5A5A),
                    fontSize = 13.sp,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = template == ReceivingViewModel.ReprintTemplate.BASIC,
                        onClick = { onTemplateChange(ReceivingViewModel.ReprintTemplate.BASIC) },
                        label = { Text("Базовый") },
                    )
                    FilterChip(
                        selected = template == ReceivingViewModel.ReprintTemplate.INCOMING_ORDER,
                        onClick = { onTemplateChange(ReceivingViewModel.ReprintTemplate.INCOMING_ORDER) },
                        label = { Text("Приходный ордер") },
                    )
                }
                if (template == ReceivingViewModel.ReprintTemplate.INCOMING_ORDER) {
                    OutlinedTextField(
                        value = supplierName,
                        onValueChange = onSupplierNameChange,
                        label = { Text("Контрагент") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = receiptDate,
                        onValueChange = onReceiptDateChange,
                        label = { Text("Дата приемки") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onPrint,
                enabled = selectedCount > 0,
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp),
                shape = RoundedCornerShape(12.dp),
            ) {
                Text("Печатать $selectedCount", color = Color.White, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Отмена")
            }
        },
        containerColor = Color.White,
    )
}

@Composable
private fun StatusPill(status: String) {
    val normalized = status.trim().lowercase()
    val (bg, fg, title) = when {
        normalized.contains("списан") -> Triple(Color(0xFFFFE3E3), Color(0xFFC62828), "списан")
        normalized.contains("оборот") -> Triple(Color(0xFFE3F7E8), Color(0xFF2E7D32), "в обороте")
        normalized.contains("нанес") -> Triple(Color(0xFFEFFFCC), Color(0xFF558B2F), "нанесен")
        normalized.contains("эммит") || normalized.contains("эмит") -> Triple(Color(0xFFFFEBD1), Color(0xFFE67E22), "эмитирован")
        else -> Triple(Color(0xFFEAF3FF), DarkGreen, status.ifBlank { "—" })
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(999.dp)
    ) {
        Text(
            text = title,
            color = fg,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
        )
    }
}

private fun formatEmissionDate(ts: Long?): String {
    if (ts == null || ts <= 0L) return "—"
    return java.text.SimpleDateFormat("dd.MM.yyyy", java.util.Locale("ru")).format(java.util.Date(ts))
}

@Composable
private fun ReceivingPlacementRecommendationCard(
    recommendation: ReceivingStorageRecommendation?,
    modifier: Modifier = Modifier,
) {
    val bg = if (recommendation?.forbidden == true) Color(0xFFFFF8E1) else Color(0xFFE8F5E9)
    val fg = if (recommendation?.forbidden == true) Color(0xFFE65100) else DarkGreen
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        color = bg,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Inventory, contentDescription = null, tint = fg, modifier = Modifier.size(22.dp))
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("Предложенное размещение", color = fg, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                if (recommendation == null) {
                    Text(
                        "Сканируйте код — система подберёт ячейку по номенклатуре и профилю склада",
                        color = Color(0xFF6B6B6B),
                        fontSize = 11.sp,
                        lineHeight = 14.sp,
                    )
                } else {
                    Text(
                        recommendation.locationCode,
                        color = fg,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    )
                    Text(
                        buildString {
                            append(recommendation.itemName.take(34))
                            append(" · ")
                            append(formatReceivingQty(recommendation.qty))
                            append(" шт")
                            recommendation.zoneCode?.let { append(" · ").append(it) }
                        },
                        color = Color(0xFF5A5A5A),
                        fontSize = 11.sp,
                        lineHeight = 14.sp,
                    )
                    recommendation.reasons.firstOrNull()?.let { reason ->
                        Text(reason, color = Color(0xFF6B6B6B), fontSize = 10.sp, lineHeight = 13.sp)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MovementScreen(
    navController: NavController,
    prefillItemCode: String = "",
    prefillFromLocation: String = "",
) {
    val context = LocalContext.current
    val app = context.applicationContext as com.scadatable.wms.WmsApplication
    val tasksVm: TasksViewModel = viewModel(factory = TasksViewModelFactory(app.repository))
    val tasks by tasksVm.tasks.collectAsState()
    val listState = rememberLazyListState()
    val movementTasks = tasks.filter { it.taskType.contains("transfer", true) || it.taskType.contains("putaway", true) }
    val scope = rememberCoroutineScope()
    var nomenclatureItems by remember { mutableStateOf<List<com.scadatable.wms.data.remote.ItemRow>>(emptyList()) }
    var itemCode by remember { mutableStateOf(prefillItemCode.trim()) }
    var query by remember { mutableStateOf(prefillItemCode.trim()) }
    var sourceLocation by remember { mutableStateOf(prefillFromLocation.trim()) }
    var targetLocation by remember { mutableStateOf("") }
    var qtyInput by remember { mutableStateOf("1") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        tasksVm.refresh("in_progress")
        app.repository.fetchItemsPage(limit = 80).onSuccess { page ->
            nomenclatureItems = page.items
            if (prefillItemCode.isNotBlank()) {
                val hit = page.items.firstOrNull {
                    it.itemCode.equals(prefillItemCode.trim(), ignoreCase = true)
                }
                if (hit != null) {
                    itemCode = hit.itemCode
                    query = hit.name
                }
            }
        }
        if (prefillItemCode.isNotBlank() && query == prefillItemCode.trim()) {
            app.repository.fetchItemDetail(prefillItemCode.trim()).onSuccess { detail ->
                val name = detail.item?.name?.takeIf { it.isNotBlank() }
                if (name != null) {
                    query = name
                    itemCode = detail.item?.itemCode?.takeIf { it.isNotBlank() } ?: prefillItemCode.trim()
                }
            }
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Перемещение", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Номенклатура → ячейка назначения", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, null, tint = DarkGreen)
                    }
                }
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding).padding(16.dp).fillMaxSize(),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(16.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Свободное перемещение", fontWeight = FontWeight.Bold, color = DarkGreen)
                        OutlinedTextField(
                            value = query,
                            onValueChange = { value ->
                                query = value
                                itemCode = value
                            },
                            label = { Text("Скан / код номенклатуры") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        val filteredItems = remember(nomenclatureItems, query) {
                            val q = query.trim().lowercase()
                            if (q.isBlank()) nomenclatureItems.take(20)
                            else nomenclatureItems.filter {
                                it.itemCode.lowercase().contains(q) ||
                                    it.name.lowercase().contains(q) ||
                                    it.sku?.lowercase()?.contains(q) == true
                            }.take(20)
                        }
                        if (filteredItems.isNotEmpty()) {
                            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                filteredItems.forEach { item ->
                                    OutlinedCard(
                                        onClick = {
                                            itemCode = item.itemCode
                                            query = item.name
                                        },
                                        modifier = Modifier.fillMaxWidth(),
                                        colors = CardDefaults.outlinedCardColors(containerColor = Color(0xFFFAFCF8)),
                                    ) {
                                        Row(
                                            Modifier.fillMaxWidth().padding(10.dp),
                                            horizontalArrangement = Arrangement.SpaceBetween,
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Column(Modifier.weight(1f)) {
                                                Text(item.name, color = DarkGreen, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 2)
                                                Text(item.itemCode, color = Color.Gray, fontSize = 11.sp, maxLines = 1)
                                            }
                                            Text(formatReceivingQty(item.availableQty), color = DarkGreen, fontWeight = FontWeight.Bold)
                                        }
                                    }
                                }
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(
                                value = sourceLocation,
                                onValueChange = { sourceLocation = it },
                                label = { Text("Откуда") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                            OutlinedTextField(
                                value = targetLocation,
                                onValueChange = { targetLocation = it },
                                label = { Text("Куда") },
                                singleLine = true,
                                modifier = Modifier.weight(1f),
                            )
                        }
                        OutlinedTextField(
                            value = qtyInput,
                            onValueChange = { qtyInput = it },
                            label = { Text("Количество") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                scope.launch {
                                    busy = true
                                    error = null
                                    message = null
                                    val result = app.repository.confirmTransfer(
                                        itemCode = itemCode,
                                        sourceLocationCode = sourceLocation,
                                        targetLocationCode = targetLocation,
                                        qty = qtyInput.toDoubleOrNull() ?: 0.0,
                                    )
                                    busy = false
                                    result.onSuccess { body ->
                                        message = "Перемещено · ${body.documentId ?: body.transferId ?: body.movementId ?: "OK"}"
                                    }.onFailure { err ->
                                        error = err.message ?: "Не удалось выполнить перемещение"
                                    }
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(54.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            enabled = !busy,
                        ) {
                            Text(if (busy) "Перемещаем..." else "Переместить", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                        message?.let { Text(it, color = DarkGreen, fontSize = 12.sp) }
                        error?.let { Text(it, color = ErrorRed, fontSize = 12.sp) }
                    }
                }
            }
            item {
                Text("Задачи перемещения (${movementTasks.size})", fontWeight = FontWeight.Bold, color = DarkGreen)
            }
            if (movementTasks.isEmpty()) {
                item {
                    Card(colors = CardDefaults.cardColors(containerColor = Color.White)) {
                        Text("Нет активных задач перемещения", modifier = Modifier.padding(16.dp), color = Color.Gray)
                    }
                }
            } else {
                items(movementTasks) { task ->
                    MovementTaskCard(task = task)
                }
            }
        }
    }
}

@Composable
fun ReceivingNextStepsHint(
    positionCount: Int,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Что дальше?", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 13.sp)
            Text(
                "• Сканируйте следующий код в поле выше",
                fontSize = 12.sp,
                color = Color(0xFF4A4A4A),
            )
            Text(
                "• Печать этикеток: кнопка «Печать» внизу — отметьте позиции и «Отправить на печать»",
                fontSize = 12.sp,
                color = Color(0xFF4A4A4A),
            )
            Text(
                "• Когда всё принято ($positionCount поз.) — «Завершить» внизу",
                fontSize = 12.sp,
                color = Color(0xFF4A4A4A),
            )
        }
    }
}

@Composable
fun ReceivingWorkBottomBar(
    onCloseDocument: () -> Unit,
    onOpenDocuments: () -> Unit,
) {
    Surface(
        color = Color.White,
        tonalElevation = 2.dp,
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedButton(
                onClick = onOpenDocuments,
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                Icon(Icons.Default.List, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("Список документов", fontSize = 14.sp)
            }
            Spacer(Modifier.width(12.dp))
            Button(
                onClick = onCloseDocument,
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.weight(1f)
            ) {
                Text("Завершить приемку", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
fun MovementTaskCard(task: TaskCache) {
    Card(colors = CardDefaults.cardColors(containerColor = Color.White), shape = RoundedCornerShape(16.dp)) {
        Column(Modifier.padding(16.dp)) {
            Text(task.taskCode, color = DarkGreen, fontWeight = FontWeight.Bold)
            Text("Статус: ${task.taskStatus}", color = Color.Gray, fontSize = 12.sp)
            Spacer(Modifier.height(8.dp))
            Text(
                "Маршрут: ${task.sourceLocationCode ?: "—"} → ${task.targetLocationCode ?: "—"}",
                color = Color.Gray,
                fontSize = 12.sp
            )
            Text("Количество: ${task.plannedQty ?: 0.0}", color = DarkGreen, fontWeight = FontWeight.Medium)
        }
    }
}
