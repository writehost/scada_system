package com.scadatable.wms.data.remote

import com.google.gson.JsonDeserializationContext
import com.google.gson.JsonDeserializer
import com.google.gson.JsonElement
import com.google.gson.annotations.JsonAdapter
import com.google.gson.annotations.SerializedName
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

data class ApiError(
    val error: String? = null,
    val message: String? = null,
    val code: String? = null,
)

data class HealthResponse(
    val ok: Boolean = false,
    val error: String? = null,
)

data class AuthLoginRequest(
    val login: String,
    val password: String,
)

data class AuthUserDto(
    val userId: String? = null,
    val login: String? = null,
    val fio: String? = null,
    val displayName: String? = null,
    val position: String? = null,
    val roleCodes: List<String>? = null,
)

data class AuthLoginResponse(
    val ok: Boolean = false,
    val accessToken: String? = null,
    val tokenType: String? = null,
    val expiresIn: Long? = null,
    val user: AuthUserDto? = null,
)

data class IdentifyUserRequest(
    val siteCode: String,
    val method: String,
    val rfidUid: String? = null,
    val identity: String? = null,
    val pin: String? = null,
)

data class IdentifyUserResponse(
    val user: AuthUserDto? = null,
    val method: String? = null,
)

data class RegisterDeviceRequest(
    val siteCode: String,
    val deviceUid: String,
    val deviceName: String,
    val platform: String? = null,
    val appVersion: String? = null,
    val deviceInfo: Map<String, Any>? = null,
)

data class DeviceRow(
    val deviceId: String,
    val deviceUid: String,
    val deviceName: String,
    val platform: String? = null,
    val appVersion: String? = null,
    val deviceStatus: String,
    val assignedUserId: String? = null,
    val lastSeenAt: String? = null,
    val deviceInfo: Map<String, Any>? = null,
)

data class RegisterDeviceResponse(
    val device: DeviceRow,
)

data class ProfileRole(
    val code: String,
    val name: String,
)

data class ProfileOperator(
    val userId: String,
    val login: String,
    val displayName: String,
    val externalCode: String? = null,
    val phone: String? = null,
    val isActive: Boolean,
    val roles: List<ProfileRole> = emptyList(),
)

data class MobileProfileResponse(
    val siteCode: String,
    val device: DeviceRow,
    val assignedUserId: String? = null,
    val operatorUserId: String? = null,
    val operator: ProfileOperator? = null,
    val hint: String? = null,
)

data class TaskRow(
    val taskId: String,
    val taskCode: String,
    val taskType: String,
    val taskStatus: String,
    val priorityCode: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val sourceWarehouseCode: String? = null,
    val targetWarehouseCode: String? = null,
    val sourceWarehouseName: String? = null,
    val targetWarehouseName: String? = null,
    val sourceLocationCode: String? = null,
    val targetLocationCode: String? = null,
    val plannedQty: Double? = null,
    val confirmedQty: Double? = null,
    val dueAt: String? = null,
    val claimedAt: String? = null,
    val startedAt: String? = null,
    val completedAt: String? = null,
    val exceptionCode: String? = null,
)

data class TasksPage(
    val tasks: List<TaskRow> = emptyList(),
    val nextCursor: String? = null,
)

data class TaskSubscribeTrigger(
    val eventType: String? = null,
    val message: String? = null,
    val taskId: String? = null,
    val atIso: String? = null,
)

data class TasksSubscribeResponse(
    val tasks: List<TaskRow> = emptyList(),
    val nextCursor: String? = null,
    val trigger: TaskSubscribeTrigger? = null,
)

data class DeviceTaskActionRequest(
    val requestId: String,
    val siteCode: String,
    val deviceUid: String,
    val operatorUserId: String? = null,
)

data class TaskShipScanDto(
    val code: String = "",
    val qty: Double = 1.0,
    val itemCode: String? = null,
    val itemName: String? = null,
    val expiresAt: String? = null,
    val manufacturedAt: String? = null,
    val at: String? = null,
)

data class TaskPayloadDto(
    val shipScans: List<TaskShipScanDto>? = null,
)

data class FgPickPlanCodeDto(
    val code: String = "",
    val kind: String = "unit",
)

data class FgPickPlanPalletDto(
    val pickOrder: Int = 0,
    val palletId: String? = null,
    val lpn: String = "",
    val palletCode: String? = null,
    val position: Int = 0,
    val stackRole: String = "face",
    val stackLabel: String = "",
    val blockedBy: List<String> = emptyList(),
    val planRowId: String? = null,
    val zone: String? = null,
    val locationCode: String? = null,
    val bottles: Double = 0.0,
    val blocks: Int = 0,
    val manufacturedAt: String? = null,
    val expiryAt: String? = null,
    val codes: List<FgPickPlanCodeDto> = emptyList(),
)

data class FgPickPlanSuggestedDto(
    val planRowId: String? = null,
    val zone: String? = null,
    val locationCode: String? = null,
    val rowLabel: String? = null,
    val allocationStrategy: String? = null,
)

data class FgPickPlanDto(
    val enough: Boolean = false,
    val plannedQty: Double = 0.0,
    val totalAvailable: Double = 0.0,
    val shortage: Double = 0.0,
    val dateFilter: String? = null,
    val reason: String? = null,
    val suggested: FgPickPlanSuggestedDto? = null,
    val availableDates: List<String> = emptyList(),
    val pallets: List<FgPickPlanPalletDto> = emptyList(),
)

