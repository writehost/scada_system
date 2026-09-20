package com.scadatable.wms.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Print
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.print.LabelPrintService
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.ui.components.LabelPreviewDialog
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.CreateCodeStep
import com.scadatable.wms.viewmodel.CreateCodeWizardViewModel
import com.scadatable.wms.viewmodel.CreateCodeWizardViewModelFactory
import com.scadatable.wms.viewmodel.MarkingUom
import java.util.EnumMap
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CreateCodeWizardScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val viewModel: CreateCodeWizardViewModel = viewModel(
        factory = CreateCodeWizardViewModelFactory(app.repository),
    )
    val state by viewModel.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }
    var previewPayload by remember { mutableStateOf<ReceivingStickerPayload?>(null) }

    LaunchedEffect(Unit) {
        viewModel.loadItems()
    }

    LaunchedEffect(state.searchQuery) {
        val q = state.searchQuery.trim()
        if (q.length >= 2 || q.isEmpty()) {
            kotlinx.coroutines.delay(if (q.length >= 2) 300 else 0)
            viewModel.loadItems()
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
                    val result = LabelPrintService.print(context, app.appPrefs, payload)
                    previewPayload = null
                    result.onSuccess {
                        snackbarHostState.showSnackbar(it)
                    }.onFailure { err ->
                        snackbarHostState.showSnackbar(err.message ?: "Ошибка печати")
                    }
                }
            },
        )
    }

    val stepLabel = when (state.step) {
        CreateCodeStep.ITEM -> "1/3"
        CreateCodeStep.PARAMS -> "2/3"
        CreateCodeStep.RESULT -> "3/3"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Создать код", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Конструктор маркировки · $stepLabel", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = {
                        if (!viewModel.goBack()) navController.popBackStack()
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = SoftWhiteBackground,
        bottomBar = {
            when (state.step) {
                CreateCodeStep.ITEM -> {
                    Surface(shadowElevation = 8.dp) {
                        Button(
                            onClick = { viewModel.proceedFromItem() },
                            enabled = state.selectedItem != null && !state.gtinLoading,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        ) {
                            if (state.gtinLoading) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = Color.White,
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text("Далее")
                        }
                    }
                }
                CreateCodeStep.PARAMS -> {
                    Surface(shadowElevation = 8.dp) {
                        Button(
                            onClick = { viewModel.generateCode() },
                            enabled = !state.generating,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        ) {
                            if (state.generating) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(18.dp),
                                    strokeWidth = 2.dp,
                                    color = Color.White,
                                )
                                Spacer(Modifier.width(8.dp))
                            }
                            Text("Сгенерировать код")
                        }
                    }
                }
                CreateCodeStep.RESULT -> {
                    Surface(shadowElevation = 8.dp) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(
                                onClick = { navController.popBackStack() },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text("Готово")
                            }
                            Button(
                                onClick = { viewModel.printLabel() },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) {
                                Icon(Icons.Default.Print, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(6.dp))
                                Text(if (state.printed) "Ещё раз" else "Этикетка")
                            }
                        }
                    }
                }
            }
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(horizontal = 12.dp, vertical = 8.dp),
        ) {
            state.generateError?.let { err ->
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                ) {
                    Text(
                        err,
                        color = Color(0xFF8A1C1C),
                        fontSize = 13.sp,
                        modifier = Modifier.padding(12.dp),
                    )
                }
            }

            when (state.step) {
                CreateCodeStep.ITEM -> ItemPickStep(
                    searchQuery = state.searchQuery,
                    onSearchChange = viewModel::setSearchQuery,
                    items = state.items,
                    loading = state.itemsLoading,
                    error = state.itemsError,
                    selectedItem = state.selectedItem,
                    onSelect = viewModel::selectItem,
                )
                CreateCodeStep.PARAMS -> ParamsStep(
                    item = state.selectedItem,
                    gtinInfo = state.gtinInfo,
                    volumeInput = state.volumeInput,
                    onVolumeChange = viewModel::setVolumeInput,
                    uom = state.uom,
                    onUomChange = viewModel::setUom,
                )
                CreateCodeStep.RESULT -> ResultStep(
                    item = state.selectedItem,
                    gtin = state.result?.gtin.orEmpty(),
                    batchCode = state.result?.batchCode.orEmpty(),
                    code = viewModel.primaryCode(),
                    volumeInput = state.volumeInput,
                    uom = state.uom,
                    cellCode = previewPayload?.cellCode,
                    qrPayload = previewPayload?.qrUrl,
                )
            }
        }
    }
}

