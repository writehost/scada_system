package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ItemRow
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class NomenclatureFilter(val shortLabel: String) {
    ALL("Все"),
    IN_STOCK("Ост"),
    MARKED("ЧЗ"),
    DRAFT("Черн"),
}

data class NomenclatureUiState(
    val items: List<ItemRow> = emptyList(),
    val loading: Boolean = false,
    val loadingMore: Boolean = false,
    val syncing: Boolean = false,
    val error: String? = null,
    val nextCursor: String? = null,
    val lastSyncAt: String? = null,
    val query: String = "",
    val filter: NomenclatureFilter = NomenclatureFilter.ALL,
) {
    val visibleItems: List<ItemRow> = applyNomenclatureFilter(items, filter)
}

fun applyNomenclatureFilter(items: List<ItemRow>, filter: NomenclatureFilter): List<ItemRow> =
    when (filter) {
        NomenclatureFilter.ALL -> items
        NomenclatureFilter.IN_STOCK -> items.filter { it.availableQty > 0 }
        NomenclatureFilter.MARKED -> items.filter { it.isMarked }
        NomenclatureFilter.DRAFT -> items.filter { it.name.startsWith("Новый товар", ignoreCase = true) }
    }

class NomenclatureViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(NomenclatureUiState())
    val uiState: StateFlow<NomenclatureUiState> = _uiState.asStateFlow()

    private var searchJob: Job? = null
    private var activeQuery: String = ""
    private var cachedBrowseItems: List<ItemRow> = emptyList()
    private var cachedBrowseCursor: String? = null

    init {
        reload(query = "")
    }

    fun onQueryChange(query: String) {
        _uiState.value = _uiState.value.copy(query = query)
        val normalized = normalizeNomenclatureQuery(query)
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            if (!looksLikeBarcode(normalized)) delay(250)
            reload(normalized)
        }
    }

    fun clearQuery() {
        if (_uiState.value.query.isEmpty()) return
        searchJob?.cancel()
        _uiState.value = _uiState.value.copy(query = "")
        if (cachedBrowseItems.isNotEmpty()) {
            activeQuery = ""
            _uiState.value = _uiState.value.copy(
                items = cachedBrowseItems,
                nextCursor = cachedBrowseCursor,
                loading = false,
                error = null,
            )
        } else {
            reload("")
        }
    }

    fun toggleFilter(filter: NomenclatureFilter) {
        val next = if (_uiState.value.filter == filter && filter != NomenclatureFilter.ALL) {
            NomenclatureFilter.ALL
        } else {
            filter
        }
        _uiState.value = _uiState.value.copy(filter = next)
    }

    fun refreshFromServer() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(syncing = true, error = null)
            val res = repository.refreshItemsAndLocations()
            _uiState.value = _uiState.value.copy(
                syncing = false,
                lastSyncAt = repository.getLastSyncAt(),
                error = res.exceptionOrNull()?.message,
            )
            if (res.isSuccess) {
                cachedBrowseItems = emptyList()
                cachedBrowseCursor = null
                reload(activeQuery)
            }
        }
    }

    fun loadMore() {
        val cursor = _uiState.value.nextCursor ?: return
        if (_uiState.value.loading || _uiState.value.loadingMore) return
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loadingMore = true, error = null)
            val res = repository.fetchItemsPage(query = activeQuery.takeIf { it.isNotEmpty() }, cursor = cursor)
            res.onSuccess { page ->
                val merged = _uiState.value.items + page.items
                _uiState.value = _uiState.value.copy(
                    items = merged,
                    nextCursor = page.nextCursor?.takeIf { it.isNotBlank() },
                    loadingMore = false,
                )
                if (activeQuery.isEmpty()) {
                    cachedBrowseItems = merged
                    cachedBrowseCursor = _uiState.value.nextCursor
                }
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(
                    loadingMore = false,
                    error = err.message,
                )
            }
        }
    }

    private fun reload(query: String) {
        viewModelScope.launch {
            activeQuery = query
            if (query.isEmpty() && cachedBrowseItems.isNotEmpty()) {
                _uiState.value = _uiState.value.copy(
                    items = cachedBrowseItems,
                    nextCursor = cachedBrowseCursor,
                    loading = false,
                    error = null,
                )
                return@launch
            }
            _uiState.value = _uiState.value.copy(loading = true, error = null, nextCursor = null)
            val res = repository.fetchItemsPage(query = query.takeIf { it.isNotEmpty() })
            res.onSuccess { page ->
                _uiState.value = _uiState.value.copy(
                    items = page.items,
                    nextCursor = page.nextCursor?.takeIf { it.isNotBlank() },
                    loading = false,
                    lastSyncAt = _uiState.value.lastSyncAt ?: repository.getLastSyncAt(),
                )
                if (query.isEmpty()) {
                    cachedBrowseItems = page.items
                    cachedBrowseCursor = page.nextCursor?.takeIf { it.isNotBlank() }
                }
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    items = emptyList(),
                    error = err.message,
                )
            }
        }
    }
}

private fun normalizeNomenclatureQuery(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return ""
    val compact = trimmed.replace("\\s".toRegex(), "")
    Regex("01(\\d{14})").find(compact)?.groupValues?.get(1)?.let { return it }
    if (compact.all { it.isDigit() } && compact.length in 8..14) return compact
    return trimmed
}

private fun looksLikeBarcode(query: String): Boolean {
    if (query.isEmpty()) return false
    val compact = query.replace("\\s".toRegex(), "")
    if (compact.length >= 18) return true
    if (compact.startsWith("01") && compact.length >= 16) return true
    return compact.all { it.isDigit() } && compact.length >= 8
}

class NomenclatureViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(NomenclatureViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return NomenclatureViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
