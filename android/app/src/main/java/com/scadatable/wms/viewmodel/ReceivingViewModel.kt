package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.FinalizeReceivingSessionResponse
import com.scadatable.wms.data.local.*
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.receiving.ReceivingDocumentStatus
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.receiving.buildReceivingBatchCode
import com.scadatable.wms.receiving.buildReceivingBatchCodeForItem
import com.scadatable.wms.receiving.buildReceivingBatchQrUrl
import com.scadatable.wms.receiving.evaluateReceivingScanGate
import com.scadatable.wms.receiving.ReceivingGroupMatcher
import com.scadatable.wms.receiving.extractReceivingBatchCode
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.util.UUID

class ReceivingViewModel(
    private val dao: WmsDao,
    private val repository: WmsRepository,
) : ViewModel() {
    enum class ReprintTemplate {
        BASIC,
        INCOMING_ORDER,
    }

    private val _currentDocId = MutableStateFlow<String?>(null)
    val currentDocId: StateFlow<String?> = _currentDocId
    private val _viewOnlyDocId = MutableStateFlow<String?>(null)
    val viewOnlyDocId: StateFlow<String?> = _viewOnlyDocId
    private val _lastClosedDocId = MutableStateFlow<String?>(null)
    val lastClosedDocId: StateFlow<String?> = _lastClosedDocId

    private val _uiState = MutableStateFlow<ReceivingUiState>(ReceivingUiState.Idle)
    val uiState: StateFlow<ReceivingUiState> = _uiState
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val events: SharedFlow<String> = _events.asSharedFlow()
    private val _printSticker = MutableSharedFlow<ReceivingStickerPayload>(extraBufferCapacity = 4)
    val printSticker: SharedFlow<ReceivingStickerPayload> = _printSticker.asSharedFlow()
    private val _pendingStickerBatch = MutableStateFlow<String?>(null)
    val pendingStickerBatch: StateFlow<String?> = _pendingStickerBatch.asStateFlow()
    private val _storageRecommendation = MutableStateFlow<ReceivingStorageRecommendation?>(null)
    val storageRecommendation: StateFlow<ReceivingStorageRecommendation?> = _storageRecommendation.asStateFlow()

    init {
        viewModelScope.launch {
            val activeDocId = repository.getActiveReceivingDocId()
            if (!activeDocId.isNullOrBlank()) {
                val doc = dao.getReceivingDocumentById(activeDocId)
                if (doc?.status == ReceivingDocumentStatus.CLOSED) {
                    repository.setActiveReceivingDocId(null)
                } else {
                    _currentDocId.value = activeDocId
                }
            }
        }

        viewModelScope.launch {
            ScanEvents.barcodes.collect { barcode ->
                if (!ScanEvents.isActive(ScanEvents.Consumer.RECEIVING)) return@collect
                if (
                    _currentDocId.value != null &&
                    _viewOnlyDocId.value == null &&
                    _uiState.value is ReceivingUiState.Idle
                ) {
                    onBarcodeScanned(barcode)
                }
            }
        }
    }

    val warehouses = dao.getAllWarehouses().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val items = combine(_currentDocId, _viewOnlyDocId) { activeId, viewId ->
        activeId ?: viewId
    }.flatMapLatest { id ->
        if (id == null) flowOf(emptyList()) else dao.getReceivingItems(id)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    init {
        viewModelScope.launch {
            items.collectLatest { rows ->
                refreshStorageRecommendation(rows)
            }
        }
    }

    fun createDocument(productGroup: String? = null) {
        val id = UUID.randomUUID().toString().substring(0, 8).uppercase()
        _currentDocId.value = id
        _lastClosedDocId.value = null
        viewModelScope.launch {
            activateDocument(id, createIfMissing = true, productGroup = productGroup)
        }
    }

    fun onBarcodeScanned(barcode: String) {
        if (barcode.isBlank()) return

        viewModelScope.launch {
            val normalized = barcode.trim()
            _uiState.value = ReceivingUiState.Loading(normalized)

            extractReceivingBatchCode(normalized)?.let { batchCode ->
                handleBatchStickerScan(batchCode)
                return@launch
            }

            val resolved = repository.resolveReceivingScan(normalized)
            if (resolved.isSuccess) {
                val body = resolved.getOrThrow()
                val primary = body.primaryItem
                if (primary == null) {
                    _uiState.value = ReceivingUiState.Error("Сервер не вернул номенклатуру")
                    return@launch
                }
                repository.cacheReceivingResolve(body)
                val product = Product(
                    barcode = primary.itemCode,
                    name = primary.name,
                    sku = primary.itemCode,
                    unit = "pcs",
                    groupGtin = body.nestedItem?.gtin,
                    itemsInGroup = body.specQtyPer ?: 1,
                    productGroup = primary.productGroup,
                )
                val itemStatus = mapExpiryStatus(body.expiry?.state)
                val gate = evaluateReceivingScanGate(body.crptStatus, body.expiry?.state, itemStatus)
                val activeGroup = repository.getActiveReceivingProductGroup().orEmpty()
                val groupMismatch = ReceivingGroupMatcher.mismatchMessage(
                    selectedGroup = activeGroup,
                    crptGroup = primary.productGroup,
                    crptGroupLabel = primary.productGroupLabel,
                )
                val prefilledQty = defaultPrefilledQty(null)
                _uiState.value = ReceivingUiState.ConfirmQuantity(
                    product = product,
                    scannedCode = normalized,
                    resolvedGtin = primary.gtin,
                    itemStatus = itemStatus,
                    expiryMessage = groupMismatch ?: body.expiry?.message ?: gate.reason,
                    warnings = body.warnings.orEmpty() + listOfNotNull(groupMismatch),
                    nestedItemName = body.nestedItem?.name,
                    packageRole = primary.packageRole,
                    productGroupLabel = primary.productGroupLabel,
                    generalPackageTypeLabel = primary.generalPackageTypeLabel,
                    emissionAt = parseIsoMillis(body.expiry?.emissionAt),
                    expiresAt = parseIsoMillis(body.expiry?.expiresAt),
                    shelfLifeDays = body.expiry?.shelfLifeDays,
                    crptStatus = body.crptStatus,
                    expiryState = body.expiry?.state,
                    blocked = gate.blocked || groupMismatch != null,
                    blockReason = groupMismatch ?: gate.reason,
                    gateWarning = gate.warning,
                    prefilledQty = prefilledQty,
                )
                return@launch
            }

            val gtin = extractGtin14(normalized)
            val product = if (gtin != null) dao.getProductByGtin(gtin) else dao.getProductByBarcode(normalized)
            if (product != null) {
                _uiState.value = ReceivingUiState.ConfirmQuantity(
                    product = product,
                    scannedCode = normalized,
                    resolvedGtin = gtin,
                    prefilledQty = defaultPrefilledQty(null),
                )
            } else {
                _uiState.value = ReceivingUiState.Error(
                    resolved.exceptionOrNull()?.message ?: "Не удалось получить данные из ЧЗ"
                )
            }
        }
    }

    private suspend fun handleBatchStickerScan(batchCode: String) {
        val lookup = repository.lookupReceivingBatch(batchCode)
        if (lookup.isFailure) {
            _uiState.value = ReceivingUiState.Error(
                lookup.exceptionOrNull()?.message ?: "Стикер партии не найден на сервере"
            )
            return
        }
        val body = lookup.getOrThrow()
        val batch = body.batch
        if (batch?.itemCode.isNullOrBlank()) {
            _uiState.value = ReceivingUiState.Error("В стикере нет номенклатуры")
            return
        }
        val product = dao.getProductByBarcode(batch.itemCode)
            ?: Product(
                barcode = batch.itemCode,
                name = batch.itemName ?: batch.itemCode,
                sku = batch.itemCode,
                unit = "pcs",
                groupGtin = batch.gtin,
            )
        val prefilledQty = body.documentQty?.takeIf { it > 0.0 }
            ?: batch.qty?.takeIf { it > 0.0 }
            ?: defaultPrefilledQty(null)
        val unmarked = batch.gtin.isNullOrBlank()
        _uiState.value = ReceivingUiState.ConfirmQuantity(
            product = product,
            scannedCode = batchCode,
            resolvedGtin = batch.gtin,
            itemStatus = if (unmarked) "без маркировки" else "эммитирован",
            prefilledQty = prefilledQty,
            batchLookupNote = "Стикер партии ${batch.batchCode ?: batchCode}. Подтвердите количество.",
            emissionAt = parseIsoMillis(batch.emissionAtIso),
            expiresAt = parseIsoMillis(batch.expiresAtIso),
        )
    }

    fun confirmQuantity(
        state: ReceivingUiState.ConfirmQuantity,
        quantity: Double,
        printRequested: Boolean = false,
    ) {
        if (state.blocked) return
        if (!quantity.isFinite() || quantity <= 0.0) return
        val docId = _currentDocId.value ?: return
        viewModelScope.launch {
            val codeForEvent = state.scannedCode?.trim().orEmpty().ifBlank { state.product.barcode }
            val existingBatch = extractReceivingBatchCode(state.scannedCode.orEmpty())
            val batchCode = existingBatch
                ?: buildReceivingBatchCodeForItem(
                    itemCode = state.product.barcode,
                    gtin = state.resolvedGtin ?: state.product.groupGtin,
                    emissionAt = state.emissionAt,
                )
            val scanEvent = repository.reportReceivingScanEvent(
                code = codeForEvent,
                documentId = docId,
                qty = quantity,
                itemCode = state.product.barcode,
                itemName = state.product.name,
                stickerStatus = normalizeCrptStatusForPosting(state.crptStatus, state.itemStatus),
                itemStatus = state.itemStatus,
                emissionAtIso = state.emissionAt?.let { java.time.Instant.ofEpochMilli(it).toString() },
                expiryState = state.expiryState,
            )
            if (scanEvent.isFailure) {
                _uiState.value = ReceivingUiState.Error(
                    "Скан не ушёл на сервер: ${scanEvent.exceptionOrNull()?.message ?: "ошибка"}"
                )
                return@launch
            }
            val scanEventId = scanEvent.getOrNull()
            val itemId = dao.insertReceivingItem(
                ReceivingItem(
                    documentId = docId,
                    productBarcode = state.product.barcode,
                    quantity = quantity,
                    scannedCode = state.scannedCode,
                    resolvedGtin = state.resolvedGtin,
                    status = state.itemStatus,
                    emissionAt = state.emissionAt,
                    serverScanEventId = scanEventId,
                    batchCode = batchCode,
                )
            )
            scanEventId?.let {
                if (itemId > 0L) {
                    dao.updateReceivingItemScanEventId(itemId, it)
                }
            }

            val baseUrl = repository.getReceivingBaseUrl()
            val siteCode = repository.getSiteCode()
            val cellCode = dao.getReceivingDocumentById(docId)?.targetLocationCode
                ?.takeIf { it.isNotBlank() }
                ?: repository.getReceivingTargetLocationCode()
            val qrUrl = buildReceivingBatchQrUrl(
                baseUrl = baseUrl,
                siteCode = siteCode,
                batchCode = batchCode,
                cellCode = cellCode,
                itemCode = state.product.barcode,
                gtin = state.resolvedGtin,
                qty = quantity,
            )
            if (existingBatch == null) {
                repository.registerReceivingBatchSticker(
                    batchCode = batchCode,
                    documentId = docId,
                    itemCode = state.product.barcode,
                    itemName = state.product.name,
                    gtin = state.resolvedGtin,
                    qty = quantity,
                    cellCode = cellCode,
                    emissionAtIso = state.emissionAt?.let { java.time.Instant.ofEpochMilli(it).toString() },
                    expiresAtIso = state.expiresAt?.let { java.time.Instant.ofEpochMilli(it).toString() },
                )
            }

            val autoPrint = repository.isAutoPrintReceivingEnabled()
            if ((printRequested || autoPrint) && existingBatch == null) {
                val selectedGroupLabel = selectedReceivingGroupLabel(
                    state.productGroupLabel ?: state.product.productGroup,
                )
                val payload = ReceivingStickerPayload(
                    batchCode = batchCode,
                    itemName = state.product.name,
                    scannedCode = state.scannedCode,
                    gtin = state.resolvedGtin,
                    qty = quantity,
                    emissionAt = state.emissionAt,
                    expiresAt = state.expiresAt,
                    shelfLifeDays = state.shelfLifeDays,
                    cellCode = cellCode,
                    qrUrl = qrUrl,
                    productGroupLabel = selectedGroupLabel,
                )
                _printSticker.emit(payload)
                _events.tryEmit("Отправлено на печать: $batchCode")
            }

            val lineCount = dao.countReceivingItems(docId)
            val docStatus = dao.getReceivingDocumentById(docId)?.status
            if (docStatus != ReceivingDocumentStatus.CLOSED) {
                repository.reportReceivingSessionStatus(
                    documentId = docId,
                    status = ReceivingDocumentStatus.ACTIVE,
                    lineCount = lineCount,
                ).onFailure { err ->
                    _events.tryEmit(
                        "Не удалось отправить статус сессии: ${err.message ?: "ошибка"}"
                    )
                }
            }

            val qtyLabel = formatQtyLabel(quantity)
            _events.tryEmit("✓ Принято $qtyLabel шт · ${state.product.name.take(40)}")

            if (existingBatch != null && _pendingStickerBatch.value == existingBatch) {
                _pendingStickerBatch.value = null
            }
            _uiState.value = ReceivingUiState.Idle
        }
    }

    /**
     * Приёмка без ЧЗ: печатаем STK-стикер, оператор клеит и сканирует его — тогда confirmQuantity.
     */
    fun printManualReceivingSticker(
        itemCode: String,
        itemName: String,
        quantity: Double,
        onDone: (() -> Unit)? = null,
    ) {
        if (!quantity.isFinite() || quantity <= 0.0) return
        val docId = _currentDocId.value ?: return
        viewModelScope.launch {
            val code = itemCode.trim()
            val name = itemName.trim().ifBlank { code }
            if (code.isBlank()) return@launch

            var product = dao.getProductByBarcode(code)
            if (product == null) {
                product = Product(
                    barcode = code,
                    name = name,
                    sku = code,
                    unit = "шт",
                    productGroup = null,
                    isMarked = false,
                )
                dao.insertProduct(product)
            }

            val emissionAt = System.currentTimeMillis()
            val batchCode = buildReceivingBatchCodeForItem(code, null, emissionAt)
            val emissionIso = java.time.Instant.ofEpochMilli(emissionAt).toString()
            val cellCode = dao.getReceivingDocumentById(docId)?.targetLocationCode
                ?.takeIf { it.isNotBlank() }
                ?: repository.getReceivingTargetLocationCode()
            val reg = repository.registerReceivingBatchSticker(
                batchCode = batchCode,
                documentId = docId,
                itemCode = code,
                itemName = name,
                gtin = null,
                qty = quantity,
                cellCode = cellCode,
                emissionAtIso = emissionIso,
                expiresAtIso = null,
            )
            if (reg.isFailure) {
                _uiState.value = ReceivingUiState.Error(
                    "Не удалось зарегистрировать стикер: ${reg.exceptionOrNull()?.message ?: "ошибка"}"
                )
                return@launch
            }

            val baseUrl = repository.getReceivingBaseUrl()
            val siteCode = repository.getSiteCode()
            val qrUrl = buildReceivingBatchQrUrl(
                baseUrl = baseUrl,
                siteCode = siteCode,
                batchCode = batchCode,
                cellCode = cellCode,
                itemCode = code,
                qty = quantity,
            )
            val selectedGroupLabel = selectedReceivingGroupLabel(product.productGroup)
            _printSticker.emit(
                ReceivingStickerPayload(
                    batchCode = batchCode,
                    itemName = name,
                    scannedCode = null,
                    gtin = null,
                    qty = quantity,
                    emissionAt = emissionAt,
                    expiresAt = null,
                    shelfLifeDays = null,
                    cellCode = cellCode,
                    qrUrl = qrUrl,
                    productGroupLabel = selectedGroupLabel,
                )
            )
            _pendingStickerBatch.value = batchCode
            _events.tryEmit("Стикер $batchCode напечатан. Наклейте на товар и отсканируйте код.")
            _uiState.value = ReceivingUiState.Idle
            onDone?.invoke()
        }
    }

    fun setActiveDocument(docId: String, productGroup: String? = null) {
        val normalized = docId.trim()
        if (normalized.isBlank()) return
        _lastClosedDocId.value = null
        viewModelScope.launch {
            prepareDocumentScreen(normalized, productGroup)
        }
    }

    fun switchProductGroup(productGroup: String) {
        val docId = _currentDocId.value?.trim().orEmpty()
        val group = productGroup.trim()
        if (docId.isBlank() || group.isBlank()) return
        viewModelScope.launch {
            repository.switchReceivingDocumentProductGroup(docId, group)
                .onSuccess {
                    _events.tryEmit("Товарная группа: ${MaterialWarehouseGroups.titleFor(group)}")
                }
                .onFailure { err ->
                    _events.tryEmit(err.message ?: "Не удалось сменить группу")
                }
        }
    }

    private suspend fun prepareDocumentScreen(docId: String, productGroup: String? = null) {
        val existing = dao.getReceivingDocumentById(docId)
        if (existing?.status == ReceivingDocumentStatus.CLOSED) {
            _viewOnlyDocId.value = docId
            _currentDocId.value = null
            _uiState.value = ReceivingUiState.Idle
            repository.setActiveReceivingDocId(null)
            return
        }
        _viewOnlyDocId.value = null
        _currentDocId.value = docId
        activateDocument(docId, createIfMissing = true, productGroup = productGroup)
    }

    fun reopenDocument(docId: String, productGroup: String? = null) {
        val normalized = docId.trim()
        if (normalized.isBlank()) return
        _viewOnlyDocId.value = null
        _currentDocId.value = normalized
        _lastClosedDocId.value = null
        viewModelScope.launch {
            activateDocument(normalized, createIfMissing = false, productGroup = productGroup, forceReopen = true)
        }
    }

    fun pauseActiveDocument() {
        val current = _currentDocId.value ?: return
        _currentDocId.value = null
        _uiState.value = ReceivingUiState.Idle
        viewModelScope.launch {
            dao.updateReceivingDocumentStatus(current, ReceivingDocumentStatus.PAUSED)
            repository.setActiveReceivingDocId(null)
            val lineCount = dao.countReceivingItems(current)
            repository.reportReceivingSessionStatus(
                documentId = current,
                status = ReceivingDocumentStatus.PAUSED,
                lineCount = lineCount,
            ).onFailure { err ->
                _events.tryEmit(
                    "Документ приостановлен локально, но статус не ушёл на сервер: ${err.message ?: "ошибка"}"
                )
            }
            _events.tryEmit("Документ $current приостановлен")
        }
    }

    fun clearActiveDocument() {
        val current = _currentDocId.value
        val recommendedLocation = _storageRecommendation.value?.locationCode
        _currentDocId.value = null
        _uiState.value = ReceivingUiState.Idle
        _lastClosedDocId.value = current
        viewModelScope.launch {
            if (current != null) {
                _viewOnlyDocId.value = null
                repository.setActiveReceivingDocId(null)
                dao.updateReceivingDocumentStatus(current, ReceivingDocumentStatus.CLOSED)
                val lineCount = dao.countReceivingItems(current)
                val statusRes = repository.reportReceivingSessionStatus(
                    documentId = current,
                    status = ReceivingDocumentStatus.CLOSED,
                    lineCount = lineCount,
                )
                if (statusRes.isFailure) {
                    repository.reportReceivingSessionStatus(
                        documentId = current,
                        status = ReceivingDocumentStatus.CLOSED,
                        lineCount = lineCount,
                    ).onFailure { err ->
                        _events.tryEmit(
                            "Документ закрыт на ТСД, но веб не обновился: ${err.message ?: "ошибка"}"
                        )
                    }
                }
                repository.syncReceivingDocumentQuantities(current)
                if (repository.isAutoPostReceivingStockEnabled()) {
                    val docTarget = dao.getReceivingDocumentById(current)?.targetLocationCode
                    repository.finalizeReceivingSession(
                        documentId = current,
                        productGroup = repository.getActiveReceivingProductGroup(),
                        targetLocationCode = docTarget?.takeIf { it.isNotBlank() } ?: recommendedLocation,
                    ).onSuccess { body ->
                        if (body.alreadyPosted == true) {
                            _events.tryEmit("Остаток уже проведён · ${body.locationCode ?: "—"}")
                        } else {
                            val parts = body.lines.orEmpty().size
                            _events.tryEmit(
                                "Закрыт и проведён: ${body.movementsCreated ?: parts} партий · ${body.locationCode ?: "—"}"
                            )
                        }
                    }.onFailure { err ->
                        _events.tryEmit(
                            "Документ закрыт. Проведите вручную: ${err.message ?: "ошибка"}"
                        )
                    }
                } else {
                    _events.tryEmit(
                        "Документ $current закрыт. Проведите на остаток в списке «Закрытые» или включите автопроведение в настройках."
                    )
                }
            } else if (current != null) {
                _events.tryEmit("Документ $current закрыт")
            }
        }
    }

    fun deleteCurrentDocument() {
        val docId = _currentDocId.value ?: return
        _currentDocId.value = null
        _uiState.value = ReceivingUiState.Idle
        _lastClosedDocId.value = null
        viewModelScope.launch {
            dao.deleteReceivingItemsByDocument(docId)
            dao.deleteReceivingDocumentById(docId)
            repository.setActiveReceivingDocId(null)
        }
    }

    fun deleteReceivingItem(itemId: Long) {
        viewModelScope.launch {
            dao.deleteReceivingItemById(itemId)
        }
    }

    fun updateReceivingItemQuantity(itemId: Long, quantity: Double) {
        if (!quantity.isFinite() || quantity <= 0.0) return
        viewModelScope.launch {
            dao.updateReceivingItemQuantity(itemId, quantity)
            val item = dao.getReceivingItemById(itemId) ?: return@launch
            repository.syncReceivingScanEventQty(
                itemId = itemId,
                scanEventId = item.serverScanEventId,
                documentId = item.documentId,
                code = item.scannedCode?.trim().orEmpty().ifBlank { item.productBarcode },
                qty = quantity,
            )
        }
    }

    fun reopenLastClosedDocument() {
        val id = _lastClosedDocId.value?.trim().orEmpty()
        if (id.isBlank()) return
        setActiveDocument(id)
    }

    fun postDocumentToStock(docId: String, productGroup: String? = null) {
        val normalized = docId.trim()
        if (normalized.isBlank()) return
        val recommendedLocation = _storageRecommendation.value?.locationCode
        viewModelScope.launch {
            val docTarget = dao.getReceivingDocumentById(normalized)?.targetLocationCode
            repository.finalizeReceivingSession(
                documentId = normalized,
                productGroup = productGroup,
                targetLocationCode = docTarget?.takeIf { it.isNotBlank() } ?: recommendedLocation,
            ).onSuccess { body ->
                if (body.alreadyPosted == true) {
                    _events.tryEmit("Уже проведён на остаток · ${body.locationCode ?: "—"}")
                } else {
                    _events.tryEmit(
                        "Проведено на остаток: ${body.movementsCreated ?: body.lines.orEmpty().size} партий · ${body.locationCode ?: "—"}"
                    )
                }
            }.onFailure { err ->
                _events.tryEmit("Не удалось провести: ${err.message ?: "ошибка"}")
            }
        }
    }

    fun cancelConfirmation() {
        _uiState.value = ReceivingUiState.Idle
    }

    fun createMissingNow(barcode: String, name: String? = null) {
        viewModelScope.launch {
            val res = repository.enqueueNomenclatureDraft(barcode = barcode, name = name)
            if (res.isSuccess) {
                val product = res.getOrThrow()
                _uiState.value = ReceivingUiState.ConfirmQuantity(product = product, scannedCode = barcode)
            } else {
                _uiState.value = ReceivingUiState.Error(res.exceptionOrNull()?.message ?: "Не удалось создать номенклатуру")
            }
        }
    }

    fun createMissingLater(barcode: String) {
        viewModelScope.launch {
            val res = repository.enqueueNomenclatureDraft(
                barcode = barcode,
                name = "Новый товар $barcode (позже)",
            )
            if (res.isSuccess) {
                repository.reportMissingNomenclature(
                    code = barcode,
                    note = "Отсутствует номенклатура, нужно добавить позже"
                )
                _uiState.value = ReceivingUiState.ConfirmQuantity(
                    product = res.getOrThrow(),
                    scannedCode = barcode,
                )
            } else {
                _uiState.value = ReceivingUiState.Error(res.exceptionOrNull()?.message ?: "Не удалось отложить номенклатуру")
            }
        }
    }

    fun syncNomenclatureOutbox() {
        viewModelScope.launch {
            repository.replayNomenclatureOutbox()
        }
    }

    fun reprintSelectedItems(
        itemIds: List<Long>,
        template: ReprintTemplate,
        supplierName: String?,
        receiptDocDate: String?,
    ) {
        if (itemIds.isEmpty()) return
        viewModelScope.launch {
            val now = System.currentTimeMillis()
            dao.markReceivingItemsPrinted(itemIds, status = "нанесен", emissionAt = now)
            val baseUrl = repository.getReceivingBaseUrl()
            val siteCode = repository.getSiteCode()
            val selectedGroupLabel = selectedReceivingGroupLabel()
            for (itemId in itemIds) {
                val item = dao.getReceivingItemById(itemId) ?: continue
                val product = dao.getProductByBarcode(item.productBarcode)
                val emissionAt = item.emissionAt ?: now
                val batchCode = item.batchCode?.trim().orEmpty().ifBlank {
                    buildReceivingBatchCode(item.resolvedGtin, emissionAt).also { generated ->
                        dao.updateReceivingItemBatchCode(itemId, generated)
                    }
                }
                val qrUrl = buildReceivingBatchQrUrl(
                    baseUrl = baseUrl,
                    siteCode = siteCode,
                    batchCode = batchCode,
                    cellCode = item.cellId,
                    itemCode = item.productBarcode,
                    gtin = item.resolvedGtin,
                    qty = item.quantity,
                )
                _printSticker.emit(
                    ReceivingStickerPayload(
                        batchCode = batchCode,
                        itemName = product?.name ?: item.productBarcode,
                        scannedCode = item.scannedCode?.trim().orEmpty().ifBlank { item.productBarcode },
                        gtin = item.resolvedGtin,
                        qty = item.quantity,
                        emissionAt = emissionAt,
                        expiresAt = null,
                        shelfLifeDays = null,
                        cellCode = item.cellId,
                        qrUrl = qrUrl,
                        productGroupLabel = selectedGroupLabel,
                        supplierName = supplierName.takeIf { template == ReprintTemplate.INCOMING_ORDER },
                        receiptDocDate = receiptDocDate.takeIf { template == ReprintTemplate.INCOMING_ORDER },
                    )
                )
            }
            val templateText = when (template) {
                ReprintTemplate.BASIC -> "Базовый"
                ReprintTemplate.INCOMING_ORDER -> "Приходный ордер"
            }
            val supplierPart = supplierName?.trim().takeUnless { it.isNullOrBlank() }?.let { " | контрагент: $it" } ?: ""
            val datePart = receiptDocDate?.trim().takeUnless { it.isNullOrBlank() }?.let { " | дата: $it" } ?: ""
            _events.tryEmit("Печать: ${itemIds.size} поз. | шаблон: $templateText$supplierPart$datePart")
        }
    }

    private suspend fun selectedReceivingGroupLabel(fallback: String? = null): String? {
        val activeCategory = repository.getActiveReceivingCategory()
            ?.trim()
            ?.takeIf { it.isNotBlank() && it != ReceivingProductGroups.ALL_DOCS }
        val activeGroup = activeCategory ?: repository.getActiveReceivingProductGroup()
            ?.trim()
            ?.takeIf { it.isNotBlank() && it != ReceivingProductGroups.ALL_DOCS }
        if (activeGroup.isNullOrBlank()) return fallback?.trim()?.takeIf { it.isNotBlank() }

        val categories = repository.fetchReceivingCategories().getOrNull()
            ?: repository.loadReceivingCategoriesFromCache()
        val categoryName = categories
            .firstOrNull { it.code.equals(activeGroup, ignoreCase = true) }
            ?.name
            ?.trim()
            ?.takeIf { it.isNotBlank() }

        return categoryName
            ?: ReceivingProductGroups.find(activeGroup)?.title
            ?: activeGroup
    }

    private suspend fun activateDocument(
        docId: String,
        createIfMissing: Boolean,
        productGroup: String? = null,
        forceReopen: Boolean = false,
    ) {
        val group = productGroup?.trim()?.takeIf { it.isNotBlank() }
        val existing = dao.getReceivingDocumentById(docId)
        if (existing?.status == ReceivingDocumentStatus.CLOSED && !forceReopen) {
            return
        }
        if (existing == null && createIfMissing) {
            dao.insertReceivingDocument(
                ReceivingDocument(
                    id = docId,
                    status = ReceivingDocumentStatus.ACTIVE,
                    productGroup = group,
                )
            )
        } else if (existing != null) {
            dao.updateReceivingDocumentStatus(docId, ReceivingDocumentStatus.ACTIVE)
        }
        dao.pauseOtherActiveDocuments(docId)
        repository.setActiveReceivingDocId(docId)
        if (group != null) {
            repository.setActiveReceivingProductGroup(group)
        }
        val lineCount = dao.countReceivingItems(docId)
        repository.reportReceivingSessionStatus(
            documentId = docId,
            status = ReceivingDocumentStatus.ACTIVE,
            productGroup = group ?: existing?.productGroup,
            lineCount = lineCount,
        )
    }

    private suspend fun defaultPrefilledQty(existing: Double?): Double {
        if (existing != null && existing > 0.0) return existing
        return 0.0
    }

    private suspend fun refreshStorageRecommendation(rows: List<com.scadatable.wms.data.local.ReceivingItemView>) {
        if (rows.isEmpty()) {
            _storageRecommendation.value = null
            return
        }
        val dominant = rows
            .groupBy { it.productBarcode.trim() }
            .mapNotNull { (code, list) ->
                if (code.isBlank()) null else code to list.sumOf { it.quantity }
            }
            .maxByOrNull { it.second }
        if (dominant == null) {
            _storageRecommendation.value = null
            return
        }
        val result = repository.recommendReceivingStorageLocation(
            itemCode = dominant.first,
            qty = dominant.second,
            preferReceiving = false,
        )
        result.onSuccess { response ->
            val best = response.recommendations.firstOrNull { !it.forbidden }
                ?: response.recommendations.firstOrNull()
            if (best == null) {
                _storageRecommendation.value = null
                return@onSuccess
            }
            _storageRecommendation.value = best.locationCode?.trim()?.takeIf { it.isNotBlank() }?.let {
                ReceivingStorageRecommendation(
                    itemCode = dominant.first,
                    itemName = response.requirements?.itemName?.trim()?.takeIf { name -> name.isNotBlank() }
                        ?: rows.firstOrNull { row -> row.productBarcode.trim() == dominant.first }?.productName
                        ?: dominant.first,
                    qty = dominant.second,
                    locationCode = it,
                    displayName = best.displayName?.trim()?.takeIf { name -> name.isNotBlank() },
                    zoneCode = best.zoneCode?.trim()?.takeIf { zone -> zone.isNotBlank() },
                    score = best.score.toInt(),
                    forbidden = best.forbidden,
                    reasons = best.reasons,
                )
            }
        }.onFailure {
            _storageRecommendation.value = null
        }
    }
}

private fun normalizeCrptStatusForPosting(crptStatus: String?, itemStatus: String?): String? {
    if (itemStatus?.equals("без маркировки", ignoreCase = true) == true) return null
    val raw = crptStatus?.trim().orEmpty()
    val upper = raw.uppercase()
    if (upper == "EMITTED" || upper == "APPLIED" || upper == "INTRODUCED") return upper
    val local = itemStatus?.trim()?.lowercase().orEmpty()
    if (raw.isBlank() && local != "просрочен") return "EMITTED"
    if (raw.equals("эмитирован", ignoreCase = true) || raw.equals("эммитирован", ignoreCase = true)) return "EMITTED"
    if (raw.equals("нанесён", ignoreCase = true) || raw.equals("нанесен", ignoreCase = true)) return "APPLIED"
    if (raw.equals("в обороте", ignoreCase = true)) return "INTRODUCED"
    return raw
}

private fun formatQtyLabel(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else "%.2f".format(value)

sealed class ReceivingUiState {
    object Idle : ReceivingUiState()
    data class Loading(val scannedCode: String) : ReceivingUiState()
    data class ConfirmQuantity(
        val product: Product,
        val scannedCode: String? = null,
        val resolvedGtin: String? = null,
        val itemStatus: String = "эммитирован",
        val expiryMessage: String? = null,
        val warnings: List<String> = emptyList(),
        val nestedItemName: String? = null,
        val packageRole: String? = null,
        val productGroupLabel: String? = null,
        val generalPackageTypeLabel: String? = null,
        val emissionAt: Long? = null,
        val expiresAt: Long? = null,
        val shelfLifeDays: Int? = null,
        val crptStatus: String? = null,
        val expiryState: String? = null,
        val blocked: Boolean = false,
        val blockReason: String? = null,
        val gateWarning: Boolean = false,
        val prefilledQty: Double? = null,
        val batchLookupNote: String? = null,
    ) : ReceivingUiState()
    data class MissingProduct(
        val barcode: String,
        val resolvedGtin: String? = null,
    ) : ReceivingUiState()
    data class Error(val message: String) : ReceivingUiState()
}

data class ReceivingStorageRecommendation(
    val itemCode: String,
    val itemName: String,
    val qty: Double,
    val locationCode: String,
    val displayName: String? = null,
    val zoneCode: String? = null,
    val score: Int = 0,
    val forbidden: Boolean = false,
    val reasons: List<String> = emptyList(),
)

private fun mapExpiryStatus(state: String?): String = when (state?.lowercase()) {
    "expired" -> "просрочен"
    "warning" -> "истекает"
    else -> "эммитирован"
}

private fun parseIsoMillis(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    val raw = value.trim()
    runCatching { return java.time.Instant.parse(raw).toEpochMilli() }
    runCatching { return java.time.OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
    runCatching {
        val date = java.time.LocalDate.parse(raw.take(10))
        return date.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
    }
    return null
}

private fun extractGtin14(raw: String): String? {
    val compact = raw.replace("\\s".toRegex(), "")
    val m = Regex("01(\\d{14})").find(compact) ?: return null
    return m.groupValues[1]
}

class ReceivingViewModelFactory(
    private val dao: WmsDao,
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ReceivingViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return ReceivingViewModel(dao, repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
