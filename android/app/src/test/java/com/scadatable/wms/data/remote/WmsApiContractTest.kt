package com.scadatable.wms.data.remote

import com.google.gson.Gson
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.http.GET
import retrofit2.http.POST

class WmsApiContractTest {
    @Test
    fun tsdUsesCurrentWmsRoutes() {
        assertPost("login", "/api/auth/login")
        assertPost("identifyUser", "/api/wms/users/identify")
        assertGet("listProductGroups", "/api/wms/directories/item-groups")
        assertGet("listReceivingCategories", "/api/wms/directories/receiving-categories")
        assertGet("listItems", "/api/wms/items")
        assertGet("getPosPickPlan", "/api/wms/stock/pos-pick")
        assertPost("submitPosIssue", "/api/wms/stock/pos-issue")
        assertPost("confirmTransfer", "/api/wms/transfers/confirm")
        assertPost("resolveReceivingScan", "/api/wms/receiving/resolve-scan")
        assertGet("listProductionPlans", "/api/wms/production/plans")
    }

    @Test
    fun transferPayloadMatchesServerContract() {
        val json = Gson().toJson(
            TransferConfirmRequest(
                requestId = "00000000-0000-0000-0000-000000000001",
                siteCode = "DEFAULT",
                itemCode = "SKU-1",
                fromLocationCode = "A-01",
                toLocationCode = "LINE-01",
                qty = 1.0,
            )
        )

        assertTrue(json.contains("\"fromLocationCode\""))
        assertTrue(json.contains("\"toLocationCode\""))
    }

    private fun assertGet(methodName: String, path: String) {
        val method = WmsApi::class.java.methods.firstOrNull { it.name == methodName }
        assertNotNull("Missing WmsApi.$methodName", method)
        assertEquals(path, method!!.getAnnotation(GET::class.java)?.value)
    }

    private fun assertPost(methodName: String, path: String) {
        val method = WmsApi::class.java.methods.firstOrNull { it.name == methodName }
        assertNotNull("Missing WmsApi.$methodName", method)
        assertEquals(path, method!!.getAnnotation(POST::class.java)?.value)
    }
}
