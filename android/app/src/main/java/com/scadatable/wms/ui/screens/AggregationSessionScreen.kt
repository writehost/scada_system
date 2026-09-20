package com.scadatable.wms.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.aggregation.AggregationModes
import com.scadatable.wms.data.local.AggregationDocument
import com.scadatable.wms.data.local.AggregationGroupSummary
import com.scadatable.wms.data.local.AggregationLink
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.AggregationMode
import com.scadatable.wms.viewmodel.AggregationViewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun AggregationScreen(navController: NavController, modeRouteKey: String) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val db = remember { WmsDatabase.getDatabase(context) }
    val viewModel: AggregationViewModel = viewModel { AggregationViewModel(db.wmsDao(), app.repository) }

    val sessionMode = remember(modeRouteKey) { AggregationModes.fromRouteKey(modeRouteKey) }
    val modeOption = remember(sessionMode) { AggregationModes.optionFor(sessionMode) }
    val modeTitle = remember(sessionMode) { AggregationModes.titleFor(sessionMode) }
    val modeSubtitle = modeOption?.subtitle.orEmpty()

    ScanConsumerEffect(ScanEvents.Consumer.AGGREGATION)

    LaunchedEffect(sessionMode) {
        viewModel.enterSession(sessionMode)
    }

    val currentDocId by viewModel.currentDocumentId.collectAsState()
    val targetCount by viewModel.targetChildrenCount.collectAsState()
    val parentBarcode by viewModel.parentBarcode.collectAsState()
    val documents by viewModel.documents.collectAsState()
    val groups by viewModel.groups.collectAsState()
    val children by viewModel.children.collectAsState()
    val message by viewModel.message.collectAsState()
    val isUploading by viewModel.isUploading.collectAsState()
    val keyboard = LocalSoftwareKeyboardController.current
    val snackbarHostState = remember { SnackbarHostState() }

    var barcodeInput by remember { mutableStateOf("") }
    var verifyInput by remember { mutableStateOf("") }
    var replaceTarget by remember { mutableStateOf<String?>(null) }
    var replaceInput by remember { mutableStateOf("") }
    var lastShownMessage by remember { mutableStateOf<String?>(null) }
    var showCreateDialog by remember { mutableStateOf(false) }

    val modeKey = remember(sessionMode) { sessionMode.name.lowercase() }
    val recentDocs = remember(documents, modeKey) {
        documents.filter { it.mode == modeKey }.take(5)
    }
    val assembledGroups = remember(groups, parentBarcode) {
        groups.filter { it.closedAt != null && it.parentCode != parentBarcode }
    }

    fun requestCreateDocument() {
        if (AggregationModes.needsTargetQty(sessionMode)) {
            showCreateDialog = true
        } else {
            viewModel.createDocument(0)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(modeTitle, fontWeight = FontWeight.Bold, color = DarkGreen, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(modeSubtitle, fontSize = 12.sp, color = Color(0xFF6B6B6B))
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
        bottomBar = {
            Column {
                if (parentBarcode != null) {
                    Button(
                        onClick = { viewModel.disbandCurrentGroup() },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                            .height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFFFEBEE)),
                        shape = RoundedCornerShape(14.dp),
                    ) {
                        Icon(Icons.Default.LinkOff, contentDescription = null, tint = Color(0xFFC62828))
                        Spacer(Modifier.width(8.dp))
                        Text("Расформировать", color = Color(0xFFC62828), fontWeight = FontWeight.SemiBold)
                    }
                }
                WmsBottomBar(navController)
            }
        },
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item(key = "document") {
                AggregationDocumentCard(
                    docId = currentDocId,
                    targetCount = targetCount,
                    isUploading = isUploading,
                    onCreate = { requestCreateDocument() },
                    onClose = { viewModel.closeDocument() },
                    onUpload = { viewModel.uploadCurrentDocument() },
                )
            }

            if (currentDocId.isNullOrBlank()) {
                item(key = "empty-doc") {
                    AggregationEmptyDocumentCard(onCreate = { requestCreateDocument() })
                }
                if (recentDocs.isNotEmpty()) {
                    item(key = "recent-header") {
                        Text(
                            "Недавние",
                            fontWeight = FontWeight.Bold,
                            color = DarkGreen,
                            fontSize = 14.sp,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    items(recentDocs, key = { it.id }) { doc ->
                        AggregationRecentDocRow(doc = doc, onClick = { viewModel.openDocument(doc.id) })
                    }
                }
            }

            item(key = "parent") {
                if (parentBarcode == null) {
                    AggregationScanPromptCard(
                        label = AggregationModes.parentScanHint(sessionMode),
                        hint = if (currentDocId.isNullOrBlank()) {
                            "Сначала документ"
                        } else if (targetCount > 0) {
                            "затем ${AggregationModes.childLabel(sessionMode).lowercase()} ×$targetCount"
                        } else {
                            "затем ${AggregationModes.childLabel(sessionMode).lowercase()}"
                        },
                        enabled = !currentDocId.isNullOrBlank(),
                    )
                } else {
                    AggregationParentCard(
                        label = AggregationModes.parentLabel(sessionMode),
                        parentCode = parentBarcode!!,
                        childrenCount = children.size,
                        targetCount = targetCount,
                        onCloseGroup = { viewModel.closeCurrentGroup() },
                    )
                }
            }

            if (!currentDocId.isNullOrBlank()) {
                item(key = "scan-input") {
                    OutlinedTextField(
                        value = barcodeInput,
                        onValueChange = { barcodeInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = {
                            Text(
                                if (parentBarcode == null) {
                                    AggregationModes.parentScanHint(sessionMode)
                                } else {
                                    AggregationModes.childScanHint(sessionMode)
                                },
                            )
                        },
                        placeholder = { Text("DataMatrix") },
                        leadingIcon = { Icon(Icons.Default.QrCodeScanner, contentDescription = null, tint = DarkGreen) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            viewModel.onBarcodeScanned(barcodeInput)
                            barcodeInput = ""
                            keyboard?.hide()
                        }),
                        shape = RoundedCornerShape(14.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = DarkGreen,
                            unfocusedBorderColor = Color(0xFFE0E0E0),
                            focusedContainerColor = Color.White,
                            unfocusedContainerColor = Color.White,
                        ),
                    )
                }
            }

            if (!currentDocId.isNullOrBlank() && parentBarcode != null) {
                item(key = "children-header") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${AggregationModes.childLabel(sessionMode)} (${children.size}${if (targetCount > 0) "/$targetCount" else ""})",
                            fontWeight = FontWeight.Bold,
                            color = DarkGreen,
                            fontSize = 14.sp,
                        )
                        if (sessionMode == AggregationMode.EXTRACT) {
                            Surface(shape = RoundedCornerShape(8.dp), color = Color(0xFFFFF3E0)) {
                                Text(
                                    "Изъятие",
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                    color = Color(0xFFE65100),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }
                        }
                    }
                }

                if (children.isEmpty()) {
                    item(key = "children-empty") {
                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFFF7FAF4)),
                            shape = RoundedCornerShape(12.dp),
                        ) {
                            Text(
                                AggregationModes.childScanHint(sessionMode),
                                modifier = Modifier.padding(14.dp),
                                color = Color(0xFF6B6B6B),
                                fontSize = 13.sp,
                            )
                        }
                    }
                } else {
                    items(children, key = { it.id }) { child ->
                        AggregationChildRow(
                            child = child,
                            isExtract = sessionMode == AggregationMode.EXTRACT,
                            onEdit = {
                                replaceTarget = child.childCode
                                replaceInput = child.childCode
                            },
                            onDelete = { viewModel.removeChild(child.childCode) },
                        )
                    }
                }

                item(key = "verify") {
                    OutlinedTextField(
                        value = verifyInput,
                        onValueChange = { verifyInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Проверка") },
                        placeholder = { Text("Код в списке?") },
                        singleLine = true,
                        trailingIcon = {
                            IconButton(onClick = { viewModel.verifyCode(verifyInput) }) {
                                Icon(Icons.Default.Rule, contentDescription = "Проверить", tint = DarkGreen)
                            }
                        },
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = Color.White,
                            unfocusedContainerColor = Color.White,
                        ),
                    )
                }
            }

            if (!currentDocId.isNullOrBlank() && assembledGroups.isNotEmpty()) {
                item(key = "groups-header") {
                    Text(
                        "${AggregationModes.groupsSectionTitle(sessionMode)} (${assembledGroups.size})",
                        fontWeight = FontWeight.Bold,
                        color = DarkGreen,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }
                items(assembledGroups, key = { it.id }) { group ->
                    AggregationGroupRow(
                        group = group,
                        parentLabel = AggregationModes.parentLabel(sessionMode),
                        targetCount = targetCount,
                        onClick = { viewModel.openGroup(group.parentCode) },
                    )
                }
            }
        }
    }

    if (showCreateDialog) {
        AggregationQtyDialog(
            mode = sessionMode,
            onDismiss = { showCreateDialog = false },
            onConfirm = { qty ->
                showCreateDialog = false
                viewModel.createDocument(qty)
            },
        )
    }

    if (replaceTarget != null) {
        AlertDialog(
            onDismissRequest = { replaceTarget = null },
            title = { Text("Замена кода") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Старый: ${replaceTarget ?: ""}", color = Color.Gray, fontSize = 12.sp)
                    OutlinedTextField(
                        value = replaceInput,
                        onValueChange = { replaceInput = it },
                        label = { Text("Новый код") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            },
            confirmButton = {
                Button(onClick = {
                    val oldCode = replaceTarget ?: return@Button
                    viewModel.replaceChild(oldCode, replaceInput)
                    replaceTarget = null
                }) { Text("Заменить") }
            },
            dismissButton = {
                TextButton(onClick = { replaceTarget = null }) { Text("Отмена") }
            },
        )
    }

    LaunchedEffect(Unit) { keyboard?.hide() }
    LaunchedEffect(message) {
        val text = message?.trim().orEmpty()
        if (text.isNotEmpty() && text != lastShownMessage) {
            lastShownMessage = text
            snackbarHostState.showSnackbar(text)
        }
    }
}

@Composable
private fun AggregationQtyDialog(
    mode: AggregationMode,
    onDismiss: () -> Unit,
    onConfirm: (Int) -> Unit,
) {
    val presets = listOf(6, 12)
    var selected by remember { mutableIntStateOf(12) }
    var customMode by remember { mutableStateOf(false) }
    var customText by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(AggregationModes.qtyDialogTitle(mode), fontWeight = FontWeight.Bold, color = DarkGreen) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "Сколько ${AggregationModes.childLabel(mode).lowercase()} в одной упаковке?",
                    fontSize = 13.sp,
                    color = Color(0xFF5A5A5A),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    presets.forEach { n ->
                        FilterChip(
                            selected = !customMode && selected == n,
                            onClick = {
                                customMode = false
                                selected = n
                            },
                            label = { Text("$n") },
                        )
                    }
                    FilterChip(
                        selected = customMode,
                        onClick = { customMode = true },
                        label = { Text("Другое") },
                    )
                }
                if (customMode) {
                    OutlinedTextField(
                        value = customText,
                        onValueChange = { customText = it.filter { ch -> ch.isDigit() }.take(3) },
                        label = { Text("Количество") },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(12.dp),
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val qty = if (customMode) customText.toIntOrNull() ?: 0 else selected
                    if (qty in 1..999) onConfirm(qty)
                },
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
            ) { Text("Создать") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена") }
        },
    )
}

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun AggregationDocumentCard(
    docId: String?,
    targetCount: Int,
    isUploading: Boolean,
    onCreate: () -> Unit,
    onClose: () -> Unit,
    onUpload: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text("Документ", fontSize = 11.sp, color = Color(0xFF8A8A8A))
                Text(
                    text = docId?.take(8)?.uppercase() ?: "Не создан",
                    fontWeight = FontWeight.Bold,
                    color = DarkGreen,
                    fontSize = if (docId != null) 20.sp else 16.sp,
                    fontFamily = if (docId != null) FontFamily.Monospace else FontFamily.Default,
                )
                if (docId != null && targetCount > 0) {
                    Text("по $targetCount шт.", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilledTonalIconButton(
                    onClick = onCreate,
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = LimeAccent.copy(alpha = 0.45f),
                        contentColor = DarkGreen,
                    ),
                ) { Icon(Icons.Default.Add, contentDescription = "Новый документ") }
                FilledTonalIconButton(
                    onClick = onUpload,
                    enabled = !docId.isNullOrBlank() && !isUploading,
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = DarkGreen.copy(alpha = 0.12f),
                        contentColor = DarkGreen,
                        disabledContainerColor = Color(0xFFF0F0F0),
                        disabledContentColor = Color(0xFFBDBDBD),
                    ),
                ) {
                    if (isUploading) {
                        CircularWavyProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            color = DarkGreen,
                            wavelength = 16.dp,
                            waveSpeed = 4.dp,
                            amplitude = 0.5f,
                        )
                    } else {
                        Icon(Icons.Default.CloudUpload, contentDescription = "Выгрузить")
                    }
                }
                FilledTonalIconButton(
                    onClick = onClose,
                    enabled = !docId.isNullOrBlank(),
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = Color(0xFFFFEBEE),
                        contentColor = Color(0xFFC62828),
                        disabledContainerColor = Color(0xFFF0F0F0),
                        disabledContentColor = Color(0xFFBDBDBD),
                    ),
                ) { Icon(Icons.Default.Close, contentDescription = "Закрыть документ") }
            }
        }
    }
}

