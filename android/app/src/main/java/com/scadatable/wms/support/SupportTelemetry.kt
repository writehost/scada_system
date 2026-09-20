package com.scadatable.wms.support

import java.util.ArrayDeque

object SupportTelemetry {
    private val pending = ArrayDeque<SupportEventDraft>(32)
    private const val MAX_PENDING = 40

    @Volatile
    var currentScreen: String = "main"
        private set

    @Volatile
    var activeSessionId: String? = null
        internal set

    fun setScreen(route: String) {
        val label = humanizeRoute(route)
        if (label != currentScreen) {
            currentScreen = label
            if (activeSessionId != null) {
                log("info", "screen", "Экран: $label")
            }
        }
    }

    fun log(level: String, eventType: String, message: String) {
        synchronized(pending) {
            if (pending.size >= MAX_PENDING) pending.removeFirst()
            pending.addLast(SupportEventDraft(level, eventType, message))
        }
    }

    fun logApiError(status: Int, code: String?, message: String) {
        log("error", "api_error", "API $status${code?.let { " ($it)" } ?: ""}: $message")
    }

    fun drainPending(): List<SupportEventDraft> {
        synchronized(pending) {
            if (pending.isEmpty()) return emptyList()
            val copy = pending.toList()
            pending.clear()
            return copy
        }
    }

    private fun humanizeRoute(route: String): String {
        val clean = route.substringBefore("?").trim('/')
        if (clean.isBlank() || clean == "main") return "Главная"
        return clean
            .replace('_', ' ')
            .replace("/", " → ")
            .replace("receiving session", "Приёмка")
            .replace("receiving documents", "Документы приёмки")
            .replace("receiving category", "Подгруппа приёмки")
            .replace("issue manual", "Выдача вручную")
            .replace("warehouse stock", "Склад")
            .replace("scan history", "История сканов")
    }
}

data class SupportEventDraft(
    val level: String,
    val eventType: String,
    val message: String,
)
