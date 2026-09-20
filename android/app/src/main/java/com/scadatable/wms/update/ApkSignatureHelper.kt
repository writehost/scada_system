package com.scadatable.wms.update

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.content.pm.SigningInfo
import android.os.Build
import com.scadatable.wms.BuildConfig
import java.io.File
import java.security.MessageDigest

object ApkSignatureHelper {
    /** Единственный допустимый ключ OTA — tsd-ota.keystore (не менять на сервере и в CI). */
    private val allowedCertSha256: String = BuildConfig.OTA_SIGNING_CERT_SHA256.lowercase()

    fun verifyOtaApk(context: Context, apkFile: File): Result<Unit> {
        if (!apkFile.exists() || apkFile.length() < 1024L) {
            return Result.failure(IllegalStateException("Скачанный APK пустой или повреждён"))
        }
        val apkCert = readArchiveCertSha256(context, apkFile)
            ?: return Result.failure(IllegalStateException("Не удалось прочитать подпись APK"))
        if (apkCert != allowedCertSha256) {
            return Result.failure(
                IllegalStateException(
                    "APK с сервера подписан другим ключом. Сообщите администратору — на OTA-сервере должен быть только tsd-ota.keystore.",
                ),
            )
        }
        val installed = readInstalledCertSha256(context)
        if (installed != null && installed != apkCert) {
            return Result.failure(
                IllegalStateException(
                    "На ТСД установлена версия с другой подписью. Один раз переустановите APK по USB или удалите приложение и поставьте с https://scada25.ru/packages/",
                ),
            )
        }
        return Result.success(Unit)
    }

    fun readInstalledCertSha256(context: Context): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES,
                )
                certSha256Hex(info.signingInfo)
            } else {
                @Suppress("DEPRECATION")
                val info = context.packageManager.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNATURES,
                )
                @Suppress("DEPRECATION")
                certSha256Hex(info.signatures)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun readArchiveCertSha256(context: Context, apkFile: File): String? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = context.packageManager.getPackageArchiveInfo(
                    apkFile.absolutePath,
                    PackageManager.GET_SIGNING_CERTIFICATES,
                ) ?: return null
                info.applicationInfo?.let { appInfo ->
                    appInfo.sourceDir = apkFile.absolutePath
                    appInfo.publicSourceDir = apkFile.absolutePath
                }
                certSha256Hex(info.signingInfo)
            } else {
                @Suppress("DEPRECATION")
                val info = context.packageManager.getPackageArchiveInfo(
                    apkFile.absolutePath,
                    PackageManager.GET_SIGNATURES,
                ) ?: return null
                info.applicationInfo?.let { appInfo ->
                    appInfo.sourceDir = apkFile.absolutePath
                    appInfo.publicSourceDir = apkFile.absolutePath
                }
                @Suppress("DEPRECATION")
                certSha256Hex(info.signatures)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun certSha256Hex(signingInfo: SigningInfo?): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        val sig = signingInfo?.apkContentsSigners?.firstOrNull() ?: return null
        return sha256Hex(sig)
    }

    private fun certSha256Hex(signatures: Array<Signature>?): String? {
        val sig = signatures?.firstOrNull() ?: return null
        return sha256Hex(sig)
    }

    private fun sha256Hex(signature: Signature): String {
        val digest = MessageDigest.getInstance("SHA-256")
        return digest.digest(signature.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
