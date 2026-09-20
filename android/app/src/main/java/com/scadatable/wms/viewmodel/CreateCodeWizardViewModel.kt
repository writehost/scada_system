package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.GenerateInternalMarkingResponse
import com.scadatable.wms.data.remote.InternalMarkingCodeDto
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.ResolveItemGtinResponse
import com.scadatable.wms.receiving.ReceivingStickerPayload
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class CreateCodeStep {
    ITEM,
    PARAMS,
    RESULT,
}

enum class MarkingUom(val apiValue: String, val label: String) {
    PCS("pcs", "шт"),
    L("l", "л"),
}

data class CreateCodeWizardUiState(
    val step: CreateCodeStep = CreateCodeStep.ITEM,
    val searchQuery: String = "",
    val items: List<ItemRow> = emptyList(),
    val itemsLoading: Boolean = false,
    val itemsError: String? = null,
    val selectedItem: ItemRow? = null,
    val gtinInfo: ResolveItemGtinResponse? = null,
    val gtinLoading: Boolean = false,
    val volumeInput: String = "1",
    val uom: MarkingUom = MarkingUom.PCS,
    val generating: Boolean = false,
    val generateError: String? = null,
    val result: GenerateInternalMarkingResponse? = null,
    val printed: Boolean = false,
)

class CreateCodeWizardViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(CreateCodeWizardUiState())
    val uiState: StateFlow<CreateCodeWizardUiState> = _uiState.asStateFlow()

    private val _printSticker = MutableSharedFlow<ReceivingStickerPayload>(extraBufferCapacity = 2)
    val printSticker: SharedFlow<ReceivingStickerPayload> = _printSticker.asSharedFlow()

    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val events: SharedFlow<String> = _events.asSharedFlow()

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun loadItems() {
        val query = _uiState.value.searchQuery.trim()
        viewModelScope.launch {
            _uiState.update { it.copy(itemsLoading = true, itemsError = null) }
            repository.fetchItemsPage(query = query.takeIf { it.length >= 2 }, limit = 80)
                .onSuccess { page ->
                    _uiState.update {
                        it.copy(items = page.items, itemsLoading = false, itemsError = null)
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(
                            itemsLoading = false,
                            itemsError = err.message ?: "Не удалось загрузить номенклатуру",
                        )
                    }
                }
        }
    }

    fun selectItem(item: ItemRow) {
        _uiState.update { it.copy(selectedItem = item) }
    }

    fun setVolumeInput(value: String) {
        _uiState.update { it.copy(volumeInput = value) }
    }

    fun setUom(uom: MarkingUom) {
        _uiState.update { it.copy(uom = uom) }
    }

    fun goBack(): Boolean {
        val step = _uiState.value.step
        return when (step) {
            CreateCodeStep.ITEM -> false
            CreateCodeStep.PARAMS -> {
                _uiState.update { it.copy(step = CreateCodeStep.ITEM, gtinInfo = null, generateError = null) }
                true
            }
            CreateCodeStep.RESULT -> {
                _uiState.update {
                    it.copy(step = CreateCodeStep.PARAMS, result = null, printed = false, generateError = null)
                }
                true
            }
        }
    }

    fun proceedFromItem() {
        val item = _uiState.value.selectedItem ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(gtinLoading = true, gtinInfo = null, generateError = null) }
            repository.resolveItemGtinForMarking(item.itemCode, assignIfMissing = true)
                .onSuccess { info ->
                    _uiState.update {
                        it.copy(
                            step = CreateCodeStep.PARAMS,
                            gtinInfo = info,
                            gtinLoading = false,
                        )
                    }
                }
                .onFailure { err ->
                    _uiState.update {
                        it.copy(
                            gtinLoading = false,
                            generateError = err.message ?: "Не удалось определить GTIN",
                        )
                    }
                }
        }
    }

    fun generateCode() {
        val state = _uiState.value
        val item = state.selectedItem ?: return
        val volume = state.volumeInput.trim().replace(',', '.').toDoubleOrNull()
        if (volume == null || volume <= 0.0) {
            _uiState.update { it.copy(generateError = "Укажите объём больше нуля") }
            return
        }

        viewModelScope.launch {
            _uiState.update { it.copy(generating = true, generateError = null) }
            repository.generateInternalMarkingCodes(
                itemCode = item.itemCode,
                volume = volume,
                uom = state.uom.apiValue,
                gtin = state.gtinInfo?.gtin,
            ).onSuccess { response ->
                if (response.codes.isEmpty()) {
                    _uiState.update {
                        it.copy(
                            generating = false,
                            generateError = "Сервер не вернул код маркировки",
                        )
                    }
                    return@launch
                }
                _uiState.update {
                    it.copy(
                        step = CreateCodeStep.RESULT,
                        generating = false,
                        result = response,
                        printed = false,
                    )
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        generating = false,
                        generateError = err.message ?: "Ошибка генерации кода",
                    )
                }
            }
        }
    }

    fun printLabel() {
        val state = _uiState.value
        val item = state.selectedItem ?: return
        val result = state.result ?: return
        val code = result.codes.firstOrNull() ?: return
        val volume = state.volumeInput.trim().replace(',', '.').toDoubleOrNull() ?: 1.0

        viewModelScope.launch {
            val baseUrl = repository.getReceivingBaseUrl().trimEnd('/')
            val siteCode = repository.getSiteCode()
            val cellCode = repository.getReceivingTargetLocationCode()
            val batchCode = result.batchCode.ifBlank { "MK-${System.currentTimeMillis()}" }
            val qrUrl = com.scadatable.wms.print.WmsLabelQr.buildPayload(
                baseUrl = baseUrl,
                siteCode = siteCode,
                batchCode = batchCode,
                cellCode = cellCode,
                itemCode = item.itemCode,
                gtin = result.gtin.ifBlank { code.gtin },
                qty = volume,
            )
            val payload = ReceivingStickerPayload(
                batchCode = batchCode,
                itemName = item.name,
                scannedCode = code.raw,
                gtin = result.gtin.ifBlank { code.gtin },
                qty = volume,
                emissionAt = System.currentTimeMillis(),
                expiresAt = null,
                shelfLifeDays = null,
                cellCode = cellCode,
                qrUrl = qrUrl,
                productGroupLabel = item.productGroup,
            )
            _printSticker.emit(payload)
            _uiState.update { it.copy(printed = true) }
            _events.emit("Предпросмотр этикетки готов")
        }
    }

    fun primaryCode(): InternalMarkingCodeDto? = _uiState.value.result?.codes?.firstOrNull()
}

class CreateCodeWizardViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(CreateCodeWizardViewModel::class.java)) {
            return CreateCodeWizardViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel: ${modelClass.name}")
    }
}
