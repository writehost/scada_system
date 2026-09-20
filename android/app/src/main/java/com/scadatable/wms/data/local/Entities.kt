package com.scadatable.wms.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "warehouses")
data class Warehouse(
    @PrimaryKey val id: String,
    val name: String
)

@Entity(tableName = "cells")
data class Cell(
    @PrimaryKey val id: String,
    val warehouseId: String,
    val name: String
)

@Entity(tableName = "products")
data class Product(
    @PrimaryKey val barcode: String,
    val name: String,
    val sku: String,
    val unit: String,
    val groupGtin: String? = null, // GTIN групповой упаковки
    val itemsInGroup: Int = 1,     // Сколько штук в упаковке (6, 12 и т.д.)
    val productGroup: String? = null,
    val availableQty: Double = 0.0,
    val reservedQty: Double = 0.0,
    val isMarked: Boolean = false,
)

@Entity(tableName = "aggregations")
data class Aggregation(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val parentBarcode: String, // Код упаковки (Блок)
    val childBarcode: String,  // Код единицы (Бутылка)
    val timestamp: Long = System.currentTimeMillis(),
    val isSynced: Boolean = false
)

@Entity(tableName = "aggregation_documents")
data class AggregationDocument(
    @PrimaryKey val id: String,
    val mode: String, // block | pallet | extract
    val status: String = "draft", // draft | closed | uploaded
    /** Сколько вложений в одну группу (блок/паллету). 0 = без лимита (ручное закрытие). */
    val targetChildrenCount: Int = 0,
    val createdAt: Long = System.currentTimeMillis(),
    val closedAt: Long? = null,
    val uploadedCodeListId: String? = null,
)

@Entity(tableName = "aggregation_groups")
data class AggregationGroup(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val documentId: String,
    val mode: String,
    val parentCode: String,
    val createdAt: Long = System.currentTimeMillis(),
    val closedAt: Long? = null,
)

@Entity(tableName = "aggregation_links")
data class AggregationLink(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val documentId: String,
    val mode: String,
    val parentCode: String,
    val childCode: String,
    val action: String = "add", // add | extract
    val createdAt: Long = System.currentTimeMillis(),
)

data class AggregationGroupSummary(
    val id: Long,
    val documentId: String,
    val mode: String,
    val parentCode: String,
    val createdAt: Long,
    val closedAt: Long? = null,
    val itemsCount: Int,
)

@Entity(tableName = "receiving_documents")
data class ReceivingDocument(
    @PrimaryKey val id: String,
    val date: Long = System.currentTimeMillis(),
    val status: String = com.scadatable.wms.receiving.ReceivingDocumentStatus.ACTIVE,
    val warehouseId: String? = null,
    val productGroup: String? = null,
    val targetLocationCode: String? = null,
)

@Entity(tableName = "receiving_items")
data class ReceivingItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val documentId: String,
    val productBarcode: String,
    val quantity: Double,
    val cellId: String? = null,
    val scannedCode: String? = null,
    val resolvedGtin: String? = null,
    val status: String = "эммитирован",
    val emissionAt: Long? = null,
    val serverScanEventId: String? = null,
    val batchCode: String? = null,
)

data class ReceivingItemView(
    val id: Long,
    val documentId: String,
    val productBarcode: String,
    val productName: String,
    val quantity: Double,
    val cellId: String? = null,
    val scannedCode: String? = null,
    val resolvedGtin: String? = null,
    val status: String = "эммитирован",
    val emissionAt: Long? = null,
    val batchCode: String? = null,
)

@Entity(tableName = "collect_scan_documents")
data class CollectScanDocument(
    @PrimaryKey val id: String, // UUID requestId
    val createdAt: Long = System.currentTimeMillis(),
    val serverCodeListId: String? = null,
)

@Entity(tableName = "collect_scan_items")
data class CollectScanItem(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val documentId: String,
    val code: String,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "movement_documents")
data class MovementDocument(
    @PrimaryKey val id: String,
    val date: Long = System.currentTimeMillis(),
    val productBarcode: String,
    val fromCellId: String,
    val toCellId: String,
    val quantity: Double
)

@Entity(tableName = "issue_documents")
data class IssueDocument(
    @PrimaryKey val id: String,
    val date: Long = System.currentTimeMillis(),
    val productBarcode: String,
    val recipient: String,
    val quantity: Double
)

@Entity(tableName = "inventory_documents")
data class InventoryDocument(
    @PrimaryKey val id: String,
    val date: Long = System.currentTimeMillis(),
    val warehouseId: String,
    val cellId: String? = null
)

@Entity(tableName = "barcode_scans")
data class BarcodeScan(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val barcode: String,
    val timestamp: Long = System.currentTimeMillis(),
    val type: String // e.g., "GENERAL", "RECEIVING", "MOVEMENT"
)

@Entity(tableName = "task_cache")
data class TaskCache(
    @PrimaryKey val taskId: String,
    val taskCode: String,
    val taskType: String,
    val taskStatus: String,
    val priorityCode: String? = null,
    val itemCode: String? = null,
    val itemName: String? = null,
    val sourceLocationCode: String? = null,
    val targetLocationCode: String? = null,
    val plannedQty: Double? = null,
    val confirmedQty: Double? = null,
    val dueAt: String? = null,
    val claimedAt: String? = null,
    val startedAt: String? = null,
    val completedAt: String? = null,
    val exceptionCode: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "sync_state")
data class SyncState(
    @PrimaryKey val key: String,
    val value: String,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "task_action_outbox")
data class TaskActionOutbox(
    @PrimaryKey val requestId: String,
    val taskId: String,
    val action: String, // claim | start | complete | exception
    val siteCode: String,
    val deviceUid: String,
    val operatorUserId: String? = null,
    val confirmedQty: Double? = null,
    val targetLocationCode: String? = null,
    val note: String? = null,
    val exceptionCode: String? = null,
    val exceptionNote: String? = null,
    val attemptCount: Int = 0,
    val lastError: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "nomenclature_outbox")
data class NomenclatureOutbox(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val barcode: String,
    val name: String,
    val sku: String,
    val uomCode: String = "pcs",
    val createdAt: Long = System.currentTimeMillis(),
)