data class WmsTaskDetailTask(
    val taskId: String,
    val taskCode: String? = null,
    val taskType: String? = null,
    val taskStatus: String? = null,
    val plannedQty: Double? = null,
    val confirmedQty: Double? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val documentNo: String? = null,
    val manufacturedAt: String? = null,
    val sourceWarehouseCode: String? = null,
    val targetWarehouseCode: String? = null,
    val sourceWarehouseName: String? = null,
    val targetWarehouseName: String? = null,
    val sourceLocationCode: String? = null,
    val targetLocationCode: String? = null,
    val taskPayload: TaskPayloadDto? = null,
    val fgPickPlan: FgPickPlanDto? = null,
)

data class WmsTaskDetailResponse(
    val task: WmsTaskDetailTask? = null,
    val fgPickPlan: FgPickPlanDto? = null,
)

data class ScanTaskByDeviceRequest(
    val requestId: String,
    val siteCode: String,
    val deviceUid: String,
    val operatorUserId: String? = null,
    val code: String,
    val qty: Double? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val expiresAt: String? = null,
    val manufacturedAt: String? = null,
)

data class ScanTaskByDeviceResponse(
    val taskId: String? = null,
    val plannedQty: Double? = null,
    val scannedQty: Double? = null,
    val remainingQty: Double? = null,
    val scans: List<TaskShipScanDto>? = null,
    val error: String? = null,
    val code: String? = null,
)

data class CompleteTaskByDeviceRequest(
    val requestId: String,
    val siteCode: String,
    val deviceUid: String,
    val operatorUserId: String? = null,
    val confirmedQty: Double? = null,
    val sourceLocationCode: String? = null,
    val targetLocationCode: String? = null,
    val note: String? = null,
)

data class TaskExceptionRequest(
    val requestId: String,
    val siteCode: String,
    val deviceUid: String,
    val operatorUserId: String? = null,
    val exceptionCode: String,
    val exceptionNote: String? = null,
)

data class IdempotentWriteResponse(
    val disposition: String? = null,
    val taskId: String? = null,
    val error: String? = null,
    val code: String? = null,
)

data class LookupRequest(
    val siteCode: String,
    val query: String,
)

data class LookupItem(
    val itemCode: String,
    val barcode: String? = null,
    val name: String,
    val locationCode: String,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val quarantineQty: Double = 0.0,
    val rejectedQty: Double = 0.0,
    val accuracyStatus: String? = null,
    val locationStatus: String? = null,
)

data class LookupResponse(
    val items: List<LookupItem> = emptyList(),
)

data class ItemRow(
    val itemCode: String,
    val sku: String? = null,
    val name: String,
    val uomCode: String? = null,
    @SerializedName(value = "productGroup", alternate = ["product_group"])
    val productGroup: String? = null,
    val isMarked: Boolean = false,
    val isPerishable: Boolean = false,
    val shelfLifeDays: Int? = null,
    val expiryWarningDays: Int? = null,
    /** Ближайший срок из остатков (как на scada25 materials warehouse). */
    val nearestExpiryAt: String? = null,
    val lotManufacturedAtMin: String? = null,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
)

data class ItemsPage(
    val items: List<ItemRow> = emptyList(),
    val nextCursor: String? = null,
)

data class ItemStockByLocationRow(
    val locationCode: String = "",
    val warehouseCode: String? = null,
    val zoneCode: String? = null,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val inProductionQty: Double = 0.0,
)

data class ItemDetailItem(
    val itemCode: String? = null,
    val sku: String? = null,
    val name: String? = null,
    @SerializedName(value = "productGroup", alternate = ["product_group"])
    val productGroup: String? = null,
    @SerializedName(value = "itemGroupCode", alternate = ["item_group_code"])
    val itemGroupCode: String? = null,
    @SerializedName(value = "itemClassCode", alternate = ["item_class_code"])
    val itemClassCode: String? = null,
    @SerializedName(value = "itemClassLabel", alternate = ["item_class_label"])
    val itemClassLabel: String? = null,
)

data class ItemDetailTotals(
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
)

data class ItemDetailResponse(
    val item: ItemDetailItem? = null,
    val totals: ItemDetailTotals? = null,
    val stockByLocation: List<ItemStockByLocationRow> = emptyList(),
)

data class LocationDetailInfo(
    val locationCode: String = "",
    val displayName: String? = null,
    val warehouseCode: String? = null,
    val zoneCode: String? = null,
)

data class LocationStockLine(
    val itemCode: String = "",
    val name: String? = null,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val nearestExpiryAt: String? = null,
)

data class LocationDetailResponse(
    val location: LocationDetailInfo? = null,
    val stock: List<LocationStockLine> = emptyList(),
)

data class ManualReceivingDocumentLineRequest(
    val itemCode: String,
    val qty: Double,
    val batchLabel: String? = null,
    val emissionAt: String? = null,
    val lotExpiryAt: String? = null,
    val markingCode: String? = null,
    val comment: String? = null,
)

data class ManualReceivingDocumentRequest(
    val requestId: String,
    val siteCode: String,
    val targetLocationCode: String,
    val comment: String? = null,
    val groupCode: String? = null,
    val groupName: String? = null,
    val receiptAt: String? = null,
    val lines: List<ManualReceivingDocumentLineRequest>,
)

data class ManualReceivingDocumentResponse(
    val documentId: String,
    val documentType: String? = null,
    val lineCount: Int = 0,
    val totalQty: Double = 0.0,
    val disposition: String? = null,
)

data class TnvedNodeRow(
    val code: String,
    val name: String,
    val level: String? = null,
    val parentCode: String? = null,
    val codeFrom: String? = null,
    val codeTo: String? = null,
)

data class TnvedNodesResponse(
    val nodes: List<TnvedNodeRow> = emptyList(),
)

