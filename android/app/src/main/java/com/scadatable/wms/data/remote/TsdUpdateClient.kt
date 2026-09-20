package com.scadatable.wms.data.remote

import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

data class TsdReleaseInfo(
    @SerializedName("versionCode") val versionCode: Int,
    @SerializedName("versionName") val versionName: String,
    @SerializedName("buildId") val buildId: String,
    @SerializedName("builtAt") val builtAt: String? = null,
    @SerializedName("changelog") val changelog: String? = null,
    @SerializedName("apkName") val apkName: String? = null,
    @SerializedName("apkUrl") val apkUrl: String? = null,
    @SerializedName("apkSha256") val apkSha256: String? = null,
    @SerializedName("signingCertSha256") val signingCertSha256: String? = null,
    @SerializedName("mandatory") val mandatory: Boolean = false,
)

data class TsdUpdateCheckResult(
    @SerializedName("updateAvailable") val updateAvailable: Boolean = false,
    @SerializedName("isTest") val isTest: Boolean = false,
    @SerializedName("release") val release: TsdReleaseInfo? = null,
    @SerializedName("currentVersionCode") val currentVersionCode: Int? = null,
    @SerializedName("currentVersionName") val currentVersionName: String? = null,
    @SerializedName("installedVersionCode") val installedVersionCode: Int? = null,
    @SerializedName("installedVersionName") val installedVersionName: String? = null,
    @SerializedName("error") val error: String? = null,
)

object TsdUpdateClient {
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()
    }

    suspend fun check(serverBaseUrl: String, versionCode: Int, versionName: String): TsdUpdateCheckResult {
        return withContext(Dispatchers.IO) {
            try {
                val base = WmsEndpointConfig.resolveUpdateServerBaseUrl(serverBaseUrl)
                val url = buildString {
                    append(base)
                    append("api/v1/tsd/check?currentVersionCode=")
                    append(versionCode)
                    append("&currentVersionName=")
                    append(java.net.URLEncoder.encode(versionName, Charsets.UTF_8.name()))
                }
                val request = Request.Builder()
                    .url(url)
                    .header("Accept", "application/json")
                    .get()
                    .build()
                http.newCall(request).execute().use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        return@withContext TsdUpdateCheckResult(error = "HTTP ${response.code}")
                    }
                    com.google.gson.Gson().fromJson(body, TsdUpdateCheckResult::class.java)
                        ?: TsdUpdateCheckResult(error = "empty_response")
                }
            } catch (e: Exception) {
                TsdUpdateCheckResult(error = e.message ?: "check_failed")
            }
        }
    }
}
