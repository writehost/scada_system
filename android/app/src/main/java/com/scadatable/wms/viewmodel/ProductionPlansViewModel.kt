package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.ProductionPlanDto
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth

data class ProductionPlansUiState(
    val month: YearMonth = YearMonth.now(),
    val plans: List<ProductionPlanDto> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)

class ProductionPlansViewModel(
    private val repository: WmsRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ProductionPlansUiState())
    val uiState: StateFlow<ProductionPlansUiState> = _uiState.asStateFlow()

    init {
        refresh()
    }

    fun previousMonth() = loadMonth(_uiState.value.month.minusMonths(1))

    fun nextMonth() = loadMonth(_uiState.value.month.plusMonths(1))

    fun currentMonth() = loadMonth(YearMonth.now())

    fun refresh() = loadMonth(_uiState.value.month)

    private fun loadMonth(month: YearMonth) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(month = month, loading = true, error = null)
            val from = month.atDay(1).toString()
            val to = month.atEndOfMonth().toString()
            repository.listProductionPlans(from = from, to = to)
                .onSuccess { plans ->
                    _uiState.value = _uiState.value.copy(
                        plans = plans.sortedWith(
                            compareBy<ProductionPlanDto> {
                                runCatching { LocalDate.parse(it.planDate) }.getOrNull()
                            }.thenBy { it.lineCode.orEmpty() }.thenBy { it.itemName }
                        ),
                        loading = false,
                    )
                }
                .onFailure { error ->
                    _uiState.value = _uiState.value.copy(
                        loading = false,
                        error = error.message ?: "Не удалось загрузить план выпуска",
                    )
                }
        }
    }
}

class ProductionPlansViewModelFactory(
    private val repository: WmsRepository,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T =
        ProductionPlansViewModel(repository) as T
}
