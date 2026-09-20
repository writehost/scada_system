package com.scadatable.wms.update

import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

object ApkInstallHelper {
    const val OTA_APK_NAME = "ota-install.apk"

    fun otaStorageDir(context: Context): File =
        File(context.getExternalFilesDir(null) ?: context.cacheDir, "ota").apply { mkdirs() }

    fun otaDownloadFile(context: Context): File = File(otaStorageDir(context), OTA_APK_NAME)

    fun prepareInstallFile(context: Context, source: File): File {
        val target = otaDownloadFile(context)
        target.parentFile?.mkdirs()
        if (!source.exists() || source.length() <= 0L) {
            throw IllegalStateException("APK не найден или пустой")
        }
        if (source.canonicalPath != target.canonicalPath) {
            source.inputStream().use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            }
        }
        return target
    }

    fun fileProviderUri(context: Context, apkFile: File): Uri {
        val authority = "${context.packageName}.fileprovider"
        return FileProvider.getUriForFile(context, authority, apkFile.canonicalFile)
    }

    /**
     * Сначала PackageInstaller (тихое обновление с той же подписью на ТСД),
     * затем системный установщик если сессия не удалась.
     */
    fun install(context: Context, apkFile: File): Result<Unit> {
        OtaInstallStatus.clear(context)
        val installFile = prepareInstallFile(context, apkFile)
        val sessionResult = installWithPackageInstaller(context, installFile)
        if (sessionResult.isSuccess) {
            return Result.success(Unit)
        }
        val viewResult = installWithViewIntent(context, installFile)
        return if (viewResult.isSuccess) {
            Result.success(Unit)
        } else {
            sessionResult.exceptionOrNull()?.let { Result.failure(it) } ?: viewResult
        }
    }

    @SuppressLint("QueryPermissionsNeeded")
    private fun installWithViewIntent(context: Context, apkFile: File): Result<Unit> {
        return try {
            val uri = fileProviderUri(context, apkFile)
            val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val installers = context.packageManager.queryIntentActivities(
                viewIntent,
                PackageManager.MATCH_DEFAULT_ONLY,
            )
            if (installers.isEmpty()) {
                return Result.failure(IllegalStateException("На устройстве нет приложения для установки APK"))
            }
            for (resolve in installers) {
                context.grantUriPermission(
                    resolve.activityInfo.packageName,
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
            viewIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val preferredPackages = listOf(
                "com.android.packageinstaller",
                "com.google.android.packageinstaller",
                "com.miui.packageinstaller",
            )
            var launched = false
            for (pkg in preferredPackages) {
                if (installers.none { it.activityInfo.packageName == pkg }) continue
                runCatching {
                    context.startActivity(Intent(viewIntent).apply { setPackage(pkg) })
                    launched = true
                }
                if (launched) break
            }
            if (!launched) {
                val launchContext = context.findActivity() ?: context
                launchContext.startActivity(
                    if (launchContext is Activity) viewIntent
                    else Intent.createChooser(viewIntent, "Установить SCADA WMS"),
                )
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(
                IllegalStateException(
                    "Не удалось открыть установщик: ${e.message ?: e.javaClass.simpleName}",
                    e,
                ),
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun installWithPackageInstaller(context: Context, apkFile: File): Result<Unit> {
        return try {
            val installer = context.packageManager.packageInstaller
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setSize(apkFile.length())
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    setAppPackageName(context.packageName)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    runCatching {
                        setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                    }
                }
            }
            val sessionId = installer.createSession(params)
            installer.openSession(sessionId).use { session ->
                apkFile.inputStream().buffered().use { input ->
                    session.openWrite("base.apk", 0, apkFile.length()).use { output ->
                        input.copyTo(output)
                        session.fsync(output)
                    }
                }
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                val pending = PendingIntent.getBroadcast(
                    context,
                    sessionId,
                    Intent(context, OtaInstallReceiver::class.java),
                    flags,
                )
                session.commit(pending.intentSender)
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun openUnknownSourcesSettings(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
            data = Uri.parse("package:${context.packageName}")
            if (context !is Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    private fun Context.findActivity(): Activity? {
        var ctx = this
        while (ctx is android.content.ContextWrapper) {
            if (ctx is Activity) return ctx
            ctx = ctx.baseContext
        }
        return null
    }
}