@Composable
private fun ItemPickStep(
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    items: List<ItemRow>,
    loading: Boolean,
    error: String?,
    selectedItem: ItemRow?,
    onSelect: (ItemRow) -> Unit,
) {
    Text(
        "Выберите номенклатуру",
        color = Color(0xFF616161),
        fontSize = 13.sp,
        modifier = Modifier.padding(bottom = 8.dp),
    )
    OutlinedTextField(
        value = searchQuery,
        onValueChange = onSearchChange,
        modifier = Modifier.fillMaxWidth(),
        placeholder = { Text("Поиск по названию или коду") },
        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
    )
    if (loading) {
        LinearProgressIndicator(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            color = DarkGreen,
        )
    }
    error?.let {
        Text(it, color = Color(0xFF8A1C1C), fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
    }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        items(items, key = { it.itemCode }) { item ->
            val selected = selectedItem?.itemCode == item.itemCode
            Card(
                onClick = { onSelect(item) },
                colors = CardDefaults.cardColors(
                    containerColor = if (selected) Color(0xFFE8F5E9) else Color.White,
                ),
                border = if (selected) CardDefaults.outlinedCardBorder().copy(width = 2.dp) else null,
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            item.name,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            item.itemCode,
                            fontSize = 12.sp,
                            color = Color(0xFF757575),
                            fontFamily = FontFamily.Monospace,
                        )
                        item.sku?.trim()?.takeIf { it.isNotEmpty() && it != item.itemCode }?.let { sku ->
                            Text("Артикул: $sku", fontSize = 11.sp, color = Color(0xFF9E9E9E))
                        }
                    }
                    Icon(Icons.Default.ChevronRight, contentDescription = null, tint = Color(0xFFBDBDBD))
                }
            }
        }
    }
}

@Composable
private fun ParamsStep(
    item: ItemRow?,
    gtinInfo: com.scadatable.wms.data.remote.ResolveItemGtinResponse?,
    volumeInput: String,
    onVolumeChange: (String) -> Unit,
    uom: MarkingUom,
    onUomChange: (MarkingUom) -> Unit,
) {
    Text(
        item?.name ?: "",
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
        color = DarkGreen,
        modifier = Modifier.padding(bottom = 4.dp),
    )
    Text(
        item?.itemCode.orEmpty(),
        fontSize = 12.sp,
        color = Color(0xFF757575),
        fontFamily = FontFamily.Monospace,
        modifier = Modifier.padding(bottom = 12.dp),
    )

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text("QR / код WMS", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Spacer(Modifier.height(6.dp))
            if (gtinInfo != null) {
                Text(
                    gtinInfo.gtin,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    when (gtinInfo.source) {
                        "existing" -> "Внутренний идентификатор для QR этикетки"
                        else -> "Создан новый код · артикул ${gtinInfo.article}"
                    },
                    fontSize = 12.sp,
                    color = Color(0xFF616161),
                    modifier = Modifier.padding(top = 4.dp),
                )
            } else {
                Text("Определяем код…", color = Color(0xFF757575))
            }
        }
    }

    Text("Объём партии", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(bottom = 6.dp))
    OutlinedTextField(
        value = volumeInput,
        onValueChange = onVolumeChange,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        placeholder = { Text("Например: 1000") },
    )

    Text("Единица", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        MarkingUom.entries.forEach { option ->
            FilterChip(
                selected = uom == option,
                onClick = { onUomChange(option) },
                label = { Text(option.label) },
            )
        }
    }
}

@Composable
private fun ResultStep(
    item: ItemRow?,
    gtin: String,
    batchCode: String,
    code: com.scadatable.wms.data.remote.InternalMarkingCodeDto?,
    volumeInput: String,
    uom: MarkingUom,
    cellCode: String?,
    qrPayload: String?,
) {
    Text(
        "Код создан — QR этикетка WMS",
        fontWeight = FontWeight.Bold,
        fontSize = 16.sp,
        color = DarkGreen,
        modifier = Modifier.padding(bottom = 8.dp),
    )

    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(item?.name.orEmpty(), fontWeight = FontWeight.SemiBold)
            InfoRow("Ячейка", cellCode.orEmpty().ifBlank { "укажите в приёмке / настройках" })
            InfoRow("GTIN", gtin)
            InfoRow("Партия", batchCode)
            InfoRow("Объём", "${volumeInput.trim()} ${uom.label}")
            InfoRow("Серийник", code?.serial.orEmpty())
            Spacer(Modifier.height(8.dp))
            Text("Нажмите «Этикетка» — сначала предпросмотр, потом печать", fontSize = 12.sp, color = Color(0xFF757575))
            if (!qrPayload.isNullOrBlank()) {
                val bmp = remember(qrPayload) { encodePreviewQr(qrPayload, 280) }
                if (bmp != null) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "QR",
                        modifier = Modifier
                            .padding(top = 8.dp)
                            .size(140.dp)
                            .align(Alignment.CenterHorizontally),
                    )
                }
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text("$label: ", fontSize = 12.sp, color = Color(0xFF757575))
        Text(
            value.ifBlank { "—" },
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.weight(1f),
        )
    }
}

private fun encodePreviewQr(text: String, sizePx: Int): Bitmap? {
    return runCatching {
        val hints = EnumMap<EncodeHintType, Any>(EncodeHintType::class.java)
        hints[EncodeHintType.MARGIN] = 1
        val matrix = QRCodeWriter().encode(text.trim(), BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val w = matrix.width
        val h = matrix.height
        val pixels = IntArray(w * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                pixels[y * w + x] = if (matrix[x, y]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
            }
        }
        Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
            it.setPixels(pixels, 0, w, 0, 0, w, h)
        }
    }.getOrNull()
}
