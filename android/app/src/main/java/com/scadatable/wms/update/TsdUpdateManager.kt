package com.scadatable.wms.update

import android.content.Context
import android.os.Build
import android.os.PowerManager
import com.scadatable.wms.data.remote.TsdReleaseInfo
import com.scadatable.wms.data.remote.TsdUpdateCheckResult
import com.scadatable.wms.data.remote.TsdUpdateClient
import com.scadatable.wms.data.remote.WmsEndpointConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.math.min

class TsdUpdateManager(private val context: Context) {
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(60, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.MINUTES)
            .writeTimeout(5, TimeUnit.MINUTES)
            .callTimeout(45, TimeUnit.MINUTES)
            .retryOnConnectionFailure(true)
            .build()
    }

    suspend fun checkForUpdate(serverBaseUrl: String, versionCode: Int, versionName: String): TsdUpdateCheckResult {
        return TsdUpdateClient.check(serverBaseUrl, versionCode, versionName)
    }

    suspend fun downloadApk(
        release: TsdReleaseInfo,
        serverBaseUrl: String,
        onProgress: (progress: Float, status: String?) -> Unit,
    ): Result<File> = withContext(Dispatchers.IO) {
        val resolved = resolveApkUrl(release, serverBaseUrl)
            ?: return@withContext Result.failure(IllegalStateException("Нет URL APK"))

        val outFile = ApkInstallHelper.otaDownloadFile(context)
        val metaFile = File(ApkInstallHelper.otaStorageDir(context), "${ApkInstallHelper.OTA_APK_NAME}.meta")
        ensureReleaseContext(release, outFile, metaFile)

        val wakeLock = acquireDownloadWakeLock()
        try {
            downloadApkResumable(release, resolved, outFile, metaFile, onProgress)
        } finally {
            releaseWakeLock(wakeLock)
        }
    }

    private fun ensureReleaseContext(release: TsdReleaseInfo, outFile: File, metaFile: File) {
        val stored = OtaDownloadMeta.read(metaFile)
        if (stored != null && stored.matches(release)) return
        OtaDownloadMeta.clearArtifacts(outFile, metaFile)
    }

    private fun isCompleteDownload(apkFile: File, expectedSize: Long, expectedSha256: String?): Boolean {
        if (!apkFile.exists() || apkFile.length() <= 0L) return false
        if (apkFile.length() != expectedSize) return false
        if (expectedSha256.isNullOrBlank()) return true
        return ApkSha256.ofFile(apkFile).lowercase() == expectedSha256.trim().lowercase()
    }

    private fun acquireDownloadWakeLock(): PowerManager.WakeLock? {
        return try {
            val pm = context.getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "scadatable:wms-tsd-download").apply {
                setReferenceCounted(false)
                acquire(45 * 60 * 1000L)
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun releaseWakeLock(wakeLock: PowerManager.WakeLock?) {
        try {
            if (wakeLock?.isHeld == true) wakeLock.release()
        } catch (_: Exception) {
        }
    }

    private suspend fun downloadApkResumable(
        release: TsdReleaseInfo,
        url: String,
        outFile: File,
        metaFile: File,
        onProgress: (Float, String?) -> Unit,
    ): Result<File> {
        val expectedSha256 = release.apkSha256?.trim()?.lowercase()?.takeIf { it.isNotBlank() }
        var totalBytes = readExpectedSize(metaFile, release)
        if (totalBytes == null || totalBytes <= 0L) {
            totalBytes = probeContentLength(url)
            if (totalBytes != null && totalBytes > 0L) {
                writeExpectedSize(metaFile, release, totalBytes)
            }
        }

        if (totalBytes != null && totalBytes > 0L) {
            val expectedSize = totalBytes
            if (isCompleteDownload(outFile, expectedSize, expectedSha256)) {
                onProgress(1f, null)
                return Result.success(outFile)
            }
            if (outFile.exists() && outFile.length() == expectedSize) {
                // Размер совпал, но SHA256 нет — типичный случай после setLength в chunked без полной загрузки.
                OtaDownloadMeta.clearArtifacts(outFile, metaFile)
                totalBytes = probeContentLength(url)
                if (totalBytes != null && totalBytes > 0L) {
                    writeExpectedSize(metaFile, release, totalBytes)
                }
            }
            val sizeForDownload = totalBytes ?: expectedSize
            // Сначала resumable streaming — на ТСД Wi‑Fi стабильнее одного соединения, чем сотни chunk-запросов
            val streaming = downloadApkStreaming(release, url, outFile, metaFile, sizeForDownload, onProgress)
            if (streaming.isSuccess) return streaming
            val chunked = downloadApkChunked(release, url, outFile, metaFile, sizeForDownload, onProgress)
            if (chunked.isSuccess) return chunked
            return streaming
        }

        return downloadApkStreaming(release, url, outFile, metaFile, totalBytes, onProgress)
    }

    /** Короткие HTTP-запросы по 256 КБ — не рвутся на нестабильном Wi‑Fi ТСД. */
    private suspend fun downloadApkChunked(
        release: TsdReleaseInfo,
        url: String,
        outFile: File,
        metaFile: File,
        totalBytes: Long,
        onProgress: (Float, String?) -> Unit,
    ): Result<File> = withContext(Dispatchers.IO) {
        val expectedSha256 = release.apkSha256?.trim()?.lowercase()?.takeIf { it.isNotBlank() }
        val chunkSize = 256L * 1024L
        java.io.RandomAccessFile(outFile, "rw").use { raf ->
            val channel = raf.channel
            var offset = if (outFile.exists()) outFile.length() else 0L
            if (offset >= totalBytes) offset = 0L

            while (offset < totalBytes) {
                val end = min(offset + chunkSize - 1, totalBytes - 1)
                val chunkIndex = (offset / chunkSize).toInt() + 1
                val chunkTotal = ((totalBytes + chunkSize - 1) / chunkSize).toInt()
                var chunkAttempt = 0
                val maxChunkAttempts = 10
                var chunkOk = false
                while (chunkAttempt < maxChunkAttempts && !chunkOk) {
                    chunkAttempt++
                    try {
                        onProgress(
                            progressOf(offset, totalBytes),
                            "Фрагмент $chunkIndex/$chunkTotal (${offset / (1024 * 1024)} МБ)…",
                        )
                        downloadRangeToFile(url, offset, end, channel, offset)
                        chunkOk = true
                    } catch (e: Exception) {
                        if (chunkAttempt >= maxChunkAttempts) {
                            return@withContext Result.failure(
                                IOException("Обрыв на фрагменте $chunkIndex: ${e.message}", e),
                            )
                        }
                        val waitMs = min(15_000L, 1_500L * chunkAttempt)
                        onProgress(
                            progressOf(offset, totalBytes),
                            "Повтор фрагмента $chunkIndex/$chunkTotal ($chunkAttempt/$maxChunkAttempts)…",
                        )
                        delay(waitMs)
                    }
                }
                offset = end + 1
                onProgress(progressOf(offset, totalBytes), null)
            }
        }
        if (outFile.length() != totalBytes) {
            return@withContext Result.failure(
                IOException("Загрузка не завершена (${outFile.length()} / $totalBytes байт)"),
            )
        }
        if (!isCompleteDownload(outFile, totalBytes, expectedSha256)) {
            OtaDownloadMeta.clearArtifacts(outFile, metaFile)
            return@withContext Result.failure(
                IOException("Файл повреждён после загрузки фрагментами. Повторите скачивание."),
            )
        }
        onProgress(1f, null)
        Result.success(outFile)
    }

    private fun downloadRangeToFile(
        url: String,
        start: Long,
        end: Long,
        channel: java.nio.channels.FileChannel,
        fileOffset: Long,
    ) {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=$start-$end")
            .header("Accept", "*/*")
            .get()
            .build()
        http.newCall(request).execute().use { response ->
            if (response.code != 206 && response.code != 200) {
                throw IOException("HTTP ${response.code}")
            }
            if (response.code == 200 && start > 0L) {
                throw IOException("Сервер не поддерживает докачку (HTTP 200)")
            }
            val body = response.body ?: throw IOException("Пустой ответ")
            body.byteStream().use { input ->
                val buffer = ByteArray(32 * 1024)
                var pos = fileOffset
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                    val written = channel.write(java.nio.ByteBuffer.wrap(buffer, 0, read), pos)
                    if (written <= 0) throw IOException("Не удалось записать файл")
                    pos += read
                }
            }
        }
    }

    private fun supportsRange(url: String): Boolean {
        val request = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .get()
            .build()
        return http.newCall(request).execute().use { it.code == 206 }
    }

    private suspend fun downloadApkStreaming(
        release: TsdReleaseInfo,
        url: String,
        outFile: File,
        metaFile: File,
        initialTotal: Long?,
        onProgress: (Float, String?) -> Unit,
    ): Result<File> {
        val expectedSha256 = release.apkSha256?.trim()?.lowercase()?.takeIf { it.isNotBlank() }
        var totalBytes = initialTotal
        if (totalBytes == null || totalBytes <= 0L) {
            totalBytes = readExpectedSize(metaFile, release)
            if (totalBytes == null || totalBytes <= 0L) {
                totalBytes = probeContentLength(url)
                if (totalBytes != null && totalBytes > 0L) {
                    writeExpectedSize(metaFile, release, totalBytes)
                }
            }
        }

        val maxAttempts = 12
        var attempt = 0
        var lastError: Exception? = null

        while (attempt < maxAttempts) {
            attempt++
            try {
                var downloaded = if (outFile.exists()) outFile.length() else 0L
                if (totalBytes != null && totalBytes > 0L && isCompleteDownload(outFile, totalBytes, expectedSha256)) {
                    onProgress(1f, null)
                    return Result.success(outFile)
                }

                val status = if (downloaded > 0L) {
                    val mb = downloaded / (1024f * 1024f)
                    "Докачка с ${"%.1f".format(mb)} МБ…"
                } else {
                    "Скачивание…"
                }
                onProgress(progressOf(downloaded, totalBytes), status)

                val requestBuilder = Request.Builder()
                    .url(url)
                    .header("Accept", "*/*")
                    .get()
                if (downloaded > 0L) {
                    requestBuilder.header("Range", "bytes=$downloaded-")
                }

                http.newCall(requestBuilder.build()).execute().use { response ->
                    when (response.code) {
                        206 -> {
                            val contentRange = response.header("Content-Range")
                            val totalFromHeader = parseTotalFromContentRange(contentRange)
                            if (totalFromHeader != null && totalFromHeader > 0L) {
                                totalBytes = totalFromHeader
                                writeExpectedSize(metaFile, release, totalFromHeader)
                            }
                        }
                        200 -> {
                            if (downloaded > 0L) {
                                outFile.delete()
                                downloaded = 0L
                            }
                            val len = response.body?.contentLength() ?: -1L
                            if (len > 0L) {
                                totalBytes = len
                                writeExpectedSize(metaFile, release, len)
                            }
                        }
                        416 -> {
                            OtaDownloadMeta.clearArtifacts(outFile, metaFile)
                            downloaded = 0L
                            totalBytes = probeContentLength(url)
                            if (totalBytes != null && totalBytes > 0L) {
                                writeExpectedSize(metaFile, release, totalBytes)
                            }
                            throw IOException("Смещение загрузки сброшено, начинаем заново")
                        }
                        else -> throw IOException("Скачивание: HTTP ${response.code}")
                    }

                    val body = response.body ?: throw IOException("Пустой ответ сервера")
                    val appendMode = response.code == 206
                    body.byteStream().use { input ->
                        java.io.FileOutputStream(outFile, appendMode).use { output ->
                            val buffer = ByteArray(64 * 1024)
                            var read: Int
                            while (input.read(buffer).also { read = it } != -1) {
                                output.write(buffer, 0, read)
                                downloaded += read
                                onProgress(progressOf(downloaded, totalBytes), status)
                            }
                            output.flush()
                        }
                    }
                }

                if (outFile.length() <= 0L) {
                    throw IOException("Файл APK не сохранён")
                }
                if (totalBytes != null && totalBytes > 0L && outFile.length() < totalBytes) {
                    throw IOException("Загрузка не завершена (${outFile.length()} / $totalBytes байт)")
                }
                if (totalBytes != null && totalBytes > 0L && !isCompleteDownload(outFile, totalBytes, expectedSha256)) {
                    OtaDownloadMeta.clearArtifacts(outFile, metaFile)
                    throw IOException("Файл повреждён после скачивания. Повторите загрузку.")
                }

                onProgress(1f, null)
                return Result.success(outFile)
            } catch (e: Exception) {
                lastError = if (e is Exception) e else IOException(e.message, e)
                val partial = if (outFile.exists()) outFile.length() else 0L
                if (attempt >= maxAttempts) break
                val waitMs = min(30_000L, 2_000L * attempt)
                onProgress(
                    progressOf(partial, totalBytes),
                    "Обрыв связи, повтор $attempt/$maxAttempts через ${waitMs / 1000} с…",
                )
                delay(waitMs)
            }
        }

        val partial = if (outFile.exists()) outFile.length() else 0L
        val hint = if (partial > 0L) {
            " Загружено ${partial / (1024 * 1024)} МБ — нажмите «Продолжить скачивание»."
        } else {
            ""
        }
        return Result.failure(
            lastError?.let { IOException("${it.message ?: "Не удалось скачать APK"}.$hint Проверьте Wi‑Fi и нажмите «Продолжить скачивание».", it) }
                ?: IOException("Не удалось скачать APK.$hint"),
        )
    }

    private fun progressOf(downloaded: Long, total: Long?): Float {
        if (total != null && total > 0L) {
            return (downloaded.toFloat() / total.toFloat()).coerceIn(0f, 0.99f)
        }
        return 0f
    }

    private fun resolveApkUrl(release: TsdReleaseInfo, serverBaseUrl: String): String? {
        val apkUrl = release.apkUrl?.trim().orEmpty()
        if (apkUrl.isBlank()) return null
        return if (apkUrl.startsWith("http")) {
            apkUrl
        } else {
            val base = WmsEndpointConfig.resolveUpdateServerBaseUrl(serverBaseUrl)
            base.trimEnd('/') + (if (apkUrl.startsWith("/")) apkUrl else "/$apkUrl")
        }
    }

    private fun probeContentLength(url: String): Long? {
        val headRequest = Request.Builder().url(url).head().build()
        http.newCall(headRequest).execute().use { response ->
            if (response.isSuccessful) {
                response.header("Content-Length")?.toLongOrNull()?.takeIf { it > 0L }?.let { return it }
            }
        }
        val rangeRequest = Request.Builder()
            .url(url)
            .header("Range", "bytes=0-0")
            .get()
            .build()
        http.newCall(rangeRequest).execute().use { response ->
            if (response.code == 206) {
                return parseTotalFromContentRange(response.header("Content-Range"))
            }
            if (response.isSuccessful) {
                return response.body?.contentLength()?.takeIf { it > 0L }
            }
        }
        return null
    }

    private fun parseTotalFromContentRange(header: String?): Long? {
        if (header.isNullOrBlank()) return null
        val totalPart = header.substringAfter("/", "").trim()
        return totalPart.toLongOrNull()?.takeIf { it > 0L }
    }

    private fun readExpectedSize(metaFile: File, release: TsdReleaseInfo): Long? {
        val meta = OtaDownloadMeta.read(metaFile) ?: return readLegacyExpectedSize(metaFile)
        if (!meta.matches(release)) return null
        return meta.expectedSize.takeIf { it > 0L }
    }

    private fun readLegacyExpectedSize(metaFile: File): Long? {
        if (!metaFile.exists()) return null
        return runCatching { metaFile.readText().trim().toLongOrNull() }.getOrNull()?.takeIf { it > 0L }
    }

    private fun writeExpectedSize(metaFile: File, release: TsdReleaseInfo, size: Long) {
        OtaDownloadMeta.write(metaFile, OtaDownloadMeta.fromRelease(release, size))
    }

    fun canInstallPackages(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    fun openInstallPermissionSettings() {
        ApkInstallHelper.openUnknownSourcesSettings(context)
    }

    fun verifyDownloadedApk(apkFile: File, expectedSha256: String?): Result<Unit> {
        val metaFile = File(ApkInstallHelper.otaStorageDir(context), "${ApkInstallHelper.OTA_APK_NAME}.meta")
        if (!expectedSha256.isNullOrBlank()) {
            val actual = ApkSha256.ofFile(apkFile).lowercase()
            val expected = expectedSha256.trim().lowercase()
            if (actual != expected) {
                OtaDownloadMeta.clearArtifacts(apkFile, metaFile)
                return Result.failure(
                    IllegalStateException(
                        "Файл повреждён (контрольная сумма не совпадает). Нажмите «Скачать заново» — загрузка начнётся с начала.",
                    ),
                )
            }
        }
        return ApkSignatureHelper.verifyOtaApk(context, apkFile)
    }

    fun clearOtaDownloadCache() {
        OtaDownloadMeta.clearArtifacts(
            ApkInstallHelper.otaDownloadFile(context),
            File(ApkInstallHelper.otaStorageDir(context), "${ApkInstallHelper.OTA_APK_NAME}.meta"),
        )
    }

    fun startInstall(apkFile: File, hostContext: Context = context): Result<Unit> {
        val ctx = hostContext.findActivity() ?: hostContext
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !canInstallPackages()) {
            return Result.failure(IllegalStateException("Разрешите установку из этого источника"))
        }
        ApkSignatureHelper.verifyOtaApk(context, apkFile).onFailure { return Result.failure(it) }
        return ApkInstallHelper.install(ctx, apkFile)
    }

    suspend fun waitForInstallResult(hostContext: Context = context): String? =
        OtaInstallStatus.waitForResult(hostContext.applicationContext)

    fun consumeInstallStatusMessage(): String? = OtaInstallStatus.consumeMessage(context)

    private fun Context.findActivity(): android.app.Activity? {
        var ctx = this
        while (ctx is android.content.ContextWrapper) {
            if (ctx is android.app.Activity) return ctx
            ctx = ctx.baseContext
        }
        return null
    }
}
