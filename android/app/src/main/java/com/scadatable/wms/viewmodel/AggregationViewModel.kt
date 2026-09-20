package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.aggregation.AggregationModes
import com.scadatable.wms.data.ScanEvents
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.local.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.coroutines.ExperimentalCoroutinesApi
import java.util.UUID

enum class AggregationMode {
    BLOCK,   // Сборка блока (Единица -> Блок)
    PALLET,  // Сборка паллеты (Блок -> Паллета)
    EXTRACT  // Изъятие из паллеты
}

class AggregationViewModel(
    private val dao: WmsDao,
    private val repository: WmsRepository,
) : ViewModel() {

    private val _mode = MutableStateFlow(AggregationMode.BLOCK)
    val mode: StateFlow<AggregationMode> = _mode

    private val _currentDocumentId = MutableStateFlow<String?>(null)
    val currentDocumentId: StateFlow<String?> = _currentDocumentId

    private val _targetChildrenCount = MutableStateFlow(0)
    val targetChildrenCount: StateFlow<Int> = _targetChildrenCount

    private val _parentBarcode = MutableStateFlow<String?>(null)
    val parentBarcode: StateFlow<String?> = _parentBarcode

    init {
        viewModelScope.launch {
            ScanEvents.barcodes.collect { barcode ->
                if (!ScanEvents.isActive(ScanEvents.Consumer.AGGREGATION)) return@collect
                onBarcodeScanned(barcode)
            }
        }
    }

    val documents: StateFlow<List<AggregationDocument>> = dao.getAggregationDocuments()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val groups = _currentDocumentId.flatMapLatest { documentId ->
        if (documentId.isNullOrBlank()) flowOf(emptyList())
        else dao.getAggregationGroupsByDocument(documentId)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    @OptIn(ExperimentalCoroutinesApi::class)
    val children = combine(_currentDocumentId, _parentBarcode, _mode) { docId, barcode, mode ->
        Triple(docId, barcode, mode)
    }.flatMapLatest { (docId, barcode, mode) ->
        if (docId.isNullOrBlank() || barcode.isNullOrBlank()) {
            flowOf(emptyList())
        } else {
            dao.getAggregationLinks(docId, barcode, mode.name.lowercase())
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message

    private val _isUploading = MutableStateFlow(false)
    val isUploading: StateFlow<Boolean> = _isUploading

    fun enterSession(mode: AggregationMode) {
        _mode.value = mode
        _parentBarcode.value = null
        _targetChildrenCount.value = 0
        _message.value = when (mode) {
            AggregationMode.BLOCK -> "Создайте документ и укажите размер блока"
            AggregationMode.PALLET -> "Создайте документ и укажите блоков в паллете"
            AggregationMode.EXTRACT -> "Создайте документ, затем сканируйте паллету"
        }
    }

    fun setMode(newMode: AggregationMode) {
        _mode.value = newMode
        _parentBarcode.value = null
        _currentDocumentId.value = null
        _targetChildrenCount.value = 0
        _message.value = "Режим изменён"
    }

    /** @param targetChildrenCount сколько вложений на группу; 0 = без автозакрытия */
    fun createDocument(targetChildrenCount: Int = 0) {
        viewModelScope.launch {
            val target = targetChildrenCount.coerceAtLeast(0)
            val docId = UUID.randomUUID().toString()
            dao.insertAggregationDocument(
                AggregationDocument(
                    id = docId,
                    mode = _mode.value.name.lowercase(),
                    status = "draft",
                    targetChildrenCount = target,
                )
            )
            _currentDocumentId.value = docId
            _targetChildrenCount.value = target
            _parentBarcode.value = null
            val parent = AggregationModes.parentLabel(_mode.value)
            _message.value = if (target > 0) {
                "Документ создан · $target влож. · сканируйте $parent"
            } else {
                "Документ создан · сканируйте $parent"
            }
        }
    }

    fun openDocument(docId: String) {
        viewModelScope.launch {
            val doc = dao.getAggregationDocument(docId)
            _currentDocumentId.value = docId
            _targetChildrenCount.value = doc?.targetChildrenCount ?: 0
            _parentBarcode.value = null
            _message.value = "Документ открыт · сканируйте ${AggregationModes.parentLabel(_mode.value)}"
        }
    }

    fun openGroup(parentCode: String) {
        _parentBarcode.value = parentCode
        _message.value = "Группа открыта"
    }

    fun onBarcodeScanned(barcode: String) {
        viewModelScope.launch {
            val normalized = barcode.trim()
            if (normalized.isBlank()) return@launch
            val docId = _currentDocumentId.value
            if (docId.isNullOrBlank()) {
                _message.value = "Сначала создайте документ"
                return@launch
            }
            val modeKey = _mode.value.name.lowercase()
            val parent = _parentBarcode.value
            if (parent == null) {
                val already = groups.value.any { it.parentCode == normalized }
                if (!already) {
                    dao.insertAggregationGroup(
                        AggregationGroup(
                            documentId = docId,
                            mode = modeKey,
                            parentCode = normalized,
                        )
                    )
                }
                _parentBarcode.value = normalized
                val childHint = AggregationModes.childLabel(_mode.value)
                val target = _targetChildrenCount.value
                val currentCount = if (already) {
                    dao.countAggregationChildren(docId, normalized, modeKey)
                } else {
                    0
                }
                _message.value = if (target > 0) {
                    "${AggregationModes.parentLabel(_mode.value)} · $childHint ($currentCount/$target)"
                } else {
                    "${AggregationModes.parentLabel(_mode.value)} · $childHint"
                }
            } else {
                if (normalized == parent) {
                    _message.value = "Это код упаковки, нужен ${AggregationModes.childLabel(_mode.value).lowercase()}"
                    return@launch
                }

                val existing = children.value
                if (existing.any { it.childCode == normalized }) {
                    _message.value = "Уже в списке"
                    return@launch
                }

                val target = _targetChildrenCount.value
                if (target > 0 && existing.size >= target) {
                    _message.value = "Лимит $target — закройте или соберите заново"
                    return@launch
                }

                val action = when (_mode.value) {
                    AggregationMode.EXTRACT -> "extract"
                    else -> "add"
                }
                dao.insertAggregationLink(
                    AggregationLink(
                        documentId = docId,
                        mode = modeKey,
                        parentCode = parent,
                        childCode = normalized,
                        action = action,
                    )
                )

                val newCount = existing.size + 1
                if (target > 0 && newCount >= target) {
                    dao.closeAggregationGroup(docId, parent, modeKey, System.currentTimeMillis())
                    _parentBarcode.value = null
                    _message.value = AggregationModes.groupDoneMessage(_mode.value) +
                        " · сканируйте ${AggregationModes.parentLabel(_mode.value)}"
                } else {
                    _message.value = if (target > 0) {
                        "$newCount/$target"
                    } else {
                        "Добавлено · $newCount"
                    }
                }
            }
        }
    }

    fun closeCurrentGroup() {
        val docId = _currentDocumentId.value ?: return
        val parent = _parentBarcode.value ?: return
        viewModelScope.launch {
            val modeKey = _mode.value.name.lowercase()
            val count = dao.countAggregationChildren(docId, parent, modeKey)
            val target = _targetChildrenCount.value
            if (target > 0 && count < target) {
                _message.value = "Неполный набор: $count/$target"
                return@launch
            }
            dao.closeAggregationGroup(docId, parent, modeKey, System.currentTimeMillis())
            _parentBarcode.value = null
            _message.value = AggregationModes.groupDoneMessage(_mode.value) +
                " · сканируйте ${AggregationModes.parentLabel(_mode.value)}"
        }
    }

    fun removeChild(code: String) {
        val docId = _currentDocumentId.value ?: return
        val parent = _parentBarcode.value ?: return
        viewModelScope.launch {
            dao.deleteAggregationChild(docId, parent, code, _mode.value.name.lowercase())
            _message.value = "Удалено"
        }
    }

    fun replaceChild(oldCode: String, newCode: String) {
        val docId = _currentDocumentId.value ?: return
        val parent = _parentBarcode.value ?: return
        val normalized = newCode.trim()
        if (normalized.isBlank()) {
            _message.value = "Новый код пустой"
            return
        }
        if (normalized == parent) {
            _message.value = "Нельзя заменить на код упаковки"
            return
        }
        viewModelScope.launch {
            val modeKey = _mode.value.name.lowercase()
            dao.deleteAggregationChild(docId, parent, oldCode, modeKey)
            dao.insertAggregationLink(
                AggregationLink(
                    documentId = docId,
                    mode = modeKey,
                    parentCode = parent,
                    childCode = normalized,
                    action = "add",
                )
            )
            _message.value = "Заменено"
        }
    }

    fun verifyCode(code: String) {
        val normalized = code.trim()
        if (normalized.isBlank()) {
            _message.value = "Введите код"
            return
        }
        val exists = children.value.any { it.childCode == normalized }
        _message.value = if (exists) "Найден" else "Не найден"
    }

    fun disbandCurrentGroup() {
        val docId = _currentDocumentId.value ?: return
        val parent = _parentBarcode.value ?: return
        viewModelScope.launch {
            val modeKey = _mode.value.name.lowercase()
            dao.clearAggregationGroup(docId, parent, modeKey)
            dao.deleteAggregationGroup(docId, parent, modeKey)
            _parentBarcode.value = null
            _message.value = "Расформировано · сканируйте ${AggregationModes.parentLabel(_mode.value)}"
        }
    }

    fun closeDocument() {
        val docId = _currentDocumentId.value ?: return
        viewModelScope.launch {
            dao.closeAggregationDocument(docId)
            _parentBarcode.value = null
            _currentDocumentId.value = null
            _targetChildrenCount.value = 0
            _message.value = "Документ закрыт"
        }
    }

    fun uploadCurrentDocument() {
        val docId = _currentDocumentId.value ?: return
        viewModelScope.launch {
            _isUploading.value = true
            val links = dao.getAggregationLinksForUpload(docId)
            if (links.isEmpty()) {
                _message.value = "Документ пуст"
                _isUploading.value = false
                return@launch
            }
            val res = repository.uploadAggregationDocument(
                documentId = docId,
                mode = _mode.value.name.lowercase(),
                entries = links.map {
                    WmsRepository.AggregationUploadEntry(
                        parentCode = it.parentCode,
                        childCode = it.childCode,
                        action = it.action,
                        mode = it.mode,
                    )
                }
            )
            _isUploading.value = false
            if (res.isSuccess) {
                dao.markAggregationDocumentUploaded(docId, res.getOrNull())
                _message.value = "Выгружено"
            } else {
                _message.value = res.exceptionOrNull()?.message ?: "Ошибка выгрузки"
            }
        }
    }

    fun reset() {
        _parentBarcode.value = null
        _message.value = "Сканируйте ${AggregationModes.parentLabel(_mode.value)}"
    }
}
