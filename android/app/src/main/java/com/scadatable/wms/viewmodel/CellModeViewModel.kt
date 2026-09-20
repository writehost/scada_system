package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.LocationRow
import com.scadatable.wms.data.remote.LocationStockLine
import com.scadatable.wms.data.remote.ManualReceivingDocumentLineRequest
import com.scadatable.wms.viewmodel.MaterialWarehouseStockViewModel.Companion.looksLikeLocationCode
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.format.DateTimeFormatter

enum class CellWriteOffReason(val label: String, val sourceSystem: String) {
    EXPIRED("Истёкший срок годности", "tsd_writeoff_expired"),
    DEFECT("Брак стикеров", "tsd_writeoff_defect"),
}

enum class CellActionKind {
    PRODUCTION,
    WRITE_OFF,
    MOVE,
}

sealed class CellModePhase {
    data object NeedCellScan : CellModePhase()
    data class Contents(
        val locationCode: String,
        val displayName: String?,
        val stock: List<LocationStockLine>,
        val selected: Set<String> = emptySet(),
    ) : CellModePhase()
    data class ChooseAction(
        val locationCode: String,
        val displayName: String?,
        val selected: List<LocationStockLine>,
    ) : CellModePhase()
    data class PickProductionLine(
        val locationCode: String,
        val selected: List<LocationStockLine>,
        val lines: List<ProductionLineOption>,
        val loading: Boolean = false,
    ) : CellModePhase()
    data class AwaitProductionTarget(
        val locationCode: String,
        val selected: List<LocationStockLine>,
        val lineLabel: String,
        val lineZone: String?,
        val hintCells: List<LocationRow> = emptyList(),
    ) : CellModePhase()
    data class PickWriteOffReason(
        val locationCode: String,
        val selected: List<LocationStockLine>,
    ) : CellModePhase()
    data class AwaitMoveTarget(
        val locationCode: String,
        val selected: List<LocationStockLine>,
    ) : CellModePhase()
    data class AddStock(
        val locationCode: String,
        val displayName: String?,
        val query: String = "",
        val results: List<ItemRow> = emptyList(),
        val searching: Boolean = false,
        val selected: ItemRow? = null,
        val qtyText: String = "1",
    ) : CellModePhase()
    data class Working(
        val message: String,
    ) : CellModePhase()
    data class Done(
        val message: String,
        val locationCode: String?,
    ) : CellModePhase()
}

data class ProductionLineOption(
    val label: String,
    val zoneCode: String?,
    val cells: List<LocationRow>,
)

data class CellModeUiState(
    val phase: CellModePhase = CellModePhase.NeedCellScan,
    val busy: Boolean = false,
    val error: String? = null,
)

class CellModeViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _ui = MutableStateFlow(CellModeUiState())
    val ui: StateFlow<CellModeUiState> = _ui.asStateFlow()
    private var searchJob: Job? = null

    fun reset() {
        searchJob?.cancel()
        _ui.value = CellModeUiState()
    }

    fun clearError() {
        _ui.value = _ui.value.copy(error = null)
    }

    fun onScan(raw: String) {
        val code = raw.trim()
        if (code.isBlank() || _ui.value.busy) return
        when (val phase = _ui.value.phase) {
            is CellModePhase.NeedCellScan,
            is CellModePhase.Done,
            -> openCell(code)
            is CellModePhase.Contents -> {
                if (looksLikeLocationCode(code)) openCell(code)
            }
            is CellModePhase.AddStock -> {
                if (looksLikeLocationCode(code) && code.contains('-')) {
                    openCell(code)
                } else {
                    setAddQuery(code, immediate = true)
                }
            }
            is CellModePhase.AwaitProductionTarget -> completeProduction(phase, code)
            is CellModePhase.AwaitMoveTarget -> completeMove(phase, code)
            else -> Unit
        }
    }

    fun openCell(raw: String) {
        val code = raw.trim().uppercase()
        if (code.isBlank()) return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, error = null, phase = CellModePhase.Working("Загрузка ячейки…"))
            val res = repository.fetchLocationDetail(code)
            res.onSuccess { detail ->
                val locCode = detail.location?.locationCode?.trim()?.ifBlank { code } ?: code
                _ui.value = CellModeUiState(
                    phase = CellModePhase.Contents(
                        locationCode = locCode,
                        displayName = detail.location?.displayName,
                        stock = detail.stock.filter { it.availableQty > 0 || (it.name?.isNotBlank() == true) },
                    ),
                )
            }.onFailure { err ->
                _ui.value = CellModeUiState(
                    phase = CellModePhase.NeedCellScan,
                    error = err.message ?: "Ячейка не найдена",
                )
            }
        }
    }

    fun toggleItem(itemCode: String) {
        val phase = _ui.value.phase as? CellModePhase.Contents ?: return
        val next = phase.selected.toMutableSet()
        if (!next.add(itemCode)) next.remove(itemCode)
        _ui.value = _ui.value.copy(phase = phase.copy(selected = next), error = null)
    }

    fun selectAll() {
        val phase = _ui.value.phase as? CellModePhase.Contents ?: return
        _ui.value = _ui.value.copy(
            phase = phase.copy(selected = phase.stock.map { it.itemCode }.toSet()),
            error = null,
        )
    }

    fun clearSelection() {
        val phase = _ui.value.phase as? CellModePhase.Contents ?: return
        _ui.value = _ui.value.copy(phase = phase.copy(selected = emptySet()), error = null)
    }

    fun goChooseAction() {
        val phase = _ui.value.phase as? CellModePhase.Contents ?: return
        val selected = phase.stock.filter { it.itemCode in phase.selected }
        if (selected.isEmpty()) {
            _ui.value = _ui.value.copy(error = "Выберите хотя бы одну номенклатуру")
            return
        }
        _ui.value = _ui.value.copy(
            error = null,
            phase = CellModePhase.ChooseAction(phase.locationCode, phase.displayName, selected),
        )
    }

    fun startAddStock() {
        val phase = _ui.value.phase as? CellModePhase.Contents ?: return
        searchJob?.cancel()
        _ui.value = _ui.value.copy(
            error = null,
            phase = CellModePhase.AddStock(
                locationCode = phase.locationCode,
                displayName = phase.displayName,
            ),
        )
        setAddQuery("", immediate = true)
    }

    fun setAddQuery(raw: String, immediate: Boolean = false) {
        val phase = _ui.value.phase as? CellModePhase.AddStock ?: return
        val query = raw.trim()
        _ui.value = _ui.value.copy(
            error = null,
            phase = phase.copy(query = raw, searching = true, selected = null),
        )
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            if (!immediate && query.length in 1..1) {
                _ui.value = _ui.value.copy(
                    phase = phase.copy(query = raw, results = emptyList(), searching = false, selected = null),
                )
                return@launch
            }
            if (!immediate) delay(280)
            val current = _ui.value.phase as? CellModePhase.AddStock ?: return@launch
            val res = if (query.isBlank()) {
                repository.fetchItemsPage(limit = 40, bareProductGroup = true)
            } else {
                repository.fetchItemsPage(query = query, limit = 60)
            }
            res.onSuccess { page ->
                val items = page.items
            val auto = when {
                query.isBlank() -> null
                items.size == 1 -> items.first()
                else -> items.firstOrNull {
                    it.itemCode.equals(query, true) || it.sku.equals(query, true)
                }
            }
                val p = _ui.value.phase as? CellModePhase.AddStock ?: return@onSuccess
                _ui.value = _ui.value.copy(
                    phase = p.copy(
                        results = items,
                        searching = false,
                        selected = auto ?: p.selected,
                    ),
                )
            }.onFailure { err ->
                val p = _ui.value.phase as? CellModePhase.AddStock ?: return@onFailure
                _ui.value = _ui.value.copy(
                    phase = p.copy(searching = false, results = emptyList()),
                    error = err.message ?: "Не удалось найти номенклатуру",
                )
            }
        }
    }

    fun pickAddItem(item: ItemRow) {
        val phase = _ui.value.phase as? CellModePhase.AddStock ?: return
        _ui.value = _ui.value.copy(
            error = null,
            phase = phase.copy(selected = item, qtyText = phase.qtyText.ifBlank { "1" }),
        )
    }

    fun setAddQty(text: String) {
        val phase = _ui.value.phase as? CellModePhase.AddStock ?: return
        _ui.value = _ui.value.copy(phase = phase.copy(qtyText = text.filter { it.isDigit() || it == '.' || it == ',' }))
    }

    fun confirmAddStock() {
        val phase = _ui.value.phase as? CellModePhase.AddStock ?: return
        val item = phase.selected
        if (item == null) {
            _ui.value = _ui.value.copy(error = "Выберите номенклатуру")
            return
        }
        val qty = phase.qtyText.replace(',', '.').toDoubleOrNull()
        if (qty == null || !qty.isFinite() || qty <= 0.0) {
            _ui.value = _ui.value.copy(error = "Укажите количество больше нуля")
            return
        }
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, phase = CellModePhase.Working("Добавление в ячейку…"), error = null)
            val day = DateTimeFormatter.ofPattern("yyyyMMdd").format(Instant.now().atZone(java.time.ZoneOffset.UTC))
            val res = repository.postManualReceivingDocument(
                targetLocationCode = phase.locationCode,
                groupCode = null,
                groupName = null,
                comment = "ТСД · ячейка ${phase.locationCode}",
                lines = listOf(
                    ManualReceivingDocumentLineRequest(
                        itemCode = item.itemCode,
                        qty = qty,
                        batchLabel = "RCV-$day-${item.itemCode.take(20)}",
                        comment = "ТСД · режим ячейки",
                    ),
                ),
            )
            res.onSuccess {
                openCell(phase.locationCode)
            }.onFailure { err ->
                _ui.value = CellModeUiState(
                    phase = phase,
                    error = err.message ?: "Не удалось добавить",
                )
            }
        }
    }

    fun backToContents() {
        val phase = _ui.value.phase
        val loc = when (phase) {
            is CellModePhase.ChooseAction -> phase.locationCode to phase.displayName
            is CellModePhase.PickProductionLine -> phase.locationCode to null
            is CellModePhase.AwaitProductionTarget -> phase.locationCode to null
            is CellModePhase.PickWriteOffReason -> phase.locationCode to null
            is CellModePhase.AwaitMoveTarget -> phase.locationCode to null
            is CellModePhase.AddStock -> phase.locationCode to phase.displayName
            is CellModePhase.Done -> phase.locationCode to null
            else -> null
        } ?: return
        val code = loc.first ?: return
        openCell(code)
    }

    fun startAction(kind: CellActionKind) {
        val phase = _ui.value.phase as? CellModePhase.ChooseAction ?: return
        when (kind) {
            CellActionKind.PRODUCTION -> loadProductionLines(phase.locationCode, phase.selected)
            CellActionKind.WRITE_OFF -> {
                _ui.value = _ui.value.copy(
                    phase = CellModePhase.PickWriteOffReason(phase.locationCode, phase.selected),
                    error = null,
                )
            }
            CellActionKind.MOVE -> {
                _ui.value = _ui.value.copy(
                    phase = CellModePhase.AwaitMoveTarget(phase.locationCode, phase.selected),
                    error = null,
                )
            }
        }
    }

    private fun loadProductionLines(sourceLocation: String, selected: List<LocationStockLine>) {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                phase = CellModePhase.PickProductionLine(sourceLocation, selected, emptyList(), loading = true),
                error = null,
            )
            val res = repository.fetchLocations(workshopOnly = true)
            res.onSuccess { locs ->
                val waiting = locs.filter { it.isWaitingPoint || it.zoneCode.isNotBlank() }
                val grouped = waiting
                    .groupBy { loc ->
                        loc.zoneCode.trim().ifBlank {
                            loc.slotTitle?.trim().orEmpty().ifBlank { loc.warehouseCode }
                        }
                    }
                    .filterKeys { it.isNotBlank() }
                    .map { (label, cells) ->
                        ProductionLineOption(
                            label = label,
                            zoneCode = label,
                            cells = cells.sortedBy { it.locationCode },
                        )
                    }
                    .sortedBy { it.label.lowercase() }
                _ui.value = _ui.value.copy(
                    phase = CellModePhase.PickProductionLine(
                        locationCode = sourceLocation,
                        selected = selected,
                        lines = grouped,
                        loading = false,
                    ),
                )
            }.onFailure { err ->
                _ui.value = _ui.value.copy(
                    phase = CellModePhase.ChooseAction(sourceLocation, null, selected),
                    error = err.message ?: "Не удалось загрузить линии",
                )
            }
        }
    }

    fun pickProductionLine(line: ProductionLineOption) {
        val phase = _ui.value.phase as? CellModePhase.PickProductionLine ?: return
        val emptyHints = line.cells.filter { it.isEmpty }.ifEmpty { line.cells }
        _ui.value = _ui.value.copy(
            phase = CellModePhase.AwaitProductionTarget(
                locationCode = phase.locationCode,
                selected = phase.selected,
                lineLabel = line.label,
                lineZone = line.zoneCode,
                hintCells = emptyHints.take(6),
            ),
            error = null,
        )
    }

    fun pickHintProductionCell(cell: LocationRow) {
        val phase = _ui.value.phase as? CellModePhase.AwaitProductionTarget ?: return
        completeProduction(phase, cell.locationCode)
    }

    fun confirmWriteOff(reason: CellWriteOffReason) {
        val phase = _ui.value.phase as? CellModePhase.PickWriteOffReason ?: return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, phase = CellModePhase.Working("Списание…"), error = null)
            val errors = mutableListOf<String>()
            var okCount = 0
            for (line in phase.selected) {
                val qty = line.availableQty.takeIf { it > 0 } ?: continue
                val res = repository.productionConsume(
                    locationCode = phase.locationCode,
                    itemCode = line.itemCode,
                    qty = qty,
                    sourceSystem = reason.sourceSystem,
                )
                if (res.isSuccess) okCount++
                else errors += "${line.itemCode}: ${res.exceptionOrNull()?.message ?: "ошибка"}"
            }
            _ui.value = when {
                okCount == 0 -> CellModeUiState(
                    phase = CellModePhase.PickWriteOffReason(phase.locationCode, phase.selected),
                    error = errors.firstOrNull() ?: "Списание не выполнено",
                )
                else -> CellModeUiState(
                    phase = CellModePhase.Done(
                        message = buildString {
                            append("Списано позиций: $okCount")
                            append(" · ${reason.label}")
                            if (errors.isNotEmpty()) append("\nЧастично: ${errors.size} с ошибкой")
                        },
                        locationCode = phase.locationCode,
                    ),
                )
            }
        }
    }

    private fun completeProduction(phase: CellModePhase.AwaitProductionTarget, targetRaw: String) {
        val target = targetRaw.trim().uppercase()
        if (target.isBlank()) return
        if (target.equals(phase.locationCode, ignoreCase = true)) {
            _ui.value = _ui.value.copy(error = "Ячейка назначения совпадает с источником")
            return
        }
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, phase = CellModePhase.Working("Выдача в производство…"), error = null)
            val operator = repository.currentOperatorName()
            val errors = mutableListOf<String>()
            var okCount = 0
            for (line in phase.selected) {
                val qty = line.availableQty.takeIf { it > 0 } ?: continue
                val res = repository.submitIssue(
                    itemCode = line.itemCode,
                    sourceLocationCode = phase.locationCode,
                    targetLocationCode = target,
                    qty = qty,
                    recipientName = operator,
                    lineName = phase.lineLabel,
                )
                if (res.isSuccess) okCount++
                else errors += "${line.itemCode}: ${res.exceptionOrNull()?.message ?: "ошибка"}"
            }
            _ui.value = when {
                okCount == 0 -> CellModeUiState(
                    phase = phase,
                    error = errors.firstOrNull() ?: "Не удалось выдать",
                )
                else -> CellModeUiState(
                    phase = CellModePhase.Done(
                        message = buildString {
                            append("В производство: $okCount поз.")
                            append(" → ${phase.lineLabel} / $target")
                            if (errors.isNotEmpty()) append("\nЧастично: ${errors.size} с ошибкой")
                        },
                        locationCode = phase.locationCode,
                    ),
                )
            }
        }
    }

    private fun completeMove(phase: CellModePhase.AwaitMoveTarget, targetRaw: String) {
        val target = targetRaw.trim().uppercase()
        if (target.isBlank()) return
        if (target.equals(phase.locationCode, ignoreCase = true)) {
            _ui.value = _ui.value.copy(error = "Ячейка назначения совпадает с источником")
            return
        }
        viewModelScope.launch {
            _ui.value = _ui.value.copy(busy = true, phase = CellModePhase.Working("Перемещение…"), error = null)
            val errors = mutableListOf<String>()
            var okCount = 0
            for (line in phase.selected) {
                val qty = line.availableQty.takeIf { it > 0 } ?: continue
                val res = repository.confirmTransfer(
                    itemCode = line.itemCode,
                    sourceLocationCode = phase.locationCode,
                    targetLocationCode = target,
                    qty = qty,
                )
                if (res.isSuccess) okCount++
                else errors += "${line.itemCode}: ${res.exceptionOrNull()?.message ?: "ошибка"}"
            }
            _ui.value = when {
                okCount == 0 -> CellModeUiState(
                    phase = phase,
                    error = errors.firstOrNull() ?: "Не удалось переместить",
                )
                else -> CellModeUiState(
                    phase = CellModePhase.Done(
                        message = buildString {
                            append("Перемещено: $okCount поз.")
                            append("\n${phase.locationCode} → $target")
                            if (errors.isNotEmpty()) append("\nЧастично: ${errors.size} с ошибкой")
                        },
                        locationCode = target,
                    ),
                )
            }
        }
    }
}

class CellModeViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(CellModeViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return CellModeViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
