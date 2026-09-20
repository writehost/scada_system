package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.CrptCode
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.WorkshopPickListDto
import com.scadatable.wms.data.remote.WorkshopPickListLineDto
import com.scadatable.wms.receiving.extractReceivingBatchCode
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import org.json.JSONArray

class IssueViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow<IssueUiState>(IssueUiState.Idle)
    val uiState: StateFlow<IssueUiState> = _uiState

    private val _recipients = MutableStateFlow<List<WmsRepository.IssueRecipientOption>>(emptyList())
    val recipients: StateFlow<List<WmsRepository.IssueRecipientOption>> = _recipients

    private val _items = MutableStateFlow<List<ItemRow>>(emptyList())
    val items: StateFlow<List<ItemRow>> = _items

    private val _itemsLoading = MutableStateFlow(false)
    val itemsLoading: StateFlow<Boolean> = _itemsLoading

    private val _itemsError = MutableStateFlow<String?>(null)
    val itemsError: StateFlow<String?> = _itemsError

    private val _pickList = MutableStateFlow<WorkshopPickListDto?>(null)
    val pickList: StateFlow<WorkshopPickListDto?> = _pickList

    private val _pickListLoading = MutableStateFlow(false)
    val pickListLoading: StateFlow<Boolean> = _pickListLoading

    private val _pickListError = MutableStateFlow<String?>(null)
    val pickListError: StateFlow<String?> = _pickListError

    private val _activePlanCode = MutableStateFlow<String?>(null)

    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val events: SharedFlow<String> = _events.asSharedFlow()

    init {
        viewModelScope.launch {
            ScanEvents.barcodes.collect { barcode ->
                if (!ScanEvents.isActive(ScanEvents.Consumer.ISSUE)) return@collect
                if (_uiState.value is IssueUiState.Idle) {
                    onBarcodeScanned(barcode)
                }
            }
        }
    }

    fun loadRecipients(fallbackJson: String? = null) {
        viewModelScope.launch {
            val fromApi = repository.listIssueRecipients().getOrNull().orEmpty()
            _recipients.value = when {
                fromApi.isNotEmpty() -> fromApi
                !fallbackJson.isNullOrBlank() -> parseLocalRecipients(fallbackJson)
                else -> emptyList()
            }
        }
    }

    fun loadItems(productGroup: String) {
        val group = productGroup.trim()
        viewModelScope.launch {
            _itemsLoading.value = true
            _itemsError.value = null
            val linkedGroups = repository.resolveReceivingCategoryProductGroups(group)
            val res = repository.fetchItemsPage(
                productGroup = if (linkedGroups.isEmpty()) group.takeIf { it.isNotBlank() && it != "—" } else null,
                productGroups = linkedGroups.takeIf { it.isNotEmpty() },
                bareProductGroup = group == "—" && linkedGroups.isEmpty(),
                limit = 100,
            )
            res.onSuccess { page ->
                _items.value = page.items
                _itemsLoading.value = false
            }.onFailure { err ->
                _items.value = emptyList()
                _itemsLoading.value = false
                _itemsError.value = humanizeIssueApiError(err.message)
            }
        }
    }

    fun loadWorkshopPickList(planCode: String) {
        val code = planCode.trim()
        if (code.isBlank()) {
            viewModelScope.launch { _events.emit("Укажите код плана APS") }
            return
        }
        viewModelScope.launch {
            _pickListLoading.value = true
            _pickListError.value = null
            val res = repository.getWorkshopPickList(code)
            res.onSuccess { body ->
                val list = body.pickList
                _pickList.value = list
                _activePlanCode.value = list?.planCode ?: code
                _pickListLoading.value = false
                if (list == null || list.lines.isEmpty()) {
                    _events.emit("Нет строк к отбору по плану $code")
                } else {
                    _events.emit("Pick list: ${list.totalLines} строк · готово ${list.linesReady}")
                }
            }.onFailure { err ->
                _pickList.value = null
                _pickListLoading.value = false
                _pickListError.value = humanizeIssueApiError(err.message)
            }
        }
    }

    fun selectPickListLine(line: WorkshopPickListLineDto) {
        val planCode = _activePlanCode.value?.trim().orEmpty()
        val steps = line.planSteps.filter { it.takeQty > 0.0 || it.availableQty > 0.0 }
        if (steps.isEmpty() && !line.enough) {
            viewModelScope.launch {
                _events.emit("Недостаточно остатка: ${line.itemCode}")
            }
            return
        }
        val first = steps.firstOrNull()
        _uiState.value = IssueUiState.ConfirmIssue(
            batchCode = planCode.ifBlank { line.itemCode },
            itemCode = line.itemCode,
            itemName = line.itemName?.trim().orEmpty().ifBlank { line.itemCode },
            gtin = null,
            availableQty = if (line.needQty > 0) line.needQty else line.availableQty,
            sourceLocationCode = first?.locationCode
                ?: line.suggestedLocationCode.orEmpty(),
            lotCode = first?.lotCode ?: line.suggestedLotCode,
            emissionAtIso = first?.emissionAtIso,
            prefilledQty = line.needQty.takeIf { it > 0 } ?: 1.0,
            pickPlan = steps.ifEmpty { line.planSteps },
            rotationPolicy = "fefo",
            isPerishable = false,
            planCode = planCode.takeIf { it.isNotBlank() },
        )
    }

    fun onItemSelected(item: ItemRow) {
        val itemCode = item.itemCode.trim()
        if (itemCode.isBlank()) return
        viewModelScope.launch {
            _uiState.value = IssueUiState.Loading(itemCode)
            val planResult = repository.getPosPickPlan(itemCode = itemCode, qty = 1.0)
            if (planResult.isFailure) {
                _uiState.value = IssueUiState.Error(
                    humanizeIssueApiError(
                        planResult.exceptionOrNull()?.message ?: "Не удалось построить FEFO-маршрут"
                    )
                )
                return@launch
            }
            presentPickPlan(
                scannedLabel = item.name.trim().ifBlank { itemCode },
                itemCode = itemCode,
                plan = planResult.getOrThrow(),
            )
        }
    }

    fun onBarcodeScanned(barcode: String) {
        val normalized = CrptCode.normalizeScannerDecorations(barcode)
        if (normalized.isBlank()) return

        viewModelScope.launch {
            _uiState.value = IssueUiState.Loading(normalized)

            val batchCode = extractReceivingBatchCode(normalized)
                ?: normalized.takeIf { it.startsWith("STK-", ignoreCase = true) }

            var itemCode: String
            var scannedLabel: String
            if (!batchCode.isNullOrBlank()) {
                val lookup = repository.lookupReceivingBatch(batchCode)
                if (lookup.isFailure) {
                    _uiState.value = IssueUiState.Error(
                        lookup.exceptionOrNull()?.message ?: "Стикер партии не найден"
                    )
                    return@launch
                }

                val batch = lookup.getOrThrow().batch
                if (batch?.itemCode.isNullOrBlank()) {
                    _uiState.value = IssueUiState.Error("В стикере нет номенклатуры")
                    return@launch
                }
                itemCode = batch.itemCode!!.trim()
                scannedLabel = batch.batchCode ?: batchCode
            } else {
                itemCode = normalized
                scannedLabel = normalized
                val resolve = repository.resolveReceivingScan(normalized)
                if (resolve.isSuccess) {
                    resolve.getOrThrow()
                        .primaryItem
                        ?.takeIf { it.itemCode.isNotBlank() }
                        ?.let { resolved ->
                            itemCode = resolved.itemCode.trim()
                            scannedLabel = resolved.name.trim().ifBlank { normalized }
                        }
                } else if (looksLikeGs1MarkedCode(normalized)) {
                    _uiState.value = IssueUiState.Error(
                        humanizeIssueApiError(resolve.exceptionOrNull()?.message)
                    )
                    return@launch
                } else {
                    val compact = CrptCode.normalize(normalized)
                    if (compact != normalized && !looksLikeGs1MarkedCode(compact)) {
                        itemCode = compact
                        scannedLabel = compact
                    }
                }
                if (itemCode == normalized && looksLikeGs1MarkedCode(normalized)) {
                    repository.resolveReceivingScan(CrptCode.normalize(normalized))
                        .getOrNull()
                        ?.primaryItem
                        ?.takeIf { it.itemCode.isNotBlank() }
                        ?.let { resolved ->
                            itemCode = resolved.itemCode.trim()
                            scannedLabel = resolved.name.trim().ifBlank { normalized }
                        }
                    if (itemCode == normalized) {
                        _uiState.value = IssueUiState.Error("Код маркировки распознан, но номенклатура не найдена")
                        return@launch
                    }
                }
            }

            val planResult = repository.getPosPickPlan(itemCode = itemCode, qty = 1.0)
            if (planResult.isFailure) {
                _uiState.value = IssueUiState.Error(
                    humanizeIssueApiError(
                        planResult.exceptionOrNull()?.message ?: "Не удалось построить FEFO-маршрут"
                    )
                )
                return@launch
            }
            val plan = planResult.getOrThrow()
            presentPickPlan(
                scannedLabel = scannedLabel,
                itemCode = itemCode,
                plan = plan,
            )
        }
    }

    private fun presentPickPlan(
        scannedLabel: String,
        itemCode: String,
        plan: com.scadatable.wms.data.remote.PosPickPlanResponse,
        planCode: String? = null,
        prefilledQty: Double = 1.0,
    ) {
        val item = plan.item
        if (item?.itemCode.isNullOrBlank()) {
            _uiState.value = IssueUiState.Error("Номенклатура не найдена")
            return
        }
        val firstPick = plan.plan.firstOrNull { it.availableQty > 0.0 } ?: plan.plan.firstOrNull()
        val itemName = item?.itemName?.trim().orEmpty().ifBlank { item.itemCode }
        val availableQty = plan.totalAvailable

        _uiState.value = IssueUiState.ConfirmIssue(
            batchCode = scannedLabel,
            itemCode = item.itemCode,
            itemName = itemName,
            gtin = null,
            availableQty = availableQty,
            sourceLocationCode = firstPick?.locationCode.orEmpty(),
            lotCode = firstPick?.lotCode,
            emissionAtIso = firstPick?.emissionAtIso,
            prefilledQty = prefilledQty,
            pickPlan = plan.plan,
            rotationPolicy = item.rotationPolicy ?: "fefo",
            isPerishable = item.isPerishable,
            planCode = planCode?.trim()?.takeIf { it.isNotBlank() } ?: _activePlanCode.value,
        )
    }

    private fun humanizeIssueApiError(message: String?): String {
        val raw = message?.trim().orEmpty()
        if (raw.isBlank()) return "Не удалось связаться с сервером WMS"
        if (raw.contains("failed to fetch", ignoreCase = true) ||
            raw.contains("failed to connect", ignoreCase = true) ||
            raw.contains("unable to resolve host", ignoreCase = true)
        ) {
            return "Нет связи с сервером. Проверьте Wi‑Fi и Base URL в настройках ТСД."
        }
        if (raw.equals("item not found", ignoreCase = true)) {
            return "Номенклатура не найдена на сервере"
        }
        if (raw.equals("unknown siteCode", ignoreCase = true)) {
            return "Неверный siteCode. В настройках укажите DEFAULT"
        }
        return raw
    }

    fun confirmIssue(
        state: IssueUiState.ConfirmIssue,
        qty: Double,
        recipientName: String,
        targetLocationCode: String,
        scannedSourceLocationCode: String? = null,
    ) {
        if (!qty.isFinite() || qty <= 0.0) {
            viewModelScope.launch { _events.emit("Укажите количество больше нуля") }
            return
        }
        if (state.availableQty > 0.0 && qty - state.availableQty > 1e-9) {
            viewModelScope.launch {
                _events.emit("Нельзя выдать больше ${formatQty(state.availableQty)} шт")
            }
            return
        }
        val recipient = recipientName.trim()
        if (recipient.isBlank()) {
            viewModelScope.launch { _events.emit("Выберите получателя") }
            return
        }
        val targetLocation = targetLocationCode.trim()
        if (targetLocation.isBlank()) {
            viewModelScope.launch { _events.emit("Укажите ячейку линии / цеха") }
            return
        }
        val scannedSource = scannedSourceLocationCode?.trim().orEmpty()
            .ifBlank { state.sourceLocationCode.trim() }
        if (scannedSource.isBlank()) {
            viewModelScope.launch { _events.emit("Отсканируйте ячейку источника (фаза 2)") }
            return
        }
        val expected = state.pickPlan
            .filter { it.takeQty > 0.0 || it.availableQty > 0.0 }
            .map { it.locationCode.trim().uppercase() }
            .filter { it.isNotBlank() }
            .toSet()
        if (expected.isNotEmpty() && scannedSource.uppercase() !in expected) {
            viewModelScope.launch {
                _events.emit("Ячейка $scannedSource не в маршруте. Ожидают: ${expected.joinToString()}")
            }
            return
        }

        viewModelScope.launch {
            _uiState.value = IssueUiState.Submitting(state)
            val result = repository.submitPosIssue(
                itemCode = state.itemCode,
                qty = qty,
                recipientName = recipient,
                targetLocationCode = targetLocation,
                lineName = targetLocation,
                scannedSourceLocationCode = scannedSource,
                requireSourceScan = true,
                planCode = state.planCode,
                createAct = true,
            )
            if (result.isSuccess) {
                val body = result.getOrThrow()
                val docIds = body.documents.mapNotNull { it.documentId?.trim()?.takeIf { id -> id.isNotBlank() } }
                _uiState.value = IssueUiState.Idle
                _events.emit(
                    if (docIds.isNotEmpty()) {
                        "Выдано ${formatQty(body.issuedQty)} шт · документов ${docIds.size}"
                    } else {
                        "Выдано ${formatQty(qty)} шт"
                    }
                )
            } else {
                _uiState.value = IssueUiState.Error(
                    humanizeIssueApiError(result.exceptionOrNull()?.message ?: "Не удалось оформить выдачу")
                )
            }
        }
    }

    fun cancelConfirmation() {
        _uiState.value = IssueUiState.Idle
    }

    private fun parseLocalRecipients(json: String): List<WmsRepository.IssueRecipientOption> {
        return runCatching {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val row = arr.optJSONObject(i) ?: continue
                    val fio = row.optString("fio").trim()
                    if (fio.isBlank()) continue
                    val login = row.optString("login").trim().takeIf { it.isNotBlank() }
                    val position = row.optString("position").trim().takeIf { it.isNotBlank() }
                    add(
                        WmsRepository.IssueRecipientOption(
                            id = login ?: fio,
                            displayName = fio,
                            subtitle = position ?: login,
                        )
                    )
                }
            }.sortedBy { it.displayName.lowercase() }
        }.getOrDefault(emptyList())
    }

