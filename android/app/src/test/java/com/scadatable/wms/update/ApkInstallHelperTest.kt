package com.scadatable.wms.update

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class ApkInstallHelperTest {
    private fun appContext(): android.content.Context = RuntimeEnvironment.getApplication()

    @Test
    fun otaDownloadFile_uses_ota_folder() {
        val context = appContext()
        val file = ApkInstallHelper.otaDownloadFile(context)
        assertTrue(file.absolutePath.replace('\\', '/').contains("/ota/"))
        assertEquals(OTA_APK_NAME, file.name)
    }

    @Test
    fun prepareInstallFile_normalizes_to_ota_apk() {
        val context = appContext()
        val temp = File(ApkInstallHelper.otaStorageDir(context), "temp-source.apk").apply {
            parentFile?.mkdirs()
            writeBytes(byteArrayOf(1, 2, 3, 4))
        }
        val prepared = ApkInstallHelper.prepareInstallFile(context, temp)
        assertEquals(ApkInstallHelper.otaDownloadFile(context).canonicalPath, prepared.canonicalPath)
        assertEquals(4L, prepared.length())
    }

    private companion object {
        private const val OTA_APK_NAME = ApkInstallHelper.OTA_APK_NAME
    }
}
