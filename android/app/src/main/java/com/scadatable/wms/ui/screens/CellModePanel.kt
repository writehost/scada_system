package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckBox
import androidx.compose.material.icons.filled.CheckBoxOutlineBlank
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.LocationStockLine
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.viewmodel.CellActionKind
import com.scadatable.wms.viewmodel.CellModePhase
import com.scadatable.wms.viewmodel.CellModeUiState
import com.scadatable.wms.viewmodel.CellWriteOffReason
import com.scadatable.wms.viewmodel.ProductionLineOption

@Composable
fun CellModePanel(
    state: CellModeUiState,
    onToggleItem: (String) -> Unit,
    onSelectAll: () -> Unit,
    onClearSelection: () -> Unit,
    onContinue: () -> Unit,
    onBack: () -> Unit,
    onAction: (CellActionKind) -> Unit,
    onPickLine: (ProductionLineOption) -> Unit,
    onPickHintCell: (com.scadatable.wms.data.remote.LocationRow) -> Unit,
    onWriteOff: (CellWriteOffReason) -> Unit,
    onRescanCell: () -> Unit,
    onClearError: () -> Unit,
    onStartAdd: () -> Unit,
    onAddQuery: (String) -> Unit,
    onPickAddItem: (ItemRow) -> Unit,
    onAddQty: (String) -> Unit,
    onConfirmAdd: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        state.error?.let { msg ->
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE))) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(msg, color = ErrorRed, fontSize = 13.sp)
                    TextButton(onClick = onClearError) { Text("Скрыть") }
                }
            }
        }

        when (val phase = state.phase) {
            is CellModePhase.NeedCellScan -> CellHintCard(
                title = "Отсканируйте ячейку",
                body = "Коды вида A-1, CG-1, OS-… — как на scada25. После скана покажем содержимое.",
            )
            is CellModePhase.Working -> {
                LinearProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = DarkGreen,
                    trackColor = Color(0xFFE0E0E0),
                )
                Text(phase.message, color = Color(0xFF616161), fontSize = 13.sp)
            }
            is CellModePhase.Contents -> CellContentsPanel(
                phase = phase,
                onToggleItem = onToggleItem,
                onSelectAll = onSelectAll,
                onClearSelection = onClearSelection,
                onContinue = onContinue,
                onRescanCell = onRescanCell,
                onStartAdd = onStartAdd,
            )
            is CellModePhase.AddStock -> CellAddStockPanel(
                phase = phase,
                onBack = onBack,
                onQuery = onAddQuery,
                onPickItem = onPickAddItem,
                onQty = onAddQty,
                onConfirm = onConfirmAdd,
            )
            is CellModePhase.ChooseAction -> CellChooseActionPanel(
                phase = phase,
                onBack = onBack,
                onAction = onAction,
            )
            is CellModePhase.PickProductionLine -> CellPickLinePanel(
                phase = phase,
                onBack = onBack,
                onPickLine = onPickLine,
            )
            is CellModePhase.AwaitProductionTarget -> CellAwaitTargetPanel(
                title = "Линия ${phase.lineLabel}",
                subtitle = "Отсканируйте ячейку ожидания на линии или выберите из списка",
                source = phase.locationCode,
                selected = phase.selected,
                onBack = onBack,
                hints = phase.hintCells.map { it.locationCode to (it.displayName ?: it.locationCode) },
                onHint = { code ->
                    phase.hintCells.firstOrNull { it.locationCode.equals(code, true) }?.let(onPickHintCell)
                },
            )
            is CellModePhase.PickWriteOffReason -> CellWriteOffPanel(
                phase = phase,
                onBack = onBack,
                onWriteOff = onWriteOff,
            )
            is CellModePhase.AwaitMoveTarget -> CellAwaitTargetPanel(
                title = "Перемещение",
                subtitle = "Откуда: ${phase.locationCode}. Отсканируйте ячейку назначения.",
                source = phase.locationCode,
                selected = phase.selected,
                onBack = onBack,
                hints = emptyList(),
                onHint = {},
            )
            is CellModePhase.Done -> {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Готово", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
                        Text(phase.message, color = DarkGreen, fontSize = 13.sp, lineHeight = 18.sp)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = onRescanCell) { Text("Другая ячейка") }
                            if (!phase.locationCode.isNullOrBlank()) {
                                OutlinedButton(onClick = onBack) { Text("Обновить") }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CellHintCard(title: String, body: String) {
    Card(
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(
            Modifier.padding(20.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(title, fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
            Text(body, color = Color(0xFF757575), fontSize = 13.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
private fun CellContentsPanel(
    phase: CellModePhase.Contents,
    onToggleItem: (String) -> Unit,
    onSelectAll: () -> Unit,
    onClearSelection: () -> Unit,
    onContinue: () -> Unit,
    onRescanCell: () -> Unit,
    onStartAdd: () -> Unit,
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = LimeAccent.copy(alpha = 0.35f)),
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Ячейка", fontSize = 11.sp, color = Color(0xFF5A5A5A))
            Text(
                phase.displayName?.takeIf { it.isNotBlank() } ?: phase.locationCode,
                fontWeight = FontWeight.Bold,
                color = DarkGreen,
                fontSize = 18.sp,
            )
            if (!phase.displayName.isNullOrBlank()) {
                Text(phase.locationCode, fontFamily = FontFamily.Monospace, fontSize = 12.sp, color = Color(0xFF616161))
            }
            TextButton(onClick = onRescanCell, contentPadding = PaddingValues(0.dp)) {
                Text("Сменить ячейку", fontSize = 12.sp)
            }
        }
    }

    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Содержимое", fontWeight = FontWeight.SemiBold, color = DarkGreen)
        Row(verticalAlignment = Alignment.CenterVertically) {
            FilledIconButton(
                onClick = onStartAdd,
                modifier = Modifier.size(36.dp),
                colors = IconButtonDefaults.filledIconButtonColors(
                    containerColor = LimeAccent,
                    contentColor = DarkGreen,
                ),
            ) {
                Icon(Icons.Default.Add, contentDescription = "Добавить в ячейку")
            }
            TextButton(onClick = onSelectAll) { Text("Все", fontSize = 12.sp) }
            TextButton(onClick = onClearSelection) { Text("Сброс", fontSize = 12.sp) }
        }
    }

    if (phase.stock.isEmpty()) {
        Text("Ячейка пуста — нажмите +, чтобы добавить номенклатуру", color = Color.Gray, fontSize = 13.sp)
    } else {
        phase.stock.forEach { line ->
            val checked = line.itemCode in phase.selected
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .toggleable(value = checked, role = Role.Checkbox) { onToggleItem(line.itemCode) },
                colors = CardDefaults.cardColors(
                    containerColor = if (checked) Color(0xFFE8F5E9) else Color.White,
                ),
                shape = RoundedCornerShape(10.dp),
            ) {
                Row(
                    Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        if (checked) Icons.Default.CheckBox else Icons.Default.CheckBoxOutlineBlank,
                        contentDescription = null,
                        tint = DarkGreen,
                    )
                    Column(Modifier.weight(1f)) {
                        Text(line.name ?: line.itemCode, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 14.sp)
                        Text(line.itemCode, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color(0xFF888888))
                    }
                    Text(
                        formatWarehouseQty(line.availableQty),
                        fontWeight = FontWeight.Bold,
                        color = DarkGreen,
                        fontSize = 16.sp,
                    )
                }
            }
        }
    }

    Button(
        onClick = onContinue,
        enabled = phase.selected.isNotEmpty(),
        modifier = Modifier.fillMaxWidth().height(48.dp),
    ) {
        Text("Дальше (${phase.selected.size})")
    }
}

@Composable
private fun CellAddStockPanel(
    phase: CellModePhase.AddStock,
    onBack: () -> Unit,
    onQuery: (String) -> Unit,
    onPickItem: (ItemRow) -> Unit,
    onQty: (String) -> Unit,
    onConfirm: () -> Unit,
) {
    Text(
        "Добавить в ${phase.locationCode}",
        fontWeight = FontWeight.Bold,
        color = DarkGreen,
        fontSize = 16.sp,
    )
    Text(
        "Найдите номенклатуру или отсканируйте код / GTIN / артикул",
        color = Color(0xFF757575),
        fontSize = 12.sp,
    )
    OutlinedTextField(
        value = phase.query,
        onValueChange = onQuery,
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("Поиск…", fontSize = 14.sp) },
        singleLine = true,
        shape = RoundedCornerShape(10.dp),
    )
    if (phase.searching) {
        CircularProgressIndicator(
            modifier = Modifier
                .padding(vertical = 8.dp)
                .size(24.dp),
            color = DarkGreen,
            strokeWidth = 3.dp,
        )
    }
    phase.selected?.let { sel ->
        Card(
            colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(sel.name, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 14.sp)
                Text(sel.itemCode, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color(0xFF757575))
                OutlinedTextField(
                    value = phase.qtyText,
                    onValueChange = onQty,
                    label = { Text("Количество") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                )
                Button(
                    onClick = onConfirm,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) {
                    Text("Добавить в ячейку")
                }
            }
        }
    }
    if (phase.results.isEmpty() && !phase.searching && phase.query.trim().length >= 2) {
        Text("Ничего не найдено", color = Color.Gray, fontSize = 13.sp)
    } else {
        phase.results.take(12).forEach { item ->
            val selected = phase.selected?.itemCode == item.itemCode
            Card(
                onClick = { onPickItem(item) },
                colors = CardDefaults.cardColors(
                    containerColor = if (selected) Color(0xFFE8F5E9) else Color.White,
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text(item.name, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 13.sp)
                    Text(item.itemCode, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color(0xFF888888))
                }
            }
        }
    }
    TextButton(onClick = onBack) { Text("Назад к содержимому") }
}

