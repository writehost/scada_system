package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.LpnNestActionRequest
import com.scadatable.wms.data.remote.ManualReceivingDocumentLineRequest
import com.scadatable.wms.data.remote.RetrofitClient
import com.scadatable.wms.print.LabelPrintService
import com.scadatable.wms.print.WmsLabelQr
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.receiving.evaluateReceivingScanGate
import com.scadatable.wms.ui.components.LabelPreviewDialog
import com.scadatable.wms.ui.components.ScanConsumerEffect
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import kotlinx.coroutines.launch

private enum class TargetKind { CELL, BOX, PALLET }
private enum class PalletSubMode { BOXES, FREE }
private enum class Step {
    CHOOSE_TARGET,
    RESOLVE_CELL,
    RESOLVE_PALLET,
    PALLET_MENU,
    RESOLVE_BOX,
    SCANNING,
    NO_CRPT_ITEM,
    NO_CRPT_QTY,
}

private data class FreeLine(
    val key: String,
    val itemCode: String,
    val itemName: String,
    val qty: Double,
    val markingCode: String?,
    val emissionAt: String?,
    val lotExpiryAt: String?,
    val sourceLabel: String,
    val containerLpn: String?,
)

private fun looksLikeLpn(code: String): Boolean {
    val c = code.trim()
    return c.startsWith("LPN-", ignoreCase = true) || c.startsWith("STK-", ignoreCase = true)
}

private fun looksLikeCrpt(code: String): Boolean {
    val c = code.trim()
    if (c.length < 16) return false
    if (c.contains('\u001D') || c.contains("(01)")) return true
    return c.startsWith("01") && c.length >= 25
}

