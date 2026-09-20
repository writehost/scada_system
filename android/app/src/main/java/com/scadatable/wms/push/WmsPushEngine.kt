package com.scadatable.wms.push

import android.content.Context
import com.scadatable.wms.data.AppPrefs
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.local.TaskCache
import com.scadatable.wms.data.remote.TaskSubscribeTrigger
import kotlinx.coroutines.flow.first

object WmsPushEngine {
    suspend fun syncAndNotify(context: Context, repository: WmsRepository, prefs: AppPrefs) {
        if (!prefs.pushNotificationsEnabled.first()) return

        repository.refreshDeviceTasks(status = "open").onSuccess { tasks ->
            notifyOpenTasks(context, prefs, tasks, force = false)
        }

        val cacheBefore = prefs.receivingCategoriesCache.first().orEmpty()
        repository.fetchReceivingCategories().onSuccess {
            val cacheAfter = prefs.receivingCategoriesCache.first().orEmpty()
            val prevSig = prefs.lastReceivingCategoriesSig.first()
            val sig = cacheAfter.hashCode().toString()
            if (cacheBefore.isNotBlank() && cacheAfter.isNotBlank() && cacheBefore != cacheAfter && prevSig.isNotBlank()) {
                WmsPushNotifier.show(
                    context,
                    NOTIFY_CATEGORIES,
                    "Обновлены подгруппы приёмки",
                    "Нажмите «Обновить подгруппы» на экране приёмки или откройте приложение.",
                )
            }
            prefs.setLastReceivingCategoriesSig(sig)
        }
    }

    suspend fun handleSubscribeResult(
        context: Context,
        prefs: AppPrefs,
        tasks: List<TaskCache>,
        trigger: TaskSubscribeTrigger?,
    ) {
        if (!prefs.pushNotificationsEnabled.first()) return
        val eventType = trigger?.eventType?.lowercase().orEmpty()
        if (eventType == "push_test") {
            val body = trigger?.message?.trim().orEmpty().ifBlank {
                "Push с сервера доставлен. Связь с ТСД работает."
            }
            WmsPushNotifier.show(context, NOTIFY_TEST, "Тест WMS", body)
            return
        }
        val isRealEvent = eventType.isNotBlank() && eventType != "timeout"
        val notified = notifyOpenTasks(context, prefs, tasks, force = false)
        if (!notified && isRealEvent && tasks.any { it.taskStatus.equals("open", true) }) {
            val body = tasks
                .filter { it.taskStatus.equals("open", true) }
                .take(2)
                .joinToString("\n") { "${it.taskCode}: ${it.itemName ?: it.itemCode ?: "—"}" }
            WmsPushNotifier.show(
                context,
                NOTIFY_TASKS,
                "Задача на ТСД",
                body.ifBlank { "Откройте раздел «Задачи»" },
            )
        }
    }

    private suspend fun notifyOpenTasks(
        context: Context,
        prefs: AppPrefs,
        tasks: List<TaskCache>,
        force: Boolean,
    ): Boolean {
        val openTasks = tasks.filter { it.taskStatus.equals("open", ignoreCase = true) }
        val openCount = openTasks.size
        val prev = prefs.lastNotifiedOpenTaskCount.first()
        if ((openCount > prev && openCount > 0) || (force && openCount > 0)) {
            val delta = (openCount - prev).coerceAtLeast(1)
            val title = if (delta == 1) "Новая задача на ТСД" else "Новые задачи: $openCount"
            val body = openTasks
                .take(2)
                .joinToString("\n") { "${it.taskCode}: ${it.itemName ?: it.itemCode ?: "—"}" }
            WmsPushNotifier.show(context, NOTIFY_TASKS, title, body.ifBlank { "Откройте раздел «Задачи»" })
            prefs.setLastNotifiedOpenTaskCount(openCount)
            return true
        }
        prefs.setLastNotifiedOpenTaskCount(openCount)
        return false
    }

    private const val NOTIFY_TASKS = 1001
    private const val NOTIFY_CATEGORIES = 1002
    private const val NOTIFY_TEST = 1004
}
