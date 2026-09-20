package com.scadatable.wms.data

import com.scadatable.wms.data.local.Product
import com.scadatable.wms.data.local.NomenclatureOutbox
import com.scadatable.wms.data.local.CollectScanDocument
import com.scadatable.wms.data.local.CollectScanItem
import com.scadatable.wms.data.local.ReceivingDocument
import com.scadatable.wms.data.local.ReceivingItem
import com.scadatable.wms.data.local.SyncState
import com.scadatable.wms.data.local.TaskActionOutbox
import com.scadatable.wms.data.local.TaskCache
import com.scadatable.wms.data.local.Warehouse
import com.scadatable.wms.data.local.WmsDao
import com.scadatable.wms.data.local.Cell
import com.scadatable.wms.data.remote.CrptInfoRequest
import com.scadatable.wms.data.remote.CrptCisInfoDto
import com.scadatable.wms.data.remote.ReceivingResolveScanRequest
import com.scadatable.wms.data.remote.ReceivingResolveResponse
import com.scadatable.wms.data.remote.ReceivingResolveItemDto
import com.scadatable.wms.data.remote.DeviceTaskActionRequest
import com.scadatable.wms.data.remote.CompleteTaskByDeviceRequest
import com.scadatable.wms.data.remote.TaskExceptionRequest
import com.scadatable.wms.data.remote.LookupResponse
import com.scadatable.wms.data.remote.ImportItemRow
import com.scadatable.wms.data.remote.ImportItemsRequest
import com.scadatable.wms.data.remote.MobileProfileResponse
import com.scadatable.wms.data.remote.CodeListEntryDto
import com.scadatable.wms.data.remote.CreateCodeListRequest
import com.scadatable.wms.data.remote.PatchReceivingScanEventRequest
import com.scadatable.wms.data.remote.SyncReceivingSessionLine
import com.scadatable.wms.data.remote.SyncReceivingSessionRequest
import com.scadatable.wms.data.remote.FinalizeReceivingSessionRequest
import com.scadatable.wms.data.remote.FinalizeReceivingSessionResponse
import com.scadatable.wms.data.remote.RegisterDeviceRequest
import com.scadatable.wms.data.remote.RetrofitClient
import com.scadatable.wms.data.remote.TaskRow
import com.scadatable.wms.data.remote.WmsHttpException
import com.scadatable.wms.data.remote.AuthLoginRequest
import com.scadatable.wms.data.remote.IdentifyUserRequest
import com.scadatable.wms.data.remote.PosIssueRequest
import com.scadatable.wms.data.remote.ProductionPlanDto
import com.scadatable.wms.data.remote.TransferConfirmRequest
import com.scadatable.wms.data.remote.safeApi
import com.scadatable.wms.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import java.util.Locale
import java.util.UUID

