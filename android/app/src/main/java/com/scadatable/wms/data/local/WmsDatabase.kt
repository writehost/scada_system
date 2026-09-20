package com.scadatable.wms.data.local

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        Warehouse::class, Cell::class, Product::class, BarcodeScan::class,
        ReceivingDocument::class, ReceivingItem::class, MovementDocument::class,
        IssueDocument::class, InventoryDocument::class, Aggregation::class,
        TaskCache::class, SyncState::class, TaskActionOutbox::class, NomenclatureOutbox::class,
        CollectScanDocument::class, CollectScanItem::class,
        AggregationDocument::class, AggregationGroup::class, AggregationLink::class
    ],
    version = 18,
    exportSchema = false
)
abstract class WmsDatabase : RoomDatabase() {
    abstract fun wmsDao(): WmsDao

    companion object {
        @Volatile
        private var INSTANCE: WmsDatabase? = null

        fun getDatabase(context: Context): WmsDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    WmsDatabase::class.java,
                    "wms_database"
                )
                .fallbackToDestructiveMigration(true)
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