@Composable
private fun CellChooseActionPanel(
    phase: CellModePhase.ChooseAction,
    onBack: () -> Unit,
    onAction: (CellActionKind) -> Unit,
) {
    Text("Выбрано: ${phase.selected.size} · из ${phase.locationCode}", color = Color(0xFF616161), fontSize = 12.sp)
    Text("Что сделать?", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
    Button(onClick = { onAction(CellActionKind.PRODUCTION) }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
        Text("В производство")
    }
    OutlinedButton(onClick = { onAction(CellActionKind.WRITE_OFF) }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
        Text("Списать")
    }
    OutlinedButton(onClick = { onAction(CellActionKind.MOVE) }, modifier = Modifier.fillMaxWidth().height(48.dp)) {
        Text("Переместить")
    }
    TextButton(onClick = onBack) { Text("Назад к содержимому") }
}

@Composable
private fun CellPickLinePanel(
    phase: CellModePhase.PickProductionLine,
    onBack: () -> Unit,
    onPickLine: (ProductionLineOption) -> Unit,
) {
    Text("Выберите линию", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
    if (phase.loading) {
        CircularProgressIndicator(
            modifier = Modifier
                .padding(vertical = 12.dp)
                .size(28.dp),
            color = DarkGreen,
            strokeWidth = 3.dp,
        )
    } else if (phase.lines.isEmpty()) {
        Text("Линии не найдены. Можно отсканировать ячейку ожидания вручную после выбора любой зоны на сервере.", color = Color.Gray, fontSize = 13.sp)
    } else {
        phase.lines.forEach { line ->
            Card(
                onClick = { onPickLine(line) },
                colors = CardDefaults.cardColors(containerColor = Color.White),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(12.dp)) {
                    Text(line.label, fontWeight = FontWeight.Bold, color = DarkGreen)
                    Text("${line.cells.size} яч. ожидания", fontSize = 12.sp, color = Color(0xFF757575))
                }
            }
        }
    }
    TextButton(onClick = onBack) { Text("Назад") }
}

@Composable
private fun CellWriteOffPanel(
    phase: CellModePhase.PickWriteOffReason,
    onBack: () -> Unit,
    onWriteOff: (CellWriteOffReason) -> Unit,
) {
    Text("Основание списания", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp)
    Text("${phase.selected.size} поз. из ${phase.locationCode}", color = Color(0xFF616161), fontSize = 12.sp)
    CellWriteOffReason.entries.forEach { reason ->
        Button(
            onClick = { onWriteOff(reason) },
            modifier = Modifier.fillMaxWidth().height(48.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828)),
        ) {
            Text(reason.label)
        }
    }
    TextButton(onClick = onBack) { Text("Назад") }
}

@Composable
private fun CellAwaitTargetPanel(
    title: String,
    subtitle: String,
    source: String,
    selected: List<LocationStockLine>,
    onBack: () -> Unit,
    hints: List<Pair<String, String>>,
    onHint: (String) -> Unit,
) {
    CellHintCard(title = title, body = subtitle)
    Text("Источник: $source · позиций ${selected.size}", color = Color(0xFF616161), fontSize = 12.sp)
    if (hints.isNotEmpty()) {
        Text("Быстрый выбор", fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 13.sp)
        hints.forEach { (code, name) ->
            OutlinedButton(
                onClick = { onHint(code) },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("$code · $name", fontSize = 13.sp)
            }
        }
    }
    TextButton(onClick = onBack) { Text("Назад") }
}
