package com.scadatable.wms.data.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WmsEndpointConfigTest {
    @Test
    fun defaultBaseUrlPointsToPublicWms() {
        assertEquals("https://scada25.ru/", WmsEndpointConfig.DEFAULT_BASE_URL)
    }

    @Test
    fun normalizesHostNamesForPhysicalTsd() {
        assertEquals("https://scada25.ru/", WmsEndpointConfig.normalizeBaseUrl("scada25.ru"))
        assertEquals("http://192.168.31.236:3001/", WmsEndpointConfig.normalizeBaseUrl("192.168.31.236:3001"))
    }

    @Test
    fun flagsCommonScadaHostTypo() {
        assertTrue(WmsEndpointConfig.isKnownMisconfiguredProductionHost("https://scada.ru/"))
        assertFalse(WmsEndpointConfig.isKnownMisconfiguredProductionHost("https://scada25.ru/"))
    }

    @Test
    fun updateServerStripsApiPort() {
        assertEquals("https://scada25.ru/", WmsEndpointConfig.resolveUpdateServerBaseUrl("https://scada25.ru:3001/"))
        assertEquals("http://192.168.1.10/", WmsEndpointConfig.resolveUpdateServerBaseUrl("http://192.168.1.10:3001/"))
    }

    @Test
    fun flagsEmulatorOnlyUrlsForPhysicalTsd() {
        assertTrue(WmsEndpointConfig.isLikelyWrongForPhysicalTsd("http://10.0.2.2:3001/"))
        assertTrue(WmsEndpointConfig.isLikelyWrongForPhysicalTsd("http://localhost:3001/"))
        assertFalse(WmsEndpointConfig.isLikelyWrongForPhysicalTsd("https://scada25.ru/"))
    }
}
