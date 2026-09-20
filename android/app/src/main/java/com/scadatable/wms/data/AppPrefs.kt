package com.scadatable.wms.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.scadatable.wms.data.remote.WmsEndpointConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.appDataStore by preferencesDataStore(name = "wms_app_prefs")

class AppPrefs(private val context: Context) {
    private object Keys {
        val baseUrl: Preferences.Key<String> = stringPreferencesKey("base_url")
        val siteCode: Preferences.Key<String> = stringPreferencesKey("site_code")
        val deviceUid: Preferences.Key<String> = stringPreferencesKey("device_uid")
        val deviceName: Preferences.Key<String> = stringPreferencesKey("device_name")
        val operatorUserId: Preferences.Key<String> = stringPreferencesKey("operator_user_id")
        val accessToken: Preferences.Key<String> = stringPreferencesKey("access_token")
        val operatorDisplayName: Preferences.Key<String> = stringPreferencesKey("operator_display_name")
        val activeReceivingDocId: Preferences.Key<String> = stringPreferencesKey("active_receiving_doc_id")
        val activeReceivingProductGroup: Preferences.Key<String> = stringPreferencesKey("active_receiving_product_group")
        val activeReceivingCategory: Preferences.Key<String> = stringPreferencesKey("active_receiving_category")
        val activeCollectDocId: Preferences.Key<String> = stringPreferencesKey("active_collect_doc_id")
        val autoPrintReceiving: Preferences.Key<Boolean> = booleanPreferencesKey("auto_print_receiving")
        val autoPostReceivingStock: Preferences.Key<Boolean> = booleanPreferencesKey("auto_post_receiving_stock")
        val receivingTargetLocationCode: Preferences.Key<String> = stringPreferencesKey("receiving_target_location_code")
        val printerBackend: Preferences.Key<String> = stringPreferencesKey("printer_backend")
        val printerBluetoothMac: Preferences.Key<String> = stringPreferencesKey("printer_bluetooth_mac")
        val labelTemplateTspl: Preferences.Key<String> = stringPreferencesKey("label_template_tspl")
        val receivingCategoriesCache: Preferences.Key<String> = stringPreferencesKey("receiving_categories_cache")
        val pushNotificationsEnabled: Preferences.Key<Boolean> = booleanPreferencesKey("push_notifications_enabled")
        val lastNotifiedOpenTaskCount: Preferences.Key<Int> = intPreferencesKey("last_notified_open_task_count")
        val lastReceivingCategoriesSig: Preferences.Key<String> = stringPreferencesKey("last_receiving_categories_sig")
        val lastNotifiedSupportSessionId: Preferences.Key<String> = stringPreferencesKey("last_notified_support_session_id")
    }

    val baseUrl: Flow<String> = context.appDataStore.data.map { it[Keys.baseUrl] ?: WmsEndpointConfig.DEFAULT_BASE_URL }
    val siteCode: Flow<String> = context.appDataStore.data.map { it[Keys.siteCode] ?: "DEFAULT" }
    val deviceUid: Flow<String> = context.appDataStore.data.map { it[Keys.deviceUid] ?: "TSD-EMULATOR" }
    val deviceName: Flow<String> = context.appDataStore.data.map { it[Keys.deviceName] ?: "Android Emulator" }
    val operatorUserId: Flow<String?> = context.appDataStore.data.map { it[Keys.operatorUserId] }
    val accessToken: Flow<String?> = context.appDataStore.data.map { it[Keys.accessToken] }
    val operatorDisplayName: Flow<String?> = context.appDataStore.data.map { it[Keys.operatorDisplayName] }
    val activeReceivingDocId: Flow<String?> = context.appDataStore.data.map { it[Keys.activeReceivingDocId] }
    val activeReceivingProductGroup: Flow<String?> = context.appDataStore.data.map { it[Keys.activeReceivingProductGroup] }
    val activeReceivingCategory: Flow<String?> = context.appDataStore.data.map { it[Keys.activeReceivingCategory] }
    val activeCollectDocId: Flow<String?> = context.appDataStore.data.map { it[Keys.activeCollectDocId] }
    val autoPrintReceiving: Flow<Boolean> = context.appDataStore.data.map { it[Keys.autoPrintReceiving] ?: false }
    val autoPostReceivingStock: Flow<Boolean> = context.appDataStore.data.map { it[Keys.autoPostReceivingStock] ?: true }
    val receivingTargetLocationCode: Flow<String> = context.appDataStore.data.map { it[Keys.receivingTargetLocationCode] ?: "" }
    val printerBackend: Flow<String> = context.appDataStore.data.map { it[Keys.printerBackend] ?: "tsc_bluetooth" }
    val printerBluetoothMac: Flow<String> = context.appDataStore.data.map { it[Keys.printerBluetoothMac] ?: "" }
    val labelTemplateTspl: Flow<String> = context.appDataStore.data.map { it[Keys.labelTemplateTspl] ?: "" }
    val receivingCategoriesCache: Flow<String?> = context.appDataStore.data.map { it[Keys.receivingCategoriesCache] }
    val pushNotificationsEnabled: Flow<Boolean> = context.appDataStore.data.map { it[Keys.pushNotificationsEnabled] ?: true }
    val lastNotifiedOpenTaskCount: Flow<Int> = context.appDataStore.data.map { it[Keys.lastNotifiedOpenTaskCount] ?: 0 }
    val lastReceivingCategoriesSig: Flow<String> = context.appDataStore.data.map { it[Keys.lastReceivingCategoriesSig] ?: "" }
    val lastNotifiedSupportSessionId: Flow<String> = context.appDataStore.data.map { it[Keys.lastNotifiedSupportSessionId] ?: "" }