data class ProductGroupRow(
    val productGroup: String = "",
    val code: String? = null,
    val name: String? = null,
    val description: String? = null,
    val imageUrl: String? = null,
    val sortOrder: Int = 100,
    val isActive: Boolean = true,
    val itemCount: Int = 0,
    val withStockCount: Int = 0,
    val withActiveSpecCount: Int = 0,
    val groupDescription: String? = null,
) {
    fun effectiveCode(): String = code?.trim()?.takeIf { it.isNotEmpty() }
        ?: productGroup.trim()

    fun displayName(): String = name?.trim()?.takeIf { it.isNotEmpty() }
        ?: effectiveCode()

    fun displayDescription(): String? = description?.trim()?.takeIf { it.isNotEmpty() }
        ?: groupDescription?.trim()?.takeIf { it.isNotEmpty() }
}

data class ProductGroupsResponse(
    val groups: List<ProductGroupRow> = emptyList(),
)

data class ReceivingCategoryRow(
    val code: String = "",
    val name: String = "",
    val description: String? = null,
    val imageUrl: String? = null,
    val sortOrder: Int = 100,
    val isActive: Boolean = true,
    val linkedGroupCodes: List<String> = emptyList(),
)

data class ReceivingCategoriesResponse(
    val categories: List<ReceivingCategoryRow> = emptyList(),
    val tableMissing: Boolean? = null,
)

data class LocationRow(
    val locationCode: String,
    val displayName: String? = null,
    val warehouseCode: String,
    val zoneCode: String,
    val locationStatus: String,
    val accuracyStatus: String? = null,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val skuCount: Int = 0,
    val slotTitle: String? = null,
    val virtualPath: String? = null,
    val isWaitingPoint: Boolean = false,
    val isEmpty: Boolean = false,
    val occupiedItemCode: String? = null,
    val occupiedItemName: String? = null,
)

data class WarehouseDirectoryRow(
    val id: String? = null,
    val code: String = "",
    val name: String? = null,
    val shortName: String? = null,
    val description: String? = null,
    val status: String? = null,
    val warehouseType: String? = null,
    val isActive: Boolean = true,
)

data class WarehousesDirectoryResponse(
    val warehouses: List<WarehouseDirectoryRow> = emptyList(),
)

data class LocationsResponse(
    val locations: List<LocationRow> = emptyList(),
)

data class CreateLocationRequest(
    val siteCode: String,
    val warehouseCode: String,
    val zoneCode: String,
    val locationCode: String,
    val displayName: String,
)

data class CreateLocationResponse(
    val location: LocationRow,
)

data class StorageRecommendRequest(
    val siteCode: String,
    val itemCode: String? = null,
    val qty: Double? = null,
    val preferReceiving: Boolean? = false,
    val limit: Int? = 4,
    val lpnCode: String? = null,
    val batchCode: String? = null,
    val strategyCodes: List<String>? = null,
    val warehouseCode: String? = null,
)

data class StorageRecommendRequirementsDto(
    val itemId: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val gtin: String? = null,
    val materialType: String? = null,
    val processType: String? = null,
    val stickerShape: String? = null,
    val productGroup: String? = null,
    val volume: String? = null,
    val applicationPlace: String? = null,
    val equipment: String? = null,
)

data class StorageRecommendRowDto(
    val locationId: String? = null,
    val locationCode: String? = null,
    val displayName: String? = null,
    val zoneCode: String? = null,
    val score: Double = 0.0,
    val forbidden: Boolean = false,
    val reasons: List<String> = emptyList(),
    val availableCapacity: Double? = null,
    val currentUnits: Double = 0.0,
    val skuCount: Int = 0,
    val hasSameItem: Boolean = false,
    val hasSameGtin: Boolean = false,
)

data class StorageRecommendResponse(
    val requirements: StorageRecommendRequirementsDto? = null,
    val recommendations: List<StorageRecommendRowDto> = emptyList(),
    val itemCode: String? = null,
    val qty: Double? = null,
)

data class ImportItemRow(
    val itemCode: String,
    val name: String,
    val sku: String? = null,
    val primaryBarcode: String? = null,
    val uomCode: String? = "pcs",
)

data class ImportItemsRequest(
    val siteCode: String,
    val kind: String = "items",
    val rows: List<ImportItemRow>,
)

data class ImportItemsResponse(
    val ok: Boolean = false,
    val inserted: Int = 0,
    val updated: Int = 0,
)

data class CodeListEntryDto(
    val kind: String = "code",
    val code: String,
    val scannedAtIso: String? = null,
    val documentId: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val qty: Double? = null,
    val note: String? = null,
    val comment: String? = null,
    val stickerStatus: String? = null,
    val itemStatus: String? = null,
    val emissionAtIso: String? = null,
    val expiryState: String? = null,
)

data class CreateCodeListRequest(
    val requestId: String,
    val siteCode: String,
    val deviceUid: String,
    val listType: String = "scanner_collect",
    val entries: List<CodeListEntryDto>,
)

data class CreateCodeListResponse(
    val codeListId: String? = null,
)

data class PatchReceivingScanEventRequest(
    val siteCode: String,
    val qty: Double,
)

data class PatchReceivingScanEventResponse(
    val ok: Boolean? = null,
    val scanEventId: String? = null,
    val qty: Double? = null,
)

data class SyncReceivingSessionLine(
    val code: String,
    val qty: Double,
    val scanEventId: String? = null,
)

data class SyncReceivingSessionRequest(
    val siteCode: String,
    val documentId: String,
    val lines: List<SyncReceivingSessionLine>,
)

