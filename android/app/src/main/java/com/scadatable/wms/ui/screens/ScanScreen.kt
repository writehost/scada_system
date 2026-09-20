package com.scadatable.wms.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import com.scadatable.wms.viewmodel.ScanStatus
import com.scadatable.wms.viewmodel.ScanHandlingMode
import com.scadatable.wms.viewmodel.ScannerViewModel
import com.scadatable.wms.viewmodel.ScannerViewModelFactory
import com.scadatable.wms.viewmodel.CellModeViewModel
import com.scadatable.wms.viewmodel.CellModeViewModelFactory
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.*
import kotlinx.coroutines.delay
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private const val WEDGE_MIN_LENGTH_MARK = 18
private const val WEDGE_MIN_LENGTH_CELL = 3
private const val WEDGE_IDLE_MS = 90L

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ScanScreen(navController: NavController) {
    val context = LocalContext.current
    val db = remember { WmsDatabase.getDatabase(context) }
    val app = context.applicationContext as WmsApplication
    val viewModel: ScannerViewModel = viewModel(
        factory = ScannerViewModelFactory(db.wmsDao(), app.repository)
    )
    val cellVm: CellModeViewModel = viewModel(
        factory = CellModeViewModelFactory(app.repository)
    )

    val scanStatus by viewModel.scanResult.collectAsState()
    val collectDocumentId by viewModel.collectDocumentId.collectAsState()
    val collectItems by viewModel.collectItems.collectAsState()
    val cellUi by cellVm.ui.collectAsState()
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val snackbarHostState = remember { SnackbarHostState() }
    val resultScroll = rememberScrollState()

    var barcodeInput by remember { mutableStateOf("") }
    var manualInputOpen by remember { mutableStateOf(false) }
    var selectedAction by remember { mutableStateOf(ScanAction.INFO) }
    var actionHint by remember { mutableStateOf<String?>(null) }
    var lastShownHint by remember { mutableStateOf<String?>(null) }
    var modeMenuExpanded by remember { mutableStateOf(false) }

    fun currentMode(): ScanHandlingMode = when (selectedAction) {
        ScanAction.INFO -> ScanHandlingMode.INFO
        ScanAction.CELL -> ScanHandlingMode.CELL
        ScanAction.COLLECT -> ScanHandlingMode.COLLECT
    }

    fun submitBarcode(code: String, fromManual: Boolean = false) {
        val trimmed = code.trim().trim('\n', '\r')
        if (trimmed.isBlank()) return
        if (selectedAction == ScanAction.CELL) {
            if (cellUi.busy) return
            cellVm.onScan(trimmed)
        } else {
            if (scanStatus is ScanStatus.Loading) return
            viewModel.onBarcodeScanned(trimmed, currentMode())
        }
        barcodeInput = ""
        if (fromManual) {
            manualInputOpen = false
            keyboard?.hide()
        }
    }

    ScanConsumerEffect(ScanEvents.Consumer.SCANNER)

    // Аппаратный скан Mindeo: в режиме «Ячейка» ViewModel скан игнорирует — обрабатываем здесь.
    LaunchedEffect(selectedAction) {
        if (selectedAction != ScanAction.CELL) return@LaunchedEffect
        ScanEvents.barcodes.collect { raw ->
            if (!ScanEvents.isActive(ScanEvents.Consumer.SCANNER)) return@collect
            submitBarcode(raw)
        }
    }

    LaunchedEffect(manualInputOpen) {
        if (!manualInputOpen) return@LaunchedEffect
        delay(80)
        focusRequester.requestFocus()
        keyboard?.show()
    }

    LaunchedEffect(selectedAction) {
        viewModel.setScanMode(currentMode())
        if (selectedAction == ScanAction.CELL) {
            cellVm.reset()
            viewModel.clearStatus()
        }
    }

    LaunchedEffect(barcodeInput, selectedAction, manualInputOpen) {
        if (!manualInputOpen) return@LaunchedEffect
        val code = barcodeInput.trim().trim('\n', '\r')
        val minLen = if (selectedAction == ScanAction.CELL) WEDGE_MIN_LENGTH_CELL else WEDGE_MIN_LENGTH_MARK
        if (code.length < minLen) return@LaunchedEffect
        if (code.contains('\n') || code.contains('\r')) return@LaunchedEffect
        delay(WEDGE_IDLE_MS)
        if (barcodeInput.trim().trim('\n', '\r') == code) {
            submitBarcode(code, fromManual = true)
        }
    }

    LaunchedEffect(scanStatus) {
        when (val status = scanStatus) {
            is ScanStatus.Success -> {
                when (selectedAction) {
                    ScanAction.COLLECT -> actionHint = "Добавлено в список"
                    else -> {}
                }
            }
            else -> {}
        }
        if (scanStatus is ScanStatus.Error) {
            delay(5000)
            viewModel.clearStatus()
        }
        if (scanStatus !is ScanStatus.Idle && scanStatus !is ScanStatus.Loading) {
            resultScroll.scrollTo(0)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Сканер", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 18.sp)
                        Text(
                            text = selectedAction.subtitle,
                            color = Color(0xFF757575),
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SoftWhiteBackground,
                    titleContentColor = DarkGreen,
                ),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.Default.ArrowBack, contentDescription = null, tint = DarkGreen)
                    }
                },
                actions = {
                    Box {
                        TextButton(onClick = { modeMenuExpanded = true }) {
                            Text(selectedAction.label, color = DarkGreen, fontSize = 13.sp)
                        }
                        DropdownMenu(
                            expanded = modeMenuExpanded,
                            onDismissRequest = { modeMenuExpanded = false },
                        ) {
                            ScanAction.entries.forEach { action ->
                                DropdownMenuItem(
                                    text = {
                                        Column {
                                            Text(action.label, fontWeight = FontWeight.SemiBold)
                                            Text(action.subtitle, fontSize = 12.sp, color = Color.Gray)
                                        }
                                    },
                                    onClick = {
                                        selectedAction = action
                                        modeMenuExpanded = false
                                    },
                                )
                            }
                        }
                    }
                    if (selectedAction == ScanAction.COLLECT) {
                        IconButton(onClick = { navController.navigate(Screen.CollectDocuments.route) }) {
                            Icon(Icons.Default.Description, contentDescription = "Списки", tint = DarkGreen)
                        }
                    }
                    IconButton(onClick = { navController.navigate(Screen.ScanHistory.route) }) {
                        Icon(Icons.Default.History, contentDescription = "История", tint = DarkGreen)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            Surface(
                color = Color.White,
                shadowElevation = 2.dp,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    if (selectedAction == ScanAction.COLLECT) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = if (!collectDocumentId.isNullOrBlank()) {
                                    "Список ${collectDocumentId!!.take(8).uppercase()}"
                                } else {
                                    "Новый список"
                                },
                                color = Color(0xFF616161),
                                fontSize = 12.sp,
                                modifier = Modifier.weight(1f),
                            )
                            TextButton(
                                onClick = { viewModel.startNewCollectDocument() },
                                contentPadding = PaddingValues(horizontal = 6.dp),
                            ) {
                                Text("Сброс", fontSize = 12.sp)
                            }
                        }
                    }

                    if (!manualInputOpen) {
                        OutlinedButton(
                            onClick = { manualInputOpen = true },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(36.dp),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                            colors = ButtonDefaults.outlinedButtonColors(
                                contentColor = DarkGreen,
                            ),
                        ) {
                            Icon(
                                Icons.Default.Keyboard,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                            )
                            Spacer(Modifier.width(6.dp))
                            Text("Ручной ввод", fontSize = 13.sp, fontWeight = FontWeight.Medium)
                        }
                    } else {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Surface(
                                modifier = Modifier
                                    .weight(1f)
                                    .height(36.dp),
                                shape = RoundedCornerShape(8.dp),
                                color = Color(0xFFF5F7F5),
                                border = BorderStroke(1.dp, Color(0xFFD0D5D0)),
                            ) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(horizontal = 10.dp),
                                ) {
                                    BasicTextField(
                                        value = barcodeInput,
                                        onValueChange = { raw ->
                                            barcodeInput = raw
                                            if (raw.endsWith("\n") || raw.endsWith("\r")) {
                                                submitBarcode(raw, fromManual = true)
                                            }
                                        },
                                        modifier = Modifier
                                            .weight(1f)
                                            .focusRequester(focusRequester),
                                        singleLine = true,
                                        textStyle = TextStyle(
                                            color = DarkGreen,
                                            fontSize = 14.sp,
                                            lineHeight = 18.sp,
                                        ),
                                        cursorBrush = SolidColor(DarkGreen),
                                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                        keyboardActions = KeyboardActions(
                                            onDone = { submitBarcode(barcodeInput, fromManual = true) },
                                        ),
                                        decorationBox = { inner ->
                                            if (barcodeInput.isEmpty()) {
                                                Text(
                                                    "Ввод",
                                                    color = Color(0xFF9E9E9E),
                                                    fontSize = 13.sp,
                                                )
                                            }
                                            inner()
                                        },
                                    )
                                    if (barcodeInput.isNotEmpty()) {
                                        IconButton(
                                            onClick = { barcodeInput = "" },
                                            modifier = Modifier.size(28.dp),
                                        ) {
                                            Icon(
                                                Icons.Default.Clear,
                                                contentDescription = "Очистить",
                                                modifier = Modifier.size(16.dp),
                                                tint = Color(0xFF757575),
                                            )
                                        }
                                    }
                                }
                            }
                            FilledIconButton(
                                onClick = { submitBarcode(barcodeInput, fromManual = true) },
                                enabled = if (selectedAction == ScanAction.CELL) {
                                    !cellUi.busy && barcodeInput.isNotBlank()
                                } else {
                                    scanStatus !is ScanStatus.Loading && barcodeInput.isNotBlank()
                                },
                                modifier = Modifier.size(36.dp),
                                colors = IconButtonDefaults.filledIconButtonColors(
                                    containerColor = LimeAccent,
                                    contentColor = DarkGreen,
                                ),
                                shape = RoundedCornerShape(8.dp),
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.Send,
                                    contentDescription = "Отправить",
                                    modifier = Modifier.size(16.dp),
                                )
                            }
                            IconButton(
                                onClick = {
                                    manualInputOpen = false
                                    barcodeInput = ""
                                    keyboard?.hide()
                                },
                                modifier = Modifier.size(36.dp),
                            ) {
                                Icon(
                                    Icons.Default.Close,
                                    contentDescription = "Скрыть",
                                    tint = Color(0xFF757575),
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }

                    if (scanStatus is ScanStatus.Loading && selectedAction != ScanAction.CELL) {
                        LinearWavyProgressIndicator(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 6.dp),
                            color = DarkGreen,
                            wavelength = 24.dp,
                            waveSpeed = 4.dp,
                            amplitude = 0.5f
                        )
                    }
                }
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                if (selectedAction == ScanAction.CELL) {
                    CellModePanel(
                        state = cellUi,
                        onToggleItem = cellVm::toggleItem,
                        onSelectAll = cellVm::selectAll,
                        onClearSelection = cellVm::clearSelection,
                        onContinue = cellVm::goChooseAction,
                        onBack = cellVm::backToContents,
                        onAction = cellVm::startAction,
                        onPickLine = cellVm::pickProductionLine,
                        onPickHintCell = cellVm::pickHintProductionCell,
                        onWriteOff = cellVm::confirmWriteOff,
                        onRescanCell = cellVm::reset,
                        onClearError = cellVm::clearError,
                        onStartAdd = cellVm::startAddStock,
                        onAddQuery = cellVm::setAddQuery,
                        onPickAddItem = cellVm::pickAddItem,
                        onAddQty = cellVm::setAddQty,
                        onConfirmAdd = cellVm::confirmAddStock,
                    )
                } else if (selectedAction == ScanAction.COLLECT && collectItems.isNotEmpty() && scanStatus is ScanStatus.Idle) {
                    Column(modifier = Modifier.fillMaxSize()) {
                        Text(
                            "В списке: ${collectItems.size}",
                            color = Color(0xFF616161),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(bottom = 6.dp),
                        )
                        LazyColumn(
                            modifier = Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            items(collectItems, key = { it.id }) { item ->
                                ScanResultCard(
                                    containerColor = Color.White,
                                    titleColor = DarkGreen,
                                    bodyColor = Color(0xFF424242),
                                    subtitleColor = Color(0xFF9E9E9E),
                                    title = item.code.take(48) + if (item.code.length > 48) "…" else "",
                                    code = null,
                                    meta = null,
                                    expiryMessage = null,
                                )
                            }
                        }
                    }
                } else when (val status = scanStatus) {
                    is ScanStatus.Loading -> {
                        ScanLoadingPanel(code = status.scannedCode)
                    }
                    is ScanStatus.CrptSuccess -> {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .verticalScroll(resultScroll),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            status.items.forEach { info ->
                                CrptInfoResultCard(
                                    scannedCode = status.scannedCode,
                                    normalizedCode = status.normalizedCode,
                                    info = info,
                                    style = CrptCardStyle.Scanner,
                                )
                            }
                        }
                    }
                    is ScanStatus.Success -> {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .verticalScroll(resultScroll),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            ScanResultCard(
                                containerColor = Color(0xFFC8E6C9),
                                titleColor = Color(0xFF1B5E20),
                                bodyColor = Color(0xFF2E7D32),
                                subtitleColor = Color(0xFF388E3C),
                                title = status.title,
                                code = status.barcode,
                                meta = status.subtitle,
                                expiryMessage = status.secondaryNote,
                            )
                        }
                    }
                    is ScanStatus.Error -> {
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .verticalScroll(resultScroll),
                        ) {
                            ScanResultCard(
                                containerColor = Color(0xFFFFCDD2),
                                titleColor = Color(0xFFB71C1C),
                                bodyColor = Color(0xFFC62828),
                                subtitleColor = Color(0xFFC62828),
                                title = status.message,
                                code = null,
                                meta = "Сканируйте снова",
                                expiryMessage = null,
                            )
                        }
                    }
                    else -> {
                        ScanIdleHint(selectedAction = selectedAction)
                    }
                }
            }
        }
    }

    LaunchedEffect(actionHint) {
        val hint = actionHint?.trim().orEmpty()
        if (hint.isNotEmpty() && hint != lastShownHint) {
            lastShownHint = hint
            snackbarHostState.showSnackbar(hint)
        }
    }
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun ScanLoadingPanel(code: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularWavyProgressIndicator(
            color = DarkGreen,
            wavelength = 28.dp,
            waveSpeed = 5.dp,
            amplitude = 0.6f
        )
        Spacer(modifier = Modifier.height(14.dp))
        Text("Запрос в ЧЗ…", color = DarkGreen, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
        if (code.isNotBlank()) {
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = code.take(42) + if (code.length > 42) "…" else "",
                color = Color(0xFF757575),
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun ScanIdleHint(selectedAction: ScanAction) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Default.QrCodeScanner,
            contentDescription = null,
            tint = Color(0xFFBDBDBD),
            modifier = Modifier.size(56.dp),
        )
        Spacer(modifier = Modifier.height(14.dp))
        Text(
            text = when (selectedAction) {
                ScanAction.INFO -> "Сканируйте код маркировки"
                ScanAction.CELL -> "Отсканируйте ячейку"
                ScanAction.COLLECT -> "Скан добавится в список"
            },
            color = Color(0xFF757575),
            fontSize = 16.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "Или нажмите «Ручной ввод»",
            color = Color(0xFF9E9E9E),
            fontSize = 13.sp,
            textAlign = TextAlign.Center,
            lineHeight = 18.sp,
        )
    }
}

