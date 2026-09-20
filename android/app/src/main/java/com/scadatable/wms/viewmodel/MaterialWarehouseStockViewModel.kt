package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ItemDetailResponse
import com.scadatable.wms.data.remote.ItemRow
import com.scadatable.wms.data.remote.ItemStockByLocationRow
import com.scadatable.wms.data.remote.LocationDetailResponse
import com.scadatable.wms.warehouse.MaterialWarehouseGroups
import com.scadatable.wms.warehouse.WarehouseKind
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class MaterialStockSort {
    NAME,
    QTY_DESC,
    IN_STOCK_FIRST,
}

data class MaterialWarehouseStockUiState(
    val items: List<ItemRow> = emptyList(),
    val displayedItems: List<ItemRow> = emptyList(),
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val error: String? = null,
    val nextCursor: String? = null,
    val query: String = "",
    val totalAvailable: Double = 0.0,
    val sort: MaterialStockSort = MaterialStockSort.IN_STOCK_FIRST,
    val inStockOnly: Boolean = false,
    val selectedItem: ItemRow? = null,
    val itemLocations: List<ItemStockByLocationRow> = emptyList(),
    val itemDetailLoading: Boolean = false,
    val itemDetailError: String? = null,
    val locationDetail: LocationDetailResponse? = null,
    val locationLoading: Boolean = false,
    val locationError: String? = null,
    val scanMessage: String? = null,
)

