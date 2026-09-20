package com.scadatable.wms.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.util.Log

class OtaInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        OtaInstallStatus.save(context, status, message)
        when (status) {
            PackageInstaller.STATUS_SUCCESS ->
                Log.i(TAG, "OTA install success")
            else ->
                Log.w(TAG, "OTA install failed: status=$status msg=$message")
        }
    }

    companion object {
        private const val TAG = "OtaInstallReceiver"
    }
}
