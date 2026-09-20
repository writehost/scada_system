package com.scadatable.wms.update

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class OtaReleaseContractTest {
    @Test
    fun manifest_contains_required_ota_components() {
        val manifest = locate("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains("android.permission.REQUEST_INSTALL_PACKAGES"))
        assertTrue(manifest.contains("androidx.core.content.FileProvider"))
        assertTrue(manifest.contains("\${applicationId}.fileprovider"))
        assertTrue(manifest.contains(".update.OtaInstallReceiver"))
    }

    @Test
    fun release_build_forbids_silent_signing_fallback() {
        val gradle = locate("build.gradle").readText()
        assertTrue(gradle.contains("TSD signing keystore not found"))
        assertTrue(gradle.contains("signingConfig signingConfigs.tsd"))
        assertFalse(gradle.contains("store = file(\"\${System.properties['user.home']}/.android/debug.keystore\")"))
    }

    @Test
    fun ota_certificate_pin_is_configured() {
        val gradle = locate("build.gradle").readText()
        val digest = Regex("""OTA_SIGNING_CERT_SHA256".*"([0-9a-f]{64})"""")
            .find(gradle)
            ?.groupValues
            ?.get(1)
            .orEmpty()
        assertTrue("OTA signing certificate SHA-256 must be pinned", digest.length == 64)
    }

    private fun locate(relativePath: String): File {
        var dir = File(System.getProperty("user.dir"))
        repeat(8) {
            val candidate = File(dir, relativePath)
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: throw IllegalStateException("Cannot locate $relativePath")
        }
        throw IllegalStateException("Cannot locate $relativePath")
    }
}
