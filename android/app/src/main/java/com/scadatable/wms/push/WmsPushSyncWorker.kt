package com.scadatable.wms.push

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.scadatable.wms.WmsApplication

class WmsPushSyncWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as? WmsApplication ?: return Result.success()
        WmsPushEngine.syncAndNotify(applicationContext, app.repository, app.appPrefs)
        return Result.success()
    }

    companion object {
        const val WORK_NAME = "wms_push_sync"
    }
}