class MaterialWarehouseStockViewModel(
    private val repository: WmsRepository,
    private val kind: WarehouseKind,
    private val productGroup: String,
) : ViewModel() {
    private val _uiState = MutableStateFlow(MaterialWarehouseStockUiState())
    val uiState: StateFlow<MaterialWarehouseStockUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null
    private val bare = MaterialWarehouseGroups.isBareGroup(productGroup)
    private val apiGroup = if (bare) null else productGroup.trim()
    private val materialType = kind.materialTypeFilter

    init {
        reload(query = "")
    }

    fun onQueryChange(query: String) {
        _uiState.value = _uiState.value.copy(query = query)
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(250)
            reload(query.trim())
        }
    }

    fun clearQuery() {
        if (_uiState.value.query.isEmpty()) return
        onQueryChange("")
    }

    fun refresh() {
        reload(_uiState.value.query.trim())
    }

    fun setSort(sort: MaterialStockSort) {
        val s = _uiState.value
        _uiState.value = s.copy(
            sort = sort,
            displayedItems = applyDisplay(s.items, sort, s.inStockOnly),
        )
    }

    fun setInStockOnly(value: Boolean) {
        val s = _uiState.value
        _uiState.value = s.copy(
            inStockOnly = value,
            displayedItems = applyDisplay(s.items, s.sort, value),
        )
    }

    fun openItem(item: ItemRow) {
        _uiState.value = _uiState.value.copy(
            selectedItem = item,
            itemLocations = emptyList(),
            itemDetailError = null,
            itemDetailLoading = true,
            locationDetail = null,
            locationError = null,
        )
        viewModelScope.launch {
            repository.fetchItemDetail(item.itemCode)
                .onSuccess { detail ->
                    val locations = detail.stockByLocation
                        .filter { it.availableQty > 0 || it.reservedQty > 0 || it.inProductionQty > 0 }
                        .sortedByDescending { it.availableQty }
                    _uiState.value = _uiState.value.copy(
                        selectedItem = mergeItem(item, detail),
                        itemLocations = locations.ifEmpty { detail.stockByLocation },
                        itemDetailLoading = false,
                    )
                }
                .onFailure { err ->
                    _uiState.value = _uiState.value.copy(
                        itemDetailLoading = false,
                        itemDetailError = err.message ?: "Не удалось загрузить ячейки",
                    )
                }
        }
    }

    fun closeItemSheet() {
        _uiState.value = _uiState.value.copy(
            selectedItem = null,
            itemLocations = emptyList(),
            itemDetailError = null,
            itemDetailLoading = false,
        )
    }

    fun closeLocationSheet() {
        _uiState.value = _uiState.value.copy(
            locationDetail = null,
            locationError = null,
            locationLoading = false,
        )
    }

    fun openLocation(locationCode: String) {
        val code = locationCode.trim()
        if (code.isBlank()) return
        _uiState.value = _uiState.value.copy(
            locationLoading = true,
            locationError = null,
            locationDetail = null,
            selectedItem = null,
            scanMessage = null,
        )
        viewModelScope.launch {
            repository.fetchLocationDetail(code)
                .onSuccess { detail ->
                    _uiState.value = _uiState.value.copy(
                        locationDetail = detail,
                        locationLoading = false,
                    )
                }
                .onFailure { err ->
                    _uiState.value = _uiState.value.copy(
                        locationLoading = false,
                        locationError = err.message ?: "Ячейка не найдена",
                    )
                }
        }
    }

    fun onScanOrSubmit(raw: String) {
        val code = raw.trim()
        if (code.isBlank()) return
        if (looksLikeLocationCode(code)) {
            openLocation(code)
            return
        }
        val matched = findItemInList(code)
        if (matched != null) {
            openItem(matched)
            return
        }
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(scanMessage = null)
            // Try as location first (short codes without dash also possible)
            val asLocation = repository.fetchLocationDetail(code)
            if (asLocation.isSuccess) {
                _uiState.value = _uiState.value.copy(
                    locationDetail = asLocation.getOrNull(),
                    locationLoading = false,
                    locationError = null,
                    selectedItem = null,
                )
                return@launch
            }
            repository.fetchItemsPage(
                query = code,
                productGroup = apiGroup,
                bareProductGroup = bare,
                materialType = materialType,
                limit = 20,
            ).onSuccess { page ->
                val hit = page.items.firstOrNull { itemMatchesCode(it, code) }
                    ?: page.items.firstOrNull()
                if (hit != null) {
                    openItem(hit)
                } else {
                    _uiState.value = _uiState.value.copy(scanMessage = "Не найдено: $code")
                }
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(scanMessage = err.message ?: "Ошибка поиска")
            }
        }
    }

    fun clearScanMessage() {
        _uiState.value = _uiState.value.copy(scanMessage = null)
    }

    fun loadMore() {
        val cursor = _uiState.value.nextCursor ?: return
        if (_uiState.value.loading || _uiState.value.loadingMore) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loadingMore = true, error = null)
            val res = repository.fetchItemsPage(
                query = _uiState.value.query.takeIf { it.isNotEmpty() },
                cursor = cursor,
                productGroup = apiGroup,
                bareProductGroup = bare,
                materialType = null,
            )
            res.onSuccess { page ->
                val merged = _uiState.value.items + page.items
                val s = _uiState.value
                _uiState.value = s.copy(
                    items = merged,
                    displayedItems = applyDisplay(merged, s.sort, s.inStockOnly),
                    nextCursor = page.nextCursor?.takeIf { it.isNotBlank() },
                    loadingMore = false,
                    totalAvailable = merged.sumOf { it.availableQty },
                )
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(loadingMore = false, error = err.message)
            }
        }
    }

    private fun reload(query: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null, nextCursor = null)
            val res = repository.fetchItemsPage(
                query = query.takeIf { it.isNotEmpty() },
                productGroup = apiGroup,
                bareProductGroup = bare,
                materialType = materialType,
            )
            val page = res.getOrNull()
            val effectiveRes = if (res.isSuccess && page?.items.isNullOrEmpty() && materialType != null) {
                repository.fetchItemsPage(
                    query = query.takeIf { it.isNotEmpty() },
                    productGroup = apiGroup,
                    bareProductGroup = bare,
                    materialType = null,
                )
            } else {
                res
            }
            effectiveRes.onSuccess { loaded ->
                val s = _uiState.value
                _uiState.value = s.copy(
                    items = loaded.items,
                    displayedItems = applyDisplay(loaded.items, s.sort, s.inStockOnly),
                    nextCursor = loaded.nextCursor?.takeIf { it.isNotBlank() },
                    loading = false,
                    totalAvailable = loaded.items.sumOf { it.availableQty },
                )
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    items = emptyList(),
                    displayedItems = emptyList(),
                    error = err.message,
                )
            }
        }
    }

    private fun findItemInList(code: String): ItemRow? {
        return _uiState.value.items.firstOrNull { itemMatchesCode(it, code) }
    }

    companion object {
        fun applyDisplay(
            items: List<ItemRow>,
            sort: MaterialStockSort,
            inStockOnly: Boolean,
        ): List<ItemRow> {
            val filtered = if (inStockOnly) items.filter { it.availableQty > 0 } else items
            return when (sort) {
                MaterialStockSort.NAME -> filtered.sortedBy { it.name.lowercase() }
                MaterialStockSort.QTY_DESC -> filtered.sortedByDescending { it.availableQty }
                MaterialStockSort.IN_STOCK_FIRST -> filtered.sortedWith(
                    compareByDescending<ItemRow> { it.availableQty > 0 }
                        .thenByDescending { it.availableQty }
                        .thenBy { it.name.lowercase() },
                )
            }
        }

        fun looksLikeLocationCode(raw: String): Boolean {
            val c = raw.trim()
            if (c.isEmpty()) return false
            if (c.startsWith("01") && c.length >= 16) return false
            if (Regex("""^\d{8,14}$""").matches(c)) return false
            if (c.contains('-')) return true
            if (c.length <= 8 && Regex("""^[A-Za-zА-Яа-я]\w*$""").matches(c)) return true
            return c.length <= 6 && !c.all { it.isDigit() }
        }

        fun itemMatchesCode(item: ItemRow, code: String): Boolean {
            val q = code.trim().lowercase()
            if (q.isEmpty()) return false
            if (item.itemCode.equals(code.trim(), ignoreCase = true)) return true
            if (item.sku?.equals(code.trim(), ignoreCase = true) == true) return true
            val gtin = displayGtin(item.itemCode)
            if (gtin.equals(code.trim(), ignoreCase = true)) return true
            if (item.itemCode.lowercase().contains(q)) return true
            return false
        }

        fun displayGtin(itemCode: String): String {
            val compact = itemCode.replace("\\s".toRegex(), "")
            Regex("01(\\d{14})").find(compact)?.groupValues?.get(1)?.let { return it }
            if (compact.length > 14) return compact.take(14)
            return compact
        }

        private fun mergeItem(base: ItemRow, detail: ItemDetailResponse): ItemRow {
            val fromApi = detail.item
            return base.copy(
                name = fromApi?.name?.takeIf { it.isNotBlank() } ?: base.name,
                sku = fromApi?.sku ?: base.sku,
                availableQty = detail.totals?.availableQty ?: base.availableQty,
                reservedQty = detail.totals?.reservedQty ?: base.reservedQty,
                productGroup = fromApi?.productGroup ?: base.productGroup,
            )
        }
    }
}

class MaterialWarehouseStockViewModelFactory(
    private val repository: WmsRepository,
    private val kind: WarehouseKind,
    private val productGroup: String,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MaterialWarehouseStockViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MaterialWarehouseStockViewModel(repository, kind, productGroup) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
