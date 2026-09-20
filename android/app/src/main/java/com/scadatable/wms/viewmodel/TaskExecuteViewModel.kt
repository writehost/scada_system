package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ReceivingResolveResponse
import com.scadatable.wms.data.remote.TaskShipScanDto
import com.scadatable.wms.data.remote.WmsHttpException
import com.scadatable.wms.data.remote.WmsTaskDetailTask
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

data class TaskExecuteUiState(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val scanBusy: Boolean = false,
    val error: String? = null,
    val lastOk: String? = null,
    val done: Boolean = false,
    val task: WmsTaskDetailTask? = null,
    val scans: List<TaskShipScanDto> = emptyList(),
)

class TaskExecuteViewModel(
    private val repository: WmsRepository,
    private val taskId: String,
) : ViewModel() {
    private val _ui = MutableStateFlow(TaskExecuteUiState())
    val ui: StateFlow<TaskExecuteUiState> = _ui.asStateFlow()

    init {
        viewModelScope.launch {
            load()
            if (needsStart(_ui.value.task) && !_ui.value.done && _ui.value.task != null) {
                startTaskInternal()
            }
        }
    }

    fun refresh() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        _ui.update { it.copy(loading = true, error = null) }
        val res = repository.getTaskDetail(taskId)
        val detail = res.getOrNull()?.task
        if (detail == null) {
            _ui.update {
                it.copy(
                    loading = false,
                    error = res.exceptionOrNull()?.message ?: "Не удалось загрузить задание",
                )
            }
            return
        }
        val status = detail.taskStatus.orEmpty().lowercase()
        val plan = detail.fgPickPlan ?: res.getOrNull()?.fgPickPlan
        val merged = if (plan != null && detail.fgPickPlan == null) detail.copy(fgPickPlan = plan) else detail
        _ui.update {
            it.copy(
                loading = false,
                task = merged,
                scans = merged.taskPayload?.shipScans.orEmpty(),
                done = status == "completed",
                error = if (plan != null && !plan.enough) plan.reason else null,
            )
        }
    }

    fun startTask() {
        viewModelScope.launch { startTaskInternal() }
    }

    private suspend fun startTaskInternal() {
        _ui.update { it.copy(busy = true, error = null) }
        val res = repository.startTaskOnDevice(taskId)
        if (res.isFailure) {
            _ui.update {
                it.copy(busy = false, error = mapError(res.exceptionOrNull(), "Не удалось начать задание"))
            }
            return
        }
        _ui.update { it.copy(busy = false) }
        load()
    }

    fun onBarcodeScanned(raw: String) {
        val code = raw.trim().replace("\\s+".toRegex(), "")
        if (code.isBlank()) return
        val state = _ui.value
        val task = state.task ?: return
        if (state.done || state.scanBusy || state.busy) return
        if (needsStart(task)) {
            _ui.update { it.copy(error = "Сначала нажмите «Выполнить задание»") }
            return
        }
        val plan = task.fgPickPlan
        if (plan != null && !plan.enough) {
            _ui.update { it.copy(error = plan.reason ?: "Этого товара нет на складе — отгрузить нельзя") }
            return
        }
        val planned = task.plannedQty ?: 0.0
        val scanned = state.scans.sumOf { it.qty }
        val remaining = (planned - scanned).coerceAtLeast(0.0)
        if (remaining <= 0.0) {
            _ui.update { it.copy(error = "Все коды уже отсканированы. Нажмите «Завершить отгрузку».") }
            return
        }
        viewModelScope.launch {
            _ui.update { it.copy(scanBusy = true, error = null, lastOk = null) }
            try {
                val resolved = repository.resolveReceivingScan(code).getOrThrow()
                val expiry = resolved.expiry
                if (expiry?.state == "expired") {
                    throw IllegalStateException(
                        expiry.message?.takeIf { it.isNotBlank() }
                            ?: "Срок годности истёк${expiry.expiresAt?.let { " (${formatDate(it)})" } ?: ""} — код не принимается",
                    )
                }
                if (!itemMatchesTask(resolved, task.itemCode)) {
                    val got = resolved.primaryItem?.name ?: resolved.primaryItem?.itemCode ?: "другой товар"
                    throw IllegalStateException("Это $got, а в задании ${task.itemName ?: task.itemCode}")
                }
                val qty = scanQty(resolved, remaining)
                val saved = repository.scanTaskShipCode(
                    taskId = taskId,
                    code = resolved.normalizedCode?.takeIf { it.isNotBlank() } ?: code,
                    qty = qty,
                    itemCode = resolved.primaryItem?.itemCode,
                    itemName = resolved.primaryItem?.name,
                    expiresAt = expiry?.expiresAt,
                    manufacturedAt = expiry?.emissionAt,
                ).getOrThrow()
                _ui.update {
                    it.copy(
                        scanBusy = false,
                        scans = saved.scans.orEmpty().ifEmpty { it.scans },
                        lastOk = buildString {
                            append("+${formatQty(qty)}")
                            expiry?.expiresAt?.takeIf { it.isNotBlank() }?.let { append(" · до ${formatDate(it)}") }
                        },
                        error = if (expiry?.state == "warning") expiry.message else null,
                    )
                }
            } catch (e: Exception) {
                _ui.update {
                    it.copy(scanBusy = false, error = mapError(e, "Не удалось принять код"))
                }
            }
        }
    }

    fun completeTask() {
        viewModelScope.launch {
            val state = _ui.value
            val task = state.task ?: return@launch
            val plan = task.fgPickPlan
            if (plan != null && !plan.enough) {
                _ui.update { it.copy(error = plan.reason ?: "Этого товара нет на складе — отгрузить нельзя") }
                return@launch
            }
            val planned = task.plannedQty ?: 0.0
            val scanned = state.scans.sumOf { it.qty }
            if (planned > 0 && scanned + 1e-9 < planned) {
                _ui.update { it.copy(error = "Ещё нужно отсканировать ${formatQty(planned - scanned)} кодов") }
                return@launch
            }
            _ui.update { it.copy(busy = true, error = null) }
            val res = repository.completeTaskOnDevice(
                taskId = taskId,
                confirmedQty = scanned.takeIf { it > 0 } ?: planned,
                sourceLocationCode = plan?.suggested?.locationCode ?: task.sourceLocationCode,
                targetLocationCode = task.targetLocationCode,
            )
            if (res.isFailure) {
                _ui.update {
                    it.copy(busy = false, error = mapError(res.exceptionOrNull(), "Не удалось завершить задание"))
                }
                return@launch
            }
            _ui.update { it.copy(busy = false, done = true) }
            refresh()
        }
    }

    companion object {
        fun needsStart(task: WmsTaskDetailTask?): Boolean {
            val status = task?.taskStatus.orEmpty().lowercase()
            return status in setOf("open", "claimed", "on_hold")
        }

        fun formatQty(n: Double?): String {
            if (n == null) return "—"
            return if (n % 1.0 == 0.0) n.toInt().toString() else String.format(Locale.getDefault(), "%.3f", n)
        }

        fun formatDate(raw: String?): String {
            if (raw.isNullOrBlank()) return "—"
            return try {
                val parsed = listOf(
                    "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
                    "yyyy-MM-dd'T'HH:mm:ss'Z'",
                    "yyyy-MM-dd'T'HH:mm:ss",
                    "yyyy-MM-dd",
                ).firstNotNullOfOrNull { pattern ->
                    runCatching {
                        SimpleDateFormat(pattern, Locale.US).apply {
                            timeZone = TimeZone.getTimeZone("UTC")
                        }.parse(raw)
                    }.getOrNull()
                } ?: return raw
                SimpleDateFormat("dd.MM.yyyy", Locale("ru")).format(parsed)
            } catch (_: Exception) {
                raw
            }
        }

        fun warehouseRoute(task: WmsTaskDetailTask?): String {
            val from = listOf(task?.sourceWarehouseName, task?.sourceWarehouseCode, task?.sourceLocationCode)
                .firstOrNull { !it.isNullOrBlank() } ?: "откуда"
            val to = listOf(task?.targetWarehouseName, task?.targetWarehouseCode, task?.targetLocationCode)
                .firstOrNull { !it.isNullOrBlank() } ?: "куда"
            return "$from → $to"
        }

        private fun itemMatchesTask(resolved: ReceivingResolveResponse, itemCode: String?): Boolean {
            val want = itemCode?.trim()?.lowercase().orEmpty()
            if (want.isBlank()) return true
            return listOfNotNull(resolved.primaryItem, resolved.nestedItem)
                .any { it.itemCode.trim().lowercase() == want }
        }

        private fun scanQty(resolved: ReceivingResolveResponse, remaining: Double): Double {
            val per = resolved.specQtyPer?.toDouble()
            if (per != null && per > 1.0) {
                return if (remaining > 0) minOf(per, remaining) else per
            }
            return 1.0
        }

        fun mapError(error: Throwable?, fallback: String): String {
            if (error is WmsHttpException) return error.message ?: fallback
            return error?.message ?: fallback
        }
    }
}

class TaskExecuteViewModelFactory(
    private val repository: WmsRepository,
    private val taskId: String,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(TaskExecuteViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return TaskExecuteViewModel(repository, taskId) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
