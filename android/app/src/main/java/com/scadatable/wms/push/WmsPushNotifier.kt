package com.scadatable.wms.push

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.scadatable.wms.R
import com.scadatable.wms.WmsActivity

object WmsPushNotifier {
    const val CHANNEL_ID = "wms_events"
    private const val CHANNEL_NAME = "WMS события"
    private const val TAG = "WmsPush"

    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true
        return ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Задачи, подгруппы приёмки и другие события WMS"
            enableVibration(true)
        }
        mgr.createNotificationChannel(channel)
    }

    fun show(context: Context, notificationId: Int, title: String, body: String) {
        if (!canPost(context)) {
            Log.w(TAG, "POST_NOTIFICATIONS not granted — skip: $title")
            return
        }
        ensureChannel(context)
        val launch = PendingIntent.getActivity(
            context,
            notificationId,
            Intent(context, WmsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_logo)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(launch)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .build()
        ContextCompat.getSystemService(context, NotificationManager::class.java)
            ?.notify(notificationId, notification)
    }
}