@Composable
private fun AggregationEmptyDocumentCard(onCreate: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF4F7F1)),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(Icons.Default.Description, contentDescription = null, tint = DarkGreen, modifier = Modifier.size(32.dp))
            Text("Новый документ — укажите размер упаковки", color = DarkGreen, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Button(
                onClick = onCreate,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                shape = RoundedCornerShape(12.dp),
            ) { Text("Создать", color = Color.White) }
        }
    }
}

@Composable
private fun AggregationRecentDocRow(doc: AggregationDocument, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.FolderOpen, contentDescription = null, tint = DarkGreen)
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(doc.id.take(8).uppercase(), fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
                Text(
                    buildString {
                        append(doc.status)
                        if (doc.targetChildrenCount > 0) append(" · по ${doc.targetChildrenCount}")
                    },
                    fontSize = 11.sp,
                    color = Color(0xFF8A8A8A),
                )
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color(0xFFBDBDBD))
        }
    }
}

@Composable
private fun AggregationScanPromptCard(label: String, hint: String, enabled: Boolean) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = if (enabled) Color(0xFFF7FAF4) else Color(0xFFF5F5F5)),
    ) {
        Row(
            modifier = Modifier.padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(44.dp)
                    .background(
                        if (enabled) LimeAccent.copy(alpha = 0.4f) else Color(0xFFE0E0E0),
                        RoundedCornerShape(12.dp),
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Default.QrCodeScanner,
                    contentDescription = null,
                    tint = if (enabled) DarkGreen else Color.Gray,
                    modifier = Modifier.size(26.dp),
                )
            }
            Column {
                Text(
                    label,
                    color = if (enabled) DarkGreen else Color(0xFF9E9E9E),
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                )
                Text(
                    hint,
                    color = if (enabled) Color(0xFF6B6B6B) else Color(0xFFBDBDBD),
                    fontSize = 12.sp,
                )
            }
        }
    }
}

