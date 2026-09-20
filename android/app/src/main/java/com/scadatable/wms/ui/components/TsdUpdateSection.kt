package com.scadatable.wms.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.viewmodel.TsdUpdateUiState
import com.scadatable.wms.viewmodel.TsdUpdateViewModel
import com.scadatable.wms.viewmodel.TsdUpdateViewModelFactory

@Composable
fun TsdAutoUpdateCheck(
    app: WmsApplication,
    serverBaseUrl: String?,
    enabled: Boolean = true,
) {
    val updateVm: TsdUpdateViewModel = viewModel(factory = TsdUpdateViewModelFactory(app, app.appPrefs))
    val updateState by updateVm.uiState.collectAsState()
    val hostContext = LocalContext.current

    LaunchedEffect(enabled, serverBaseUrl) {
        if (enabled && !serverBaseUrl.isNullOrBlank()) {
            updateVm.refreshInstallStatus()
            updateVm.checkForUpdate(serverBaseUrl)
        }
    }

    if (updateState.updateAvailable && updateState.release != null) {
        TsdUpdateDialog(
            state = updateState,
            onDismiss = updateVm::dismissUpdatePrompt,
            onInstall = { updateVm.downloadAndInstall(hostContext) },
            onOpenInstaller = { updateVm.openDownloadedInstaller(hostContext) },
            onGrantPermission = updateVm::requestInstallPermission,
        )
    }
}

@Composable
fun TsdUpdateSettingsSection(
    app: WmsApplication,
    serverBaseUrl: String,
) {
    val updateVm: TsdUpdateViewModel = viewModel(factory = TsdUpdateViewModelFactory(app, app.appPrefs))
    val updateState by updateVm.uiState.collectAsState()
    val hostContext = LocalContext.current

    if (updateState.error != null) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text(updateState.error ?: "", color = ErrorRed, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
        }
    }
    if (updateState.message != null) {
        Card(
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
            shape = RoundedCornerShape(12.dp),
        ) {
            Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(updateState.message ?: "", color = Color(0xFF2E7D32), fontSize = 13.sp)
                OutlinedButton(
                    onClick = { updateVm.openDownloadedInstaller(hostContext) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Открыть установщик")
                }
            }
        }
    }
    ListItem(
        headlineContent = { Text("Версия ТСД") },
        supportingContent = {
            Text("${updateState.installedVersionName} (code ${updateState.installedVersionCode})")
        },
    )
    if (updateState.downloading) {
        LinearProgressIndicator(
            progress = { updateState.progress },
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
            color = DarkGreen,
        )
        if (!updateState.downloadStatus.isNullOrBlank()) {
            Text(
                updateState.downloadStatus ?: "",
                fontSize = 12.sp,
                color = Color.Gray,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
    }
    if (updateState.updateAvailable && updateState.release != null) {
        Text(
            "Доступно: ${updateState.release?.versionName} — ${updateState.release?.changelog ?: "обновление"}",
            fontSize = 12.sp,
            modifier = Modifier.padding(bottom = 8.dp),
        )
    }
    if (updateState.needsInstallPermission) {
        OutlinedButton(
            onClick = updateVm::requestInstallPermission,
            modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
        ) {
            Text("Разрешить установку APK")
        }
    }
    Button(
        onClick = {
            if (updateState.updateAvailable) {
                updateVm.downloadAndInstall(hostContext)
            } else {
                updateVm.checkForUpdate(serverBaseUrl, showNoUpdateMessage = true)
            }
        },
        enabled = !updateState.checking && !updateState.downloading,
        modifier = Modifier.fillMaxWidth(),
        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
    ) {
        Text(
            when {
                updateState.checking -> "Проверка…"
                updateState.downloading -> {
                    val pct = (updateState.progress * 100).toInt()
                    if (pct > 0) "Скачивание $pct%" else "Скачивание…"
                }
                updateState.updateAvailable && updateState.error != null && (
                    updateState.error!!.contains("контрольная сумма", ignoreCase = true) ||
                        updateState.error!!.contains("поврежд", ignoreCase = true)
                    ) -> "Скачать заново"
                updateState.updateAvailable && updateState.error != null -> "Продолжить скачивание"
                updateState.updateAvailable -> "Скачать и установить"
                else -> "Проверить обновления"
            },
            color = Color.White,
        )
    }
}

@Composable
fun TsdUpdateDialog(
    state: TsdUpdateUiState,
    onDismiss: () -> Unit,
    onInstall: () -> Unit,
    onOpenInstaller: () -> Unit,
    onGrantPermission: () -> Unit,
) {
    val release = state.release ?: return
    AlertDialog(
        onDismissRequest = { if (!release.mandatory) onDismiss() },
        title = { Text("Доступно обновление ТСД") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Версия ${release.versionName}")
                Text(release.changelog ?: "Новая версия приложения SCADA WMS для ТСД", fontSize = 14.sp)
                if (state.downloading) {
                    LinearProgressIndicator(
                        progress = { state.progress },
                        modifier = Modifier.fillMaxWidth(),
                        color = DarkGreen,
                    )
                    if (!state.downloadStatus.isNullOrBlank()) {
                        Text(state.downloadStatus ?: "", fontSize = 12.sp, color = Color.Gray)
                    }
                }
                if (state.error != null) {
                    Text(state.error ?: "", color = ErrorRed, fontSize = 12.sp)
                }
                if (state.message != null) {
                    Text(state.message ?: "", color = Color(0xFF2E7D32), fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            if (state.needsInstallPermission) {
                TextButton(onClick = onGrantPermission) {
                    Text("Разрешить установку")
                }
            } else if (state.message != null && !state.downloading) {
                TextButton(onClick = onOpenInstaller) {
                    Text("Открыть установщик")
                }
            } else {
                TextButton(onClick = onInstall, enabled = !state.downloading) {
                    Text(
                        when {
                            state.downloading -> "Скачивание…"
                            state.error?.contains("контрольная сумма", ignoreCase = true) == true ||
                                state.error?.contains("поврежд", ignoreCase = true) == true -> "Скачать заново"
                            state.error != null -> "Продолжить"
                            else -> "Обновить"
                        },
                    )
                }
            }
        },
        dismissButton = if (!release.mandatory) {
            {
                TextButton(onClick = onDismiss, enabled = !state.downloading) {
                    Text("Позже")
                }
            }
        } else null,
    )
}
