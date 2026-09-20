package com.scadatable.wms.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.ui.theme.*
import com.scadatable.wms.viewmodel.NomenclatureFilter
import com.scadatable.wms.viewmodel.NomenclatureViewModel
import com.scadatable.wms.viewmodel.NomenclatureViewModelFactory
import java.util.Locale
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NomenclatureScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val vm: NomenclatureViewModel = viewModel(factory = NomenclatureViewModelFactory(app.repository))
    val state by vm.uiState.collectAsState()
    val listState = rememberLazyListState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var selectedItem by remember { mutableStateOf<ItemRow?>(null) }
    var autoOpenedForQuery by remember { mutableStateOf<String?>(null) }
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    fun refocusScanField() {
        focusRequester.requestFocus()
        keyboard?.hide()
    }

    LaunchedEffect(Unit) { refocusScanField() }

    LaunchedEffect(listState, state.visibleItems.size, state.nextCursor, state.loading, state.loadingMore) {
        snapshotFlow {
            val info = listState.layoutInfo
            val lastVisible = info.visibleItemsInfo.lastOrNull()?.index ?: -1
            lastVisible >= info.totalItemsCount - 8
        }.collect { nearEnd ->
            if (nearEnd && state.nextCursor != null && !state.loading && !state.loadingMore) {
                vm.loadMore()
            }
        }
    }

    val visibleItems = remember(state.visibleItems) {
        state.visibleItems.sortedBy { it.name.lowercase(Locale("ru")) }
    }

    val counts = remember(state.items) {
        mapOf(
            NomenclatureFilter.ALL to state.items.size,
            NomenclatureFilter.IN_STOCK to state.items.count { it.availableQty > 0 },
            NomenclatureFilter.MARKED to state.items.count { it.isMarked },
            NomenclatureFilter.DRAFT to state.items.count { it.name.startsWith("Новый товар", ignoreCase = true) },
        )
    }

    LaunchedEffect(state.query, visibleItems, state.loading) {
        if (!state.loading && state.query.length >= 8 && visibleItems.size == 1) {
            if (autoOpenedForQuery != state.query) {
                autoOpenedForQuery = state.query
                selectedItem = visibleItems.first()
            }
        }
        if (state.query.isBlank()) autoOpenedForQuery = null
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Номенклатура", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 16.sp) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                actions = {
                    Text(
                        "${visibleItems.size}/${state.items.size}",
                        color = Color(0xFF9E9E9E),
                        fontSize = 12.sp,
                        modifier = Modifier.padding(end = 4.dp),
                    )
                    IconButton(onClick = { vm.refreshFromServer() }, enabled = !state.syncing) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = DarkGreen, modifier = Modifier.size(22.dp))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 4.dp)
                    .background(Color.White, RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BasicTextField(
                    value = state.query,
                    onValueChange = { vm.onQueryChange(it) },
                    modifier = Modifier
                        .weight(1f)
                        .focusRequester(focusRequester)
                        .onFocusChanged { if (it.isFocused) keyboard?.hide() },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 14.sp, color = Color(0xFF1A1A1A)),
                    cursorBrush = SolidColor(DarkGreen),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { refocusScanField() }),
                    decorationBox = { inner ->
                        if (state.query.isEmpty()) {
                            Text("Скан / GTIN / название", color = Color(0xFFAAAAAA), fontSize = 14.sp)
                        }
                        inner()
                    },
                )
                if (state.query.isNotEmpty()) {
                    IconButton(onClick = { vm.clearQuery(); refocusScanField() }, modifier = Modifier.size(28.dp)) {
                        Icon(Icons.Default.Clear, contentDescription = "Очистить", modifier = Modifier.size(16.dp), tint = Color(0xFF9E9E9E))
                    }
                }
            }

            if (state.query.isBlank()) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    NomenclatureFilter.values().forEach { filter ->
                        val selected = state.filter == filter
                        val count = counts[filter] ?: 0
                        FilterChip(
                            selected = selected,
                            onClick = { vm.toggleFilter(filter) },
                            label = {
                                Text(
                                    "${filter.shortLabel} · $count",
                                    fontSize = 11.sp,
                                    maxLines = 1,
                                )
                            },
                            modifier = Modifier.height(30.dp),
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = DarkGreen,
                                selectedLabelColor = Color.White,
                                containerColor = Color.White,
                                labelColor = Color(0xFF666666),
                            ),
                            border = FilterChipDefaults.filterChipBorder(
                                enabled = true,
                                selected = selected,
                                borderColor = Color(0xFFE0E0E0),
                                selectedBorderColor = DarkGreen,
                            ),
                        )
                    }
                }
            }

            if (state.syncing || state.loading) {
                LinearWavyProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = DarkGreen,
                    wavelength = 24.dp,
                    waveSpeed = 4.dp,
                    amplitude = 0.5f
                )
            }

            state.error?.let { msg ->
                Text(msg, color = ErrorRed, fontSize = 11.sp, modifier = Modifier.padding(horizontal = 10.dp, vertical = 2.dp))
            }

            when {
                state.loading && visibleItems.isEmpty() -> {
                    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularWavyProgressIndicator(
                            color = DarkGreen,
                            modifier = Modifier.size(24.dp),
                            wavelength = 20.dp,
                            waveSpeed = 4.dp,
                            amplitude = 0.5f
                        )
                    }
                }
                !state.loading && visibleItems.isEmpty() -> {
                    Column(
                        Modifier.fillMaxSize().padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text(
                            when {
                                state.query.isNotBlank() -> "Не найдено"
                                state.filter != NomenclatureFilter.ALL -> "Пусто по фильтру"
                                else -> "Нет данных"
                            },
                            color = Color(0xFF9E9E9E),
                            fontSize = 14.sp,
                        )
                        if (state.filter != NomenclatureFilter.ALL) {
                            TextButton(onClick = { vm.toggleFilter(state.filter) }) {
                                Text("Сбросить фильтр", fontSize = 13.sp)
                            }
                        }
                    }
                }
                else -> {
                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        items(
                            items = visibleItems,
                            key = { it.itemCode },
                            contentType = { "row" },
                        ) { item ->
                            NomenclatureListRow(
                                item = item,
                                onClick = { selectedItem = item },
                            )
                        }
                        if (state.loadingMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(8.dp), contentAlignment = Alignment.Center) {
                                    CircularWavyProgressIndicator(
                                        color = DarkGreen,
                                        modifier = Modifier.size(18.dp),
                                        wavelength = 16.dp,
                                        waveSpeed = 3.dp,
                                        amplitude = 0.5f
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (selectedItem != null) {
        ModalBottomSheet(
            onDismissRequest = {
                selectedItem = null
                if (state.query.isNotBlank()) {
                    vm.clearQuery()
                }
                refocusScanField()
            },
            sheetState = sheetState,
            containerColor = Color.White,
        ) {
            NomenclatureDetailSheet(
                item = selectedItem!!,
                onCopy = { text ->
                    copyToClipboard(context, text)
                    selectedItem = null
                    vm.clearQuery()
                    refocusScanField()
                    scope.launch { snackbarHostState.showSnackbar("GTIN скопирован") }
                },
                onDismiss = {
                    selectedItem = null
                    if (state.query.isNotBlank()) vm.clearQuery()
                    refocusScanField()
                },
            )
        }
    }
}

@Composable
private fun NomenclatureListRow(item: ItemRow, onClick: () -> Unit) {
    val article = remember(item.itemCode, item.sku) { displayArticleCode(item.itemCode, item.sku) }
    val isDraft = item.name.startsWith("Новый товар", ignoreCase = true)
    val hasStock = item.availableQty > 0
    val qtyColor = when {
        hasStock -> DarkGreen
        isDraft -> Color(0xFFE65100)
        else -> Color(0xFFBDBDBD)
    }
    val group = productGroupLabel(item.productGroup)

    Surface(
        onClick = onClick,
        color = Color.White,
        shape = RoundedCornerShape(10.dp),
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
        border = BorderStroke(1.dp, Color(0xFFE8EBE8)),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = item.name,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color(0xFF1A1A1A),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    lineHeight = 18.sp,
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        text = article,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 11.sp,
                        color = Color(0xFF757575),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (group != "—") {
                        Text(
                            text = group,
                            fontSize = 10.sp,
                            color = Color(0xFF616161),
                            modifier = Modifier
                                .background(Color(0xFFF0F2F0), RoundedCornerShape(4.dp))
                                .padding(horizontal = 5.dp, vertical = 1.dp),
                            maxLines = 1,
                        )
                    }
                    if (item.isMarked) {
                        Text(
                            text = "ЧЗ",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF1565C0),
                            modifier = Modifier
                                .background(Color(0xFFE3F2FD), RoundedCornerShape(4.dp))
                                .padding(horizontal = 5.dp, vertical = 1.dp),
                        )
                    }
                    if (isDraft) {
                        Text(
                            text = "черн.",
                            fontSize = 10.sp,
                            color = Color(0xFFE65100),
                            modifier = Modifier
                                .background(Color(0xFFFFF3E0), RoundedCornerShape(4.dp))
                                .padding(horizontal = 5.dp, vertical = 1.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    text = formatNomenclatureQty(item.availableQty),
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    color = qtyColor,
                    maxLines = 1,
                )
                Text(
                    text = "ост.",
                    fontSize = 10.sp,
                    color = Color(0xFF9E9E9E),
                )
            }
        }
    }
}

@Composable
private fun NomenclatureDetailSheet(
    item: ItemRow,
    onCopy: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val article = remember(item.itemCode, item.sku) { displayArticleCode(item.itemCode, item.sku) }
    val isDraft = item.name.startsWith("Новый товар", ignoreCase = true)

    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp).padding(bottom = 24.dp)) {
        Text(item.name, fontWeight = FontWeight.Bold, fontSize = 16.sp)
        Spacer(Modifier.height(8.dp))
        NomenclatureDetailRow("GTIN", article)
        if (item.itemCode != article) NomenclatureDetailRow("Код", item.itemCode)
        NomenclatureDetailRow("Группа", productGroupLabel(item.productGroup))
        NomenclatureDetailRow("Доступно", formatNomenclatureQty(item.availableQty))
        if (item.reservedQty > 0) NomenclatureDetailRow("Резерв", formatNomenclatureQty(item.reservedQty))
        if (item.isMarked) NomenclatureDetailRow("ЧЗ", "Да")
        if (isDraft) NomenclatureDetailRow("Статус", "Черновик")
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { onCopy(article) }, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = DarkGreen)) {
                Icon(Icons.Default.ContentCopy, null, modifier = Modifier.size(15.dp))
                Spacer(Modifier.width(4.dp))
                Text("GTIN", fontSize = 13.sp)
            }
            OutlinedButton(onClick = onDismiss, modifier = Modifier.weight(1f)) {
                Text("Далее →", fontSize = 13.sp)
            }
        }
    }
}