@Composable
private fun AggregationParentCard(
    label: String,
    parentCode: String,
    childrenCount: Int,
    targetCount: Int,
    onCloseGroup: () -> Unit,
) {
    val progress = if (targetCount > 0) childrenCount.toFloat() / targetCount.toFloat() else 0f
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = DarkGreen),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.Inventory2, contentDescription = null, tint = LimeAccent, modifier = Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(label.uppercase(), fontSize = 10.sp, color = Color.White.copy(alpha = 0.75f), letterSpacing = 1.sp)
                    Text(
                        parentCode,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        fontSize = 15.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (targetCount > 0) "$childrenCount / $targetCount" else "Вложений: $childrenCount",
                        color = Color.White.copy(alpha = 0.9f),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                FilledTonalIconButton(
                    onClick = onCloseGroup,
                    colors = IconButtonDefaults.filledTonalIconButtonColors(
                        containerColor = Color.White.copy(alpha = 0.2f),
                        contentColor = Color.White,
                    ),
                ) { Icon(Icons.Default.Check, contentDescription = "Закрыть группу") }
            }
            if (targetCount > 0) {
                LinearProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(6.dp),
                    color = LimeAccent,
                    trackColor = Color.White.copy(alpha = 0.25f),
                )
            }
        }
    }
}

