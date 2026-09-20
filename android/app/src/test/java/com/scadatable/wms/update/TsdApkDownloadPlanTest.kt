package com.scadatable.wms.update

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class TsdApkDownloadPlanTest {
    @Test
    fun resumable_prefers_streaming_before_chunked() {
        val source = locateSource("TsdUpdateManager.kt")
        val text = source.readText()
        val streamingIdx = text.indexOf("downloadApkStreaming(release, url, outFile, metaFile, sizeForDownload, onProgress)")
        val chunkedIdx = text.indexOf("downloadApkChunked(release, url, outFile, metaFile, sizeForDownload, onProgress)")
        assertTrue("streaming call must exist", streamingIdx >= 0)
        assertTrue("chunked call must exist", chunkedIdx >= 0)
        assertTrue("streaming must be tried before chunked", streamingIdx < chunkedIdx)
    }

    private fun locateSource(fileName: String): File {
        var dir = File(System.getProperty("user.dir"))
        repeat(8) {
            val candidate = File(dir, "src/main/java/com/scadatable/wms/update/$fileName")
            if (candidate.exists()) return candidate
            dir = dir.parentFile ?: return@repeat
        }
        throw IllegalStateException("Cannot locate $fileName from ${System.getProperty("user.dir")}")
    }
}
