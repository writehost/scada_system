package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ReceivingCategoryRow
import com.scadatable.wms.receiving.ReceivingGroupMatcher
import com.scadatable.wms.receiving.ReceivingProductGroups
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class ReceivingCategoriesUiState(
    val categories: List<ReceivingCategoryRow> = emptyList(),
    val categoryLinks: Map<String, Set<String>> = emptyMap(),
    val displayOptions: List<com.scadatable.wms.receiving.ReceivingProductGroupOption> =
        ReceivingProductGroups.options.filter { it.enabled },
    val loading: Boolean = false,
    val error: String? = null,
    val fromCache: Boolean = false,
)

class ReceivingCategoriesViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ReceivingCategoriesUiState())
    val uiState: StateFlow<ReceivingCategoriesUiState> = _uiState.asStateFlow()

    init {
        viewModelScope.launch {
            val cached = repository.loadReceivingCategoriesFromCache()
            if (cached.isNotEmpty()) {
                applyCategories(cached, fromCache = true)
            }
            refresh()
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val res = repository.fetchReceivingCategories()
            res.onSuccess { categories ->
                applyCategories(categories, fromCache = false)
            }.onFailure { err ->
                val cached = repository.loadReceivingCategoriesFromCache()
                if (cached.isNotEmpty()) {
                    applyCategories(cached, fromCache = true, error = err.message)
                } else {
                    _uiState.value = ReceivingCategoriesUiState(
                        loading = false,
                        error = err.message,
                    )
                }
            }
        }
    }

    private fun applyCategories(
        categories: List<ReceivingCategoryRow>,
        fromCache: Boolean,
        error: String? = null,
    ) {
        val options = if (categories.isNotEmpty()) {
            ReceivingProductGroups.fromServerCategories(categories)
        } else {
            ReceivingProductGroups.options.filter { it.enabled }
        }
        _uiState.value = ReceivingCategoriesUiState(
            categories = categories,
            categoryLinks = ReceivingGroupMatcher.buildCategoryLinks(categories),
            displayOptions = options,
            loading = false,
            error = error,
            fromCache = fromCache,
        )
    }
}

class ReceivingCategoriesViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ReceivingCategoriesViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return ReceivingCategoriesViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