class WmsRepository(
    private val dao: WmsDao,
    private val prefs: AppPrefs,
) {
    data class ReceivingAppendResult(
        val documentId: String,
        val product: Product,
        val scannedCode: String,
        val resolvedGtin: String? = null,
        val itemStatus: String = "эммитирован",
        val crptStatus: String? = null,
        val expiryState: String? = null,
        val expiryMessage: String? = null,
        val warnings: List<String> = emptyList(),
        val nestedItemName: String? = null,
        val packageRole: String? = null,
    )

    data class CollectAppendResult(
        val documentId: String, // requestId UUID
        val code: String,
        val totalCodes: Int,
        val serverCodeListId: String? = null,
        val syncWarning: String? = null,
    )

    data class AggregationUploadEntry(
        val parentCode: String,
        val childCode: String,
        val action: String,
        val mode: String,
    )

    val cachedTasks: Flow<List<TaskCache>> = dao.getCachedTasks()
    val cachedProducts: Flow<List<Product>> = dao.getAllProducts()
    val cachedWarehouses: Flow<List<Warehouse>> = dao.getAllWarehouses()
    val cachedCells: Flow<List<Cell>> = dao.getAllCells()

    suspend fun applyBaseUrl() {
        val base = prefs.baseUrl.first()
        RetrofitClient.setAccessToken(prefs.accessToken.first())
        RetrofitClient.setBaseUrl(base)
    }

    suspend fun health(): Result<Boolean> = safeApi {
        applyBaseUrl()
        RetrofitClient.api.health().ok
    }

    suspend fun listProductionPlans(
        from: String? = null,
        to: String? = null,
        status: String? = null,
    ): Result<List<ProductionPlanDto>> = safeApi {
        applyBaseUrl()
        RetrofitClient.api.listProductionPlans(
            siteCode = prefs.siteCode.first(),
            from = from,
            to = to,
            status = status,
            includeMaterials = "1",
        ).plans
    }

    /** Проверка URL до сохранения в настройках. */
    suspend fun healthCheck(baseUrl: String): Result<Boolean> = safeApi {
        RetrofitClient.setAccessToken(prefs.accessToken.first())
        RetrofitClient.setBaseUrl(baseUrl)
        RetrofitClient.api.health().ok
    }

    suspend fun login(login: String, password: String): Result<com.scadatable.wms.data.remote.AuthLoginResponse> =
        withContext(Dispatchers.IO) {
            val cleanLogin = login.trim()
            if (cleanLogin.isBlank() || password.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("Укажите логин и пароль"))
            }
            applyBaseUrl()
            val res = safeApi {
                RetrofitClient.api.login(AuthLoginRequest(login = cleanLogin, password = password))
            }
            if (res.isSuccess) {
                val body = res.getOrThrow()
                val token = body.accessToken?.trim()
                val user = body.user
                if (!token.isNullOrBlank()) {
                    prefs.setAuthSession(
                        accessToken = token,
                        operatorUserId = user?.userId ?: prefs.operatorUserId.first(),
                        operatorDisplayName = user?.displayName ?: user?.fio ?: user?.login,
                    )
                    RetrofitClient.setAccessToken(token)
                }
            }
            res
        }

    suspend fun identifyOperator(
        method: String,
        rfidUid: String? = null,
        identity: String? = null,
        pin: String? = null,
    ): Result<com.scadatable.wms.data.remote.IdentifyUserResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val res = safeApi {
            RetrofitClient.api.identifyUser(
                IdentifyUserRequest(
                    siteCode = siteCode,
                    method = method,
                    rfidUid = rfidUid?.trim()?.takeIf { it.isNotBlank() },
                    identity = identity?.trim()?.takeIf { it.isNotBlank() },
                    pin = pin?.trim()?.takeIf { it.isNotBlank() },
                )
            )
        }
        if (res.isSuccess) {
            val user = res.getOrThrow().user
            prefs.setAuthSession(
                accessToken = prefs.accessToken.first(),
                operatorUserId = user?.userId ?: prefs.operatorUserId.first(),
                operatorDisplayName = user?.displayName ?: user?.fio ?: user?.login,
            )
        }
        res
    }

    private suspend fun buildDeviceInfoFromPrefs(): Map<String, Any> {
        val info = mutableMapOf<String, Any>()
        prefs.labelTemplateTspl.first().trim().takeIf { it.isNotEmpty() }?.let {
            info[DEVICE_INFO_LABEL_TEMPLATE] = it
        }
        prefs.printerBackend.first().trim().takeIf { it.isNotEmpty() }?.let {
            info[DEVICE_INFO_PRINTER_BACKEND] = it
        }
        prefs.printerBluetoothMac.first().trim().takeIf { it.isNotEmpty() }?.let {
            info[DEVICE_INFO_PRINTER_MAC] = it
        }
        return info
    }

    private fun deviceInfoString(info: Map<String, Any>?, key: String): String? {
        val raw = info?.get(key) ?: return null
        return when (raw) {
            is String -> raw.trim().takeIf { it.isNotEmpty() }
            else -> raw.toString().trim().takeIf { it.isNotEmpty() }
        }
    }

    private suspend fun restoreDevicePrefsFromServer(deviceInfo: Map<String, Any>?) {
        if (deviceInfo.isNullOrEmpty()) return
        if (prefs.labelTemplateTspl.first().trim().isEmpty()) {
            deviceInfoString(deviceInfo, DEVICE_INFO_LABEL_TEMPLATE)?.let { prefs.setLabelTemplateTspl(it) }
        }
        if (prefs.printerBluetoothMac.first().trim().isEmpty()) {
            deviceInfoString(deviceInfo, DEVICE_INFO_PRINTER_MAC)?.let { prefs.setPrinterBluetoothMac(it) }
        }
    }

    suspend fun syncDevicePrefsToServer(): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val deviceInfo = buildDeviceInfoFromPrefs()
        if (deviceInfo.isEmpty()) return@withContext Result.success(Unit)
        safeApi {
            RetrofitClient.api.registerDevice(
                RegisterDeviceRequest(
                    siteCode = prefs.siteCode.first(),
                    deviceUid = prefs.deviceUid.first(),
                    deviceName = prefs.deviceName.first(),
                    platform = "android",
                    appVersion = BuildConfig.VERSION_NAME,
                    deviceInfo = deviceInfo,
                )
            )
        }.map { }
    }

    suspend fun registerDevice(): Result<MobileProfileResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val deviceName = prefs.deviceName.first()
        val operatorUserId = prefs.operatorUserId.first()
        val deviceInfo = buildDeviceInfoFromPrefs()

        safeApi {
            RetrofitClient.api.registerDevice(
                RegisterDeviceRequest(
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    deviceName = deviceName,
                    platform = "android",
                    appVersion = BuildConfig.VERSION_NAME,
                    deviceInfo = deviceInfo.ifEmpty { null },
                )
            )
            val profile = RetrofitClient.api.mobileProfile(
                siteCode = siteCode,
                deviceUid = deviceUid,
                operatorUserId = operatorUserId,
            )
            restoreDevicePrefsFromServer(profile.device.deviceInfo)
            profile
        }
    }

    suspend fun refreshDeviceTasks(status: String? = null): Result<List<TaskCache>> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val operatorUserId = prefs.operatorUserId.first()

        safeApi {
            val page = RetrofitClient.api.listDeviceTasks(
                siteCode = siteCode,
                deviceUid = deviceUid,
                operatorUserId = operatorUserId,
                status = status,
                limit = 100,
            )
            val mapped = page.tasks.map { it.toCache() }
            dao.clearTaskCache()
            dao.upsertTasks(mapped)
            mapped
        }
    }

    suspend fun pollDeviceTasksSubscribe(
        status: String = "open",
        timeoutSec: Int = 45,
    ): Result<Pair<com.scadatable.wms.data.remote.TasksSubscribeResponse, List<TaskCache>>> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val operatorUserId = prefs.operatorUserId.first()

        safeApi {
            val page = RetrofitClient.api.subscribeDeviceTasks(
                siteCode = siteCode,
                deviceUid = deviceUid,
                operatorUserId = operatorUserId,
                status = status,
                timeout = timeoutSec,
                limit = 100,
            )
            val mapped = page.tasks.map { it.toCache() }
            dao.clearTaskCache()
            dao.upsertTasks(mapped)
            page to mapped
        }
    }

    suspend fun refreshItemsAndLocations(): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()

        safeApi {
            replayNomenclatureOutbox().getOrThrow()
            var cursor: String? = null
            val products = mutableListOf<Product>()
            do {
                val page = RetrofitClient.api.listItems(siteCode = siteCode, cursor = cursor, limit = 100)
                products += page.items.map {
                    Product(
                        barcode = it.itemCode,
                        name = it.name,
                        sku = it.sku ?: it.itemCode,
                        unit = it.uomCode ?: "pcs",
                        productGroup = it.productGroup,
                        availableQty = it.availableQty,
                        reservedQty = it.reservedQty,
                        isMarked = it.isMarked,
                    )
                }
                cursor = page.nextCursor?.takeIf { it.isNotBlank() }
            } while (cursor != null)
            dao.clearProducts()
            if (products.isNotEmpty()) dao.insertProducts(products)

            val locations = RetrofitClient.api.listLocations(siteCode = siteCode).locations
            if (locations.isNotEmpty()) {
                val warehouses = locations
                    .map { it.warehouseCode }
                    .distinct()
                    .map { Warehouse(id = it, name = it) }
                dao.insertWarehouses(warehouses)
                dao.insertCells(
                    locations.map {
                        com.scadatable.wms.data.local.Cell(
                            id = it.locationCode,
                            warehouseId = it.warehouseCode,
                            name = it.displayName ?: it.locationCode,
                        )
                    }
                )
            }
            dao.upsertSyncState(SyncState(key = "sync.lastAt", value = System.currentTimeMillis().toString()))
            Unit
        }
    }

    suspend fun lookup(query: String): Result<LookupResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.lookup(
                com.scadatable.wms.data.remote.LookupRequest(
                    siteCode = siteCode,
                    query = query,
                )
            )
        }
    }

    suspend fun fetchCrptInfo(rawCode: String): Result<Pair<String, List<CrptCisInfoDto>>> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        // Скан с криптохвостом → normalize без crypto; на API — скобочный GS1 (обход бага strip на проде).
        val normalized = CrptCode.normalize(rawCode)
        if (normalized.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Пустой код"))
        }
        val requestCode = CrptCode.toUpstreamRequestCode(rawCode)
        safeApi {
            val response = RetrofitClient.api.crptInfo(CrptInfoRequest(codes = listOf(requestCode)))
            val itemError = response.firstOrNull()?.errorMessage?.trim().orEmpty()
            if (itemError.isNotEmpty()) {
                val ec = response.firstOrNull()?.errorCode?.trim().orEmpty()
                throw IllegalStateException(if (ec.isNotEmpty()) "$itemError ($ec)" else itemError)
            }
            val items = response.mapNotNull { it.cisInfo }.filter { cis ->
                !cis.gtin.isNullOrBlank() || !cis.productName.isNullOrBlank() || !cis.status.isNullOrBlank()
            }
            if (items.isEmpty()) {
                throw IllegalStateException("ЧЗ не вернул данных по коду")
            }
            normalized to items
        }
    }

    suspend fun enqueueAndSendTaskAction(
        taskId: String,
        action: String,
        confirmedQty: Double? = null,
        targetLocationCode: String? = null,
        note: String? = null,
        exceptionCode: String? = null,
        exceptionNote: String? = null,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val operatorUserId = prefs.operatorUserId.first()
        val requestId = UUID.randomUUID().toString()

        dao.enqueueTaskAction(
            TaskActionOutbox(
                requestId = requestId,
                taskId = taskId,
                action = action,
                siteCode = siteCode,
                deviceUid = deviceUid,
                operatorUserId = operatorUserId,
                confirmedQty = confirmedQty,
                targetLocationCode = targetLocationCode,
                note = note,
                exceptionCode = exceptionCode,
                exceptionNote = exceptionNote,
            )
        )
        replayOutbox()
    }

    suspend fun replayOutbox(): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val actions = dao.listPendingTaskActions()
        for (a in actions) {
            val res = safeApi {
                when (a.action) {
                    "claim" -> RetrofitClient.api.claimTaskByDevice(
                        taskId = a.taskId,
                        request = DeviceTaskActionRequest(
                            requestId = a.requestId,
                            siteCode = a.siteCode,
                            deviceUid = a.deviceUid,
                            operatorUserId = a.operatorUserId,
                        )
                    )
                    "start" -> RetrofitClient.api.startTaskByDevice(
                        taskId = a.taskId,
                        request = DeviceTaskActionRequest(
                            requestId = a.requestId,
                            siteCode = a.siteCode,
                            deviceUid = a.deviceUid,
                            operatorUserId = a.operatorUserId,
                        )
                    )
                    "complete" -> RetrofitClient.api.completeTaskByDevice(
                        taskId = a.taskId,
                        request = CompleteTaskByDeviceRequest(
                            requestId = a.requestId,
                            siteCode = a.siteCode,
                            deviceUid = a.deviceUid,
                            operatorUserId = a.operatorUserId,
                            confirmedQty = a.confirmedQty,
                            targetLocationCode = a.targetLocationCode,
                            note = a.note,
                        )
                    )
                    "exception" -> RetrofitClient.api.exceptionTaskByDevice(
                        taskId = a.taskId,
                        request = TaskExceptionRequest(
                            requestId = a.requestId,
                            siteCode = a.siteCode,
                            deviceUid = a.deviceUid,
                            operatorUserId = a.operatorUserId,
                            exceptionCode = a.exceptionCode ?: "manual_exception",
                            exceptionNote = a.exceptionNote,
                        )
                    )
                    else -> Unit
                }
            }
            if (res.isSuccess) {
                dao.deleteTaskAction(a.requestId)
            } else {
                val err = res.exceptionOrNull()
                if (isNonRetryableTaskActionError(err)) {
                    // Drop terminal conflicts (wrong device / invalid transition)
                    // so they do not poison the outbox forever.
                    dao.deleteTaskAction(a.requestId)
                    continue
                }
                dao.updateTaskActionAttempt(
                    requestId = a.requestId,
                    attemptCount = a.attemptCount + 1,
                    lastError = err?.message ?: "unknown error",
                )
                return@withContext Result.failure(err ?: RuntimeException("Outbox send failed"))
            }
        }
        refreshDeviceTasks()
        Result.success(Unit)
    }

    suspend fun getLastSyncAt(): String? = dao.getSyncState("sync.lastAt")?.value

    suspend fun fetchItemsPage(
        query: String? = null,
        cursor: String? = null,
        limit: Int = 100,
        productGroup: String? = null,
        productGroups: List<String>? = null,
        bareProductGroup: Boolean = false,
        materialType: String? = null,
        tnvedPrefix: String? = null,
    ): Result<com.scadatable.wms.data.remote.ItemsPage> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val groups = productGroups?.map { it.trim() }.orEmpty().filter { it.isNotEmpty() }
        safeApi {
            RetrofitClient.api.listItems(
                siteCode = siteCode,
                query = query?.trim()?.takeIf { it.isNotEmpty() },
                cursor = cursor,
                limit = limit,
                productGroup = productGroup?.trim()?.takeIf { it.isNotEmpty() }
                    ?.takeIf { groups.isEmpty() },
                productGroups = groups.takeIf { it.isNotEmpty() },
                bareProductGroup = if (bareProductGroup) "1" else null,
                materialType = materialType?.trim()?.takeIf { it.isNotEmpty() },
                tnvedPrefix = tnvedPrefix?.replace(Regex("\\D"), "")?.takeIf { it.isNotEmpty() },
            )
        }
    }

    suspend fun postManualReceivingDocument(
        targetLocationCode: String,
        groupCode: String?,
        groupName: String?,
        comment: String?,
        lines: List<com.scadatable.wms.data.remote.ManualReceivingDocumentLineRequest>,
    ): Result<com.scadatable.wms.data.remote.ManualReceivingDocumentResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.postManualReceivingDocument(
                com.scadatable.wms.data.remote.ManualReceivingDocumentRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    targetLocationCode = targetLocationCode.trim(),
                    comment = comment?.trim()?.takeIf { it.isNotEmpty() },
                    groupCode = groupCode?.trim()?.takeIf { it.isNotEmpty() },
                    groupName = groupName?.trim()?.takeIf { it.isNotEmpty() },
                    receiptAt = java.time.Instant.now().toString(),
                    lines = lines,
                )
            )
        }
    }

    suspend fun fetchLocations(
        query: String? = null,
        warehouseCode: String? = null,
        zoneCode: String? = null,
        workshopOnly: Boolean = false,
    ): Result<List<com.scadatable.wms.data.remote.LocationRow>> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            safeApi {
                RetrofitClient.api.listLocations(
                    siteCode = siteCode,
                    warehouseCode = warehouseCode?.trim()?.takeIf { it.isNotEmpty() },
                    zoneCode = zoneCode?.trim()?.takeIf { it.isNotEmpty() },
                    query = query?.trim()?.takeIf { it.isNotEmpty() },
                    workshopOnly = if (workshopOnly) "1" else null,
                ).locations
            }
        }

    suspend fun fetchItemDetail(itemCode: String): Result<com.scadatable.wms.data.remote.ItemDetailResponse> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            val code = itemCode.trim()
            if (code.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("itemCode is required"))
            }
            safeApi {
                RetrofitClient.api.getItemDetail(itemCode = code, siteCode = siteCode)
            }
        }

    suspend fun fetchLocationDetail(locationCode: String): Result<com.scadatable.wms.data.remote.LocationDetailResponse> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            val code = locationCode.trim()
            if (code.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("locationCode is required"))
            }
            safeApi {
                RetrofitClient.api.getLocationDetail(locationCode = code, siteCode = siteCode)
            }
        }

    suspend fun createLocation(
        warehouseCode: String,
        zoneCode: String,
        locationCode: String,
        displayName: String,
    ): Result<com.scadatable.wms.data.remote.LocationRow> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.createLocation(
                com.scadatable.wms.data.remote.CreateLocationRequest(
                    siteCode = siteCode,
                    warehouseCode = warehouseCode.trim(),
                    zoneCode = zoneCode.trim(),
                    locationCode = locationCode.trim().uppercase(),
                    displayName = displayName.trim().ifBlank { locationCode.trim().uppercase() },
                )
            ).location
        }
    }

    suspend fun fetchTnvedNodes(
        parent: String? = null,
        query: String? = null,
    ): Result<List<com.scadatable.wms.data.remote.TnvedNodeRow>> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        safeApi {
            RetrofitClient.api.listTnvedNodes(
                parent = parent?.trim()?.takeIf { it.isNotEmpty() },
                query = query?.trim()?.takeIf { it.isNotEmpty() },
            ).nodes
        }
    }

    suspend fun fetchProductGroups(): Result<List<com.scadatable.wms.data.remote.ProductGroupRow>> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            safeApi {
                RetrofitClient.api.listProductGroups(siteCode = siteCode).groups
            }
        }

    suspend fun fetchWarehouseDirectory(): Result<List<com.scadatable.wms.data.remote.WarehouseDirectoryRow>> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            safeApi {
                RetrofitClient.api.listWarehouses(siteCode = siteCode).warehouses
                    .filter { it.code.isNotBlank() }
            }
        }

    suspend fun fetchReceivingCategories(): Result<List<com.scadatable.wms.data.remote.ReceivingCategoryRow>> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            safeApi {
                val categories = RetrofitClient.api
                    .listReceivingCategories(siteCode = siteCode)
                    .categories
                    .filter { it.isActive && it.code.isNotBlank() }
                prefs.setReceivingCategoriesCache(
                    com.google.gson.Gson().toJson(categories),
                )
                categories
            }
        }

    suspend fun loadReceivingCategoriesFromCache(): List<com.scadatable.wms.data.remote.ReceivingCategoryRow> =
        withContext(Dispatchers.IO) {
            val json = prefs.receivingCategoriesCache.first().orEmpty()
            if (json.isBlank()) return@withContext emptyList()
            runCatching {
                val type = object : com.google.gson.reflect.TypeToken<
                    List<com.scadatable.wms.data.remote.ReceivingCategoryRow>,
                    >() {}.type
                com.google.gson.Gson().fromJson<List<com.scadatable.wms.data.remote.ReceivingCategoryRow>>(json, type)
            }.getOrDefault(emptyList())
        }

    suspend fun resolveReceivingCategoryProductGroups(categoryCode: String): List<String> =
        withContext(Dispatchers.IO) {
            val key = categoryCode.trim().lowercase(Locale.ROOT)
            if (key.isBlank() || key == "—") return@withContext emptyList()
            val categories = fetchReceivingCategories().getOrNull()
                ?: loadReceivingCategoriesFromCache()
            val links = com.scadatable.wms.receiving.ReceivingGroupMatcher.buildCategoryLinks(categories)
            links[key]?.toList().orEmpty().filter { it.isNotBlank() }
        }

    suspend fun enqueueNomenclatureDraft(
        barcode: String,
        name: String? = null,
    ): Result<Product> = withContext(Dispatchers.IO) {
        val normalized = barcode.trim()
        if (normalized.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("barcode is blank"))
        }
        val product = Product(
            barcode = normalized,
            name = name?.trim().takeUnless { it.isNullOrBlank() } ?: "Новый товар $normalized",
            sku = normalized,
            unit = "pcs",
        )
        dao.insertProduct(product)
        dao.enqueueNomenclature(
            NomenclatureOutbox(
                barcode = normalized,
                name = product.name,
                sku = product.sku,
                uomCode = product.unit,
            )
        )
        Result.success(product)
    }

    suspend fun getActiveReceivingDocId(): String? = prefs.activeReceivingDocId.first()

    suspend fun setActiveReceivingDocId(docId: String?) {
        prefs.setActiveReceivingDocId(docId)
    }

    suspend fun getActiveReceivingProductGroup(): String? = prefs.activeReceivingProductGroup.first()

    suspend fun setActiveReceivingProductGroup(productGroup: String?) {
        prefs.setActiveReceivingProductGroup(productGroup)
    }

    suspend fun getActiveReceivingCategory(): String? = prefs.activeReceivingCategory.first()

    suspend fun setActiveReceivingCategory(category: String?) {
        prefs.setActiveReceivingCategory(category)
    }

    suspend fun getLastReceivingQty(productGroup: String): Double = prefs.getLastReceivingQty(productGroup)
    suspend fun setLastReceivingQty(productGroup: String, value: Double) = prefs.setLastReceivingQty(productGroup, value)

    suspend fun startNewReceivingDocument(
        productGroup: String? = null,
        warehouseId: String? = null,
        targetLocationCode: String? = null,
    ): String = withContext(Dispatchers.IO) {
        val newId = UUID.randomUUID().toString().substring(0, 8).uppercase()
        val group = productGroup?.trim()?.takeIf { it.isNotBlank() }
        val warehouse = warehouseId?.trim()?.takeIf { it.isNotBlank() }
        val location = targetLocationCode?.trim()?.takeIf { it.isNotBlank() }
        dao.insertReceivingDocument(
            ReceivingDocument(
                id = newId,
                productGroup = group,
                warehouseId = warehouse,
                targetLocationCode = location,
            ),
        )
        prefs.setActiveReceivingDocId(newId)
        prefs.setActiveReceivingProductGroup(group)
        if (location != null) {
            prefs.setReceivingTargetLocationCode(location)
        }
        reportReceivingSessionStatus(
            documentId = newId,
            status = com.scadatable.wms.receiving.ReceivingDocumentStatus.ACTIVE,
            productGroup = group,
            lineCount = 0,
        )
        newId
    }

    suspend fun switchReceivingDocumentProductGroup(documentId: String, productGroup: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            val doc = documentId.trim()
            val group = productGroup.trim()
            if (doc.isBlank() || group.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("documentId/productGroup required"))
            }
            val existing = dao.getReceivingDocumentById(doc)
                ?: return@withContext Result.failure(IllegalStateException("Документ не найден"))
            if (existing.status == com.scadatable.wms.receiving.ReceivingDocumentStatus.CLOSED) {
                return@withContext Result.failure(IllegalStateException("Документ закрыт"))
            }
            dao.updateReceivingDocumentProductGroup(doc, group)
            prefs.setActiveReceivingProductGroup(group)
            reportReceivingSessionStatus(
                documentId = doc,
                status = existing.status,
                productGroup = group,
                lineCount = dao.countReceivingItems(doc),
            )
            Result.success(Unit)
        }

    suspend fun reportReceivingSessionStatus(
        documentId: String,
        status: String,
        productGroup: String? = null,
        lineCount: Int? = null,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val doc = documentId.trim()
        val normalizedStatus = status.trim()
        if (doc.isBlank() || normalizedStatus.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("documentId/status are required"))
        }
        if (normalizedStatus.equals(com.scadatable.wms.receiving.ReceivingDocumentStatus.ACTIVE, ignoreCase = true)) {
            val local = dao.getReceivingDocumentById(doc)
            if (local?.status == com.scadatable.wms.receiving.ReceivingDocumentStatus.CLOSED) {
                return@withContext Result.success(Unit)
            }
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val group = productGroup?.trim()?.takeIf { it.isNotBlank() }
            ?: prefs.activeReceivingProductGroup.first()?.trim()?.takeIf { it.isNotBlank() }
        val scannedAtIso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(java.util.Date())
        val res = safeApi {
            RetrofitClient.api.createCodeList(
                CreateCodeListRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    listType = "receiving_session_status",
                    entries = listOf(
                        CodeListEntryDto(
                            kind = "session",
                            code = doc,
                            documentId = doc,
                            scannedAtIso = scannedAtIso,
                            note = normalizedStatus,
                            itemCode = group,
                            qty = lineCount?.toDouble(),
                        )
                    ),
                )
            )
        }
        if (res.isFailure) {
            return@withContext Result.failure(res.exceptionOrNull() ?: RuntimeException("session status report failed"))
        }
        Result.success(Unit)
    }

    suspend fun getActiveCollectDocId(): String? = prefs.activeCollectDocId.first()

    suspend fun setActiveCollectDocId(docId: String?) {
        prefs.setActiveCollectDocId(docId)
    }

    suspend fun startNewCollectDocument() {
        prefs.setActiveCollectDocId(null)
    }

    suspend fun addScanToCollectList(code: String): Result<CollectAppendResult> = withContext(Dispatchers.IO) {
        val normalized = code.trim()
        if (normalized.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("code is blank"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val requestId =
            prefs.activeCollectDocId.first()?.trim().takeUnless { it.isNullOrBlank() }
                ?: UUID.randomUUID().toString().also { newId ->
                    dao.insertCollectScanDocument(CollectScanDocument(id = newId))
                    prefs.setActiveCollectDocId(newId)
                }
        dao.insertCollectScanItem(
            CollectScanItem(
                documentId = requestId,
                code = normalized,
            )
        )
        val allItems = dao.listCollectScanItems(requestId)
        val entries = allItems.map { CodeListEntryDto(code = it.code) }
        var serverCodeListId: String? = null
        var syncWarning: String? = null
        val syncRes = safeApi {
            RetrofitClient.api.createCodeList(
                CreateCodeListRequest(
                    requestId = requestId,
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    listType = "scanner_collect",
                    entries = entries,
                )
            )
        }
        if (syncRes.isSuccess) {
            serverCodeListId = syncRes.getOrThrow().codeListId
            dao.insertCollectScanDocument(
                CollectScanDocument(
                    id = requestId,
                    serverCodeListId = serverCodeListId,
                )
            )
        } else {
            syncWarning = syncRes.exceptionOrNull()?.message ?: "Список сохранён локально, синхронизация с сервером не удалась"
        }
        Result.success(
            CollectAppendResult(
                documentId = requestId,
                code = normalized,
                totalCodes = entries.size,
                serverCodeListId = serverCodeListId,
                syncWarning = syncWarning,
            )
        )
    }

    suspend fun cacheReceivingResolve(body: ReceivingResolveResponse) = withContext(Dispatchers.IO) {
        cacheResolvedProducts(body)
    }

    suspend fun resolveReceivingScan(rawCode: String): Result<ReceivingResolveResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val normalized = rawCode.trim()
        if (normalized.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("code is blank"))
        }
        safeApi {
            val productGroup = prefs.activeReceivingProductGroup.first()?.trim()?.takeIf { it.isNotBlank() }
            RetrofitClient.api.resolveReceivingScan(
                ReceivingResolveScanRequest(
                    siteCode = siteCode,
                    code = normalized,
                    receivingCategory = productGroup,
                    productGroup = productGroup,
                )
            )
        }
    }

    suspend fun addScanToActiveReceiving(barcode: String, quantity: Double = 1.0): Result<ReceivingAppendResult> =
        withContext(Dispatchers.IO) {
            val normalized = barcode.trim()
            if (normalized.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("barcode is blank"))
            }
            applyBaseUrl()

            val docId = prefs.activeReceivingDocId.first()?.trim().takeUnless { it.isNullOrBlank() }
                ?: UUID.randomUUID().toString().substring(0, 8).uppercase().also { newId ->
                    dao.insertReceivingDocument(ReceivingDocument(id = newId, status = com.scadatable.wms.receiving.ReceivingDocumentStatus.ACTIVE))
                    prefs.setActiveReceivingDocId(newId)
                }

            val resolveRes = resolveReceivingScan(normalized)
            if (resolveRes.isFailure) {
                return@withContext Result.failure(
                    resolveRes.exceptionOrNull() ?: RuntimeException("CRPT resolve failed")
                )
            }
            val body = resolveRes.getOrThrow()
            val primary = body.primaryItem
                ?: return@withContext Result.failure(RuntimeException("Сервер не вернул номенклатуру"))

            cacheResolvedProducts(body)

            val gtin = primary.gtin
            val product = dao.getProductByGtin(gtin) ?: dao.getProductByBarcode(primary.itemCode)
                ?: Product(
                    barcode = primary.itemCode,
                    name = primary.name,
                    sku = primary.itemCode,
                    unit = "pcs",
                    groupGtin = body.nestedItem?.gtin,
                    itemsInGroup = body.specQtyPer ?: 1,
                    productGroup = primary.productGroup,
                ).also { dao.insertProduct(it) }

            val expiry = body.expiry
            val itemStatus = when (expiry?.state?.lowercase()) {
                "expired" -> "просрочен"
                "warning" -> "истекает"
                else -> "эммитирован"
            }
            val emissionAt = parseIsoMillis(expiry?.emissionAt)

            val itemId = dao.insertReceivingItem(
                ReceivingItem(
                    documentId = docId,
                    productBarcode = product.barcode,
                    quantity = quantity,
                    scannedCode = normalized,
                    resolvedGtin = gtin,
                    status = itemStatus,
                    emissionAt = emissionAt,
                )
            )
            runCatching {
                reportReceivingScanEvent(
                    code = normalized,
                    documentId = docId,
                    qty = quantity,
                    itemCode = product.barcode,
                    itemName = product.name,
                    note = buildReceivingScanNote(body),
                    stickerStatus = body.crptStatus,
                    itemStatus = itemStatus,
                    emissionAtIso = body.expiry?.emissionAt,
                    expiryState = body.expiry?.state,
                ).getOrNull()?.let { scanEventId ->
                    if (itemId > 0L) {
                        dao.updateReceivingItemScanEventId(itemId, scanEventId)
                    }
                }
            }
            Result.success(
                ReceivingAppendResult(
                    documentId = docId,
                    product = product,
                    scannedCode = normalized,
                    resolvedGtin = gtin,
                    itemStatus = itemStatus,
                    crptStatus = body.crptStatus,
                    expiryState = expiry?.state,
                    expiryMessage = expiry?.message,
                    warnings = body.warnings.orEmpty(),
                    nestedItemName = body.nestedItem?.name,
                    packageRole = primary.packageRole,
                )
            )
        }

    private suspend fun cacheResolvedProducts(body: ReceivingResolveResponse) {
        body.primaryItem?.let { cacheResolvedItem(it, body.nestedItem?.gtin, body.specQtyPer) }
        body.nestedItem?.let { cacheResolvedItem(it, null, 1) }
    }

    private suspend fun cacheResolvedItem(
        item: ReceivingResolveItemDto,
        nestedGtin: String?,
        itemsInGroup: Int?,
    ) {
        dao.insertProduct(
            Product(
                barcode = item.itemCode,
                name = item.name,
                sku = item.itemCode,
                unit = "pcs",
                groupGtin = nestedGtin,
                itemsInGroup = itemsInGroup ?: 1,
                productGroup = item.productGroup,
            )
        )
    }

    private fun buildReceivingScanNote(body: ReceivingResolveResponse): String? {
        val parts = mutableListOf<String>()
        body.warnings
            ?.filter { w ->
                val lower = w.lowercase()
                !lower.contains("просрочен") && !lower.contains("изъять")
            }
            ?.forEach { parts.add(it) }
        if (body.specLinked && body.nestedItem != null) {
            parts.add("Связка блока с «${body.nestedItem.name}» (${body.specQtyPer ?: "?"} шт.)")
        }
        return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
    }

    private fun parseIsoMillis(value: String?): Long? {
        if (value.isNullOrBlank()) return null
        val raw = value.trim()
        runCatching { return java.time.Instant.parse(raw).toEpochMilli() }
        runCatching { return java.time.OffsetDateTime.parse(raw).toInstant().toEpochMilli() }
        runCatching {
            val date = java.time.LocalDate.parse(raw.take(10))
            return date.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
        }
        return null
    }

    suspend fun replayNomenclatureOutbox(): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val drafts = dao.listNomenclatureOutbox()
        for (draft in drafts) {
            val res = safeApi {
                RetrofitClient.api.importItems(
                    ImportItemsRequest(
                        siteCode = siteCode,
                        rows = listOf(
                            ImportItemRow(
                                itemCode = draft.barcode,
                                name = draft.name,
                                sku = draft.sku,
                                primaryBarcode = draft.barcode,
                                uomCode = draft.uomCode,
                            )
                        )
                    )
                )
            }
            if (res.isSuccess) {
                dao.deleteNomenclatureOutbox(draft.id)
            } else {
                return@withContext Result.failure(
                    res.exceptionOrNull() ?: RuntimeException("Nomenclature outbox send failed")
                )
            }
        }
        Result.success(Unit)
    }

    suspend fun reportMissingNomenclature(
        code: String,
        note: String = "Отсутствует номенклатура, нужно добавить позже",
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val normalized = code.trim()
        if (normalized.isBlank()) return@withContext Result.failure(IllegalArgumentException("code is blank"))
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val res = safeApi {
            RetrofitClient.api.createCodeList(
                CreateCodeListRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    listType = "missing_nomenclature",
                    entries = listOf(
                        CodeListEntryDto(
                            kind = "missing_nomenclature",
                            code = normalized,
                            note = note,
                            comment = null,
                        )
                    ),
                )
            )
        }
        if (res.isFailure) return@withContext Result.failure(res.exceptionOrNull() ?: RuntimeException("report failed"))
        Result.success(Unit)
    }

    suspend fun reportReceivingScanEvent(
        code: String,
        documentId: String,
        qty: Double,
        itemCode: String? = null,
        itemName: String? = null,
        note: String? = null,
        stickerStatus: String? = null,
        itemStatus: String? = null,
        emissionAtIso: String? = null,
        expiryState: String? = null,
    ): Result<String?> = withContext(Dispatchers.IO) {
        val normalized = code.trim()
        val doc = documentId.trim()
        if (normalized.isBlank() || doc.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("code/documentId are required"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val res = safeApi {
            RetrofitClient.api.createCodeList(
                CreateCodeListRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    listType = "receiving_scan_event",
                    entries = listOf(
                        CodeListEntryDto(
                            kind = "scan",
                            code = normalized,
                            scannedAtIso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                                timeZone = java.util.TimeZone.getTimeZone("UTC")
                            }.format(java.util.Date()),
                            documentId = doc,
                            itemCode = itemCode,
                            itemName = itemName,
                            qty = qty,
                            note = note,
                            stickerStatus = stickerStatus,
                            itemStatus = itemStatus,
                            emissionAtIso = emissionAtIso,
                            expiryState = expiryState,
                        )
                    ),
                )
            )
        }
        if (res.isFailure) return@withContext Result.failure(res.exceptionOrNull() ?: RuntimeException("report failed"))
        val codeListId = res.getOrThrow().codeListId?.trim().orEmpty()
        val scanEventId = codeListId.takeIf { it.isNotBlank() }?.let { "$it:1" }
        Result.success(scanEventId)
    }

    suspend fun syncReceivingScanEventQty(
        itemId: Long,
        scanEventId: String?,
        documentId: String,
        code: String,
        qty: Double,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        if (!qty.isFinite() || qty <= 0.0) {
            return@withContext Result.failure(IllegalArgumentException("qty must be positive"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val normalizedCode = code.trim()
        val doc = documentId.trim()
        if (normalizedCode.isBlank() || doc.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("code/documentId are required"))
        }

        val eventId = scanEventId?.trim().orEmpty()
        if (eventId.isNotBlank()) {
            val patchRes = safeApi {
                RetrofitClient.api.patchReceivingScanEvent(
                    id = eventId,
                    request = PatchReceivingScanEventRequest(siteCode = siteCode, qty = qty),
                )
            }
            if (patchRes.isSuccess) return@withContext Result.success(Unit)
        }

        val syncRes = safeApi {
            RetrofitClient.api.syncReceivingSession(
                SyncReceivingSessionRequest(
                    siteCode = siteCode,
                    documentId = doc,
                    lines = listOf(
                        SyncReceivingSessionLine(
                            code = normalizedCode,
                            qty = qty,
                            scanEventId = eventId.takeIf { it.isNotBlank() },
                        )
                    ),
                )
            )
        }
        if (syncRes.isFailure) {
            return@withContext Result.failure(syncRes.exceptionOrNull() ?: RuntimeException("sync qty failed"))
        }
        syncRes.getOrThrow().updatedIds?.firstOrNull()?.let { resolvedId ->
            if (itemId > 0L) {
                dao.updateReceivingItemScanEventId(itemId, resolvedId)
            }
        }
        Result.success(Unit)
    }

    suspend fun isAutoPostReceivingStockEnabled(): Boolean =
        prefs.autoPostReceivingStock.first()

    suspend fun getReceivingTargetLocationCode(): String? =
        prefs.receivingTargetLocationCode.first().trim().takeIf { it.isNotBlank() }

    suspend fun recommendReceivingStorageLocation(
        itemCode: String,
        qty: Double,
        preferReceiving: Boolean = false,
        batchCode: String? = null,
        lpnCode: String? = null,
    ): Result<com.scadatable.wms.data.remote.StorageRecommendResponse> = withContext(Dispatchers.IO) {
        val cleanItem = itemCode.trim()
        val batch = batchCode?.trim().orEmpty()
        val lpn = lpnCode?.trim().orEmpty()
        if (cleanItem.isBlank() && batch.isBlank() && lpn.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("itemCode or LPN/batch is required"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.recommendStorageLocation(
                com.scadatable.wms.data.remote.StorageRecommendRequest(
                    siteCode = siteCode,
                    itemCode = cleanItem.takeIf { it.isNotBlank() },
                    qty = qty.takeIf { it.isFinite() && it > 0.0 },
                    preferReceiving = preferReceiving,
                    limit = 4,
                    batchCode = batch.takeIf { it.isNotBlank() },
                    lpnCode = lpn.takeIf { it.isNotBlank() },
                )
            )
        }
    }

    suspend fun fetchStockPostedDocumentIds(): Result<Set<String>> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.listReceivingStockPosts(siteCode = siteCode)
        }.map { body ->
            body.posts.orEmpty()
                .mapNotNull { it.documentId?.trim()?.uppercase() }
                .filter { it.isNotBlank() }
                .toSet()
        }
    }

    suspend fun finalizeReceivingSession(
        documentId: String,
        productGroup: String? = null,
        targetLocationCode: String? = null,
    ): Result<FinalizeReceivingSessionResponse> = withContext(Dispatchers.IO) {
        val doc = documentId.trim()
        if (doc.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("documentId is required"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val group = productGroup?.trim()?.takeIf { it.isNotBlank() }
            ?: prefs.activeReceivingProductGroup.first()?.trim()?.takeIf { it.isNotBlank() }
        val loc = targetLocationCode?.trim()?.takeIf { it.isNotBlank() }
            ?: dao.getReceivingDocumentById(doc)?.targetLocationCode?.trim()?.takeIf { it.isNotBlank() }
            ?: getReceivingTargetLocationCode()
        safeApi {
            RetrofitClient.api.finalizeReceivingSession(
                FinalizeReceivingSessionRequest(
                    siteCode = siteCode,
                    documentId = doc,
                    deviceUid = deviceUid,
                    targetLocationCode = loc,
                    productGroup = group,
                ),
            )
        }
    }

    suspend fun syncReceivingDocumentQuantities(documentId: String): Result<Unit> = withContext(Dispatchers.IO) {
        val doc = documentId.trim()
        if (doc.isBlank()) return@withContext Result.success(Unit)
        val items = dao.getReceivingItemsOnce(doc)
        if (items.isEmpty()) return@withContext Result.success(Unit)

        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val syncRes = safeApi {
            RetrofitClient.api.syncReceivingSession(
                SyncReceivingSessionRequest(
                    siteCode = siteCode,
                    documentId = doc,
                    lines = items.map { item ->
                        SyncReceivingSessionLine(
                            code = item.scannedCode?.trim().orEmpty().ifBlank { item.productBarcode },
                            qty = item.quantity,
                            scanEventId = item.serverScanEventId,
                        )
                    },
                )
            )
        }
        if (syncRes.isFailure) {
            return@withContext Result.failure(syncRes.exceptionOrNull() ?: RuntimeException("sync document failed"))
        }

        val updatedIds = syncRes.getOrThrow().updatedIds.orEmpty()
        updatedIds.forEachIndexed { index, scanEventId ->
            val item = items.getOrNull(index) ?: return@forEachIndexed
            if (item.serverScanEventId.isNullOrBlank()) {
                dao.updateReceivingItemScanEventId(item.id, scanEventId)
            }
        }
        Result.success(Unit)
    }

    suspend fun isAutoPrintReceivingEnabled(): Boolean = prefs.autoPrintReceiving.first()

    suspend fun lookupReceivingBatch(batchCode: String): Result<com.scadatable.wms.data.remote.ReceivingBatchLookupResponse> =
        withContext(Dispatchers.IO) {
            val code = batchCode.trim()
            if (code.isBlank()) {
                return@withContext Result.failure(IllegalArgumentException("batchCode is blank"))
            }
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            safeApi {
                RetrofitClient.api.lookupReceivingBatch(code = code, siteCode = siteCode)
            }
        }

    suspend fun placeReceivingBatch(
        batchCode: String,
        targetLocationCode: String,
        overrideReason: String? = null,
        recommendedLocationCode: String? = null,
    ): Result<com.scadatable.wms.data.remote.PlaceReceivingBatchResponse> = withContext(Dispatchers.IO) {
        val code = batchCode.trim()
        val target = targetLocationCode.trim()
        val override = overrideReason?.trim()?.takeIf { it.isNotEmpty() }
        val recommended = recommendedLocationCode?.trim()?.takeIf { it.isNotEmpty() }
        if (code.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Сканируйте код партии"))
        }
        if (target.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Выберите ячейку"))
        }
        applyBaseUrl()
        safeApi {
            RetrofitClient.api.placeReceivingBatch(
                com.scadatable.wms.data.remote.PlaceReceivingBatchRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = prefs.siteCode.first(),
                    batchCode = code,
                    targetLocationCode = target,
                    deviceUid = prefs.deviceUid.first(),
                    overrideReason = override,
                    recommendedLocationCode = recommended,
                )
            )
        }
    }

    suspend fun registerReceivingBatchSticker(
        batchCode: String,
        documentId: String,
        itemCode: String,
        itemName: String,
        gtin: String?,
        qty: Double,
        cellCode: String?,
        emissionAtIso: String?,
        expiresAtIso: String?,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        val code = batchCode.trim()
        val doc = documentId.trim()
        if (code.isBlank() || doc.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("batchCode/documentId are required"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val meta = buildString {
            append("{")
            append("\"gtin\":")
            append(if (gtin.isNullOrBlank()) "null" else "\"${gtin.replace("\"", "\\\"")}\"")
            if (!expiresAtIso.isNullOrBlank()) {
                append(",\"expiresAtIso\":\"${expiresAtIso.replace("\"", "\\\"")}\"")
            }
            append("}")
        }
        val res = safeApi {
            RetrofitClient.api.createCodeList(
                CreateCodeListRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    listType = "receiving_batch_sticker",
                    entries = listOf(
                        CodeListEntryDto(
                            kind = "scan",
                            code = code,
                            documentId = doc,
                            itemCode = itemCode,
                            itemName = itemName,
                            qty = qty,
                            note = cellCode,
                            comment = meta,
                            emissionAtIso = emissionAtIso,
                        )
                    ),
                )
            )
        }
        if (res.isFailure) {
            return@withContext Result.failure(res.exceptionOrNull() ?: RuntimeException("batch register failed"))
        }
        Result.success(Unit)
    }

    suspend fun resolveItemGtinForMarking(
        itemCode: String,
        assignIfMissing: Boolean = true,
    ): Result<com.scadatable.wms.data.remote.ResolveItemGtinResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.resolveItemGtinForMarking(
                com.scadatable.wms.data.remote.ResolveItemGtinRequest(
                    siteCode = siteCode,
                    itemCode = itemCode.trim(),
                    assignIfMissing = assignIfMissing,
                )
            )
        }
    }

    suspend fun generateInternalMarkingCodes(
        itemCode: String,
        volume: Double? = null,
        uom: String? = null,
        gtin: String? = null,
    ): Result<com.scadatable.wms.data.remote.GenerateInternalMarkingResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.generateInternalMarkingCodes(
                com.scadatable.wms.data.remote.GenerateInternalMarkingRequest(
                    siteCode = siteCode,
                    itemCode = itemCode.trim(),
                    qty = 1,
                    markPrinted = true,
                    gtin = gtin?.trim()?.takeIf { it.isNotEmpty() },
                    volume = volume,
                    uom = uom?.trim()?.takeIf { it.isNotEmpty() },
                    assignGtinIfMissing = true,
                )
            )
        }
    }

    suspend fun getReceivingBaseUrl(): String = prefs.baseUrl.first()

    suspend fun getSiteCode(): String = prefs.siteCode.first()

    suspend fun uploadAggregationDocument(
        documentId: String,
        mode: String,
        entries: List<AggregationUploadEntry>,
    ): Result<String?> = withContext(Dispatchers.IO) {
        val doc = documentId.trim()
        val normalizedMode = mode.trim().lowercase()
        if (doc.isBlank() || entries.isEmpty()) {
            return@withContext Result.failure(IllegalArgumentException("documentId/entries are required"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        val deviceUid = prefs.deviceUid.first()
        val listType = when (normalizedMode) {
            "block" -> "aggregation_block_doc"
            "pallet" -> "aggregation_pallet_doc"
            "extract" -> "aggregation_extract_doc"
            else -> "aggregation_block_doc"
        }
        val payloadEntries = entries.mapIndexed { index, row ->
            CodeListEntryDto(
                kind = "aggregation",
                code = row.parentCode,
                itemCode = row.childCode,
                itemName = row.mode,
                note = row.action,
                comment = "line:${index + 1}",
                documentId = doc,
                scannedAtIso = java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US).apply {
                    timeZone = java.util.TimeZone.getTimeZone("UTC")
                }.format(java.util.Date()),
            )
        }
        val res = safeApi {
            RetrofitClient.api.createCodeList(
                CreateCodeListRequest(
                    requestId = doc,
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    listType = listType,
                    entries = payloadEntries,
                )
            )
        }
        if (res.isFailure) return@withContext Result.failure(res.exceptionOrNull() ?: RuntimeException("aggregation upload failed"))
        Result.success(res.getOrThrow().codeListId)
    }

    private fun TaskRow.toCache(): TaskCache = TaskCache(
        taskId = taskId,
        taskCode = taskCode,
        taskType = taskType,
        taskStatus = taskStatus,
        priorityCode = priorityCode,
        itemCode = itemCode,
        itemName = itemName,
        sourceLocationCode = sourceLocationCode,
        targetLocationCode = targetLocationCode,
        plannedQty = plannedQty,
        confirmedQty = confirmedQty,
        dueAt = dueAt,
        claimedAt = claimedAt,
        startedAt = startedAt,
        completedAt = completedAt,
        exceptionCode = exceptionCode,
    )

    private fun extractGtin14(raw: String): String? {
        val compact = raw.replace("\\s".toRegex(), "")
        val match = Regex("01(\\d{14})").find(compact) ?: return null
        return match.groupValues[1]
    }

    private fun isNonRetryableTaskActionError(error: Throwable?): Boolean {
        val http = error as? WmsHttpException ?: return false
        val code = http.code.orEmpty().trim().lowercase()
        val text = http.message.orEmpty().lowercase()
        if (code == "wrong_device") return true
        if (http.status == 409) return true
        if (http.status == 400 && (text.contains("assigned to another device") || text.contains("wrong_device"))) {
            return true
        }
        return false
    }

    data class IssueRecipientOption(
        val id: String,
        val displayName: String,
        val subtitle: String? = null,
    )

    suspend fun listIssueRecipients(): Result<List<IssueRecipientOption>> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        safeApi {
            RetrofitClient.api.listIssueRecipients().recipients.orEmpty().mapNotNull { row ->
                val name = row.displayName?.trim().orEmpty()
                if (name.isBlank()) return@mapNotNull null
                IssueRecipientOption(
                    id = row.id?.trim().orEmpty().ifBlank { name },
                    displayName = name,
                    subtitle = row.subtitle?.trim()?.takeIf { it.isNotBlank() },
                )
            }
        }
    }

    suspend fun submitIssue(
        itemCode: String,
        sourceLocationCode: String,
        targetLocationCode: String,
        qty: Double,
        recipientName: String,
        lineName: String? = null,
        lotCode: String? = null,
        emissionDay: String? = null,
        emissionAtIso: String? = null,
    ): Result<com.scadatable.wms.data.remote.IssueResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.submitIssue(
                com.scadatable.wms.data.remote.IssueRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    itemCode = itemCode.trim(),
                    sourceLocationCode = sourceLocationCode.trim(),
                    targetLocationCode = targetLocationCode.trim(),
                    qty = qty,
                    recipientName = recipientName.trim(),
                    lineName = lineName?.trim()?.takeIf { it.isNotEmpty() },
                    lotCode = lotCode?.trim()?.takeIf { it.isNotEmpty() },
                    emissionDay = emissionDay?.trim()?.takeIf { it.isNotEmpty() },
                    emissionAtIso = emissionAtIso?.trim()?.takeIf { it.isNotEmpty() },
                )
            )
        }
    }

    suspend fun productionConsume(
        locationCode: String,
        itemCode: String,
        qty: Double,
        sourceSystem: String,
        lineCode: String? = null,
        operatorName: String? = null,
    ): Result<com.scadatable.wms.data.remote.ProductionConsumeResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.productionConsume(
                com.scadatable.wms.data.remote.ProductionConsumeRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    locationCode = locationCode.trim(),
                    itemCode = itemCode.trim(),
                    qty = qty,
                    sourceSystem = sourceSystem,
                    lineCode = lineCode?.trim()?.takeIf { it.isNotEmpty() },
                    operatorName = operatorName?.trim()?.takeIf { it.isNotEmpty() },
                )
            )
        }
    }

    suspend fun getPosPickPlan(
        itemCode: String,
        qty: Double,
    ): Result<com.scadatable.wms.data.remote.PosPickPlanResponse> = withContext(Dispatchers.IO) {
        val cleanItem = itemCode.trim()
        if (cleanItem.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("itemCode is blank"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.getPosPickPlan(
                siteCode = siteCode,
                itemCode = cleanItem,
                qty = qty.takeIf { it.isFinite() && it > 0.0 } ?: 1.0,
            )
        }
    }

    suspend fun getWorkshopPickList(
        planCode: String,
    ): Result<com.scadatable.wms.data.remote.WorkshopPickListResponse> = withContext(Dispatchers.IO) {
        val clean = planCode.trim()
        if (clean.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Укажите код плана APS"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.getWorkshopPickList(
                code = clean,
                siteCode = siteCode,
            )
        }
    }

    suspend fun submitPosIssue(
        itemCode: String,
        qty: Double,
        recipientName: String,
        targetLocationCode: String,
        lineName: String? = null,
        scannedSourceLocationCode: String? = null,
        requireSourceScan: Boolean = false,
        planCode: String? = null,
        createAct: Boolean? = null,
    ): Result<com.scadatable.wms.data.remote.PosIssueResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.submitPosIssue(
                PosIssueRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    itemCode = itemCode.trim(),
                    qty = qty,
                    recipientName = recipientName.trim(),
                    targetLocationCode = targetLocationCode.trim(),
                    lineName = lineName?.trim()?.takeIf { it.isNotBlank() },
                    scannedSourceLocationCode = scannedSourceLocationCode?.trim()?.takeIf { it.isNotBlank() },
                    requireSourceScan = requireSourceScan,
                    planCode = planCode?.trim()?.takeIf { it.isNotBlank() },
                    createAct = createAct,
                )
            )
        }
    }

    suspend fun confirmTransfer(
        itemCode: String,
        sourceLocationCode: String,
        targetLocationCode: String,
        qty: Double,
    ): Result<com.scadatable.wms.data.remote.TransferConfirmResponse> = withContext(Dispatchers.IO) {
        val cleanItem = itemCode.trim()
        val cleanSource = sourceLocationCode.trim()
        val cleanTarget = targetLocationCode.trim()
        if (cleanItem.isBlank()) return@withContext Result.failure(IllegalArgumentException("Выберите номенклатуру"))
        if (cleanSource.isBlank()) return@withContext Result.failure(IllegalArgumentException("Укажите ячейку-источник"))
        if (cleanTarget.isBlank()) return@withContext Result.failure(IllegalArgumentException("Укажите ячейку назначения"))
        if (cleanSource.equals(cleanTarget, ignoreCase = true)) {
            return@withContext Result.failure(IllegalArgumentException("Источник и назначение совпадают"))
        }
        if (!qty.isFinite() || qty <= 0.0) {
            return@withContext Result.failure(IllegalArgumentException("Укажите количество больше нуля"))
        }
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.confirmTransfer(
                TransferConfirmRequest(
                    requestId = UUID.randomUUID().toString(),
                    siteCode = siteCode,
                    itemCode = cleanItem,
                    fromLocationCode = cleanSource,
                    toLocationCode = cleanTarget,
                    qty = qty,
                )
            )
        }
    }

    suspend fun currentOperatorName(): String =
        prefs.operatorDisplayName.first()?.trim().orEmpty().ifBlank { "ТСД" }

    suspend fun getStockAvailability(
        itemCode: String,
        locationCode: String,
    ): Result<com.scadatable.wms.data.remote.StockAvailabilityResponse> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        val siteCode = prefs.siteCode.first()
        safeApi {
            RetrofitClient.api.getStockAvailability(
                siteCode = siteCode,
                itemCode = itemCode.trim(),
                locationCode = locationCode.trim(),
            )
        }
    }

    suspend fun pollSupportSession(activeSessionId: String?): Result<com.scadatable.wms.data.remote.SupportPollResponse> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            val siteCode = prefs.siteCode.first()
            val deviceUid = prefs.deviceUid.first()
            if (siteCode.isBlank() || deviceUid.isBlank()) {
                return@withContext Result.success(com.scadatable.wms.data.remote.SupportPollResponse())
            }
            safeApi {
                RetrofitClient.api.pollSupportSession(
                    siteCode = siteCode,
                    deviceUid = deviceUid,
                    sessionId = activeSessionId,
                )
            }
        }

    suspend fun respondSupportSession(sessionId: String, accept: Boolean): Result<com.scadatable.wms.data.remote.SupportSessionDto> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            safeApi {
                RetrofitClient.api.postSupportDevice(
                    com.scadatable.wms.data.remote.SupportDeviceRequest(
                        siteCode = prefs.siteCode.first(),
                        deviceUid = prefs.deviceUid.first(),
                        sessionId = sessionId,
                        action = "respond",
                        accept = accept,
                    )
                ).session ?: throw IllegalStateException("empty session")
            }
        }

    suspend fun postSupportTelemetry(
        sessionId: String,
        currentScreen: String,
        events: List<com.scadatable.wms.data.remote.SupportEventInput>,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        safeApi {
            RetrofitClient.api.postSupportDevice(
                com.scadatable.wms.data.remote.SupportDeviceRequest(
                    siteCode = prefs.siteCode.first(),
                    deviceUid = prefs.deviceUid.first(),
                    sessionId = sessionId,
                    action = "telemetry",
                    currentScreen = currentScreen,
                    events = events.ifEmpty { null },
                )
            )
            Unit
        }
    }

    suspend fun uploadSupportScreenshot(sessionId: String, screenshotBase64: String): Result<Unit> =
        withContext(Dispatchers.IO) {
            applyBaseUrl()
            safeApi {
                RetrofitClient.api.postSupportDevice(
                    com.scadatable.wms.data.remote.SupportDeviceRequest(
                        siteCode = prefs.siteCode.first(),
                        deviceUid = prefs.deviceUid.first(),
                        sessionId = sessionId,
                        action = "screenshot",
                        screenshotBase64 = screenshotBase64,
                    )
                )
                Unit
            }
        }

    suspend fun endSupportSession(sessionId: String, reason: String): Result<Unit> = withContext(Dispatchers.IO) {
        applyBaseUrl()
        safeApi {
            RetrofitClient.api.postSupportDevice(
                com.scadatable.wms.data.remote.SupportDeviceRequest(
                    siteCode = prefs.siteCode.first(),
                    deviceUid = prefs.deviceUid.first(),
                    sessionId = sessionId,
                    action = "end",
                    reason = reason,
                )
            )
            Unit
        }
    }

    private companion object {
        const val DEVICE_INFO_LABEL_TEMPLATE = "labelTemplateTspl"
        const val DEVICE_INFO_PRINTER_BACKEND = "printerBackend"
        const val DEVICE_INFO_PRINTER_MAC = "printerBluetoothMac"
    }
}