    suspend fun setBaseUrl(value: String) {
        context.appDataStore.edit { prefs -> prefs[Keys.baseUrl] = normalizeBaseUrl(value) }
    }

    suspend fun setSiteCode(value: String) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.siteCode] = value.trim().ifEmpty { "DEFAULT" }
        }
    }

    suspend fun setDeviceUid(value: String) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.deviceUid] = value.trim().ifEmpty { "TSD-EMULATOR" }
        }
    }

    suspend fun setDeviceName(value: String) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.deviceName] = value.trim().ifEmpty { "Android Emulator" }
        }
    }

    suspend fun setOperatorUserId(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.operatorUserId) else prefs[Keys.operatorUserId] = normalized
        }
    }

    suspend fun setAuthSession(accessToken: String?, operatorUserId: String?, operatorDisplayName: String?) {
        context.appDataStore.edit { prefs ->
            val token = accessToken?.trim().orEmpty()
            if (token.isEmpty()) prefs.remove(Keys.accessToken) else prefs[Keys.accessToken] = token

            val userId = operatorUserId?.trim().orEmpty()
            if (userId.isEmpty()) prefs.remove(Keys.operatorUserId) else prefs[Keys.operatorUserId] = userId

            val name = operatorDisplayName?.trim().orEmpty()
            if (name.isEmpty()) prefs.remove(Keys.operatorDisplayName) else prefs[Keys.operatorDisplayName] = name
        }
    }

    suspend fun clearAuthSession() {
        context.appDataStore.edit { prefs ->
            prefs.remove(Keys.accessToken)
            prefs.remove(Keys.operatorDisplayName)
        }
    }

    suspend fun setActiveReceivingDocId(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.activeReceivingDocId) else prefs[Keys.activeReceivingDocId] = normalized
        }
    }

    suspend fun setActiveReceivingProductGroup(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.activeReceivingProductGroup) else prefs[Keys.activeReceivingProductGroup] = normalized
        }
    }

    suspend fun setActiveReceivingCategory(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.activeReceivingCategory) else prefs[Keys.activeReceivingCategory] = normalized
        }
    }

    suspend fun setActiveCollectDocId(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.activeCollectDocId) else prefs[Keys.activeCollectDocId] = normalized
        }
    }

    suspend fun setAutoPrintReceiving(value: Boolean) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.autoPrintReceiving] = value
        }
    }

    suspend fun setAutoPostReceivingStock(value: Boolean) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.autoPostReceivingStock] = value
        }
    }

    suspend fun setReceivingTargetLocationCode(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.receivingTargetLocationCode)
            else prefs[Keys.receivingTargetLocationCode] = normalized
        }
    }

    suspend fun setPrinterBackend(value: String) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.printerBackend] = value.trim().ifEmpty { "tsc_bluetooth" }
        }
    }

    suspend fun setPrinterBluetoothMac(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.printerBluetoothMac)
            else prefs[Keys.printerBluetoothMac] = normalized
        }
    }

    suspend fun setLabelTemplateTspl(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.labelTemplateTspl)
            else prefs[Keys.labelTemplateTspl] = normalized
        }
    }

    suspend fun setReceivingCategoriesCache(value: String?) {
        context.appDataStore.edit { prefs ->
            val normalized = value?.trim().orEmpty()
            if (normalized.isEmpty()) prefs.remove(Keys.receivingCategoriesCache)
            else prefs[Keys.receivingCategoriesCache] = normalized
        }
    }

    suspend fun setPushNotificationsEnabled(value: Boolean) {
        context.appDataStore.edit { prefs -> prefs[Keys.pushNotificationsEnabled] = value }
    }

    suspend fun setLastNotifiedOpenTaskCount(value: Int) {
        context.appDataStore.edit { prefs -> prefs[Keys.lastNotifiedOpenTaskCount] = value.coerceAtLeast(0) }
    }

    suspend fun setLastReceivingCategoriesSig(value: String) {
        context.appDataStore.edit { prefs -> prefs[Keys.lastReceivingCategoriesSig] = value }
    }

    suspend fun setLastNotifiedSupportSessionId(value: String) {
        context.appDataStore.edit { prefs ->
            val normalized = value.trim()
            if (normalized.isEmpty()) prefs.remove(Keys.lastNotifiedSupportSessionId)
            else prefs[Keys.lastNotifiedSupportSessionId] = normalized
        }
    }

    suspend fun setLastReceivingQty(productGroup: String, value: Double) {
        val key = stringPreferencesKey("last_qty_${productGroup}")
        context.appDataStore.edit { it[key] = value.toString() }
    }

    suspend fun getLastReceivingQty(productGroup: String): Double {
        val key = stringPreferencesKey("last_qty_${productGroup}")
        val s = context.appDataStore.data.first()[key] ?: "1.0"
        return s.toDoubleOrNull() ?: 1.0
    }

    private fun normalizeBaseUrl(raw: String): String {
        return WmsEndpointConfig.normalizeBaseUrl(raw)
    }
}
