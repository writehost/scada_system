package com.scadatable.wms.update

import android.app.Application
import com.scadatable.wms.data.remote.TsdReleaseInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], application = Application::class)
class OtaDownloadMetaTest {
    @Test
    fun meta_roundtrip_and_release_match() {
        val release = TsdReleaseInfo(
            versionCode = 31,
            versionName = "1.5.25",
            buildId = "tsd-test",
            apkSha256 = "abc123",
        )
        val meta = OtaDownloadMeta.fromRelease(release, 12345L)
        val dir = File.createTempFile("ota-meta", "").apply { delete(); mkdirs() }
        val file = File(dir, "ota-install.apk.meta")
        OtaDownloadMeta.write(file, meta)
        val read = OtaDownloadMeta.read(file)
        assertEquals("tsd-test", read?.buildId)
        assertTrue(read!!.matches(release))
        assertFalse(read.matches(release.copy(buildId = "other")))
    }
}