/** Временный контейнер: короб без кода — LPN и этикетка появятся при закрытии. */
private const val PENDING_BOX = "__PENDING_BOX__"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FreeReceivingScreen(
    navController: NavController,
    prefillLocation: String = "",
    prefillLpn: String = "",
) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    ScanConsumerEffect(ScanEvents.Consumer.FREE_RECEIVING)

    var step by remember { mutableStateOf(Step.CHOOSE_TARGET) }
    var target by remember { mutableStateOf<TargetKind?>(null) }
    var palletSub by remember { mutableStateOf(PalletSubMode.BOXES) }

    var locationCode by remember { mutableStateOf(prefillLocation) }
    var palletCode by remember { mutableStateOf(prefillLpn) }
    var boxCode by remember { mutableStateOf("") }
    var scanInput by remember { mutableStateOf("") }
    var qtyInput by remember { mutableStateOf("1") }
    var itemQuery by remember { mutableStateOf("") }
    var itemHits by remember { mutableStateOf<List<ItemRow>>(emptyList()) }
    var selectedItem by remember { mutableStateOf<ItemRow?>(null) }
    var lines by remember { mutableStateOf<List<FreeLine>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var banner by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf<ReceivingStickerPayload?>(null) }

    fun parseQty(): Double? = qtyInput.replace(",", ".").toDoubleOrNull()?.takeIf { it > 0 }

    fun activeLpn(): String? = when {
        boxCode.isNotBlank() -> boxCode.trim()
        target == TargetKind.BOX -> PENDING_BOX
        target == TargetKind.PALLET && palletSub == PalletSubMode.BOXES && step == Step.SCANNING -> PENDING_BOX
        palletCode.isNotBlank() && target == TargetKind.PALLET && palletSub == PalletSubMode.FREE -> palletCode.trim()
        else -> null
    }

    fun run(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            error = null
            runCatching { block() }
                .onFailure { err ->
                    error = err.message
                    snackbar.showSnackbar(err.message ?: "Ошибка")
                }
            busy = false
        }
    }

    suspend fun buildLpnSticker(
        lpn: String,
        title: String,
        qty: Double = lines.filter { it.containerLpn == lpn }.sumOf { it.qty }.coerceAtLeast(1.0),
    ): ReceivingStickerPayload {
        val baseUrl = app.repository.getReceivingBaseUrl()
        val site = app.repository.getSiteCode()
        val cell = locationCode.trim()
        val qr = WmsLabelQr.buildPayload(
            baseUrl = baseUrl,
            siteCode = site,
            batchCode = lpn,
            cellCode = cell,
            itemCode = null,
            gtin = null,
            qty = qty,
            preferCompact = true,
        )
        return ReceivingStickerPayload(
            batchCode = lpn,
            itemName = title,
            scannedCode = lpn,
            gtin = null,
            qty = qty,
            emissionAt = System.currentTimeMillis(),
            expiresAt = null,
            shelfLifeDays = null,
            cellCode = cell.ifBlank { null },
            qrUrl = qr,
            productGroupLabel = "Грузоместо",
        )
    }

    suspend fun buildItemSticker(item: ItemRow, qty: Double, marking: String?): ReceivingStickerPayload {
        val baseUrl = app.repository.getReceivingBaseUrl()
        val site = app.repository.getSiteCode()
        val batch = marking?.takeIf { it.isNotBlank() }
            ?: "FREE-${item.itemCode}-${System.currentTimeMillis() % 100000}"
        val qr = WmsLabelQr.buildPayload(
            baseUrl = baseUrl,
            siteCode = site,
            batchCode = batch,
            cellCode = locationCode.trim(),
            itemCode = item.itemCode,
            gtin = null,
            qty = qty,
        )
        return ReceivingStickerPayload(
            batchCode = batch,
            itemName = item.name,
            scannedCode = marking,
            gtin = null,
            qty = qty,
            emissionAt = System.currentTimeMillis(),
            expiresAt = null,
            shelfLifeDays = null,
            cellCode = locationCode.trim().ifBlank { null },
            qrUrl = qr,
            productGroupLabel = item.productGroup,
        )
    }

    fun goChooseTarget() {
        step = Step.CHOOSE_TARGET
        target = null
        boxCode = ""
        scanInput = ""
        error = null
        banner = "Выберите цель сканирования"
    }

    fun startTarget(kind: TargetKind) {
        target = kind
        error = null
        when (kind) {
            TargetKind.CELL -> {
                step = if (locationCode.isBlank()) Step.RESOLVE_CELL else Step.SCANNING
                banner = if (locationCode.isBlank()) "Отсканируйте код ячейки" else "Сканируйте товар в ячейку $locationCode"
            }
            TargetKind.PALLET -> {
                step = Step.RESOLVE_PALLET
                banner = "Отсканируйте палету или создайте новую"
            }
            TargetKind.BOX -> {
                // Короб сам по себе: сразу скан короба / работа без кода. Ячейка не нужна.
                step = Step.RESOLVE_BOX
                banner = "Отсканируйте этикетку короба или начните без кода"
            }
        }
    }

    suspend fun resolveCell(raw: String) {
        val code = raw.trim()
        if (code.isBlank()) error("Пустой код ячейки")
        app.repository.applyBaseUrl()
        val detail = app.repository.fetchLocationDetail(code)
        if (detail.isFailure) {
            // fallback: accept typed code if looks like location
            val locs = app.repository.fetchLocations(query = code).getOrNull().orEmpty()
            val match = locs.firstOrNull { it.locationCode.equals(code, true) }
                ?: locs.firstOrNull()
            if (match == null) error(detail.exceptionOrNull()?.message ?: "Ячейка не найдена")
            locationCode = match!!.locationCode
        } else {
            locationCode = detail.getOrThrow().location?.locationCode?.trim()?.takeIf { it.isNotBlank() } ?: code
        }
        banner = "Ячейка $locationCode"
        when (target) {
            TargetKind.CELL -> {
                step = Step.SCANNING
                banner = "Сканируйте товар в ячейку $locationCode"
            }
            TargetKind.BOX -> {
                step = Step.RESOLVE_BOX
                banner = "Отсканируйте короб или создайте"
            }
            TargetKind.PALLET -> {
                step = Step.RESOLVE_PALLET
            }
            null -> step = Step.CHOOSE_TARGET
        }
        scanInput = ""
    }

    suspend fun createOrScanPallet(raw: String?, create: Boolean) {
        app.repository.applyBaseUrl()
        val sc = app.repository.getSiteCode()
        if (locationCode.isBlank()) error("Сначала укажите ячейку")
        if (create) {
            val res = RetrofitClient.api.postLpnNest(
                LpnNestActionRequest(
                    siteCode = sc,
                    action = "create",
                    loadUnitType = "pallet",
                    locationCode = locationCode.trim(),
                )
            )
            val code = res.tree?.lpn?.lpnCode?.trim().orEmpty()
            if (code.isBlank()) error("Не создалась палета")
            palletCode = code
            preview = buildLpnSticker(code, "Палета $code")
            banner = "Палета создана: $code — напечатайте этикетку"
        } else {
            val code = raw?.trim().orEmpty()
            if (code.isBlank()) error("Отсканируйте LPN палеты")
            if (!looksLikeLpn(code)) error("Ожидается LPN/STK палеты")
            RetrofitClient.api.postLpnNest(
                LpnNestActionRequest(
                    siteCode = sc,
                    action = "place",
                    childCode = code,
                    locationCode = locationCode.trim(),
                )
            )
            palletCode = code
            banner = "Палета $code"
        }
        step = Step.PALLET_MENU
        scanInput = ""
    }

    /** Есть этикетка короба — сканируем её. Нет кода — сразу содержимое, LPN+печать при закрытии. */
    suspend fun createOrScanBox(raw: String?, create: Boolean) {
        app.repository.applyBaseUrl()
        val sc = app.repository.getSiteCode()
        if (create) {
            // Старт без кода: не создаём LPN сразу — только после наполнения при закрытии.
            boxCode = ""
            step = Step.SCANNING
            scanInput = ""
            banner = "Сканируйте товар в короб. Этикетка напечатается при закрытии"
            return
        }
        val code = raw?.trim().orEmpty()
        if (code.isBlank()) error("Отсканируйте этикетку короба")
        if (!looksLikeLpn(code)) error("Ожидается LPN/STK короба")
        if (palletCode.isNotBlank()) {
            RetrofitClient.api.postLpnNest(
                LpnNestActionRequest(
                    siteCode = sc,
                    action = "nest",
                    parentCode = palletCode.trim(),
                    childCode = code,
                )
            )
        }
        boxCode = code
        banner = "Короб $code — сканируйте содержимое"
        step = Step.SCANNING
        scanInput = ""
    }

    suspend fun handleContentScan(raw: String) {
        val code = raw.trim()
        if (code.isBlank()) return
        if (looksLikeLpn(code)) {
            // смена контейнера сканом
            app.repository.applyBaseUrl()
            val sc = app.repository.getSiteCode()
            val nest = RetrofitClient.api.getLpnNest(siteCode = sc, code = code)
            val type = nest.tree?.lpn?.loadUnitType.orEmpty().lowercase()
            val lpn = nest.tree?.lpn?.lpnCode ?: code
            if (type.contains("pallet")) {
                palletCode = lpn
                boxCode = ""
                target = TargetKind.PALLET
                step = Step.PALLET_MENU
                banner = "Палета $lpn"
            } else {
                boxCode = lpn
                nest.tree?.parentLpnCode?.let { palletCode = it }
                target = if (palletCode.isNotBlank()) TargetKind.PALLET else TargetKind.BOX
                step = Step.SCANNING
                banner = "Короб $lpn"
            }
            scanInput = ""
            return
        }
        if (!looksLikeCrpt(code) && code.length < 16) {
            error = "Это не код ЧЗ. Нажмите «Нет кода ЧЗ» или отсканируйте DataMatrix"
            return
        }
        val resolved = app.repository.resolveReceivingScan(code).getOrThrow()
        val gate = evaluateReceivingScanGate(
            crptStatus = resolved.crptStatus,
            expiryState = resolved.expiry?.state,
            itemStatus = null,
        )
        if (gate.blocked) error(gate.reason ?: "Приёмка заблокирована")
        val item = resolved.primaryItem ?: error("Нет номенклатуры в ЧЗ")
        val q = parseQty() ?: 1.0
        lines = lines + FreeLine(
            key = "${System.currentTimeMillis()}-${item.itemCode}",
            itemCode = item.itemCode,
            itemName = item.name,
            qty = q,
            markingCode = resolved.normalizedCode ?: code,
            emissionAt = resolved.expiry?.emissionAt,
            lotExpiryAt = resolved.expiry?.expiresAt,
            sourceLabel = "ЧЗ",
            containerLpn = activeLpn(),
        )
        banner = "Добавлено: ${item.name} × $q" + if (gate.warning) " · срок истекает" else ""
        scanInput = ""
    }

    suspend fun addNoCrptLine(print: Boolean) {
        val item = selectedItem ?: error("Выберите номенклатуру")
        val q = parseQty() ?: error("Количество > 0")
        val gen = app.repository.generateInternalMarkingCodes(item.itemCode).getOrThrow()
        val marking = gen.codes.firstOrNull()?.display ?: gen.codes.firstOrNull()?.raw
        lines = lines + FreeLine(
            key = "${System.currentTimeMillis()}-${item.itemCode}",
            itemCode = item.itemCode,
            itemName = item.name,
            qty = q,
            markingCode = marking,
            emissionAt = null,
            lotExpiryAt = null,
            sourceLabel = "Без ЧЗ",
            containerLpn = activeLpn(),
        )
        if (print) {
            preview = buildItemSticker(item, q, marking)
        }
        selectedItem = null
        itemQuery = ""
        itemHits = emptyList()
        qtyInput = "1"
        step = Step.SCANNING
        banner = "Добавлено без ЧЗ: ${item.name} × $q — сканируйте дальше"
    }

    suspend fun closeBox() {
        app.repository.applyBaseUrl()
        val sc = app.repository.getSiteCode()
        var code = boxCode.trim()
        val pendingLines = lines.filter {
            it.containerLpn == code || it.containerLpn == PENDING_BOX ||
                (code.isBlank() && it.containerLpn.isNullOrBlank() && target == TargetKind.BOX)
        }
        if (code.isBlank()) {
            // Не было этикетки — генерим LPN и печать вместе с содержимым
            val res = RetrofitClient.api.postLpnNest(
                LpnNestActionRequest(
                    siteCode = sc,
                    action = "create",
                    loadUnitType = "box",
                    parentCode = palletCode.trim().takeIf { it.isNotBlank() },
                    locationCode = null,
                )
            )
            code = res.tree?.lpn?.lpnCode?.trim().orEmpty()
            if (code.isBlank()) error("Не удалось создать LPN короба")
            lines = lines.map { line ->
                if (line.containerLpn == PENDING_BOX ||
                    (line.containerLpn.isNullOrBlank() && target == TargetKind.BOX)
                ) {
                    line.copy(containerLpn = code)
                } else {
                    line
                }
            }
        }
        val qtySum = lines.filter { it.containerLpn == code }.sumOf { it.qty }.coerceAtLeast(1.0)
        val firstName = lines.firstOrNull { it.containerLpn == code }?.itemName
        val title = if (firstName != null) "Короб · $firstName" else "Короб $code"
        preview = buildLpnSticker(code, title, qtySum)
        boxCode = ""
        banner = "Короб $code закрыт (${pendingLines.size} поз.) — печать этикетки"
        step = when {
            target == TargetKind.PALLET && palletSub == PalletSubMode.BOXES -> Step.RESOLVE_BOX
            else -> Step.CHOOSE_TARGET
        }
        if (step == Step.RESOLVE_BOX) {
            banner = "Короб $code закрыт. Следующий короб или смените цель"
        }
    }

    suspend fun closePallet() {
        val code = palletCode.trim()
        if (code.isBlank()) error("Палета не открыта")
        if (locationCode.isBlank()) error("Нужна ячейка")
        app.repository.applyBaseUrl()
        val sc = app.repository.getSiteCode()
        RetrofitClient.api.postLpnNest(
            LpnNestActionRequest(
                siteCode = sc,
                action = "place",
                childCode = code,
                locationCode = locationCode.trim(),
            )
        )
        preview = buildLpnSticker(code, "Палета $code")
        boxCode = ""
        banner = "Палета $code закрыта в $locationCode"
        // после закрытия палеты можно провести
        step = Step.CHOOSE_TARGET
        target = null
    }

    suspend fun postStock() {
        if (locationCode.isBlank()) error("Укажите ячейку")
        if (lines.isEmpty()) error("Нет строк")
        val doc = app.repository.postManualReceivingDocument(
            targetLocationCode = locationCode.trim(),
            groupCode = "mixed",
            groupName = "Разносорт",
            comment = "Свободная приёмка (мастер)",
            lines = lines.map {
                ManualReceivingDocumentLineRequest(
                    itemCode = it.itemCode,
                    qty = it.qty,
                    markingCode = it.markingCode,
                    emissionAt = it.emissionAt,
                    lotExpiryAt = it.lotExpiryAt,
                    comment = it.sourceLabel,
                )
            },
        ).getOrThrow()
        app.repository.applyBaseUrl()
        val sc = app.repository.getSiteCode()
        for (line in lines) {
            val lpn = line.containerLpn?.trim().orEmpty()
            if (lpn.isNotEmpty()) {
                RetrofitClient.api.postLpnNest(
                    LpnNestActionRequest(
                        siteCode = sc,
                        action = "addGoods",
                        lpnCode = lpn,
                        itemCode = line.itemCode,
                        qty = line.qty,
                    )
                )
            }
        }
        if (palletCode.isNotBlank()) {
            RetrofitClient.api.postLpnNest(
                LpnNestActionRequest(
                    siteCode = sc,
                    action = "place",
                    childCode = palletCode.trim(),
                    locationCode = locationCode.trim(),
                )
            )
        }
        banner = "Проведено: ${doc.documentId}"
        lines = emptyList()
        snackbar.showSnackbar(banner!!)
        goChooseTarget()
    }

    fun onRawScan(raw: String) {
        run {
            when (step) {
                Step.RESOLVE_CELL -> resolveCell(raw)
                Step.RESOLVE_PALLET -> createOrScanPallet(raw, create = false)
                Step.RESOLVE_BOX -> createOrScanBox(raw, create = false)
                Step.SCANNING -> handleContentScan(raw)
                else -> {
                    scanInput = raw.trim()
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        ScanEvents.barcodes.collect { barcode ->
            if (!ScanEvents.isActive(ScanEvents.Consumer.FREE_RECEIVING)) return@collect
            onRawScan(barcode)
        }
    }

    LaunchedEffect(itemQuery, step) {
        if (step != Step.NO_CRPT_ITEM) return@LaunchedEffect
        val q = itemQuery.trim()
        if (q.length < 2) {
            itemHits = emptyList()
            return@LaunchedEffect
        }
        kotlinx.coroutines.delay(280)
        app.repository.fetchItemsPage(query = q, limit = 30).onSuccess { itemHits = it.items }
    }

    preview?.let { payload ->
        LabelPreviewDialog(
            payload = payload,
            onDismiss = { preview = null },
            onConfirmPrint = {
                scope.launch {
                    val result = LabelPrintService.print(context, app.appPrefs, payload)
                    preview = null
                    result.onSuccess { snackbar.showSnackbar(it) }
                        .onFailure { snackbar.showSnackbar(it.message ?: "Ошибка печати") }
                }
            },
        )
    }

    val stepTitle = when (step) {
        Step.CHOOSE_TARGET -> "Что сканируем?"
        Step.RESOLVE_CELL -> "Ячейка"
        Step.RESOLVE_PALLET -> "Палета"
        Step.PALLET_MENU -> "Палета ${palletCode.ifBlank { "—" }}"
        Step.RESOLVE_BOX -> "Короб"
        Step.SCANNING -> when (target) {
            TargetKind.CELL -> "В ячейку $locationCode"
            TargetKind.BOX -> "Короб ${boxCode.ifBlank { "…" }}"
            TargetKind.PALLET -> if (boxCode.isNotBlank()) "Короб $boxCode" else "Палета $palletCode"
            null -> "Скан"
        }
        Step.NO_CRPT_ITEM -> "Нет кода ЧЗ — номенклатура"
        Step.NO_CRPT_QTY -> "Количество"
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Свободная приёмка", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(stepTitle, fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = {
                        when (step) {
                            Step.CHOOSE_TARGET -> navController.popBackStack()
                            Step.SCANNING, Step.NO_CRPT_ITEM, Step.NO_CRPT_QTY -> goChooseTarget()
                            Step.PALLET_MENU -> {
                                step = Step.RESOLVE_PALLET
                            }
                            Step.RESOLVE_BOX -> {
                                if (target == TargetKind.PALLET) step = Step.PALLET_MENU else goChooseTarget()
                            }
                            else -> goChooseTarget()
                        }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                actions = {
                    if (step != Step.CHOOSE_TARGET) {
                        TextButton(onClick = { goChooseTarget() }) {
                            Text("Цель", color = DarkGreen, fontWeight = FontWeight.SemiBold)
                        }
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // context chips
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                if (locationCode.isNotBlank()) {
                    AssistChip(onClick = {}, label = { Text("Яч. $locationCode", fontSize = 11.sp) })
                }
                if (palletCode.isNotBlank()) {
                    AssistChip(onClick = {}, label = { Text("Пал. $palletCode", fontSize = 11.sp) })
                }
                if (boxCode.isNotBlank()) {
                    AssistChip(onClick = {}, label = { Text("Кор. $boxCode", fontSize = 11.sp) })
                }
                AssistChip(onClick = {}, label = { Text("${lines.size} поз.", fontSize = 11.sp) })
            }

            banner?.let {
                Text(it, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = DarkGreen)
            }
            error?.let {
                Text(it, fontSize = 13.sp, color = Color(0xFFB71C1C))
            }
            if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)

            when (step) {
                Step.CHOOSE_TARGET -> {
                    Text("Сначала выберите цель", color = Color(0xFF6B6B6B), fontSize = 13.sp)
                    WizardBigButton("Ячейка", "Скан ячейки → товар внутрь") {
                        startTarget(TargetKind.CELL)
                    }
                    WizardBigButton("Короб", "Скан этикетки или без кода → товар → печать при закрытии") {
                        startTarget(TargetKind.BOX)
                    }
                    WizardBigButton("Палета", "Создать/скан палеты → короба или свободные позиции") {
                        startTarget(TargetKind.PALLET)
                    }
                    if (lines.isNotEmpty()) {
                        Button(
                            onClick = { run { postStock() } },
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            shape = RoundedCornerShape(14.dp),
                        ) { Text("Провести на склад (${lines.size})") }
                    }
                }

                Step.RESOLVE_CELL -> {
                    ScanField(scanInput, { scanInput = it }, "Код ячейки", onSubmit = { onRawScan(scanInput) })
                    Button(
                        onClick = { onRawScan(scanInput) },
                        enabled = !busy && scanInput.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    ) { Text("Подтвердить ячейку") }
                }

                Step.RESOLVE_PALLET -> {
                    if (locationCode.isBlank()) {
                        Text("Нужна ячейка для палеты", color = Color(0xFFB71C1C))
                        Button(onClick = { step = Step.RESOLVE_CELL }, modifier = Modifier.fillMaxWidth()) {
                            Text("Указать ячейку")
                        }
                    }
                    ScanField(scanInput, { scanInput = it }, "LPN палеты", onSubmit = { onRawScan(scanInput) })
                    Button(
                        onClick = { onRawScan(scanInput) },
                        enabled = !busy && scanInput.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    ) { Text("Отсканирована палета") }
                    OutlinedButton(
                        onClick = { run { createOrScanPallet(null, create = true) } },
                        enabled = !busy && locationCode.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text("Создать палету + печать") }
                }

                Step.PALLET_MENU -> {
                    Text("Палета $palletCode · что добавляем?", fontWeight = FontWeight.SemiBold)
                    WizardBigButton("Короба", "Сканировать/создавать короба на палете") {
                        palletSub = PalletSubMode.BOXES
                        step = Step.RESOLVE_BOX
                        banner = "Откройте короб на палете"
                    }
                    WizardBigButton("Свободные позиции", "Товар прямо на палету (ЧЗ или без кода)") {
                        palletSub = PalletSubMode.FREE
                        boxCode = ""
                        step = Step.SCANNING
                        banner = "Сканируйте ЧЗ на палету $palletCode"
                    }
                    OutlinedButton(
                        onClick = { run { closePallet() } },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text("Закрыть палету") }
                }

                Step.RESOLVE_BOX -> {
                    Text(
                        "Есть этикетка — отсканируйте. Нет кода — сразу сканируйте товар, этикетка короба напечатается при закрытии.",
                        fontSize = 13.sp,
                        color = Color(0xFF6B6B6B),
                    )
                    ScanField(scanInput, { scanInput = it }, "Этикетка короба (LPN)", onSubmit = { onRawScan(scanInput) })
                    Button(
                        onClick = { onRawScan(scanInput) },
                        enabled = !busy && scanInput.isNotBlank(),
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    ) { Text("Отсканирован короб → товар") }
                    OutlinedButton(
                        onClick = { run { createOrScanBox(null, create = true) } },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) { Text("Нет кода короба — сканировать содержимое") }
                    if (target == TargetKind.PALLET) {
                        TextButton(onClick = { step = Step.PALLET_MENU }) {
                            Text("← К меню палеты", color = DarkGreen)
                        }
                    }
                }

                Step.SCANNING -> {
                    Text(
                        "Сканируйте код маркировки",
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 16.sp,
                        color = DarkGreen,
                    )
                    ScanField(scanInput, { scanInput = it }, "ЧЗ / LPN", onSubmit = { onRawScan(scanInput) })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = qtyInput,
                            onValueChange = { qtyInput = it },
                            modifier = Modifier.width(100.dp),
                            label = { Text("Кол-во") },
                            singleLine = true,
                            shape = RoundedCornerShape(12.dp),
                        )
                        Button(
                            onClick = { onRawScan(scanInput) },
                            enabled = !busy && scanInput.isNotBlank(),
                            modifier = Modifier.weight(1f).height(56.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        ) { Text("OK") }
                    }
                    OutlinedButton(
                        onClick = {
                            step = Step.NO_CRPT_ITEM
                            banner = "Выберите номенклатуру — кода ЧЗ нет"
                            error = null
                        },
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) { Text("Нет кода ЧЗ") }

                    if (target == TargetKind.BOX ||
                        (target == TargetKind.PALLET && palletSub == PalletSubMode.BOXES)
                    ) {
                        Button(
                            onClick = { run { closeBox() } },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF455A64)),
                        ) {
                            Text(
                                if (boxCode.isBlank()) "Закрыть короб → создать LPN + печать"
                                else "Закрыть короб → печать",
                            )
                        }
                    }
                    if (target == TargetKind.PALLET && boxCode.isBlank()) {
                        OutlinedButton(
                            onClick = { run { closePallet() } },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Закрыть палету") }
                    }
                    TextButton(onClick = { goChooseTarget() }, modifier = Modifier.fillMaxWidth()) {
                        Text("Сменить цель сканирования", color = DarkGreen)
                    }
                }

                Step.NO_CRPT_ITEM -> {
                    OutlinedTextField(
                        value = itemQuery,
                        onValueChange = {
                            itemQuery = it
                            selectedItem = null
                        },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Поиск номенклатуры") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                    )
                    LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        items(itemHits, key = { it.itemCode }) { it ->
                            Card(
                                onClick = {
                                    selectedItem = it
                                    step = Step.NO_CRPT_QTY
                                    banner = it.name
                                },
                                shape = RoundedCornerShape(12.dp),
                                colors = CardDefaults.cardColors(containerColor = Color.White),
                            ) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(it.name, fontWeight = FontWeight.Medium)
                                    Text(it.itemCode, fontFamily = FontFamily.Monospace, fontSize = 11.sp, color = Color.Gray)
                                }
                            }
                        }
                    }
                    TextButton(onClick = { step = Step.SCANNING }) {
                        Text("← Назад к скану", color = DarkGreen)
                    }
                }

                Step.NO_CRPT_QTY -> {
                    Text(selectedItem?.name ?: "—", fontWeight = FontWeight.Bold, color = DarkGreen)
                    OutlinedTextField(
                        value = qtyInput,
                        onValueChange = { qtyInput = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Количество") },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                    )
                    Button(
                        onClick = { run { addNoCrptLine(print = true) } },
                        enabled = !busy && selectedItem != null,
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                    ) { Text("OK → печать стикера") }
                    TextButton(onClick = { step = Step.NO_CRPT_ITEM }) {
                        Text("← Другая номенклатура", color = DarkGreen)
                    }
                }
            }

            if (lines.isNotEmpty() && step == Step.SCANNING) {
                HorizontalDivider()
                Text("В сессии", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                Column(
                    modifier = Modifier
                        .weight(1f, fill = false)
                        .heightIn(max = 160.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    lines.takeLast(8).reversed().forEach { line ->
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(line.itemName, fontSize = 13.sp, maxLines = 1)
                                Text(
                                    "${line.sourceLabel} · ${line.qty}" +
                                        (line.containerLpn?.let { " · $it" } ?: ""),
                                    fontSize = 11.sp,
                                    color = Color.Gray,
                                )
                            }
                            IconButton(onClick = { lines = lines.filterNot { it.key == line.key } }) {
                                Icon(Icons.Default.Delete, null, tint = Color(0xFFB71C1C))
                            }
                        }
                    }
                }
                Button(
                    onClick = { run { postStock() } },
                    enabled = !busy,
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                ) { Text("Провести на склад (${lines.size})") }
            }
        }
    }
}

@Composable
private fun WizardBigButton(title: String, subtitle: String, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 18.sp, color = DarkGreen)
            Text(subtitle, fontSize = 13.sp, color = Color(0xFF6B6B6B))
        }
    }
}

@Composable
private fun ScanField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    onSubmit: () -> Unit,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        label = { Text(label) },
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
            imeAction = androidx.compose.ui.text.input.ImeAction.Done,
        ),
        keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { onSubmit() }),
    )
}
