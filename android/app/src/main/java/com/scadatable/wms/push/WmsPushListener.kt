package com.scadatable.wms.push

import com.scadatable.wms.WmsApplication
import com.scadatable.wms.support.SupportSessionController
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Long-poll к /api/wms/devices/tasks/subscribe — почти мгновенный push, пока приложение живо. */
object WmsPushListener {
    private var job: Job? = null

    fun start(app: WmsApplication) {
        if (job?.isActive == true) return
        job = app.applicationScope.launch {
            while (isActive) {
                try {
                    if (!app.appPrefs.pushNotificationsEnabled.first()) {
                        delay(5_000)
                        continue
                    }
                    val baseUrl = app.appPrefs.baseUrl.first().trim()
                    val siteCode = app.appPrefs.siteCode.first().trim()
                    val deviceUid = app.appPrefs.deviceUid.first().trim()
                    if (baseUrl.isBlank() || siteCode.isBlank() || deviceUid.isBlank()) {
                        delay(10_000)
                        continue
                    }
                    app.repository.pollDeviceTasksSubscribe().onSuccess { (response, tasks) ->
                        WmsPushEngine.handleSubscribeResult(
                            app.applicationContext,
                            app.appPrefs,
                            tasks,
                            response.trigger,
                        )
                        if (response.trigger?.eventType?.equals("push_test", ignoreCase = true) == true) {
                            SupportSessionController.requestPollNow()
                        }
                    }.onFailure {
                        delay(5_000)
                    }
                } catch (_: CancellationException) {
                    break
                } catch (_: Exception) {
                    delay(5_000)
                }
            }
        }
    }
}
