package com.scadatable.wms.support

import android.app.Activity
import android.content.Context
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.AppPrefs
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.SupportEventInput
import com.scadatable.wms.data.remote.SupportSessionDto
import com.scadatable.wms.push.WmsPushNotifier
import com.scadatable.wms.viewmodel.SupportUiState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Глобальный опрос /api/wms/devices/support/poll — работает пока приложение живо, не только в Compose. */
object SupportSessionController {
    private val _uiState = MutableStateFlow(SupportUiState())
    val uiState: StateFlow<SupportUiState> = _uiState.asStateFlow()

    private var repository: WmsRepository? = null
    private var prefs: AppPrefs? = null
    private var appContext: Context? = null
    private var scope: CoroutineScope? = null
    private var pollJob: Job? = null
    private var activity: Activity? = null

    fun start(app: WmsApplication) {
        repository = app.repository
        prefs = app.appPrefs
        appContext = app.applicationContext
        scope = app.applicationScope
        if (pollJob?.isActive == true) return
        pollJob = app.applicationScope.launch {
            while (isActive) {
                pollOnce()
                delay(if (_uiState.value.activeSession != null) 3_500L else 3_000L)
            }
        }
    }

    fun attachActivity(activity: Activity) {
        this.activity = activity
    }

    fun onRouteChanged(route: String) {
        SupportTelemetry.setScreen(route)
    }

    fun requestPollNow() {
        val s = scope ?: return
        s.launch { pollOnce() }
    }

    fun acceptPending() {
        val session = _uiState.value.pendingSession ?: return
        val repo = repository ?: return
        val s = scope ?: return
        s.launch {
            _uiState.value = _uiState.value.copy(responding = true)
            repo.respondSupportSession(session.sessionId, accept = true)
                .onSuccess { active ->
                    SupportTelemetry.activeSessionId = active.sessionId
                    clearSupportNotification()
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
        val repo = repository ?: return
        val s = scope ?: return
        s.launch {
            _uiState.value = _uiState.value.copy(responding = true)
            repo.respondSupportSession(session.sessionId, accept = false)
            SupportTelemetry.activeSessionId = null
            clearSupportNotification()
            _uiState.value = SupportUiState(banner = "Запрос поддержки отклонён")
        }
    }

    fun endActiveLocally() {
        val session = _uiState.value.activeSession ?: return
        val repo = repository ?: return
        val s = scope ?: return
        s.launch {
            repo.endSupportSession(session.sessionId, "Завершено на ТСД")
            SupportTelemetry.activeSessionId = null
            clearSupportNotification()
            _uiState.value = SupportUiState(banner = "Режим поддержки завершён")
        }
    }

    suspend fun pollOnce() {
        val repo = repository ?: return
        val activeId = _uiState.value.activeSession?.sessionId
        val poll = repo.pollSupportSession(activeId)
        if (poll.isFailure) return
        val body = poll.getOrNull() ?: return
        val session = body.session

        when {
            session == null -> {
                if (_uiState.value.activeSession != null || _uiState.value.pendingSession != null) {
                    SupportTelemetry.activeSessionId = null
                    clearSupportNotification()
                    _uiState.value = SupportUiState()
                }
            }
            session.status == "pending" -> {
                _uiState.value = _uiState.value.copy(pendingSession = session, activeSession = null)
                maybeNotifyPending(session)
            }
            session.status == "active" -> {
                SupportTelemetry.activeSessionId = session.sessionId
                clearSupportNotification()
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
                clearSupportNotification()
                _uiState.value = SupportUiState()
            }
        }
    }

    private suspend fun maybeNotifyPending(session: SupportSessionDto) {
        val ctx = appContext ?: return
        val p = prefs ?: return
        val last = p.lastNotifiedSupportSessionId.first()
        if (last == session.sessionId) return
        p.setLastNotifiedSupportSessionId(session.sessionId)
        WmsPushNotifier.show(
            ctx,
            NOTIFY_SUPPORT,
            "Запрос поддержки",
            "Администратор WMS просит доступ. Откройте приложение и нажмите «Разрешить».",
        )
    }

    private suspend fun clearSupportNotification() {
        prefs?.setLastNotifiedSupportSessionId("")
        val ctx = appContext ?: return
        androidx.core.content.ContextCompat.getSystemService(ctx, android.app.NotificationManager::class.java)
            ?.cancel(NOTIFY_SUPPORT)
    }

    private suspend fun sendTelemetry(sessionId: String) {
        val repo = repository ?: return
        val events = SupportTelemetry.drainPending().map {
            SupportEventInput(level = it.level, eventType = it.eventType, message = it.message)
        }
        repo.postSupportTelemetry(
            sessionId = sessionId,
            currentScreen = SupportTelemetry.currentScreen,
            events = events,
        )
    }

    private suspend fun uploadScreenshot(sessionId: String) {
        val act = activity ?: return
        val repo = repository ?: return
        val base64 = ScreenCapture.captureActivityJpegBase64(act) ?: run {
            SupportTelemetry.log("warn", "screenshot", "Не удалось сделать снимок экрана")
            return
        }
        repo.uploadSupportScreenshot(sessionId, base64)
    }

    private const val NOTIFY_SUPPORT = 1003
}
