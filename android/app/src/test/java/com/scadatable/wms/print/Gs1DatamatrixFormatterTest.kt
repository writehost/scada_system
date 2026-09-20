package com.scadatable.wms.print

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class Gs1DatamatrixFormatterTest {
    @Test
    fun format_convertsParenthesizedAiToTsplGs1ElementString() {
        val raw = "(01)04607017162248(21)5kV8xY2mN(93)dGVzdA=="

        val formatted = Gs1DatamatrixFormatter.format(raw)

        assertEquals("~10104607017162248215kV8xY2mN~]93dGVzdA==", formatted)
        assertFalse(formatted.contains("(01)"))
        assertFalse(formatted.contains("(21)"))
        assertFalse(formatted.contains("(93)"))
    }

    @Test
    fun format_keepsExistingGsSeparatorAndAddsLeadingFnc1() {
        val raw = "0104607017162248215kV8xY2mN\u001D93dGVzdA=="

        assertEquals("~10104607017162248215kV8xY2mN~]93dGVzdA==", Gs1DatamatrixFormatter.format(raw))
    }

    @Test
    fun format_repairsLegacyLiteralTildePayloadFromBadLabels() {
        val raw = "~~10104607017162279215utn7tOukQILb~~]~~]93MFd7"

        assertEquals("~10104607017162279215utn7tOukQILb~]93MFd7", Gs1DatamatrixFormatter.format(raw))
    }

    @Test
    fun format_keepsFullUserExpectedPayloadWithGsBeforeAi93() {
        val raw = "0104607017160695215Ch8ELjIGXBag\u001D93frWb"

        assertEquals("~10104607017160695215Ch8ELjIGXBag~]93frWb", Gs1DatamatrixFormatter.format(raw))
    }
}
