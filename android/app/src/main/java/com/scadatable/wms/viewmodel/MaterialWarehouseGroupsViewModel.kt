package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ProductGroupRow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class MaterialWarehouseGroupsUiState(
    val groups: List<ProductGroupRow> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

class MaterialWarehouseGroupsViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(MaterialWarehouseGroupsUiState())
    val uiState: StateFlow<MaterialWarehouseGroupsUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val res = repository.fetchProductGroups()
            res.onSuccess { groups ->
                _uiState.value = MaterialWarehouseGroupsUiState(
                    groups = groups
                        .filter { it.isActive }
                        .dedupeForTiles()
                        .sortedWith(compareBy({ it.sortOrder }, { it.displayName() })),
                    loading = false,
                )
            }.onFailure { err ->
                _uiState.value = MaterialWarehouseGroupsUiState(loading = false, error = err.message)
            }
        }
    }
}

private fun List<ProductGroupRow>.dedupeForTiles(): List<ProductGroupRow> {
    val byKey = linkedMapOf<String, ProductGroupRow>()
    for (group in this) {
        val nameKey = group.displayName().trim().lowercase()
        val codeKey = group.effectiveCode().trim().lowercase()
        val key = nameKey.ifBlank { codeKey }
        if (key.isBlank()) continue
        val current = byKey[key]
        byKey[key] = if (current == null) {
            group
        } else {
            current.preferredOver(group)
        }
    }
    return byKey.values.toList()
}

private fun ProductGroupRow.preferredOver(other: ProductGroupRow): ProductGroupRow {
    val thisScore = dedupeScore()
    val otherScore = other.dedupeScore()
    return if (otherScore > thisScore) other else this
}

private fun ProductGroupRow.dedupeScore(): Int {
    var score = 0
    if (effectiveCode().isNotBlank()) score += 10
    if (!imageUrl.isNullOrBlank()) score += 5
    if (itemCount > 0) score += 3
    if (withStockCount > 0) score += 2
    score += (1000 - sortOrder).coerceIn(0, 1000)
    return score
}

class MaterialWarehouseGroupsViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(MaterialWarehouseGroupsViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return MaterialWarehouseGroupsViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
