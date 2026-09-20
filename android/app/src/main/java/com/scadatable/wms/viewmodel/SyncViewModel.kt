package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class SyncUiState(
    val syncing: Boolean = false,
    val lastSyncAt: String? = null,
    val error: String? = null,
)

class SyncViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    val products = repository.cachedProducts.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val warehouses = repository.cachedWarehouses.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())
    val cells = repository.cachedCells.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    private val _uiState = MutableStateFlow(SyncUiState())
    val uiState: StateFlow<SyncUiState> = _uiState.asStateFlow()

    fun refreshAll() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(syncing = true, error = null)
            val res = repository.refreshItemsAndLocations()
            _uiState.value = _uiState.value.copy(
                syncing = false,
                lastSyncAt = repository.getLastSyncAt(),
                error = res.exceptionOrNull()?.message,
            )
        }
    }
}

class SyncViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(SyncViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return SyncViewModel(repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
