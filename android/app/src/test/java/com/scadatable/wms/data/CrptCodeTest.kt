package com.scadatable.wms.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class CrptCodeTest {
    @Test
    fun normalize_removesParenthesesAndCryptoTail() {
        val raw = "(01)04607017162248(21)5kV8xY2mN(93)dGVzdGNyeXB0bw=="
        val normalized = CrptCode.normalize(raw)
        assertEquals("0104607017162248215kV8xY2mN", normalized)
        assertFalse(Regex("""\(\d{2}\)""").containsMatchIn(normalized))
    }

    @Test
    fun normalize_removesScannerPrefixAndGsCryptoTail() {
        val raw = "]d20104607017160695215Ch8ELjIGXBag\u001D93frWb"

        assertEquals("0104607017160695215Ch8ELjIGXBag", CrptCode.normalize(raw))
    }

    @Test
    fun normalize_repairsLegacyTsplEscapesBeforeParsing() {
        val raw = "~~10104607017160695215Ch8ELjIGXBag~~]93frWb"

        assertEquals("0104607017160695215Ch8ELjIGXBag", CrptCode.normalize(raw))
    }

    @Test
    fun normalize_keepsSoftdrinkSerialThatContains93_andStripsRealCrypto() {
        // Скан с криптохвостом → в ЧЗ без него, но serial целиком (93 внутри serial ≠ crypto).
        val serial = "5mH93%fMeyala"
        val withCrypto = "010460701716138821${serial}\u001D93yS25"
        val expected = "010460701716138821$serial"
        assertEquals(expected, CrptCode.normalize(withCrypto))
        assertEquals(expected, CrptCode.normalize(expected))
    }

    @Test
    fun toUpstreamRequestCode_usesParenFormToSurviveLegacyServerStrip() {
        val raw = "0104607017161388215mH93%fMeyala\u001D93yS25"
        assertEquals(
            "(01)04607017161388(21)5mH93%fMeyala",
            CrptCode.toUpstreamRequestCode(raw),
        )
    }
}
