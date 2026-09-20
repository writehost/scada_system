package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.filled.List
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Keyboard
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.ui.theme.SuccessGreen
import com.scadatable.wms.viewmodel.TaskExecuteViewModel
import com.scadatable.wms.viewmodel.TaskExecuteViewModelFactory

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TaskExecuteScreen(navController: NavController, taskId: String) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val viewModel: TaskExecuteViewModel = viewModel(
        factory = TaskExecuteViewModelFactory(app.repository, taskId),
    )
    val ui by viewModel.ui.collectAsState()
    var manual by remember { mutableStateOf("") }
    var manualOpen by remember { mutableStateOf(false) }
    var codesOpen by remember { mutableStateOf(false) }
    val codesSheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    ScanConsumerEffect(ScanEvents.Consumer.TASKS)
    LaunchedEffect(Unit) {
        ScanEvents.barcodes.collect { raw ->
            if (!ScanEvents.isActive(ScanEvents.Consumer.TASKS)) return@collect
            viewModel.onBarcodeScanned(raw)
        }
    }
    LaunchedEffect(manualOpen) {
        if (manualOpen) {
            kotlinx.coroutines.delay(80)
            runCatching { focusRequester.requestFocus() }
            keyboard?.show()
        }
    }

    val task = ui.task
    val plan = task?.fgPickPlan
    val planned = task?.plannedQty ?: 0.0
    val scanned = ui.scans.sumOf { it.qty }
    val remaining = (planned - scanned).coerceAtLeast(0.0)
    val progress = if (planned > 0) (scanned / planned).toFloat().coerceIn(0f, 1f) else 0f
    val needsStart = TaskExecuteViewModel.needsStart(task)
    val hasStock = plan == null || plan.enough
    val canScan = !ui.done && !needsStart && task != null && hasStock

    fun submitManual() {
        viewModel.onBarcodeScanned(manual)
        manual = ""
        manualOpen = false
        keyboard?.hide()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        task?.taskCode?.ifBlank { "Задание" } ?: "Задание",
                        fontWeight = FontWeight.Bold,
                        color = DarkGreen,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
            )
        },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        if (ui.loading && task == null) {
            Column(
                Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Загрузка задания…", color = Color.Gray)
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
        ) {
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = DarkGreen),
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text(
                            task?.itemName ?: task?.itemCode ?: "Без номенклатуры",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                        )
                        if (!task?.itemCode.isNullOrBlank()) {
                            Text(task?.itemCode.orEmpty(), color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
                        }
                        Spacer(Modifier.height(8.dp))
                        Text(TaskExecuteViewModel.warehouseRoute(task), color = Color.White, fontSize = 15.sp)
                        if (!task?.documentNo.isNullOrBlank()) {
                            Text("Документ ${task?.documentNo}", color = Color.White.copy(alpha = 0.8f), fontSize = 12.sp)
                        }
                    }
                }
            }

            if (plan != null) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(
                            containerColor = if (plan.enough) Color.White else Color(0xFFFFEBEE),
                        ),
                        shape = RoundedCornerShape(20.dp),
                    ) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("Откуда взять", color = Color.Gray, fontSize = 13.sp)
                            Text(
                                plan.suggested?.rowLabel ?: "ряд не найден на плане",
                                color = DarkGreen,
                                fontWeight = FontWeight.Black,
                                fontSize = 22.sp,
                            )
                            val loc = listOfNotNull(
                                plan.suggested?.locationCode,
                                plan.suggested?.planRowId,
                            ).distinct().joinToString(" · ")
                            if (loc.isNotBlank()) {
                                Text(loc, color = Color.Gray, fontSize = 13.sp)
                            }
                            if (!plan.dateFilter.isNullOrBlank()) {
                                Text(
                                    "дата ${TaskExecuteViewModel.formatDate(plan.dateFilter)}",
                                    color = DarkGreen,
                                    fontSize = 13.sp,
                                )
                            }
                            Text(
                                if (plan.enough) {
                                    "на складе ${TaskExecuteViewModel.formatQty(plan.totalAvailable)} шт"
                                } else {
                                    plan.reason ?: "Этого товара нет на складе — отгрузить нельзя"
                                },
                                color = if (plan.enough) SuccessGreen else ErrorRed,
                                fontWeight = FontWeight.Medium,
                            )
                            if (plan.pallets.isNotEmpty()) {
                                OutlinedButton(
                                    onClick = { codesOpen = true },
                                    modifier = Modifier.fillMaxWidth().height(48.dp),
                                    shape = RoundedCornerShape(16.dp),
                                ) {
                                    Icon(Icons.Default.List, contentDescription = null, tint = DarkGreen)
                                    Text("  Список кодов", color = DarkGreen, fontWeight = FontWeight.Bold)
                                }
                                Text(
                                    "Порядок как на плане: первая палета снизу, дальше сверху",
                                    color = Color.Gray,
                                    fontSize = 12.sp,
                                )
                            }
                        }
                    }
                }
            }

            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(20.dp),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Text("Отсканировано", color = Color.Gray, fontSize = 13.sp)
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                TaskExecuteViewModel.formatQty(scanned),
                                fontSize = 48.sp,
                                fontWeight = FontWeight.Black,
                                color = DarkGreen,
                                lineHeight = 52.sp,
                            )
                            Text(
                                " из ${TaskExecuteViewModel.formatQty(planned)}",
                                fontSize = 22.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color.Gray,
                                modifier = Modifier.padding(bottom = 8.dp),
                            )
                        }
                        Spacer(Modifier.height(8.dp))
                        LinearProgressIndicator(
                            progress = { progress },
                            modifier = Modifier.fillMaxWidth().height(8.dp),
                            color = LimeAccent,
                            trackColor = Color(0xFFE8E8E0),
                        )
                        if (!ui.lastOk.isNullOrBlank()) {
                            Spacer(Modifier.height(8.dp))
                            Text(ui.lastOk.orEmpty(), color = SuccessGreen, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }

            if (needsStart && !ui.done) {
                item {
                    Button(
                        onClick = { viewModel.startTask() },
                        enabled = !ui.busy,
                        modifier = Modifier.fillMaxWidth().height(56.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = LimeAccent),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, tint = DarkGreen)
                        Text("  Выполнить задание", color = DarkGreen, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    }
                }
            }

            if (ui.error != null) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Text(ui.error.orEmpty(), color = ErrorRed, modifier = Modifier.padding(12.dp))
                    }
                }
            }

            if (ui.done) {
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Text("Отгрузка проведена", color = SuccessGreen, modifier = Modifier.padding(12.dp))
                    }
                }
            }

            if (canScan) {
                item {
                    Button(
                        onClick = { viewModel.completeTask() },
                        enabled = !ui.busy && remaining <= 0,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = LimeAccent),
                        shape = RoundedCornerShape(16.dp),
                    ) {
                        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = DarkGreen)
                        Text("  Завершить отгрузку", color = DarkGreen, fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (canScan && remaining > 0) {
                item {
                    if (!manualOpen) {
                        OutlinedButton(
                            onClick = { manualOpen = true },
                            enabled = !ui.scanBusy,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            shape = RoundedCornerShape(16.dp),
                        ) {
                            Icon(Icons.Default.Keyboard, contentDescription = null, tint = DarkGreen)
                            Text("  Ввести код вручную", color = DarkGreen)
                        }
                    } else {
                        Card(
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            shape = RoundedCornerShape(20.dp),
                        ) {
                            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedTextField(
                                    value = manual,
                                    onValueChange = { manual = it },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .focusRequester(focusRequester),
                                    singleLine = true,
                                    enabled = !ui.scanBusy,
                                    label = { Text("Код") },
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                                    keyboardActions = KeyboardActions(onDone = { submitManual() }),
                                )
                                Button(
                                    onClick = { submitManual() },
                                    enabled = !ui.scanBusy && manual.isNotBlank(),
                                    modifier = Modifier.fillMaxWidth().height(48.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                                    shape = RoundedCornerShape(12.dp),
                                ) {
                                    Text("Принять", color = Color.White, fontWeight = FontWeight.Bold)
                                }
                                TextButton(
                                    onClick = {
                                        manualOpen = false
                                        manual = ""
                                        keyboard?.hide()
                                    },
                                    modifier = Modifier.fillMaxWidth(),
                                ) {
                                    Text("Отмена", color = Color.Gray)
                                }
                            }
                        }
                    }
                }
            }

            if (ui.scans.isNotEmpty()) {
                items(ui.scans.asReversed().take(8)) { row ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(row.itemName ?: row.itemCode ?: row.code, color = DarkGreen, maxLines = 1)
                                if (!row.expiresAt.isNullOrBlank()) {
                                    Text("до ${TaskExecuteViewModel.formatDate(row.expiresAt)}", fontSize = 12.sp, color = Color.Gray)
                                }
                            }
                            Text(TaskExecuteViewModel.formatQty(row.qty), fontWeight = FontWeight.Bold, color = DarkGreen)
                        }
                    }
                }
            }
        }

        if (codesOpen && plan != null) {
            ModalBottomSheet(
                onDismissRequest = { codesOpen = false },
                sheetState = codesSheet,
                containerColor = Color.White,
            ) {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 640.dp)
                        .padding(horizontal = 16.dp),
                    contentPadding = PaddingValues(bottom = 28.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    item {
                        Text(
                            "Список кодов",
                            fontWeight = FontWeight.Black,
                            fontSize = 20.sp,
                            color = DarkGreen,
                        )
                        Text(
                            "Как на плане: №1 снизу (лицевая), дальше — сверху",
                            color = Color.Gray,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
                        )
                    }
                    items(plan.pallets) { pallet ->
                        val face = pallet.stackRole == "face"
                        Card(
                            colors = CardDefaults.cardColors(
                                containerColor = if (face) Color(0xFFE8F5E9) else Color(0xFFF5F5F0),
                            ),
                            shape = RoundedCornerShape(16.dp),
                        ) {
                            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(
                                    Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(
                                        "№${pallet.pickOrder}",
                                        fontWeight = FontWeight.Black,
                                        color = DarkGreen,
                                        fontSize = 18.sp,
                                    )
                                    Text(
                                        pallet.stackLabel.ifBlank {
                                            if (face) "снизу — берите первой" else "сверху"
                                        },
                                        color = if (face) SuccessGreen else Color.Gray,
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 13.sp,
                                    )
                                }
                                Text(
                                    pallet.lpn.ifBlank { pallet.palletCode.orEmpty() },
                                    color = DarkGreen,
                                    fontWeight = FontWeight.Medium,
                                )
                                val meta = buildString {
                                    append("позиция ${pallet.position}")
                                    if (pallet.bottles > 0) append(" · ${TaskExecuteViewModel.formatQty(pallet.bottles)} бут.")
                                    if (pallet.blocks > 0) append(" · ${pallet.blocks} бл.")
                                    pallet.manufacturedAt?.takeIf { it.isNotBlank() }?.let {
                                        append(" · ${TaskExecuteViewModel.formatDate(it)}")
                                    }
                                }
                                Text(meta, color = Color.Gray, fontSize = 12.sp)
                                if (pallet.codes.isNotEmpty()) {
                                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp), color = Color(0xFFE0E0D8))
                                    pallet.codes.forEach { row ->
                                        val kind = when (row.kind) {
                                            "pallet" -> "палета"
                                            "block" -> "блок"
                                            else -> "код"
                                        }
                                        Text(
                                            "$kind  ${row.code}",
                                            color = DarkGreen,
                                            fontSize = 12.sp,
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
}
