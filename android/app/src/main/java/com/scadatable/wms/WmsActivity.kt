package com.scadatable.wms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.navigation.compose.rememberNavController
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.navigation.WmsNavGraph
import com.scadatable.wms.ui.theme.WmsTheme

class WmsActivity : ComponentActivity() {

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* optional */ }

    // Приёмник аппаратного сканера Mindeo MS8389 (и совместимых ТСД).
    private val scannerReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val barcode = extractScanBarcode(intent)
            if (!barcode.isNullOrBlank()) {
                Log.d("WMS_SCAN", "Аппаратный скан (${intent?.action}): $barcode")
                ScanEvents.onScan(barcode.trim())
            } else {
                Log.w("WMS_SCAN", "Пустой скан action=${intent?.action} extras=${intent?.extras?.keySet()}")
            }
        }
    }

    private fun extractScanBarcode(intent: Intent?): String? {
        if (intent == null) return null
        val keys = listOf(
            "scandata",
            "scannerdata",
            "data",
            "barcode",
            "barcode_string",
            "decode_data",
            "SCAN_BARCODE1",
            "SCAN_BARCODE",
            "com.symbol.datawedge.data_string",
        )
        for (key in keys) {
            val value = intent.getStringExtra(key)?.trim().orEmpty()
            if (value.isNotEmpty()) return value
        }
        // Некоторые прошивки кладут байты
        val bytes = intent.getByteArrayExtra("scandata")
            ?: intent.getByteArrayExtra("barcode")
            ?: intent.getByteArrayExtra("data")
        if (bytes != null && bytes.isNotEmpty()) {
            return bytes.toString(Charsets.UTF_8).trim().trimEnd('\u0000')
        }
        return null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        requestNotificationPermissionIfNeeded()
        
        setContent {
            WmsTheme {
                val navController = rememberNavController()
                WmsNavGraph(navController = navController)
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // Action из настроек Mindeo + типичные варианты прошивок
        val filter = IntentFilter().apply {
            addAction("com.android.scanner.broadcast")
            addAction("com.android.server.scannerservice.broadcast")
            addAction("android.intent.ACTION_DECODE_DATA")
            addAction("scan.rcv.message")
            addAction("nlscan.action.SCANNER_RESULT")
            addAction("com.mindeo.scan")
        }

        ContextCompat.registerReceiver(this, scannerReceiver, filter, ContextCompat.RECEIVER_EXPORTED)
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(scannerReceiver)
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