data class SyncReceivingSessionResponse(
    val ok: Boolean? = null,
    val updatedCount: Int? = null,
    val updatedIds: List<String>? = null,
)

data class FinalizeReceivingSessionRequest(
    val siteCode: String,
    val documentId: String,
    val deviceUid: String,
    val targetLocationCode: String? = null,
    val productGroup: String? = null,
)

data class FinalizeReceivingAggregatedLine(
    val itemCode: String? = null,
    val itemName: String? = null,
    val emissionDay: String? = null,
    val emissionAtIso: String? = null,
    val qty: Double? = null,
    val scanCount: Int? = null,
    val lotCode: String? = null,
)

data class ReceivingStockPostDto(
    val documentId: String? = null,
    val postedAtIso: String? = null,
    val locationCode: String? = null,
    val totalQty: Double? = null,
)

data class ReceivingStockPostsResponse(
    val posts: List<ReceivingStockPostDto>? = null,
)

data class FinalizeReceivingSessionResponse(
    val ok: Boolean? = null,
    val documentId: String? = null,
    val locationCode: String? = null,
    val alreadyPosted: Boolean? = null,
    val lines: List<FinalizeReceivingAggregatedLine>? = null,
    val movementsCreated: Int? = null,
    val skippedScans: List<Map<String, String>>? = null,
    val postedAtIso: String? = null,
    val error: String? = null,
    val code: String? = null,
)

data class ReceivingBatchDto(
    val batchCode: String? = null,
    val documentId: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val gtin: String? = null,
    val qty: Double? = null,
    val cellCode: String? = null,
    val emissionAtIso: String? = null,
    val expiresAtIso: String? = null,
)

data class ReceivingBatchLookupResponse(
    val batch: ReceivingBatchDto? = null,
    val documentQty: Double? = null,
    val stockAvailableQty: Double? = null,
    val stockInProductionQty: Double? = null,
    val lotCode: String? = null,
    val currentLocationCode: String? = null,
)

data class PlaceReceivingBatchRequest(
    val requestId: String,
    val siteCode: String,
    val batchCode: String,
    val targetLocationCode: String,
    val deviceUid: String,
    val overrideReason: String? = null,
    val recommendedLocationCode: String? = null,
)

data class PlaceReceivingBatchResponse(
    val documentId: String? = null,
    val batchCode: String,
    val itemCode: String? = null,
    val itemName: String? = null,
    val qty: Double = 0.0,
    val lotCode: String? = null,
    val sourceLocationCode: String,
    val targetLocationCode: String,
    val virtualPath: String? = null,
    val alreadyPlaced: Boolean = false,
    val disposition: String? = null,
)

data class IssueRecipientDto(
    val id: String? = null,
    val displayName: String? = null,
    val subtitle: String? = null,
)

data class IssueRecipientsResponse(
    val recipients: List<IssueRecipientDto>? = null,
)

data class IssueRequest(
    val requestId: String,
    val siteCode: String,
    val itemCode: String,
    val sourceLocationCode: String,
    val targetLocationCode: String,
    val qty: Double,
    val recipientName: String,
    val lineName: String? = null,
    val lotCode: String? = null,
    val emissionDay: String? = null,
    val emissionAtIso: String? = null,
)

data class IssueResponse(
    val documentId: String? = null,
    val lotCode: String? = null,
    val disposition: String? = null,
    val error: String? = null,
    val code: String? = null,
)

data class StockLotAvailabilityDto(
    val lotId: String? = null,
    val lotCode: String? = null,
    val emissionDay: String? = null,
    val emissionAtIso: String? = null,
    val availableQty: Double? = null,
    val inProductionQty: Double? = null,
)

data class StockAvailabilityResponse(
    val itemCode: String? = null,
    val itemName: String? = null,
    val locationCode: String? = null,
    val totalAvailable: Double? = null,
    val totalInProduction: Double? = null,
    val lots: List<StockLotAvailabilityDto>? = null,
    val error: String? = null,
)

data class PosPickItemDto(
    val itemCode: String,
    val itemName: String,
    val rotationPolicy: String? = null,
    val isPerishable: Boolean = false,
)

data class PosPickPlanRowDto(
    val locationCode: String,
    val locationName: String? = null,
    val warehouseCode: String? = null,
    val zoneCode: String? = null,
    val rack: String? = null,
    val shelf: String? = null,
    val address: String? = null,
    val lotId: String? = null,
    val lotCode: String? = null,
    val emissionAtIso: String? = null,
    val bestBeforeAt: String? = null,
    val expiryAt: String? = null,
    val receivedAt: String? = null,
    val availableQty: Double = 0.0,
    val takeQty: Double = 0.0,
    val selected: Boolean = false,
)

data class PosPickPlanResponse(
    val item: PosPickItemDto? = null,
    val requestedQty: Double = 0.0,
    val totalAvailable: Double = 0.0,
    val enough: Boolean = false,
    val plan: List<PosPickPlanRowDto> = emptyList(),
)

data class WorkshopPickListLineDto(
    val itemCode: String,
    val itemName: String? = null,
    val storageClass: String? = null,
    val requiredQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val availableQty: Double = 0.0,
    val needQty: Double = 0.0,
    val enough: Boolean = false,
    val suggestedLocationCode: String? = null,
    val suggestedLotCode: String? = null,
    val address: String? = null,
    val rack: String? = null,
    val shelf: String? = null,
    val zoneCode: String? = null,
    val warehouseCode: String? = null,
    val planSteps: List<PosPickPlanRowDto> = emptyList(),
)

