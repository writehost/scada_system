package com.scadatable.wms.print

import com.scadatable.wms.receiving.ReceivingStickerPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LabelTemplateEngineTest {
    @Test
    fun fromPayload_usesFullRawScanForGs1DatamatrixAndExposesGroupLabel() {
        val payload = ReceivingStickerPayload(
            batchCode = "STK-001",
            itemName = "Тест",
            scannedCode = "(01)04607017162248(21)ABC123(93)CRYPTO",
            gtin = "04607017162248",
            qty = 2.0,
            emissionAt = null,
            expiresAt = null,
            shelfLifeDays = null,
            cellCode = null,
            qrUrl = "https://scada25.ru/wms/receiving/STK-001",
            productGroupLabel = "Стикеры",
            supplierName = "Поставщик",
            receiptDocDate = "16.06.2026",
        )

        val values = LabelTemplateVars.fromPayload(payload)

        assertEquals("Стикеры", values[LabelTemplateVars.PRODUCT_GROUP_LABEL])
        assertEquals("~1010460701716224821ABC123~]93CRYPTO", values[LabelTemplateVars.GS1_DATAMATRIX])
        assertTrue(values[LabelTemplateVars.SCANNED_CODE].orEmpty().startsWith("010460701716224821ABC123"))
    }
}
