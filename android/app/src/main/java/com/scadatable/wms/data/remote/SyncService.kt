package com.scadatable.wms.data.remote

import com.scadatable.wms.data.WmsRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class SyncService(
    private val repository: WmsRepository,
) {

    suspend fun syncWarehouses(siteCode: String = "DEFAULT") {
        withContext(Dispatchers.IO) {
            repository.refreshItemsAndLocations()
        }
    }

    suspend fun pushAggregations(siteCode: String = "DEFAULT") {
        withContext(Dispatchers.IO) {
            repository.replayOutbox()
        }
    }
}