data class WorkshopPickListDto(
    val planCode: String,
    val planId: String? = null,
    val status: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val workshopCode: String? = null,
    val lineCode: String? = null,
    val lines: List<WorkshopPickListLineDto> = emptyList(),
    val totalLines: Int = 0,
    val linesReady: Int = 0,
    val linesShortage: Int = 0,
)

data class WorkshopPickListResponse(
    val pickList: WorkshopPickListDto? = null,
)

data class PosIssueRequest(
    val requestId: String,
    val siteCode: String,
    val itemCode: String,
    val qty: Double,
    val recipientName: String,
    val targetLocationCode: String,
    val lineName: String? = null,
    val scannedSourceLocationCode: String? = null,
    val requireSourceScan: Boolean = false,
    val planCode: String? = null,
    val createAct: Boolean? = null,
)

data class PosIssueDocumentDto(
    val documentId: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val sourceLocationCode: String? = null,
    val targetLocationCode: String? = null,
    val lotCode: String? = null,
    val qty: Double = 0.0,
    val recipientName: String? = null,
    val lineName: String? = null,
)

data class PosIssueResponse(
    val itemCode: String? = null,
    val itemName: String? = null,
    val requestedQty: Double = 0.0,
    val issuedQty: Double = 0.0,
    val targetLocationCode: String? = null,
    val recipientName: String? = null,
    val lineName: String? = null,
    val documents: List<PosIssueDocumentDto> = emptyList(),
    val disposition: String? = null,
)

data class TransferConfirmRequest(
    val requestId: String,
    val siteCode: String,
    val itemCode: String,
    val fromLocationCode: String,
    val toLocationCode: String,
    val qty: Double,
    val reasonCode: String = "tsd_move",
)

data class TransferConfirmResponse(
    val ok: Boolean? = null,
    val documentId: String? = null,
    val transferId: String? = null,
    val movementId: String? = null,
    val disposition: String? = null,
    val error: String? = null,
    val code: String? = null,
)

data class ProductionConsumeRequest(
    val requestId: String,
    val siteCode: String,
    val locationCode: String,
    val itemCode: String,
    val qty: Double,
    val sourceSystem: String? = null,
    val lineCode: String? = null,
    val lotCode: String? = null,
    val operatorName: String? = null,
)

data class ProductionConsumeResponse(
    val disposition: String? = null,
    val documentId: String? = null,
    val qty: Double? = null,
    val itemCode: String? = null,
    val locationCode: String? = null,
    val error: String? = null,
    val code: String? = null,
)

data class CrptInfoRequest(
    val codes: List<String>,
)

data class CrptCisInfoDto(
    val productName: String? = null,
    val status: String? = null,
    val statusEx: String? = null,
    val gtin: String? = null,
    val cis: String? = null,
    val requestedCis: String? = null,
    val brand: String? = null,
    val expirationDate: String? = null,
    val manufacturerName: String? = null,
    val manufacturerInn: String? = null,
    val ownerName: String? = null,
    val ownerInn: String? = null,
    val producerName: String? = null,
    val productGroup: String? = null,
    val tnVedEaes: String? = null,
    val emissionDate: String? = null,
    val introducedDate: String? = null,
    val applicationDate: String? = null,
    val packageType: String? = null,
    val generalPackageType: String? = null,
    val emissionType: String? = null,
    val markWithdraw: Boolean? = null,
    val isMultipleSales: Boolean? = null,
    @SerializedName(value = "parent", alternate = ["parentCis", "parent_cis"])
    @JsonAdapter(CrptParentAdapter::class)
    val parent: String? = null,
    @JsonAdapter(CrptChildListAdapter::class)
    val child: List<String>? = null,
)

/** ЧЗ иногда отдаёт parent строкой, иногда объектом `{cis:...}`. */
class CrptParentAdapter : JsonDeserializer<String?> {
    override fun deserialize(
        json: JsonElement?,
        typeOfT: java.lang.reflect.Type?,
        context: JsonDeserializationContext?,
    ): String? {
        if (json == null || json.isJsonNull) return null
        if (json.isJsonPrimitive) return json.asString.trim().takeIf { it.isNotEmpty() }
        if (json.isJsonObject) {
            val o = json.asJsonObject
            for (key in listOf("cis", "parent", "parentCis", "code", "value")) {
                val v = o.get(key) ?: continue
                if (v.isJsonPrimitive) {
                    val s = v.asString.trim()
                    if (s.isNotEmpty()) return s
                }
            }
        }
        return null
    }
}

/** child: [".."] или [{cis:".."}] — иначе Gson валит весь cisInfo вместе с parent. */
class CrptChildListAdapter : JsonDeserializer<List<String>?> {
    override fun deserialize(
        json: JsonElement?,
        typeOfT: java.lang.reflect.Type?,
        context: JsonDeserializationContext?,
    ): List<String>? {
        if (json == null || json.isJsonNull) return null
        if (!json.isJsonArray) return null
        return json.asJsonArray.mapNotNull { el ->
            when {
                el.isJsonNull -> null
                el.isJsonPrimitive -> el.asString.trim().takeIf { it.isNotEmpty() }
                el.isJsonObject -> {
                    val o = el.asJsonObject
                    sequenceOf("cis", "code", "child", "value")
                        .mapNotNull { key -> o.get(key)?.takeIf { it.isJsonPrimitive }?.asString }
                        .firstOrNull()
                        ?.trim()
                        ?.takeIf { it.isNotEmpty() }
                }
                else -> null
            }
        }
    }
}

data class CrptInfoResponseItem(
    val cisInfo: CrptCisInfoDto? = null,
    val errorMessage: String? = null,
    val errorCode: String? = null,
)

data class ReceivingResolveScanRequest(
    val siteCode: String,
    val code: String,
    val receivingCategory: String? = null,
    val productGroup: String? = null,
)

