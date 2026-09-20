package com.scadatable.wms.data.local

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface WmsDao {
    @Query("SELECT * FROM products WHERE barcode = :barcode")
    suspend fun getProductByBarcode(barcode: String): Product?

    @Query("SELECT * FROM products WHERE groupGtin = :gtin OR barcode = :gtin LIMIT 1")
    suspend fun getProductByGtin(gtin: String): Product?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProduct(product: Product)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertProducts(products: List<Product>)

    @Query("DELETE FROM products")
    suspend fun clearProducts()

    @Query("SELECT * FROM products ORDER BY name")
    fun getAllProducts(): Flow<List<Product>>

    @Query("SELECT * FROM warehouses")
    fun getAllWarehouses(): Flow<List<Warehouse>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWarehouse(warehouse: Warehouse)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWarehouses(warehouses: List<Warehouse>)

    @Query("SELECT * FROM cells WHERE warehouseId = :warehouseId")
    fun getCellsByWarehouse(warehouseId: String): Flow<List<Cell>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCell(cell: Cell)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCells(cells: List<Cell>)

    @Query("SELECT * FROM cells")
    fun getAllCells(): Flow<List<Cell>>

    // Receiving
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReceivingDocument(doc: ReceivingDocument)

    @Query("SELECT * FROM receiving_documents ORDER BY date DESC")
    fun getReceivingDocuments(): Flow<List<ReceivingDocument>>

    @Query("SELECT * FROM receiving_documents WHERE productGroup = :group ORDER BY date DESC")
    fun getReceivingDocumentsByGroup(group: String): Flow<List<ReceivingDocument>>

    @Query("SELECT * FROM receiving_documents WHERE id = :docId LIMIT 1")
    suspend fun getReceivingDocumentById(docId: String): ReceivingDocument?

    @Query("UPDATE receiving_documents SET status = :status WHERE id = :docId")
    suspend fun updateReceivingDocumentStatus(docId: String, status: String)

    @Query("UPDATE receiving_documents SET productGroup = :productGroup WHERE id = :docId")
    suspend fun updateReceivingDocumentProductGroup(docId: String, productGroup: String?)

    @Query(
        """
        UPDATE receiving_documents
        SET warehouseId = :warehouseId,
            targetLocationCode = :targetLocationCode,
            productGroup = :productGroup
        WHERE id = :docId
        """
    )
    suspend fun updateReceivingDocumentSetup(
        docId: String,
        warehouseId: String?,
        targetLocationCode: String?,
        productGroup: String?,
    )

    @Query(
        """
        UPDATE receiving_documents
        SET status = :pausedStatus
        WHERE status = :activeStatus AND id != :exceptId
        """
    )
    suspend fun pauseOtherActiveDocuments(
        exceptId: String,
        activeStatus: String = com.scadatable.wms.receiving.ReceivingDocumentStatus.ACTIVE,
        pausedStatus: String = com.scadatable.wms.receiving.ReceivingDocumentStatus.PAUSED,
    )

    @Query("UPDATE receiving_items SET batchCode = :batchCode WHERE id = :itemId")
    suspend fun updateReceivingItemBatchCode(itemId: Long, batchCode: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertReceivingItem(item: ReceivingItem): Long

    @Query("SELECT * FROM receiving_items WHERE id = :itemId LIMIT 1")
    suspend fun getReceivingItemById(itemId: Long): ReceivingItem?

    @Query("SELECT * FROM receiving_items WHERE documentId = :docId")
    suspend fun getReceivingItemsOnce(docId: String): List<ReceivingItem>

    @Query("SELECT COUNT(*) FROM receiving_items WHERE documentId = :docId")
    suspend fun countReceivingItems(docId: String): Int

    @Query("UPDATE receiving_items SET serverScanEventId = :scanEventId WHERE id = :itemId")
    suspend fun updateReceivingItemScanEventId(itemId: Long, scanEventId: String)

    @Query(
        """
        SELECT
          r.id AS id,
          r.documentId AS documentId,
          r.productBarcode AS productBarcode,
          COALESCE(p.name, r.productBarcode) AS productName,
          r.quantity AS quantity,
          r.cellId AS cellId,
          r.scannedCode AS scannedCode,
          r.resolvedGtin AS resolvedGtin,
          r.status AS status,
          r.emissionAt AS emissionAt,
          r.batchCode AS batchCode
        FROM receiving_items r
        LEFT JOIN products p ON p.barcode = r.productBarcode
        WHERE r.documentId = :docId
        ORDER BY r.id DESC
        """
    )
    fun getReceivingItems(docId: String): Flow<List<ReceivingItemView>>

    @Query("DELETE FROM receiving_items WHERE documentId = :docId")
    suspend fun deleteReceivingItemsByDocument(docId: String)

    @Query("DELETE FROM receiving_items WHERE id = :itemId")
    suspend fun deleteReceivingItemById(itemId: Long)

    @Query("UPDATE receiving_items SET quantity = :quantity WHERE id = :itemId")
    suspend fun updateReceivingItemQuantity(itemId: Long, quantity: Double)

    @Query("UPDATE receiving_items SET status = :status, emissionAt = :emissionAt WHERE id IN (:itemIds)")
    suspend fun markReceivingItemsPrinted(itemIds: List<Long>, status: String, emissionAt: Long)

    @Query("DELETE FROM receiving_documents WHERE id = :docId")
    suspend fun deleteReceivingDocumentById(docId: String)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCollectScanDocument(doc: CollectScanDocument)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertCollectScanItem(item: CollectScanItem)

    @Query("SELECT * FROM collect_scan_items WHERE documentId = :docId ORDER BY id ASC")
    suspend fun listCollectScanItems(docId: String): List<CollectScanItem>

    @Query("SELECT * FROM collect_scan_items WHERE documentId = :docId ORDER BY id ASC")
    fun watchCollectScanItems(docId: String): Flow<List<CollectScanItem>>

    @Query("SELECT * FROM collect_scan_documents ORDER BY createdAt DESC")
    fun getCollectScanDocuments(): Flow<List<CollectScanDocument>>

    // Aggregation
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAggregation(aggregation: Aggregation)

    @Query("SELECT * FROM aggregations WHERE parentBarcode = :parentBarcode")
    fun getChildrenForParent(parentBarcode: String): Flow<List<Aggregation>>

    @Query("SELECT COUNT(*) FROM aggregations WHERE parentBarcode = :parentBarcode")
    suspend fun getAggregationCount(parentBarcode: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAggregationDocument(doc: AggregationDocument)

    @Query("SELECT * FROM aggregation_documents ORDER BY createdAt DESC")
    fun getAggregationDocuments(): Flow<List<AggregationDocument>>

    @Query("SELECT * FROM aggregation_documents WHERE id = :documentId LIMIT 1")
    suspend fun getAggregationDocument(documentId: String): AggregationDocument?

    @Query("SELECT COUNT(*) FROM aggregation_links WHERE documentId = :documentId AND parentCode = :parentCode AND mode = :mode AND action IN ('add', 'extract')")
    suspend fun countAggregationChildren(documentId: String, parentCode: String, mode: String): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAggregationGroup(group: AggregationGroup): Long

    @Query(
        """
        SELECT
          g.id AS id,
          g.documentId AS documentId,
          g.mode AS mode,
          g.parentCode AS parentCode,
          g.createdAt AS createdAt,
          g.closedAt AS closedAt,
          COUNT(l.id) AS itemsCount
        FROM aggregation_groups g
        LEFT JOIN aggregation_links l
          ON l.documentId = g.documentId
         AND l.parentCode = g.parentCode
         AND l.mode = g.mode
         AND l.action IN ('add', 'extract')
        WHERE g.documentId = :documentId
        GROUP BY g.id
        ORDER BY g.createdAt DESC
        """
    )
    fun getAggregationGroupsByDocument(documentId: String): Flow<List<AggregationGroupSummary>>

    @Query(
        "SELECT * FROM aggregation_links WHERE documentId = :documentId AND parentCode = :parentCode AND mode = :mode ORDER BY createdAt DESC"
    )
    fun getAggregationLinks(documentId: String, parentCode: String, mode: String): Flow<List<AggregationLink>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAggregationLink(link: AggregationLink)

    @Query(
        "DELETE FROM aggregation_links WHERE documentId = :documentId AND parentCode = :parentCode AND childCode = :childCode AND mode = :mode"
    )
    suspend fun deleteAggregationChild(documentId: String, parentCode: String, childCode: String, mode: String)

    @Query("DELETE FROM aggregation_links WHERE documentId = :documentId AND parentCode = :parentCode AND mode = :mode")
    suspend fun clearAggregationGroup(documentId: String, parentCode: String, mode: String)

    @Query("DELETE FROM aggregation_groups WHERE documentId = :documentId AND parentCode = :parentCode AND mode = :mode")
    suspend fun deleteAggregationGroup(documentId: String, parentCode: String, mode: String)

    @Query("UPDATE aggregation_groups SET closedAt = :closedAt WHERE documentId = :documentId AND parentCode = :parentCode AND mode = :mode")
    suspend fun closeAggregationGroup(documentId: String, parentCode: String, mode: String, closedAt: Long)

    @Query("UPDATE aggregation_documents SET status = :status, closedAt = :closedAt WHERE id = :documentId")
    suspend fun closeAggregationDocument(documentId: String, status: String = "closed", closedAt: Long = System.currentTimeMillis())

    @Query("UPDATE aggregation_documents SET status = 'uploaded', uploadedCodeListId = :codeListId, closedAt = :closedAt WHERE id = :documentId")
    suspend fun markAggregationDocumentUploaded(documentId: String, codeListId: String?, closedAt: Long = System.currentTimeMillis())

    @Query("SELECT * FROM aggregation_links WHERE documentId = :documentId ORDER BY id ASC")
    suspend fun getAggregationLinksForUpload(documentId: String): List<AggregationLink>

    // Scans
    @Insert
    suspend fun insertScan(scan: BarcodeScan)

    @Query("SELECT * FROM barcode_scans ORDER BY timestamp DESC LIMIT 100")
    fun getRecentScans(): Flow<List<BarcodeScan>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertTasks(tasks: List<TaskCache>)

    @Query("SELECT * FROM task_cache ORDER BY updatedAt DESC")
    fun getCachedTasks(): Flow<List<TaskCache>>

    @Query("DELETE FROM task_cache")
    suspend fun clearTaskCache()

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertSyncState(state: SyncState)

    @Query("SELECT * FROM sync_state WHERE `key` = :key LIMIT 1")
    suspend fun getSyncState(key: String): SyncState?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueueTaskAction(action: TaskActionOutbox)

    @Query("SELECT * FROM task_action_outbox ORDER BY createdAt ASC")
    suspend fun listPendingTaskActions(): List<TaskActionOutbox>

    @Query("DELETE FROM task_action_outbox WHERE requestId = :requestId")
    suspend fun deleteTaskAction(requestId: String)

    @Query(
        "UPDATE task_action_outbox SET attemptCount = :attemptCount, lastError = :lastError, updatedAt = :updatedAt WHERE requestId = :requestId"
    )
    suspend fun updateTaskActionAttempt(
        requestId: String,
        attemptCount: Int,
        lastError: String?,
        updatedAt: Long = System.currentTimeMillis(),
    )

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun enqueueNomenclature(outbox: NomenclatureOutbox)

    @Query("SELECT * FROM nomenclature_outbox ORDER BY createdAt ASC")
    suspend fun listNomenclatureOutbox(): List<NomenclatureOutbox>

    @Query("DELETE FROM nomenclature_outbox WHERE id = :id")
    suspend fun deleteNomenclatureOutbox(id: Long)
}