private fun formatQty(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else "%.2f".format(value)

private fun looksLikeGs1MarkedCode(value: String): Boolean {
    val s = CrptCode.normalizeScannerDecorations(value)
    return s.contains(Regex("""^01\d{14}""")) ||
        s.startsWith("(01)") ||
        s.contains("\u001D93") ||
        s.contains("(93)")
}
}

sealed class IssueUiState {
    data object Idle : IssueUiState()
    data class Loading(val code: String) : IssueUiState()
    data class ConfirmIssue(
        val batchCode: String,
        val itemCode: String,
        val itemName: String,
        val gtin: String? = null,
        val availableQty: Double,
        val inProductionQty: Double = 0.0,
        val sourceLocationCode: String = "",
        val lotCode: String? = null,
        val emissionAtIso: String? = null,
        val prefilledQty: Double = 1.0,
        val pickPlan: List<com.scadatable.wms.data.remote.PosPickPlanRowDto> = emptyList(),
        val rotationPolicy: String = "fefo",
        val isPerishable: Boolean = false,
        val planCode: String? = null,
    ) : IssueUiState()
    data class Submitting(val previous: ConfirmIssue) : IssueUiState()
    data class Error(val message: String) : IssueUiState()
}

class IssueViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(IssueViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return IssueViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