data class ReceivingResolveItemDto(
    val itemId: String? = null,
    val itemCode: String,
    val name: String,
    val gtin: String,
    val created: Boolean = false,
    val packageRole: String? = null,
    @SerializedName(value = "productGroup", alternate = ["product_group"])
    val productGroup: String? = null,
    @SerializedName(value = "productGroupLabel", alternate = ["product_group_label"])
    val productGroupLabel: String? = null,
    @SerializedName(value = "itemClassCode", alternate = ["item_class_code"])
    val itemClassCode: String? = null,
    @SerializedName(value = "itemClassLabel", alternate = ["item_class_label"])
    val itemClassLabel: String? = null,
    val generalPackageType: String? = null,
    @SerializedName(value = "generalPackageTypeLabel", alternate = ["general_package_type_label"])
    val generalPackageTypeLabel: String? = null,
    @SerializedName(value = "imageUrl", alternate = ["image_url"])
    val imageUrl: String? = null,
)

data class ReceivingExpiryDto(
    val emissionAt: String? = null,
    val expiresAt: String? = null,
    val shelfLifeDays: Int? = null,
    val daysRemaining: Int? = null,
    val state: String? = null,
    val message: String? = null,
)

data class ReceivingResolveResponse(
    val scannedCode: String? = null,
    val normalizedCode: String? = null,
    val primaryItem: ReceivingResolveItemDto? = null,
    val nestedItem: ReceivingResolveItemDto? = null,
    val specLinked: Boolean = false,
    val specQtyPer: Int? = null,
    val crptStatus: String? = null,
    val warnings: List<String>? = null,
    val expiry: ReceivingExpiryDto? = null,
)

data class SupportSessionDto(
    val sessionId: String,
    val deviceUid: String,
    val deviceId: String? = null,
    val status: String,
    val requestedBy: String? = null,
    val requestedAt: String? = null,
    val acceptedAt: String? = null,
    val endedAt: String? = null,
    val expiresAt: String? = null,
    val currentScreen: String? = null,
    val lastHeartbeatAt: String? = null,
    val screenshotRequestedAt: String? = null,
    val latestScreenshotAt: String? = null,
    val hasScreenshot: Boolean = false,
)

data class SupportPollResponse(
    val session: SupportSessionDto? = null,
    val screenshotRequested: Boolean = false,
    val tableMissing: Boolean = false,
)

data class SupportEventInput(
    val level: String? = null,
    val eventType: String? = null,
    val message: String,
)

data class SupportDeviceRequest(
    val siteCode: String,
    val deviceUid: String,
    val sessionId: String? = null,
    val action: String,
    val accept: Boolean? = null,
    val currentScreen: String? = null,
    val events: List<SupportEventInput>? = null,
    val screenshotBase64: String? = null,
    val reason: String? = null,
)

data class SupportDeviceResponse(
    val session: SupportSessionDto? = null,
    val ok: Boolean? = null,
)

data class ProductionPlanMaterialDto(
    val planMaterialId: String,
    val itemCode: String,
    val itemName: String,
    val requiredQty: Double = 0.0,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val shortageQty: Double = 0.0,
    val uomCode: String? = null,
)

data class ProductionPlanDto(
    val planId: String,
    val code: String,
    val planDate: String,
    val planDateTo: String? = null,
    val workshopCode: String? = null,
    val lineCode: String? = null,
    val itemCode: String,
    val itemName: String,
    val plannedQty: Double = 0.0,
    val status: String,
    val shortageCount: Int = 0,
    val isFullyCovered: Boolean = false,
    val reservedAt: String? = null,
    val materials: List<ProductionPlanMaterialDto>? = null,
)

data class ProductionPlansResponse(
    val plans: List<ProductionPlanDto> = emptyList(),
)

data class ResolveItemGtinRequest(
    val siteCode: String,
    val itemCode: String,
    val assignIfMissing: Boolean = false,
)

data class ResolveItemGtinResponse(
    val itemCode: String,
    val itemName: String,
    val gtin: String,
    val article: String,
    val source: String,
)

data class GenerateInternalMarkingRequest(
    val siteCode: String,
    val itemCode: String,
    val qty: Int = 1,
    val markPrinted: Boolean = true,
    val gtin: String? = null,
    val volume: Double? = null,
    val uom: String? = null,
    val assignGtinIfMissing: Boolean = true,
)

data class InternalMarkingCodeDto(
    val codeId: String,
    val itemCode: String,
    val itemName: String,
    val gtin: String,
    val serial: String,
    val cryptoTail: String,
    val raw: String,
    val display: String,
)

data class GenerateInternalMarkingResponse(
    val codes: List<InternalMarkingCodeDto> = emptyList(),
    val gtin: String = "",
    val article: String = "",
    val batchCode: String = "",
)

interface WmsApi {
    @POST("/api/auth/login")
    suspend fun login(@Body request: AuthLoginRequest): AuthLoginResponse

    @POST("/api/wms/users/identify")
    suspend fun identifyUser(@Body request: IdentifyUserRequest): IdentifyUserResponse

    @GET("/api/wms/health")
    suspend fun health(): HealthResponse

    @POST("/api/wms/devices/register")
    suspend fun registerDevice(@Body request: RegisterDeviceRequest): RegisterDeviceResponse

    @GET("/api/wms/mobile/profile")
    suspend fun mobileProfile(
        @Query("siteCode") siteCode: String,
        @Query("deviceUid") deviceUid: String,
        @Query("operatorUserId") operatorUserId: String? = null,
    ): MobileProfileResponse

