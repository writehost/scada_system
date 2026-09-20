package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.remote.CrptCisInfoDto
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.data.local.BarcodeScan
import com.scadatable.wms.data.local.WmsDao
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class ScannerViewModel(
    private val dao: WmsDao,
    private val repository: WmsRepository,
) : ViewModel() {

    private val _scanResult = MutableStateFlow<ScanStatus>(ScanStatus.Idle)
    val scanResult: StateFlow<ScanStatus> = _scanResult
    private val _scanMode = MutableStateFlow(ScanHandlingMode.INFO)

    val recentScans = dao.getRecentScans().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    val collectDocuments = dao.getCollectScanDocuments()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    private val _collectDocumentId = MutableStateFlow<String?>(null)
    val collectDocumentId: StateFlow<String?> = _collectDocumentId.asStateFlow()
    @OptIn(ExperimentalCoroutinesApi::class)
    val collectItems = _collectDocumentId.flatMapLatest { docId ->
        if (docId.isNullOrBlank()) flowOf(emptyList()) else dao.watchCollectScanItems(docId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())
    private val _receivingDocumentId = MutableStateFlow<String?>(null)
    val receivingDocumentId: StateFlow<String?> = _receivingDocumentId.asStateFlow()

    init {
        viewModelScope.launch {
            _collectDocumentId.value = repository.getActiveCollectDocId()
            _receivingDocumentId.value = repository.getActiveReceivingDocId()
        }
        viewModelScope.launch {
            ScanEvents.barcodes.collect { barcode ->
                if (!ScanEvents.isActive(ScanEvents.Consumer.SCANNER)) return@collect
                onBarcodeScanned(barcode, _scanMode.value)
            }
        }
    }

    fun setScanMode(mode: ScanHandlingMode) {
        _scanMode.value = mode
    }

    fun onBarcodeScanned(barcode: String, mode: ScanHandlingMode = _scanMode.value) {
        val normalized = barcode.trim()
        if (normalized.isBlank()) return

        viewModelScope.launch {
            try {
                _scanResult.value = ScanStatus.Loading(normalized)
                when (mode) {
                    ScanHandlingMode.INFO -> {
                        val crpt = repository.fetchCrptInfo(normalized)
                        if (crpt.isSuccess) {
                            val (sentCode, items) = crpt.getOrThrow()
                            _scanResult.value = ScanStatus.CrptSuccess(
                                scannedCode = normalized,
                                normalizedCode = sentCode,
                                items = items,
                            )
                        } else {
                            _scanResult.value = ScanStatus.Error(
                                crpt.exceptionOrNull()?.message ?: "Не удалось получить данные из ЧЗ"
                            )
                        }
                        dao.insertScan(BarcodeScan(barcode = normalized, type = "CRPT_INFO"))
                    }
                    ScanHandlingMode.CELL -> {
                        // Обрабатывается CellModeViewModel из ScanScreen.
                        _scanResult.value = ScanStatus.Idle
                    }
                    ScanHandlingMode.COLLECT -> {
                        val appended = repository.addScanToCollectList(normalized)
                        if (appended.isFailure) {
                            _scanResult.value = ScanStatus.Error(
                                appended.exceptionOrNull()?.message ?: "Не удалось добавить в список"
                            )
                            return@launch
                        }
                        val collect = appended.getOrThrow()
                        _collectDocumentId.value = collect.documentId
                        val product = dao.getProductByBarcode(normalized)
                        val subtitle = buildString {
                            append("Список ${collect.documentId.take(8).uppercase()} · ${collect.totalCodes} код.")
                            if (!collect.syncWarning.isNullOrBlank()) {
                                append(" · не синхронизирован")
                            }
                        }
                        _scanResult.value = ScanStatus.Success(
                            barcode = normalized,
                            title = product?.name ?: normalized,
                            documentId = collect.documentId,
                            subtitle = subtitle,
                            secondaryNote = collect.syncWarning,
                        )
                        dao.insertScan(BarcodeScan(barcode = normalized, type = "COLLECT"))
                    }
                }
            } catch (e: Exception) {
                _scanResult.value = ScanStatus.Error("Ошибка поиска/базы данных")
            }
        }
    }

    fun startNewCollectDocument() {
        viewModelScope.launch {
            repository.startNewCollectDocument()
            _collectDocumentId.value = null
            _scanResult.value = ScanStatus.Idle
        }
    }

    fun openCollectDocument(documentId: String) {
        viewModelScope.launch {
            repository.setActiveCollectDocId(documentId)
            _collectDocumentId.value = documentId
            _scanResult.value = ScanStatus.Idle
        }
    }

    fun startNewReceivingDocument() {
        viewModelScope.launch {
            val id = repository.startNewReceivingDocument()
            _receivingDocumentId.value = id
        }
    }

    fun clearStatus() {
        _scanResult.value = ScanStatus.Idle
    }
}

sealed class ScanStatus {
    object Idle : ScanStatus()
    data class Loading(val scannedCode: String) : ScanStatus()
    data class Success(
        val barcode: String,
        val title: String,
        val documentId: String? = null,
        val resolvedGtin: String? = null,
        val itemStatus: String? = null,
        val stickerStatus: String? = null,
        val nestedItemName: String? = null,
        val secondaryNote: String? = null,
        val subtitle: String? = null,
        val expiryState: String? = null,
        val expiryMessage: String? = null,
        val isExpired: Boolean = false,
    ) : ScanStatus()
    data class CrptSuccess(
        val scannedCode: String,
        val normalizedCode: String,
        val items: List<CrptCisInfoDto>,
    ) : ScanStatus()
    data class Error(val message: String) : ScanStatus()
}

enum class ScanHandlingMode {
    INFO, CELL, COLLECT
}

class ScannerViewModelFactory(
    private val dao: WmsDao,
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ScannerViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return ScannerViewModel(dao, repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
