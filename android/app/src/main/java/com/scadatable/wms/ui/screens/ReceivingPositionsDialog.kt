package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.scadatable.wms.data.local.ReceivingItemView
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceivingPositionsDialog(
    documentId: String,
    items: List<ReceivingItemView>,
    totalQty: Double,
    onDismiss: () -> Unit,
    onEditItem: (ReceivingItemView) -> Unit,
    onReprint: ((ReceivingItemView) -> Unit)? = null,
    deletePositionsMode: Boolean = false,
    selectedForDelete: List<Long> = emptyList(),
    onToggleDelete: ((Long) -> Unit)? = null,
    reprintMode: Boolean = false,
    selectedForReprint: List<Long> = emptyList(),
    onToggleReprint: ((Long) -> Unit)? = null,
    onConfirmReprint: (() -> Unit)? = null,
    onCancelMode: (() -> Unit)? = null,
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = SoftWhiteBackground,
        ) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = {
                            Column {
                                Text(
                                    if (deletePositionsMode) "Удаление позиций" else if (reprintMode) "Выбор для печати" else "Позиции документа",
                                    fontWeight = FontWeight.Bold,
                                    color = DarkGreen,
                                    fontSize = 16.sp,
                                )
                                Text(
                                    "${documentId.uppercase()} · ${items.size} поз. · ${formatReceivingQty(totalQty)} шт",
                                    fontSize = 12.sp,
                                    color = Color(0xFF6B6B6B),
                                )
                            }
                        },
                        navigationIcon = {
                            IconButton(onClick = onDismiss) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowBack,
                                    contentDescription = "Назад",
                                    tint = DarkGreen,
                                )
                            }
                        },
                        colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                    )
                },
                bottomBar = {
                    if (reprintMode && onConfirmReprint != null) {
                        Surface(shadowElevation = 8.dp, color = Color.White) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.spacedBy(10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                OutlinedButton(
                                    onClick = { onCancelMode?.invoke() ?: onDismiss() },
                                    modifier = Modifier.weight(1f),
                                    shape = RoundedCornerShape(12.dp),
                                ) {
                                    Text("Отмена")
                                }
                                Button(
                                    onClick = onConfirmReprint,
                                    enabled = selectedForReprint.isNotEmpty(),
                                    modifier = Modifier.weight(1.4f),
                                    shape = RoundedCornerShape(12.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                                ) {
                                    Text("Печатать ${selectedForReprint.size}", color = Color.White)
                                }
                            }
                        }
                    }
                },
                containerColor = SoftWhiteBackground,
            ) { padding ->
                if (items.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(padding),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Пока нет отсканированных позиций", color = Color(0xFF757575))
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(padding)
                            .padding(horizontal = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                        contentPadding = PaddingValues(top = 8.dp, bottom = if (reprintMode) 96.dp else 24.dp),
                    ) {
                        items(items, key = { it.id }) { item ->
                            ReceivingPositionCard(
                                item = item,
                                onClick = {
                                    if (deletePositionsMode) {
                                        onToggleDelete?.invoke(item.id)
                                    } else if (reprintMode) {
                                        onToggleReprint?.invoke(item.id)
                                    } else {
                                        onEditItem(item)
                                    }
                                },
                                onReprint = if (!deletePositionsMode && !reprintMode) onReprint?.let { reprint -> { reprint(item) } } else null,
                                isSelected = if (deletePositionsMode) selectedForDelete.contains(item.id) else if (reprintMode) selectedForReprint.contains(item.id) else false,
                                showCheckbox = deletePositionsMode || reprintMode,
                                onToggleSelection = {
                                    if (deletePositionsMode) onToggleDelete?.invoke(item.id)
                                    else if (reprintMode) onToggleReprint?.invoke(item.id)
                                }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ReceivingPositionCard(
    item: ReceivingItemView,
    onClick: () -> Unit,
    onReprint: (() -> Unit)? = null,
    isSelected: Boolean = false,
    showCheckbox: Boolean = false,
    onToggleSelection: () -> Unit = {},
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (showCheckbox) {
                Checkbox(
                    checked = isSelected,
                    onCheckedChange = { onToggleSelection() },
                    modifier = Modifier.padding(start = 8.dp)
                )
            }
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top,
                ) {
                    Text(
                        text = item.productName.ifBlank { item.productBarcode },
                        fontWeight = FontWeight.SemiBold,
                        color = DarkGreen,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        text = "×${formatReceivingQty(item.quantity)}",
                        fontWeight = FontWeight.Bold,
                        color = DarkGreen,
                        fontSize = 18.sp,
                    )
                }
                Text(
                    text = "GTIN ${item.resolvedGtin ?: item.productBarcode}",
                    color = Color(0xFF5A5A5A),
                    fontSize = 12.sp,
                )
                if (!item.batchCode.isNullOrBlank()) {
                    Text(
                        text = "Партия ${item.batchCode}",
                        color = DarkGreen,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                if (!item.scannedCode.isNullOrBlank()) {
                    Text(
                        text = item.scannedCode.take(64) + if (item.scannedCode.length > 64) "…" else "",
                        color = Color(0xFF9E9E9E),
                        fontSize = 10.sp,
                        fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = "Эмиссия: ${formatPositionEmissionDate(item.emissionAt)}",
                        color = Color(0xFF7A7A7A),
                        fontSize = 11.sp,
                    )
                    Text(
                        text = item.status.ifBlank { "—" },
                        color = Color(0xFF2E7D32),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                    )
                }
                if (!showCheckbox) {
                    Text(
                        text = "Нажмите, чтобы изменить количество",
                        color = Color(0xFFB0B0B0),
                        fontSize = 10.sp,
                    )
                }
                if (onReprint != null) {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        TextButton(onClick = onReprint, contentPadding = PaddingValues(0.dp)) {
                            Text("Повторная печать", color = DarkGreen, fontSize = 12.sp)
                        }
                    }
                }
            }
        }
    }
}

private fun formatPositionEmissionDate(ts: Long?): String {
    if (ts == null || ts <= 0L) return "—"
    return SimpleDateFormat("dd.MM.yyyy", Locale("ru")).format(Date(ts))
}
