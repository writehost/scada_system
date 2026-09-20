package com.scadatable.wms.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.scadatable.wms.BuildConfig
import com.scadatable.wms.data.AppPrefs
import com.scadatable.wms.data.remote.TsdReleaseInfo
import com.scadatable.wms.data.remote.WmsEndpointConfig
import com.scadatable.wms.update.TsdUpdateManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class TsdUpdateUiState(
    val checking: Boolean = false,
    val downloading: Boolean = false,
    val progress: Float = 0f,
    val downloadStatus: String? = null,
    val updateAvailable: Boolean = false,
    val release: TsdReleaseInfo? = null,
    val error: String? = null,
    val message: String? = null,
    val needsInstallPermission: Boolean = false,
    val installedVersionCode: Int = BuildConfig.VERSION_CODE,
    val installedVersionName: String = BuildConfig.VERSION_NAME,
)

class TsdUpdateViewModel(
    private val appContext: Context,
    private val prefs: AppPrefs,
) : ViewModel() {
    private val manager = TsdUpdateManager(appContext)
    private val _uiState = MutableStateFlow(TsdUpdateUiState())
    val uiState: StateFlow<TsdUpdateUiState> = _uiState.asStateFlow()
    private var lastServerBaseUrl: String = ""

    fun refreshInstallStatus() {
        val statusMessage = manager.consumeInstallStatusMessage() ?: return
        _uiState.value = _uiState.value.copy(
            message = if (statusMessage.startsWith("Ошибка")) null else statusMessage,
            error = if (statusMessage.startsWith("Ошибка")) statusMessage else null,
        )
    }

    fun checkForUpdate(serverBaseUrl: String? = null, showNoUpdateMessage: Boolean = false) {
        viewModelScope.launch {
            refreshInstallStatus()
            _uiState.value = _uiState.value.copy(checking = true, error = null, message = null)
            val raw = serverBaseUrl?.trim().takeUnless { it.isNullOrBlank() }
                ?: prefs.baseUrl.first()
            val base = WmsEndpointConfig.resolveUpdateServerBaseUrl(raw)
            lastServerBaseUrl = base
            val result = manager.checkForUpdate(base, BuildConfig.VERSION_CODE, BuildConfig.VERSION_NAME)
            if (!result.error.isNullOrBlank()) {
                _uiState.value = _uiState.value.copy(
                    checking = false,
                    error = result.error,
                    updateAvailable = false,
                    release = null,
                )
                return@launch
            }
            val available = result.updateAvailable && result.release != null
            _uiState.value = _uiState.value.copy(
                checking = false,
                updateAvailable = available,
                release = if (available) result.release else null,
                message = when {
                    available -> null
                    showNoUpdateMessage -> "Установлена последняя версия (${BuildConfig.VERSION_NAME})"
                    else -> null
                },
            )
        }
    }

    fun downloadAndInstall(hostContext: Context) {
        val release = _uiState.value.release ?: return
        if (!manager.canInstallPackages()) {
            _uiState.value = _uiState.value.copy(
                needsInstallPermission = true,
                error = "Разрешите установку APK для SCADA WMS",
            )
            return
        }
        viewModelScope.launch {
            if (isChecksumError(_uiState.value.error)) {
                manager.clearOtaDownloadCache()
            }
            _uiState.value = _uiState.value.copy(
                downloading = true,
                progress = if (isChecksumError(_uiState.value.error)) 0f else {
                    _uiState.value.progress.takeIf { it > 0f && _uiState.value.error != null } ?: 0f
                },
                downloadStatus = "Подключение…",
                error = null,
                message = null,
            )
            val base = lastServerBaseUrl.ifBlank { prefs.baseUrl.first() }
            val download = manager.downloadApk(release, base) { progress, status ->
                _uiState.value = _uiState.value.copy(progress = progress, downloadStatus = status)
            }
            download.onSuccess { file ->
                val verify = manager.verifyDownloadedApk(file, release.apkSha256)
                if (verify.isFailure) {
                    _uiState.value = _uiState.value.copy(
                        downloading = false,
                        downloadStatus = null,
                        error = verify.exceptionOrNull()?.message,
                    )
                    return@onSuccess
                }
                _uiState.value = _uiState.value.copy(
                    downloading = false,
                    progress = 1f,
                    downloadStatus = "Установка…",
                )
                val install = manager.startInstall(file, hostContext)
                if (install.isFailure) {
                    _uiState.value = _uiState.value.copy(
                        downloadStatus = null,
                        error = install.exceptionOrNull()?.message,
                    )
                    return@onSuccess
                }
                val result = manager.waitForInstallResult(hostContext)
                _uiState.value = _uiState.value.copy(
                    downloadStatus = null,
                    message = if (result != null && !result.startsWith("Ошибка")) result else null,
                    error = if (result?.startsWith("Ошибка") == true) result else null,
                    installedVersionCode = BuildConfig.VERSION_CODE,
                    installedVersionName = BuildConfig.VERSION_NAME,
                    updateAvailable = false,
                    release = null,
                )
                if (result == "Обновление установлено") {
                    checkForUpdate(showNoUpdateMessage = true)
                }
            }.onFailure { err ->
                _uiState.value = _uiState.value.copy(
                    downloading = false,
                    downloadStatus = null,
                    error = err.message ?: "Не удалось скачать APK",
                )
            }
        }
    }

    fun openDownloadedInstaller(hostContext: Context) {
        val apk = com.scadatable.wms.update.ApkInstallHelper.otaDownloadFile(appContext)
        if (!apk.exists() || apk.length() <= 0L) {
            _uiState.value = _uiState.value.copy(error = "APK не найден — нажмите «Скачать и установить»")
            return
        }
        if (!manager.canInstallPackages()) {
            _uiState.value = _uiState.value.copy(
                needsInstallPermission = true,
                error = "Разрешите установку APK для SCADA WMS",
            )
            return
        }
        viewModelScope.launch {
            val verify = manager.verifyDownloadedApk(apk, _uiState.value.release?.apkSha256)
            if (verify.isFailure) {
                _uiState.value = _uiState.value.copy(error = verify.exceptionOrNull()?.message)
                return@launch
            }
            val install = manager.startInstall(apk, hostContext)
            if (install.isFailure) {
                _uiState.value = _uiState.value.copy(error = install.exceptionOrNull()?.message)
                return@launch
            }
            val result = manager.waitForInstallResult(hostContext)
            _uiState.value = _uiState.value.copy(
                message = if (result != null && !result.startsWith("Ошибка")) result else null,
                error = if (result?.startsWith("Ошибка") == true) result else null,
            )
        }
    }

    fun requestInstallPermission() {
        manager.openInstallPermissionSettings()
        _uiState.value = _uiState.value.copy(
            needsInstallPermission = false,
            message = "После разрешения нажмите «Обновить» снова",
        )
    }

    fun dismissUpdatePrompt() {
        _uiState.value = _uiState.value.copy(updateAvailable = false, release = null)
    }

    fun clearMessages() {
        _uiState.value = _uiState.value.copy(error = null, message = null)
    }

    private fun isChecksumError(message: String?): Boolean {
        return message?.contains("контрольная сумма", ignoreCase = true) == true ||
            message?.contains("поврежд", ignoreCase = true) == true
    }
}

class TsdUpdateViewModelFactory(
    private val appContext: Context,
    private val prefs: AppPrefs,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(TsdUpdateViewModel::class.java)) {
            return TsdUpdateViewModel(appContext, prefs) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
