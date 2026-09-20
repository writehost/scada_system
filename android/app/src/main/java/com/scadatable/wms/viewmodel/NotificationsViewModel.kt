package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.local.WmsDao
import com.scadatable.wms.receiving.ReceivingDocumentStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class NotificationKind { TASK, SYNC, RECEIVING, SYSTEM }

enum class NotificationLevel { INFO, WARNING, ERROR }

data class WmsNotification(
    val id: String,
    val title: String,
    val body: String,
    val time: Long,
    val kind: NotificationKind,
    val level: NotificationLevel = NotificationLevel.INFO,
    val actionRoute: String? = null,
)

data class NotificationsUiState(
    val items: List<WmsNotification> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
) {
    val unreadCount: Int = items.count {
        it.id != "empty" && (it.level != NotificationLevel.INFO || it.kind == NotificationKind.TASK)
    }
}

class NotificationsViewModel(
    private val repository: WmsRepository,
    private val dao: WmsDao,
) : ViewModel() {
    private val _uiState = MutableStateFlow(NotificationsUiState())
    val uiState: StateFlow<NotificationsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            repository.refreshDeviceTasks()
            runCatching {
                buildNotifications()
            }.onSuccess { items ->
                _uiState.value = NotificationsUiState(items = items, loading = false)
            }.onFailure { err ->
                _uiState.value = NotificationsUiState(loading = false, error = err.message)
            }
        }
    }

    private suspend fun buildNotifications(): List<WmsNotification> {
        val now = System.currentTimeMillis()
        val out = mutableListOf<WmsNotification>()

        val tasks = dao.getCachedTasks().first()
        val openTasks = tasks.filter { it.taskStatus.equals("open", true) }
        if (openTasks.isNotEmpty()) {
            out += WmsNotification(
                id = "tasks-open",
                title = if (openTasks.size == 1) "Новая задача" else "Новые задачи: ${openTasks.size}",
                body = openTasks.take(2).joinToString("\n") { task ->
                    "${task.taskCode}: ${task.itemName ?: task.itemCode ?: "без позиции"}"
                },
                time = now,
                kind = NotificationKind.TASK,
                level = NotificationLevel.WARNING,
                actionRoute = "tasks",
            )
        }

        val activeDocId = repository.getActiveReceivingDocId()?.trim().orEmpty()
        if (activeDocId.isNotEmpty()) {
            out += WmsNotification(
                id = "receiving-active-$activeDocId",
                title = "Активная приемка",
                body = "Документ $activeDocId — продолжить сканирование",
                time = now,
                kind = NotificationKind.RECEIVING,
                actionRoute = "receiving",
            )
        }

        val receivingDocs = dao.getReceivingDocuments().first()
        receivingDocs
            .filter { it.status == ReceivingDocumentStatus.PAUSED && it.id != activeDocId }
            .forEach { doc ->
                out += WmsNotification(
                    id = "receiving-paused-${doc.id}",
                    title = "Приемка приостановлена",
                    body = "Документ ${doc.id} ждёт продолжения",
                    time = doc.date,
                    kind = NotificationKind.RECEIVING,
                    level = NotificationLevel.WARNING,
                    actionRoute = "receiving_documents",
                )
            }

        val nomOutbox = dao.listNomenclatureOutbox()
        if (nomOutbox.isNotEmpty()) {
            out += WmsNotification(
                id = "nom-outbox",
                title = "Отложенная номенклатура",
                body = "${nomOutbox.size} поз. ждут выгрузки на сервер",
                time = nomOutbox.maxOfOrNull { it.createdAt } ?: now,
                kind = NotificationKind.SYNC,
                level = NotificationLevel.WARNING,
                actionRoute = "receiving",
            )
        }

        val taskOutbox = dao.listPendingTaskActions()
        if (taskOutbox.isNotEmpty()) {
            out += WmsNotification(
                id = "task-outbox",
                title = "Действия по задачам в очереди",
                body = "${taskOutbox.size} операций отправятся при связи",
                time = taskOutbox.maxOfOrNull { it.createdAt } ?: now,
                kind = NotificationKind.SYNC,
                level = NotificationLevel.WARNING,
                actionRoute = "tasks",
            )
        }

        val lastSync = repository.getLastSyncAt()
        if (lastSync.isNullOrBlank()) {
            out += WmsNotification(
                id = "sync-never",
                title = "Справочник не синхронизирован",
                body = "Обновите данные на главном экране",
                time = now,
                kind = NotificationKind.SYNC,
                level = NotificationLevel.WARNING,
            )
        }

        if (out.isEmpty()) {
            out += WmsNotification(
                id = "empty",
                title = "Нет новых уведомлений",
                body = "Задачи, приемка и синхронизация — всё спокойно",
                time = now,
                kind = NotificationKind.SYSTEM,
            )
        }

        return out.sortedByDescending { it.time }
    }
}

class NotificationsViewModelFactory(
    private val repository: WmsRepository,
    private val dao: WmsDao,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(NotificationsViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return NotificationsViewModel(repository, dao) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
