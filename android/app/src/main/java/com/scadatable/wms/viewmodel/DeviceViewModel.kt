package com.scadatable.wms.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.data.AppPrefs
import com.scadatable.wms.data.WmsRepository
import com.scadatable.wms.data.remote.MobileProfileResponse
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class DeviceUiState(
    val loading: Boolean = false,
    val healthy: Boolean? = null,
    val profile: MobileProfileResponse? = null,
    val error: String? = null,
    val statusMessage: String? = null,
    val statusSuccess: Boolean? = null,
)

class DeviceViewModel(
    private val repository: WmsRepository,
    private val prefs: AppPrefs,
) : ViewModel() {
    private val _uiState = MutableStateFlow(DeviceUiState())
    val uiState: StateFlow<DeviceUiState> = _uiState.asStateFlow()

    fun bootstrap() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val health = repository.health()
            if (health.isFailure) {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    healthy = false,
                    error = health.exceptionOrNull()?.message,
                )
                return@launch
            }
            val profileRes = repository.registerDevice()
            if (profileRes.isSuccess) {
                _uiState.value = DeviceUiState(
                    loading = false,
                    healthy = true,
                    profile = profileRes.getOrNull(),
                )
            } else {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    healthy = true,
                    error = profileRes.exceptionOrNull()?.message,
                )
            }
        }
    }

    fun testConnection(baseUrl: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(
                loading = true,
                error = null,
                healthy = null,
                statusMessage = null,
                statusSuccess = null,
            )
            val health = repository.healthCheck(baseUrl)
            if (health.isSuccess) {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    healthy = true,
                    error = null,
                    statusMessage = "Сервер доступен (health OK)",
                    statusSuccess = true,
                )
            } else {
                val msg = health.exceptionOrNull()?.message ?: "Не удалось подключиться"
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    healthy = false,
                    error = msg,
                    statusMessage = msg,
                    statusSuccess = false,
                )
            }
        }
    }

    fun saveConnection(baseUrl: String, siteCode: String, deviceUid: String, deviceName: String, operatorUserId: String?) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(statusMessage = null, statusSuccess = null)
            prefs.setBaseUrl(baseUrl)
            prefs.setSiteCode(siteCode)
            prefs.setDeviceUid(deviceUid)
            prefs.setDeviceName(deviceName)
            prefs.setOperatorUserId(operatorUserId)
            bootstrap()
            _uiState.value = _uiState.value.copy(
                statusMessage = "Настройки подключения сохранены",
                statusSuccess = true,
            )
        }
    }

    fun login(login: String, password: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val res = repository.login(login, password)
            if (res.isSuccess) {
                bootstrap()
            } else {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    error = res.exceptionOrNull()?.message ?: "Не удалось войти",
                )
            }
        }
    }

    fun identifyByPin(identity: String, pin: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(loading = true, error = null)
            val res = repository.identifyOperator(method = "pin", identity = identity, pin = pin)
            if (res.isSuccess) {
                bootstrap()
            } else {
                _uiState.value = _uiState.value.copy(
                    loading = false,
                    error = res.exceptionOrNull()?.message ?: "Оператор не найден",
                )
            }
        }
    }
}

class DeviceViewModelFactory(
    private val repository: WmsRepository,
    private val prefs: AppPrefs,
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(DeviceViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return DeviceViewModel(repository, prefs) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class: ${modelClass.name}")
    }
}