    @GET("/api/wms/devices/tasks")
    suspend fun listDeviceTasks(
        @Query("siteCode") siteCode: String,
        @Query("deviceUid") deviceUid: String,
        @Query("operatorUserId") operatorUserId: String? = null,
        @Query("status") status: String? = null,
        @Query("type") type: String? = null,
        @Query("query") query: String? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int? = null,
    ): TasksPage

    @GET("/api/wms/devices/tasks/subscribe")
    suspend fun subscribeDeviceTasks(
        @Query("siteCode") siteCode: String,
        @Query("deviceUid") deviceUid: String,
        @Query("operatorUserId") operatorUserId: String? = null,
        @Query("status") status: String? = "open",
        @Query("timeout") timeout: Int? = 45,
        @Query("limit") limit: Int? = 100,
    ): TasksSubscribeResponse

    @POST("/api/wms/devices/tasks/{id}/claim")
    suspend fun claimTaskByDevice(
        @Path("id") taskId: String,
        @Body request: DeviceTaskActionRequest,
    ): IdempotentWriteResponse

    @POST("/api/wms/devices/tasks/{id}/start")
    suspend fun startTaskByDevice(
        @Path("id") taskId: String,
        @Body request: DeviceTaskActionRequest,
    ): IdempotentWriteResponse

    @GET("/api/wms/devices/tasks/{id}")
    suspend fun getTaskDetail(
        @Path("id") taskId: String,
        @Query("siteCode") siteCode: String,
        @Query("deviceUid") deviceUid: String? = null,
        @Query("operatorUserId") operatorUserId: String? = null,
    ): WmsTaskDetailResponse

    @POST("/api/wms/devices/tasks/{id}/scan")
    suspend fun scanTaskByDevice(
        @Path("id") taskId: String,
        @Body request: ScanTaskByDeviceRequest,
    ): ScanTaskByDeviceResponse

    @POST("/api/wms/devices/tasks/{id}/complete")
    suspend fun completeTaskByDevice(
        @Path("id") taskId: String,
        @Body request: CompleteTaskByDeviceRequest,
    ): IdempotentWriteResponse

    @POST("/api/wms/devices/tasks/{id}/exception")
    suspend fun exceptionTaskByDevice(
        @Path("id") taskId: String,
        @Body request: TaskExceptionRequest,
    ): IdempotentWriteResponse

    @POST("/api/wms/lookup")
    suspend fun lookup(@Body request: LookupRequest): LookupResponse

    @GET("/api/wms/items")
    suspend fun listItems(
        @Query("siteCode") siteCode: String,
        @Query("query") query: String? = null,
        @Query("cursor") cursor: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("productGroup") productGroup: String? = null,
        @Query("productGroup") productGroups: List<String>? = null,
        @Query("bareProductGroup") bareProductGroup: String? = null,
        @Query("materialType") materialType: String? = null,
        @Query("tnvedPrefix") tnvedPrefix: String? = null,
    ): ItemsPage

    @GET("/api/wms/items/{itemCode}")
    suspend fun getItemDetail(
        @Path("itemCode") itemCode: String,
        @Query("siteCode") siteCode: String,
    ): ItemDetailResponse

    @GET("/api/wms/locations/{code}")
    suspend fun getLocationDetail(
        @Path("code") locationCode: String,
        @Query("siteCode") siteCode: String,
    ): LocationDetailResponse

    @GET("/api/wms/directories/tnved")
    suspend fun listTnvedNodes(
        @Query("parent") parent: String? = null,
        @Query("query") query: String? = null,
    ): TnvedNodesResponse

    @GET("/api/wms/directories/item-groups")
    suspend fun listProductGroups(
        @Query("siteCode") siteCode: String,
        @Query("withCounts") withCounts: String? = "1",
    ): ProductGroupsResponse

    @GET("/api/wms/directories/warehouses")
    suspend fun listWarehouses(
        @Query("siteCode") siteCode: String,
    ): WarehousesDirectoryResponse

    @GET("/api/wms/directories/receiving-categories")
    suspend fun listReceivingCategories(
        @Query("siteCode") siteCode: String,
    ): ReceivingCategoriesResponse

    @GET("/api/wms/locations")
    suspend fun listLocations(
        @Query("siteCode") siteCode: String,
        @Query("warehouseCode") warehouseCode: String? = null,
        @Query("zoneCode") zoneCode: String? = null,
        @Query("query") query: String? = null,
        @Query("workshopOnly") workshopOnly: String? = null,
    ): LocationsResponse

    @POST("/api/wms/locations")
    suspend fun createLocation(@Body request: CreateLocationRequest): CreateLocationResponse

    @POST("/api/wms/storage/recommend")
    suspend fun recommendStorageLocation(@Body request: StorageRecommendRequest): StorageRecommendResponse

    @POST("/api/wms/import")
    suspend fun importItems(@Body request: ImportItemsRequest): ImportItemsResponse

    @POST("/api/wms/devices/code-lists")
    suspend fun createCodeList(@Body request: CreateCodeListRequest): CreateCodeListResponse

    @POST("/api/wms/crpt/info")
    suspend fun crptInfo(@Body request: CrptInfoRequest): List<CrptInfoResponseItem>

    @POST("/api/wms/receiving/resolve-scan")
    suspend fun resolveReceivingScan(@Body request: ReceivingResolveScanRequest): ReceivingResolveResponse

    @PATCH("/api/wms/receiving/scan-events/{id}")
    suspend fun patchReceivingScanEvent(
        @Path("id") id: String,
        @Body request: PatchReceivingScanEventRequest,
    ): PatchReceivingScanEventResponse

