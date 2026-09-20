package com.scadatable.wms.print

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.os.Build
import java.io.OutputStream
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

object TscBluetoothPrinter {
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @SuppressLint("MissingPermission")
    fun listPairedDevices(context: Context): List<Pair<String, String>> {
        val adapter = bluetoothAdapter(context) ?: return emptyList()
        if (!adapter.isEnabled) return emptyList()
        return adapter.bondedDevices.orEmpty()
            .sortedBy { it.name?.lowercase() ?: it.address }
            .map { (it.name ?: it.address) to it.address }
    }

    suspend fun printTspl(context: Context, macAddress: String, tspl: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            val mac = macAddress.trim()
            if (mac.isBlank()) {
                return@withContext Result.failure(IllegalStateException("Укажите MAC Bluetooth-принтера"))
            }
            val adapter = bluetoothAdapter(context)
                ?: return@withContext Result.failure(IllegalStateException("Bluetooth недоступен"))
            if (!adapter.isEnabled) {
                return@withContext Result.failure(IllegalStateException("Включите Bluetooth"))
            }
            @SuppressLint("MissingPermission")
            val device = adapter.bondedDevices?.firstOrNull { it.address.equals(mac, ignoreCase = true) }
                ?: return@withContext Result.failure(IllegalStateException("Принтер $mac не найден среди сопряжённых"))
            runCatching {
                sendToDevice(device, tspl)
            }
        }

    @SuppressLint("MissingPermission")
    private fun sendToDevice(device: BluetoothDevice, tspl: String) {
        val socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
        socket.use { s ->
            s.connect()
            val bytes = TsplEncoding.toPrinterBytes(tspl)
            val out: OutputStream = s.outputStream
            out.write(bytes)
            out.flush()
            Thread.sleep(400)
        }
    }

    private fun bluetoothAdapter(context: Context): BluetoothAdapter? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            context.getSystemService(BluetoothManager::class.java)?.adapter
        } else {
            @Suppress("DEPRECATION")
            BluetoothAdapter.getDefaultAdapter()
        }
    }
}
