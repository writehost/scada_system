package com.scadatable.wms.update

import android.content.Context
import kotlinx.coroutines.delay

object OtaInstallStatus {
    private const val PREFS = "ota_install_status"
    private const val KEY_STATUS = "status"
    private const val KEY_MESSAGE = "message"
    private const val KEY_AT = "at"

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
    }

    fun save(context: Context, status: Int, message: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putInt(KEY_STATUS, status)
            .putString(KEY_MESSAGE, message.orEmpty())
            .putLong(KEY_AT, System.currentTimeMillis())
            .apply()
    }

    fun consumeMessage(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val at = prefs.getLong(KEY_AT, 0L)
        if (at <= 0L || System.currentTimeMillis() - at > 10 * 60 * 1000L) return null
        val status = prefs.getInt(KEY_STATUS, -1)
        val message = prefs.getString(KEY_MESSAGE, "").orEmpty()
        prefs.edit().clear().apply()
        return formatStatus(status, message)
    }

    suspend fun waitForResult(context: Context, timeoutMs: Long = 120_000L): String? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val at = prefs.getLong(KEY_AT, 0L)
            if (at > 0L) {
                val status = prefs.getInt(KEY_STATUS, -1)
                if (status != -1) {
                    val message = prefs.getString(KEY_MESSAGE, "").orEmpty()
                    prefs.edit().clear().apply()
                    return formatStatus(status, message)
                }
            }
            delay(400)
        }
        return null
    }

    private fun formatStatus(status: Int, message: String): String? {
        return when (status) {
            android.content.pm.PackageInstaller.STATUS_SUCCESS ->
                "Обновление установлено"
            android.content.pm.PackageInstaller.STATUS_FAILURE ->
                message.ifBlank { "Установка не удалась" }.let { "Ошибка установки: $it" }
            android.content.pm.PackageInstaller.STATUS_FAILURE_CONFLICT ->
                "Конфликт при установке — удалите старую версию и повторите"
            android.content.pm.PackageInstaller.STATUS_FAILURE_INCOMPATIBLE ->
                "APK несовместим (другая подпись). Удалите приложение и установите APK с scada25.ru вручную один раз."
            android.content.pm.PackageInstaller.STATUS_FAILURE_INVALID ->
                "Повреждённый APK — скачайте обновление заново"
            android.content.pm.PackageInstaller.STATUS_FAILURE_STORAGE ->
                "Недостаточно места на устройстве"
            else -> null
        }
    }
}