    @POST("/api/wms/receiving/sync-session")
    suspend fun syncReceivingSession(@Body request: SyncReceivingSessionRequest): SyncReceivingSessionResponse

    @POST("/api/wms/receiving/finalize")
    suspend fun finalizeReceivingSession(
        @Body request: FinalizeReceivingSessionRequest,
    ): FinalizeReceivingSessionResponse

    @GET("/api/wms/receiving/stock-posts")
    suspend fun listReceivingStockPosts(
        @Query("siteCode") siteCode: String,
    ): ReceivingStockPostsResponse

    @GET("/api/wms/receiving/batch")
    suspend fun lookupReceivingBatch(
        @Query("code") code: String,
        @Query("siteCode") siteCode: String,
    ): ReceivingBatchLookupResponse

    @POST("/api/wms/receiving/batch/place")
    suspend fun placeReceivingBatch(@Body request: PlaceReceivingBatchRequest): PlaceReceivingBatchResponse

    @POST("/api/wms/receivings/manual-document")
    suspend fun postManualReceivingDocument(
        @Body request: ManualReceivingDocumentRequest,
    ): ManualReceivingDocumentResponse

    @GET("/api/wms/issues/recipients")
    suspend fun listIssueRecipients(): IssueRecipientsResponse

    @POST("/api/wms/issues")
    suspend fun submitIssue(@Body request: IssueRequest): IssueResponse

    @GET("/api/wms/stock/availability")
    suspend fun getStockAvailability(
        @Query("siteCode") siteCode: String,
        @Query("itemCode") itemCode: String,
        @Query("locationCode") locationCode: String,
    ): StockAvailabilityResponse

    @GET("/api/wms/stock/pos-pick")
    suspend fun getPosPickPlan(
        @Query("siteCode") siteCode: String,
        @Query("itemCode") itemCode: String,
        @Query("qty") qty: Double,
    ): PosPickPlanResponse

    @POST("/api/wms/stock/pos-issue")
    suspend fun submitPosIssue(@Body request: PosIssueRequest): PosIssueResponse

    @POST("/api/wms/transfers/confirm")
    suspend fun confirmTransfer(@Body request: TransferConfirmRequest): TransferConfirmResponse

    @POST("/api/wms/production/consume")
    suspend fun productionConsume(@Body request: ProductionConsumeRequest): ProductionConsumeResponse

    @GET("/api/wms/production/plans")
    suspend fun listProductionPlans(
        @Query("siteCode") siteCode: String,
        @Query("from") from: String? = null,
        @Query("to") to: String? = null,
        @Query("status") status: String? = null,
        @Query("includeMaterials") includeMaterials: String? = null,
    ): ProductionPlansResponse

    @GET("/api/wms/production/plans/{code}/pick-list")
    suspend fun getWorkshopPickList(
        @Path("code") code: String,
        @Query("siteCode") siteCode: String,
    ): WorkshopPickListResponse

    @GET("/api/wms/devices/support/poll")
    suspend fun pollSupportSession(
        @Query("siteCode") siteCode: String,
        @Query("deviceUid") deviceUid: String,
        @Query("sessionId") sessionId: String? = null,
    ): SupportPollResponse

    @POST("/api/wms/devices/support/device")
    suspend fun postSupportDevice(@Body request: SupportDeviceRequest): SupportDeviceResponse

    @POST("/api/wms/internal-marking/resolve-gtin")
    suspend fun resolveItemGtinForMarking(@Body request: ResolveItemGtinRequest): ResolveItemGtinResponse

    @POST("/api/wms/internal-marking/generate")
    suspend fun generateInternalMarkingCodes(@Body request: GenerateInternalMarkingRequest): GenerateInternalMarkingResponse

    @GET("/api/wms/lpn/nest")
    suspend fun getLpnNest(
        @Query("siteCode") siteCode: String,
        @Query("code") code: String? = null,
        @Query("locationCode") locationCode: String? = null,
    ): LpnNestResponse

    @GET("/api/wms/lpn")
    suspend fun getLpn(
        @Query("siteCode") siteCode: String,
        @Query("code") code: String,
    ): LpnResolveResponse

    @POST("/api/wms/lpn/nest")
    suspend fun postLpnNest(@Body request: LpnNestActionRequest): LpnNestResponse
}

data class LpnNestLineDto(
    val itemCode: String = "",
    val itemName: String = "",
    val qty: Double = 0.0,
    val uom: String = "pcs",
)

data class LpnNestLpnDto(
    val lpnCode: String = "",
    val loadUnitType: String = "",
    val statusCode: String = "",
    val label: String? = null,
    val targetLocationCode: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val qty: Double? = null,
)

data class LpnNestNodeDto(
    val lpn: LpnNestLpnDto = LpnNestLpnDto(),
    val parentLpnCode: String? = null,
    val children: List<LpnNestNodeDto> = emptyList(),
    val lines: List<LpnNestLineDto> = emptyList(),
)

data class LpnNestResponse(
    val tree: LpnNestNodeDto? = null,
    val roots: List<LpnNestNodeDto> = emptyList(),
    val locationCode: String? = null,
    val lpn: LpnNestLpnDto? = null,
    val error: String? = null,
)

data class LpnResolveResponse(
    val lpn: LpnNestLpnDto? = null,
    val batch: Any? = null,
    val error: String? = null,
)

data class LpnNestActionRequest(
    val siteCode: String,
    val action: String,
    val childCode: String? = null,
    val parentCode: String? = null,
    val lpnCode: String? = null,
    val locationCode: String? = null,
    val itemCode: String? = null,
    val qty: Double? = null,
    val loadUnitType: String? = null,
    val label: String? = null,
)
