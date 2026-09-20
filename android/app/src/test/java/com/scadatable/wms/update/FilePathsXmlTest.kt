package com.scadatable.wms.update

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class FilePathsXmlTest {
    @Test
    fun file_paths_allows_cache_and_files_roots() {
        val xml = locateFilePathsXml().readText()
        assertTrue("cache-path required for OTA", xml.contains("cache-path"))
        assertTrue("external-files-path required for OTA", xml.contains("external-files-path"))
        assertTrue("ota folder required", xml.contains("ota/"))
    }

    private fun locateFilePathsXml(): File {
        var dir = File(System.getProperty("user.dir"))
        repeat(8) {
            val candidate = File(dir, "src/main/res/xml/file_paths.xml")
            if (candidate.exists()) return candidate
            val parent = dir.parentFile ?: return candidate
            dir = parent
        }
        throw IllegalStateException("file_paths.xml not found")
    }
}
