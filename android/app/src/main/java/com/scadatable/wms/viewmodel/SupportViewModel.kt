package com.scadatable.wms.viewmodel

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.SupportSessionDto
import com.scadatable.wms.support.ScreenCapture
import com.scadatable.wms.support.SupportTelemetry
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class SupportUiState(
    val pendingSession: SupportSessionDto? = null,
    val activeSession: SupportSessionDto? = null,
    val responding: Boolean = false,
    val banner: String? = null,
)

class SupportViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SupportUiState())
    val uiState: StateFlow<SupportUiState> = _uiState.asStateFlow()

    private var pollJob: Job? = null
    private var activity: Activity? = null

    fun attachActivity(activity: Activity) {
        this.activity = activity
    }

    fun startPolling() {
        if (pollJob?.isActive == true) return
        pollJob = viewModelScope.launch {
            while (isActive) {
                pollOnce()
                delay(if (_uiState.value.activeSession != null) 3500L else 4500L)
            }
        }
    }

    fun stopPolling() {
        pollJob?.cancel()
        pollJob = null
    }

    fun onRouteChanged(route: String) {
        SupportTelemetry.setScreen(route)
    }

    fun acceptPending() {
        val session = _uiState.value.pendingSession ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(responding = true)
            repository.respondSupportSession(session.sessionId, accept = true)
                .onSuccess { active ->
                    SupportTelemetry.activeSessionId = active.sessionId
                    _uiState.value = _uiState.value.copy(
                        pendingSession = null,
                        activeSession = active,
                        responding = false,
                        banner = "Режим поддержки активен",
                    )
                }
                .onFailure {
                    _uiState.value = _uiState.value.copy(responding = false, banner = it.message)
                }
        }
    }

    fun declinePending() {
        val session = _uiState.value.pendingSession ?: return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(responding = true)
            repository.respondSupportSession(session.sessionId, accept = false)
            _uiState.value = SupportUiState(banner = "Запрос поддержки отклонён")
            SupportTelemetry.activeSessionId = null
        }
    }

    fun endActiveLocally() {
        val session = _uiState.value.activeSession ?: return
        viewModelScope.launch {
            repository.endSupportSession(session.sessionId, "Завершено на ТСД")
            SupportTelemetry.activeSessionId = null
            _uiState.value = SupportUiState(banner = "Режим поддержки завершён")
        }
    }

    private suspend fun pollOnce() {
        val activeId = _uiState.value.activeSession?.sessionId
        val poll = repository.pollSupportSession(activeId)
        if (poll.isFailure) return
        val body = poll.getOrNull() ?: return
        val session = body.session

        when {
            session == null -> {
                if (_uiState.value.activeSession != null || _uiState.value.pendingSession != null) {
                    SupportTelemetry.activeSessionId = null
                    _uiState.value = SupportUiState()
                }
            }
            session.status == "pending" -> {
                _uiState.value = _uiState.value.copy(pendingSession = session, activeSession = null)
            }
            session.status == "active" -> {
                SupportTelemetry.activeSessionId = session.sessionId
                _uiState.value = _uiState.value.copy(
                    pendingSession = null,
                    activeSession = session,
                    banner = "Поддержка: администратор видит экран",
                )
                sendTelemetry(session.sessionId)
                if (body.screenshotRequested) {
                    uploadScreenshot(session.sessionId)
                }
            }
            else -> {
                SupportTelemetry.activeSessionId = null
                _uiState.value = SupportUiState()
            }
        }
    }

    private suspend fun sendTelemetry(sessionId: String) {
        val events = SupportTelemetry.drainPending().map {
            com.scadatable.wms.data.remote.SupportEventInput(
                level = it.level,
                eventType = it.eventType,
                message = it.message,
            )
        }
        repository.postSupportTelemetry(
            sessionId = sessionId,
            currentScreen = SupportTelemetry.currentScreen,
            events = events,
        )
    }

    private suspend fun uploadScreenshot(sessionId: String) {
        val act = activity ?: return
        val base64 = ScreenCapture.captureActivityJpegBase64(act) ?: run {
            SupportTelemetry.log("warn", "screenshot", "Не удалось сделать снимок экрана")
            return
        }
        repository.uploadSupportScreenshot(sessionId, base64)
    }
}

class SupportViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(SupportViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return SupportViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel: ${modelClass.name}")
    }
}