@Composable
private fun ReceivingScanResultCard(
    title: String,
    documentId: String,
    gtin: String?,
    itemStatus: String?,
    stickerStatus: String?,
    nestedItemName: String?,
    code: String,
    expiryMessage: String?,
    secondaryNote: String?,
    expired: Boolean,
    warning: Boolean,
) {
    val containerColor = when {
        expired -> Color(0xFFFFCDD2)
        warning -> Color(0xFFFFF3E0)
        else -> Color(0xFFC8E6C9)
    }
    val accent = when {
        expired -> Color(0xFFB71C1C)
        warning -> Color(0xFFE65100)
        else -> Color(0xFF1B5E20)
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = containerColor),
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = title,
                color = accent,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                lineHeight = 21.sp,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column {
                    Text("Документ", color = Color(0xFF757575), fontSize = 11.sp)
                    Text(
                        text = documentId.uppercase(),
                        color = accent,
                        fontWeight = FontWeight.Bold,
                        fontSize = 20.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    )
                }
                if (!itemStatus.isNullOrBlank()) {
                    Surface(shape = RoundedCornerShape(8.dp), color = accent.copy(alpha = 0.12f)) {
                        Text(
                            text = itemStatus.replaceFirstChar { it.uppercase() },
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                            color = accent,
                            fontWeight = FontWeight.SemiBold,
                            fontSize = 12.sp,
                        )
                    }
                }
            }

            if (!gtin.isNullOrBlank()) {
                Text("GTIN $gtin", color = Color(0xFF616161), fontSize = 12.sp)
            }
            if (!stickerStatus.isNullOrBlank()) {
                Text(
                    text = "ЧЗ: ${crptStatusRu(stickerStatus)}",
                    color = Color(0xFF616161),
                    fontSize = 12.sp,
                )
            }
            if (!nestedItemName.isNullOrBlank()) {
                Text(
                    text = "Вложение: $nestedItemName",
                    color = Color(0xFF616161),
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                )
            }
            if (!expiryMessage.isNullOrBlank()) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color.White.copy(alpha = 0.55f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = expiryMessage,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        color = accent,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )
                }
            }
            if (!secondaryNote.isNullOrBlank()) {
                Text(
                    text = secondaryNote,
                    color = Color(0xFF757575),
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                )
            }
            Text(
                text = code,
                color = Color(0xFF9E9E9E),
                fontSize = 10.sp,
                lineHeight = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private fun crptStatusRu(code: String): String = when (code.uppercase()) {
    "INTRODUCED" -> "В обороте"
    "APPLIED" -> "Нанесён"
    "EMITTED" -> "Эмитирован"
    "WRITTEN_OFF" -> "Списан"
    "RETIRED", "WITHDRAWN" -> "Выведен"
    else -> code
}

@Composable
private fun ScanResultCard(
    containerColor: Color,
    titleColor: Color,
    bodyColor: Color,
    subtitleColor: Color,
    title: String,
    code: String?,
    meta: String?,
    expiryMessage: String?,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = containerColor),
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = title,
                color = titleColor,
                fontWeight = FontWeight.Bold,
                fontSize = 16.sp,
                lineHeight = 21.sp,
                modifier = Modifier.fillMaxWidth(),
            )
            if (!code.isNullOrBlank()) {
                Text(
                    text = code,
                    color = bodyColor,
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (!meta.isNullOrBlank()) {
                Text(
                    text = meta,
                    color = subtitleColor.copy(alpha = 0.85f),
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            if (!expiryMessage.isNullOrBlank()) {
                Text(
                    text = expiryMessage,
                    color = subtitleColor,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScanHistoryScreen(navController: NavController) {
    val context = LocalContext.current
    val db = remember { WmsDatabase.getDatabase(context) }
    val app = context.applicationContext as WmsApplication
    val viewModel: ScannerViewModel = viewModel(
        factory = ScannerViewModelFactory(db.wmsDao(), app.repository)
    )
    val recentScans by viewModel.recentScans.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Последние сканы", fontWeight = FontWeight.Bold, color = DarkGreen) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SoftWhiteBackground,
                    titleContentColor = DarkGreen
                ),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(imageVector = Icons.Default.ArrowBack, contentDescription = null, tint = DarkGreen)
                    }
                }
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .padding(16.dp)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
        ) {
            Text(
                "Показываем не более 100 последних сканов",
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFF5F5F5F)
            )
            Spacer(modifier = Modifier.height(10.dp))
            recentScans.take(100).forEach { scan ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 10.dp)
                    ) {
                        Text(scan.barcode, fontWeight = FontWeight.Medium, color = DarkGreen)
                        Text(
                            SimpleDateFormat("dd.MM.yyyy HH:mm:ss", Locale("ru")).format(Date(scan.timestamp)),
                            style = MaterialTheme.typography.bodySmall,
                            color = Color(0xFF5F5F5F)
                        )
                    }
                }
            }
        }
    }
}

private enum class ScanAction(val label: String, val subtitle: String) {
    INFO("Инфо", "Честный знак"),
    CELL("Ячейка", "Содержимое и действия"),
    COLLECT("Список", "Сбор кодов"),
}
