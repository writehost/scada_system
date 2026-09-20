package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.local.TaskCache
import com.scadatable.wms.data.remote.WmsHttpException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class TasksUiState(
    val loading: Boolean = false,
    val error: String? = null,
    val syncing: Boolean = false,
)

class TasksViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    val tasks = repository.cachedTasks.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _uiState = MutableStateFlow(TasksUiState())
    val uiState: StateFlow<TasksUiState> = _uiState.asStateFlow()

    fun refresh(status: String? = null) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val res = repository.refreshDeviceTasks(status)
            _uiState.value = _uiState.value.copy(
                loading = false,
                error = mapTaskError(res.exceptionOrNull()),
            )
        }
    }

    fun claim(task: TaskCache) = performAction(task, "claim")
    fun start(task: TaskCache) = performAction(task, "start")
    fun complete(task: TaskCache) = performAction(task, "complete")
    fun exception(task: TaskCache) = performAction(task, "exception")

    fun replayOutbox() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(syncing = true, error = null)
            val res = repository.replayOutbox()
            _uiState.value = _uiState.value.copy(
                syncing = false,
                error = mapTaskError(res.exceptionOrNull()),
            )
        }
    }

    private fun performAction(task: TaskCache, action: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(syncing = true, error = null)
            val res = repository.enqueueAndSendTaskAction(
                taskId = task.taskId,
                action = action,
                confirmedQty = task.plannedQty,
                exceptionCode = if (action == "exception") "manual_exception" else null,
                exceptionNote = if (action == "exception") "Отмечено оператором на ТСД" else null,
            )
            if (res.isFailure) {
                refresh()
            }
            _uiState.value = _uiState.value.copy(
                syncing = false,
                error = mapTaskError(res.exceptionOrNull()),
            )
        }
    }

    private fun mapTaskError(error: Throwable?): String? {
        if (error == null) return null
        val http = error as? WmsHttpException
        if (http != null) {
            val code = http.code.orEmpty().trim().lowercase()
            val text = http.message.orEmpty().lowercase()
            if (code == "wrong_device" || text.contains("assigned to another device")) {
                return "Задача закреплена за другим ТСД. Обновите список и возьмите свою задачу."
            }
            if (http.status == 409) {
                return "Конфликт статуса задачи. Возможно, она уже завершена или освобождена."
            }
            if (http.status == 400) {
                return "Некорректное действие для текущего статуса задачи."
            }
        }
        return error.message ?: "Ошибка операций с задачами"
    }
}

class TasksViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(TasksViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return TasksViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