@Composable
private fun AggregationGroupRow(
    group: AggregationGroupSummary,
    parentLabel: String,
    targetCount: Int,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF2E7D32))
            Spacer(Modifier.width(10.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(group.parentCode, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    "$parentLabel · ${group.itemsCount}${if (targetCount > 0) "/$targetCount" else ""}",
                    fontSize = 11.sp,
                    color = Color(0xFF8A8A8A),
                )
            }
            Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color(0xFFBDBDBD))
        }
    }
}

@Composable
private fun AggregationChildRow(
    child: AggregationLink,
    isExtract: Boolean,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(child.childCode, fontWeight = FontWeight.Medium, fontSize = 13.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = if (isExtract || child.action == "extract") Color(0xFFFFF3E0) else Color(0xFFE8F5E9),
                ) {
                    Text(
                        if (isExtract || child.action == "extract") "Изъятие" else "OK",
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                        fontSize = 10.sp,
                        color = if (isExtract || child.action == "extract") Color(0xFFE65100) else Color(0xFF2E7D32),
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            IconButton(onClick = onEdit) {
                Icon(Icons.Default.Edit, contentDescription = "Заменить", tint = DarkGreen, modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onDelete) {
                Icon(Icons.Default.DeleteOutline, contentDescription = "Удалить", tint = Color(0xFFC62828), modifier = Modifier.size(20.dp))
            }
        }
    }
}
