package com.scadatable.wms

import android.app.Application
import com.scadatable.wms.data.AppPrefs
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.push.WmsPushListener
import com.scadatable.wms.push.WmsPushScheduler
import com.scadatable.wms.support.SupportSessionController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class WmsApplication : Application() {
    lateinit var appPrefs: AppPrefs
    lateinit var repository: WmsRepository
        private set

    private val appJob = SupervisorJob()
    val applicationScope = CoroutineScope(appJob + Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        val db = WmsDatabase.getDatabase(this)
        appPrefs = AppPrefs(this)
        repository = WmsRepository(db.wmsDao(), appPrefs)
        // Не блокируем cold start WorkManager'ом — на слабых эмуляторах это даёт ANR на сплэше.
        applicationScope.launch {
            delay(2_000)
            WmsPushScheduler.schedule(this@WmsApplication)
            WmsPushScheduler.syncNow(this@WmsApplication)
        }
        WmsPushListener.start(this)
        SupportSessionController.start(this)
    }
}
