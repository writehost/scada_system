package com.scadatable.wms.data

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.concurrent.atomic.AtomicReference

/**
 * Глобальный поток событий сканирования для аппаратных сканеров ТСД.
 * Только один активный consumer обрабатывает скан — экран, который сейчас на переднем плане.
 */
object ScanEvents {
    enum class Consumer {
        SCANNER,
        RECEIVING,
        FREE_RECEIVING,
        AGGREGATION,
        ISSUE,
        PUTAWAY,
        WAREHOUSE,
    }

    private val _barcodes = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val barcodes = _barcodes.asSharedFlow()

    private val activeConsumer = AtomicReference<Consumer?>(null)

    fun setActiveConsumer(consumer: Consumer) {
        activeConsumer.set(consumer)
    }

    fun clearActiveConsumer(consumer: Consumer) {
        activeConsumer.compareAndSet(consumer, null)
    }

    fun isActive(consumer: Consumer): Boolean = activeConsumer.get() == consumer

    fun onScan(barcode: String) {
        _barcodes.tryEmit(barcode)
    }
}