@Composable
private fun NomenclatureDetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = Color(0xFF9E9E9E), fontSize = 12.sp)
        Text(
            value,
            fontWeight = FontWeight.Medium,
            fontSize = 12.sp,
            fontFamily = if (label == "GTIN" || label == "Код") FontFamily.Monospace else FontFamily.Default,
        )
    }
}

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("gtin", text))
}

private fun displayArticleCode(itemCode: String, sku: String?): String {
    extractGtin14(itemCode)?.let { return it }
    val compact = itemCode.trim()
    if (compact.all { it.isDigit() } && compact.length in 8..14) return compact
    if (!sku.isNullOrBlank() && sku != itemCode && sku.length <= 24 && !sku.contains("?")) return sku
    if (compact.length > 16) return compact.take(12) + "…"
    return compact
}

private fun extractGtin14(raw: String): String? {
    val compact = raw.replace("\\s".toRegex(), "")
    return Regex("01(\\d{14})").find(compact)?.groupValues?.get(1)
}

private fun productGroupLabel(raw: String?): String {
    if (raw.isNullOrBlank()) return "—"
    return when (raw.lowercase(Locale.ROOT)) {
        "water" -> "Вода"
        "stickers", "sticker" -> "Стикеры"
        else -> raw
    }
}

private fun formatNomenclatureQty(value: Double): String {
    if (value == value.toLong().toDouble()) return value.toLong().toString()
    return "%.1f".format(value).trimEnd('0').trimEnd('.')
}
