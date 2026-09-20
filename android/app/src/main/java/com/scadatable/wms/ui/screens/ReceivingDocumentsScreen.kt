package com.scadatable.wms.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.Inventory
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.local.ReceivingDocument
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.receiving.ReceivingDocumentStatus
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceivingDocumentsScreen(navController: NavController, productGroup: String) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val db = remember { WmsDatabase.getDatabase(context) }
    val dao = remember { db.wmsDao() }
    val decodedGroup = MaterialWarehouseGroups.decodeRouteKey(productGroup).trim()
    val showAllDocuments = decodedGroup == ReceivingProductGroups.ALL_DOCS
    val normalizedGroup = if (showAllDocuments) {
        ReceivingProductGroups.ALL_DOCS
    } else {
        decodedGroup.ifBlank { ReceivingProductGroups.STICKERS }
    }
    val groupTitle = if (showAllDocuments) "Все документы" else MaterialWarehouseGroups.titleFor(normalizedGroup)
    val allDocs by dao.getReceivingDocuments().collectAsState(initial = emptyList())
    val groupDocs by dao.getReceivingDocumentsByGroup(normalizedGroup).collectAsState(initial = emptyList())
    val docs = if (showAllDocuments) allDocs else groupDocs
    val activeDocId by app.appPrefs.activeReceivingDocId.collectAsState(initial = null)
    val scope = rememberCoroutineScope()
    var itemCounts by remember { mutableStateOf<Map<String, Int>>(emptyMap()) }
    var stockPostedIds by remember { mutableStateOf<Set<String>>(emptySet()) }
    var postingDocId by remember { mutableStateOf<String?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }

    suspend fun refreshStockPosted() {
        stockPostedIds = app.repository.fetchStockPostedDocumentIds().getOrElse { emptySet() }
    }

    LaunchedEffect(docs) {
        itemCounts = docs.associate { doc -> doc.id to dao.countReceivingItems(doc.id) }
        refreshStockPosted()
    }

    val openDocs = docs.filter { it.status != ReceivingDocumentStatus.CLOSED || it.id == activeDocId }
    val closedDocs = docs.filter { it.status == ReceivingDocumentStatus.CLOSED && it.id != activeDocId }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Документы", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(
                            if (showAllDocuments) "Все группы" else groupTitle,
                            fontSize = 12.sp,
                            color = Color(0xFF6B6B6B),
                        )
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
        floatingActionButton = {
            if (!showAllDocuments) {
                Column(horizontalAlignment = Alignment.End) {
                    SmallFloatingActionButton(
                        onClick = {
                            navController.navigate(
                                Screen.ManualReceivingDocument.createRoute(
                                    MaterialWarehouseGroups.encodeRouteKey(normalizedGroup),
                                ),
                            )
                        },
                        containerColor = Color.White,
                        contentColor = DarkGreen,
                    ) {
                        Icon(Icons.Default.EditNote, contentDescription = "Ручной документ")
                    }
                    Spacer(Modifier.height(10.dp))
                    ExtendedFloatingActionButton(
                        onClick = {
                            navController.navigate(Screen.DocumentWizard.createRoute("receiving"))
                        },
                        containerColor = DarkGreen,
                        contentColor = Color.White,
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text("Новый")
                    }
                }
            }
        },
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        if (docs.isEmpty()) {
            ReceivingDocumentsEmptyState(
                modifier = Modifier.padding(padding),
                showAllDocuments = showAllDocuments,
                onPrimary = {
                    if (showAllDocuments) {
                        navController.navigate(Screen.DocumentWizard.createRoute("receiving"))
                    } else {
                        navController.navigate(Screen.DocumentWizard.createRoute("receiving"))
                    }
                },
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp),
            ) {
                if (!activeDocId.isNullOrBlank() && openDocs.any { it.id == activeDocId }) {
                    item(key = "continue") {
                        val activeDoc = openDocs.first { it.id == activeDocId }
                        ReceivingContinueBanner(
                            docId = activeDocId!!,
                            onClick = {
                                navController.navigate(
                                    Screen.ReceivingSession.createRoute(
                                        receivingDocGroupRoute(activeDoc),
                                        activeDocId!!,
                                    ),
                                )
                            },
                        )
                    }
                }

                if (openDocs.isNotEmpty()) {
                    item(key = "header_open") {
                        ReceivingSectionHeader(
                            title = "Открытые",
                            count = openDocs.size,
                            accent = DarkGreen,
                        )
                    }
                    items(openDocs, key = { it.id }) { doc ->
                        ReceivingOpenDocumentCard(
                            doc = doc,
                            lineCount = itemCounts[doc.id] ?: 0,
                            isActiveSession = doc.id == activeDocId,
                            showGroup = showAllDocuments,
                            onClick = {
                                navController.navigate(
                                    Screen.ReceivingSession.createRoute(receivingDocGroupRoute(doc), doc.id),
                                )
                            },
                        )
                    }
                }

                if (closedDocs.isNotEmpty()) {
                    item(key = "header_closed") {
                        ReceivingSectionHeader(
                            title = "Закрытые",
                            count = closedDocs.size,
                            accent = Color(0xFF757575),
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    items(closedDocs, key = { "closed_${it.id}" }) { doc ->
                        ReceivingClosedDocumentCard(
                            doc = doc,
                            lineCount = itemCounts[doc.id] ?: 0,
                            isPosted = stockPostedIds.contains(doc.id.uppercase()),
                            posting = postingDocId == doc.id,
                            onOpen = {
                                navController.navigate(
                                    Screen.ReceivingSession.createRoute(receivingDocGroupRoute(doc), doc.id),
                                )
                            },
                            onPost = {
                                postingDocId = doc.id
                                scope.launch {
                                    val res = app.repository.finalizeReceivingSession(
                                        documentId = doc.id,
                                        productGroup = doc.productGroup?.trim().orEmpty()
                                            .ifBlank { ReceivingProductGroups.STICKERS },
                                    )
                                    postingDocId = null
                                    res.onSuccess { body ->
                                        snackbarHostState.showSnackbar(
                                            if (body.alreadyPosted == true) {
                                                "Уже проведён · ${body.locationCode ?: "—"}"
                                            } else {
                                                "Проведено · ${body.locationCode ?: "—"}"
                                            },
                                        )
                                        refreshStockPosted()
                                    }.onFailure { err ->
                                        snackbarHostState.showSnackbar(err.message ?: "Ошибка проведения")
                                    }
                                }
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ReceivingContinueBanner(docId: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = LimeAccent.copy(alpha = 0.45f)),
        shape = RoundedCornerShape(18.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(shape = CircleShape, color = DarkGreen) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.padding(10.dp).size(22.dp),
                )
            }
            Column(modifier = Modifier.weight(1f)) {
                Text("Продолжить сканирование", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 14.sp)
                Text(
                    docId.uppercase(),
                    fontFamily = FontFamily.Monospace,
                    color = DarkGreen,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = DarkGreen)
        }
    }
}

@Composable
private fun ReceivingSectionHeader(title: String, count: Int, accent: Color, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, fontWeight = FontWeight.Bold, color = accent, fontSize = 15.sp)
        Surface(shape = RoundedCornerShape(999.dp), color = accent.copy(alpha = 0.12f)) {
            Text(
                count.toString(),
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                color = accent,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReceivingOpenDocumentCard(
    doc: ReceivingDocument,
    lineCount: Int,
    isActiveSession: Boolean,
    showGroup: Boolean,
    onClick: () -> Unit,
) {
    val statusLabel = ReceivingDocumentStatus.displayLabel(
        status = if (isActiveSession) ReceivingDocumentStatus.ACTIVE else doc.status,
        isActiveSession = isActiveSession,
        lineCount = lineCount,
    )
    val statusColor = when {
        statusLabel == "Новый" -> Color(0xFFE65100)
        isActiveSession || doc.status == ReceivingDocumentStatus.ACTIVE -> Color(0xFF2E7D32)
        doc.status == ReceivingDocumentStatus.PAUSED -> Color(0xFFE65100)
        else -> Color(0xFF757575)
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        onClick = onClick,
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(16.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .width(5.dp)
                    .height(88.dp)
                    .background(statusColor)
            )
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(shape = CircleShape, color = statusColor.copy(alpha = 0.12f)) {
                        Icon(
                            Icons.Default.Description,
                            contentDescription = null,
                            tint = statusColor,
                            modifier = Modifier.padding(10.dp).size(20.dp),
                        )
                    }
                    Column {
                        Text(
                            doc.id.uppercase(),
                            color = DarkGreen,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 17.sp,
                        )
                        Text(
                            formatReceivingDocDate(doc.date),
                            color = Color(0xFF6B6B6B),
                            fontSize = 12.sp,
                        )
                        Text(
                            buildString {
                                append("$lineCount поз.")
                                if (showGroup) {
                                    append(" · ")
                                    append(
                                        MaterialWarehouseGroups.titleFor(
                                            doc.productGroup?.trim().orEmpty().ifBlank { ReceivingProductGroups.STICKERS },
                                        ),
                                    )
                                }
                            },
                            color = Color(0xFF9E9E9E),
                            fontSize = 11.sp,
                        )
                    }
                }
                Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Surface(shape = RoundedCornerShape(999.dp), color = statusColor.copy(alpha = 0.12f)) {
                        Text(
                            statusLabel.uppercase(),
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                            color = statusColor,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                    Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = DarkGreen, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
private fun ReceivingClosedDocumentCard(
    doc: ReceivingDocument,
    lineCount: Int,
    isPosted: Boolean,
    posting: Boolean,
    onOpen: () -> Unit,
    onPost: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF8F8F8)),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = CircleShape, color = Color(0xFFE0E0E0)) {
                        Icon(
                            Icons.Default.Inventory,
                            contentDescription = null,
                            tint = Color(0xFF757575),
                            modifier = Modifier.padding(8.dp).size(18.dp),
                        )
                    }
                    Column {
                        Text(
                            doc.id.uppercase(),
                            fontWeight = FontWeight.SemiBold,
                            fontFamily = FontFamily.Monospace,
                            color = Color(0xFF616161),
                        )
                        Text(
                            "$lineCount поз. · ${formatReceivingDocDate(doc.date)}",
                            fontSize = 11.sp,
                            color = Color(0xFF9E9E9E),
                        )
                    }
                }
                Surface(
                    shape = RoundedCornerShape(999.dp),
                    color = if (isPosted) Color(0xFFE8F5E9) else Color(0xFFFFF3E0),
                ) {
                    Text(
                        if (isPosted) "На остатке" else "Не проведён",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isPosted) Color(0xFF2E7D32) else Color(0xFFE65100),
                    )
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = onOpen, shape = RoundedCornerShape(12.dp)) {
                    Text("Просмотр", fontSize = 12.sp)
                }
                if (!isPosted && lineCount > 0) {
                    Button(
                        onClick = onPost,
                        enabled = !posting,
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Text(if (posting) "…" else "Провести", color = Color.White, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun ReceivingDocumentsEmptyState(
    modifier: Modifier,
    showAllDocuments: Boolean,
    onPrimary: () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(shape = CircleShape, color = Color(0xFFE8F5E9)) {
            Icon(
                Icons.Default.Description,
                contentDescription = null,
                tint = DarkGreen,
                modifier = Modifier.padding(18.dp).size(36.dp),
            )
        }
        Spacer(Modifier.height(16.dp))
        Text("Нет документов", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 20.sp)
        Text(
            if (showAllDocuments) {
                "Выберите товарную группу и создайте первый документ"
            } else {
                "Создайте документ и начните сканировать коды"
            },
            color = Color(0xFF757575),
            fontSize = 13.sp,
            modifier = Modifier.padding(top = 8.dp, bottom = 20.dp),
        )
        Button(
            onClick = onPrimary,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
            shape = RoundedCornerShape(14.dp),
        ) {
            Text(
                if (showAllDocuments) "Выбрать группу" else "Начать приёмку",
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

private fun formatReceivingDocDate(ts: Long): String =
    SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru")).format(Date(ts))

private fun receivingDocGroupRoute(doc: ReceivingDocument): String {
    val group = doc.productGroup?.trim().orEmpty().ifBlank { ReceivingProductGroups.STICKERS }
    return MaterialWarehouseGroups.encodeRouteKey(group)
}
