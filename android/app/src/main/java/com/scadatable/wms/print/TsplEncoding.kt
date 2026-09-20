package com.scadatable.wms.print

import java.nio.charset.Charset

object TsplEncoding {
    private val WINDOWS_1251: Charset = Charset.forName("Windows-1251")

    fun prepare(tspl: String): String {
        val normalized = tspl
            .replace("\r\n", "\n")
            .replace("\r", "\n")
            .lines()
            .joinToString("\r\n", postfix = "\r\n")
        return if (normalized.contains("CODEPAGE", ignoreCase = true)) {
            normalized
        } else {
            "CODEPAGE 1251\r\n$normalized"
        }
    }

    fun toPrinterBytes(tspl: String): ByteArray {
        val prepared = prepare(tspl)
        return prepared.toByteArray(WINDOWS_1251)
    }
}
