package com.scadatable.wms.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import com.scadatable.wms.data.ScanEvents

@Composable
fun ScanConsumerEffect(consumer: ScanEvents.Consumer) {
    DisposableEffect(consumer) {
        ScanEvents.setActiveConsumer(consumer)
        onDispose { ScanEvents.clearActiveConsumer(consumer) }
    }
}
