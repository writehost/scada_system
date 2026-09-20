package com.scadatable.wms.update

import com.scadatable.wms.data.remote.TsdReleaseInfo
import org.json.JSONObject
import java.io.File

data class OtaDownloadMeta(
    val buildId: String,
    val versionCode: Int,
    val expectedSize: Long,
    val expectedSha256: String?,
) {
    fun matches(release: TsdReleaseInfo): Boolean {
        return buildId == release.buildId &&
            versionCode == release.versionCode &&
            (expectedSha256.isNullOrBlank() || expectedSha256 == release.apkSha256?.trim()?.lowercase())
    }

    fun toJson(): String = JSONObject()
        .put("buildId", buildId)
        .put("versionCode", versionCode)
        .put("expectedSize", expectedSize)
        .put("expectedSha256", expectedSha256 ?: JSONObject.NULL)
        .toString()

    companion object {
        fun fromRelease(release: TsdReleaseInfo, expectedSize: Long): OtaDownloadMeta =
            OtaDownloadMeta(
                buildId = release.buildId,
                versionCode = release.versionCode,
                expectedSize = expectedSize,
                expectedSha256 = release.apkSha256?.trim()?.lowercase()?.takeIf { it.isNotBlank() },
            )

        fun read(metaFile: File): OtaDownloadMeta? {
            if (!metaFile.exists()) return null
            return runCatching {
                val json = JSONObject(metaFile.readText())
                OtaDownloadMeta(
                    buildId = json.getString("buildId"),
                    versionCode = json.getInt("versionCode"),
                    expectedSize = json.getLong("expectedSize"),
                    expectedSha256 = json.optString("expectedSha256").trim().lowercase().takeIf { it.isNotBlank() },
                )
            }.getOrNull()
        }

        fun write(metaFile: File, meta: OtaDownloadMeta) {
            metaFile.parentFile?.mkdirs()
            metaFile.writeText(meta.toJson())
        }

        fun clearArtifacts(apkFile: File, metaFile: File) {
            runCatching { if (apkFile.exists()) apkFile.delete() }
            runCatching { if (metaFile.exists()) metaFile.delete() }
        }
    }
}
