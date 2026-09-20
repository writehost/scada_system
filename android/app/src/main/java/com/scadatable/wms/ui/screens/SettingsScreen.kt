package com.scadatable.wms.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.WmsEndpointConfig
import com.scadatable.wms.print.LabelPrintService
import com.scadatable.wms.print.LabelTemplateDefaults
import com.scadatable.wms.print.LabelTemplateVars
import com.scadatable.wms.print.PrinterBackend
import com.scadatable.wms.print.TscBluetoothPrinter
import com.scadatable.wms.push.WmsPushNotifier
import com.scadatable.wms.push.WmsPushScheduler
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.ui.components.LabelPreviewDialog
import com.scadatable.wms.ui.components.TsdUpdateSettingsSection
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.DeviceViewModel
import com.scadatable.wms.viewmodel.DeviceViewModelFactory
import kotlinx.coroutines.launch

private enum class SettingsTab(val title: String) {
    SERVER("Сервер"),
    RECEIVING("Приёмка"),
    PRINTER("Печать"),
    UPDATE("Обновление"),
}


@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val deviceVm: DeviceViewModel = viewModel(factory = DeviceViewModelFactory(app.repository, app.appPrefs))
    val state by deviceVm.uiState.collectAsState()
    val savedBaseUrl by app.appPrefs.baseUrl.collectAsState(initial = WmsEndpointConfig.DEFAULT_BASE_URL)
    val savedSiteCode by app.appPrefs.siteCode.collectAsState(initial = "DEFAULT")
    val savedDeviceUid by app.appPrefs.deviceUid.collectAsState(initial = "TSD-EMULATOR")
    val savedDeviceName by app.appPrefs.deviceName.collectAsState(initial = "Android Emulator")
    val savedOperatorUserId by app.appPrefs.operatorUserId.collectAsState(initial = null)
    val savedOperatorDisplayName by app.appPrefs.operatorDisplayName.collectAsState(initial = null)
    val autoPrintReceiving by app.appPrefs.autoPrintReceiving.collectAsState(initial = false)
    val autoPostReceivingStock by app.appPrefs.autoPostReceivingStock.collectAsState(initial = true)
    val savedTargetLocation by app.appPrefs.receivingTargetLocationCode.collectAsState(initial = "")
    val savedPrinterBackend by app.appPrefs.printerBackend.collectAsState(initial = PrinterBackend.TSC_BLUETOOTH.prefValue)
    val savedPrinterMac by app.appPrefs.printerBluetoothMac.collectAsState(initial = "")
    val savedTemplate by app.appPrefs.labelTemplateTspl.collectAsState(initial = "")
    val pushEnabled by app.appPrefs.pushNotificationsEnabled.collectAsState(initial = true)

    var selectedTab by remember { mutableIntStateOf(0) }
    var baseUrl by remember { mutableStateOf(WmsEndpointConfig.DEFAULT_BASE_URL) }
    var siteCode by remember { mutableStateOf("DEFAULT") }
    var deviceUid by remember { mutableStateOf("TSD-EMULATOR") }
    var deviceName by remember { mutableStateOf("Android Emulator") }
    var operatorUserId by remember { mutableStateOf("") }
    var loginInput by remember { mutableStateOf("") }
    var passwordInput by remember { mutableStateOf("") }
    var pinIdentityInput by remember { mutableStateOf("") }
    var pinInput by remember { mutableStateOf("") }
    var targetLocationInput by remember { mutableStateOf("") }
    var printerMacInput by remember { mutableStateOf("") }
    var templateInput by remember { mutableStateOf(LabelTemplateDefaults.RECEIVING_TSPL) }
    var printerBackend by remember { mutableStateOf(PrinterBackend.TSC_BLUETOOTH) }
    var printStatus by remember { mutableStateOf<String?>(null) }
    var printSuccess by remember { mutableStateOf<Boolean?>(null) }
    var printBusy by remember { mutableStateOf(false) }
    var previewPayload by remember { mutableStateOf<ReceivingStickerPayload?>(null) }
    val scope = rememberCoroutineScope()

    val btPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { granted ->
        if (granted.values.all { it }) {
            printStatus = null
        } else {
            printStatus = "Нужны разрешения Bluetooth для печати"
            printSuccess = false
        }
    }

    val notificationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        scope.launch {
            app.appPrefs.setPushNotificationsEnabled(granted)
            if (granted) {
                WmsPushNotifier.ensureChannel(context)
                WmsPushScheduler.syncNow(context)
            }
        }
    }

    fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            scope.launch {
                app.appPrefs.setPushNotificationsEnabled(true)
                WmsPushScheduler.syncNow(context)
            }
            return
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    fun hasBluetoothPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val connect = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)
        val scan = ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN)
        return connect == android.content.pm.PackageManager.PERMISSION_GRANTED &&
            scan == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    fun requestBluetoothPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            btPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.BLUETOOTH_CONNECT,
                    Manifest.permission.BLUETOOTH_SCAN,
                ),
            )
        }
    }

    LaunchedEffect(savedBaseUrl, savedSiteCode, savedDeviceUid, savedDeviceName, savedOperatorUserId) {
        baseUrl = savedBaseUrl
        siteCode = savedSiteCode
        deviceUid = savedDeviceUid
        deviceName = savedDeviceName
        operatorUserId = savedOperatorUserId.orEmpty()
    }
    LaunchedEffect(savedTargetLocation) { targetLocationInput = savedTargetLocation }
    LaunchedEffect(savedPrinterMac) { printerMacInput = savedPrinterMac }
    LaunchedEffect(savedTemplate) {
        templateInput = savedTemplate.ifBlank { LabelTemplateDefaults.RECEIVING_TSPL }
    }
    LaunchedEffect(savedPrinterBackend) {
        printerBackend = PrinterBackend.fromPref(savedPrinterBackend)
    }

    val pairedPrinters = remember(selectedTab, printBusy) {
        if (selectedTab == SettingsTab.PRINTER.ordinal && hasBluetoothPermission()) {
            TscBluetoothPrinter.listPairedDevices(context)
        } else {
            emptyList()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Настройки", fontWeight = FontWeight.Bold, color = DarkGreen) },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            TabRow(selectedTabIndex = selectedTab, containerColor = SoftWhiteBackground) {
                SettingsTab.entries.forEachIndexed { index, tab ->
                    Tab(
                        selected = selectedTab == index,
                        onClick = { selectedTab = index },
                        text = { Text(tab.title, fontSize = 12.sp) },
                    )
                }
            }

            Column(
                Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                when (SettingsTab.entries[selectedTab]) {
                    SettingsTab.SERVER -> {
                        SettingsStatusCard(
                            message = state.statusMessage ?: state.error,
                            success = state.statusSuccess ?: if (state.error != null) false else state.healthy,
                            loading = state.loading,
                        )
                        OutlinedTextField(
                            value = baseUrl,
                            onValueChange = { baseUrl = it },
                            label = { Text("Base URL") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        UrlHints(baseUrl)
                        OutlinedTextField(value = siteCode, onValueChange = { siteCode = it }, label = { Text("Site code") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value = deviceUid, onValueChange = { deviceUid = it }, label = { Text("Device UID") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value = deviceName, onValueChange = { deviceName = it }, label = { Text("Device name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value = operatorUserId, onValueChange = { operatorUserId = it }, label = { Text("Operator userId (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())

                        Text("Авторизация", fontWeight = FontWeight.Bold, color = DarkGreen)
                        if (!savedOperatorDisplayName.isNullOrBlank()) {
                            Text("Текущий оператор: $savedOperatorDisplayName", color = Color(0xFF2E7D32), fontSize = 12.sp)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(value = loginInput, onValueChange = { loginInput = it }, label = { Text("Логин") }, singleLine = true, modifier = Modifier.weight(1f))
                            OutlinedTextField(value = passwordInput, onValueChange = { passwordInput = it }, label = { Text("Пароль") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.weight(1f))
                        }
                        Button(onClick = { deviceVm.login(loginInput, passwordInput) }, enabled = !state.loading && loginInput.isNotBlank() && passwordInput.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                            Text("Войти по логину")
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedTextField(value = pinIdentityInput, onValueChange = { pinIdentityInput = it }, label = { Text("Логин / код") }, singleLine = true, modifier = Modifier.weight(1f))
                            OutlinedTextField(value = pinInput, onValueChange = { pinInput = it }, label = { Text("PIN") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.weight(1f))
                        }
                        Button(onClick = { deviceVm.identifyByPin(pinIdentityInput, pinInput) }, enabled = !state.loading && pinIdentityInput.isNotBlank() && pinInput.isNotBlank(), modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF7F4EA))) {
                            Text("Идентифицировать по PIN", color = DarkGreen)
                        }
                        if (state.profile != null) {
                            Text(
                                "Устройство: ${state.profile?.device?.deviceUid ?: "—"} • оператор: ${state.profile?.operator?.displayName ?: "не выбран"}",
                                color = Color.Gray,
                                fontSize = 12.sp,
                            )
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(onClick = { deviceVm.testConnection(baseUrl) }, enabled = !state.loading, modifier = Modifier.weight(1f)) {
                                Text("Проверить связь")
                            }
                            Button(
                                onClick = {
                                    deviceVm.saveConnection(baseUrl, siteCode, deviceUid, deviceName, operatorUserId.ifBlank { null })
                                },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) {
                                Text("Сохранить", color = Color.White)
                            }
                        }
                        ListItem(
                            headlineContent = { Text("Push-уведомления") },
                            supportingContent = {
                                Text(
                                    if (WmsPushNotifier.canPost(context)) {
                                        "Задачи с сервера (long-poll), пока приложение запущено"
                                    } else {
                                        "Разрешите уведомления в системе — иначе push не придут"
                                    },
                                )
                            },
                            trailingContent = {
                                Switch(
                                    checked = pushEnabled,
                                    onCheckedChange = { enabled ->
                                        if (enabled) {
                                            requestNotificationPermission()
                                        } else {
                                            scope.launch { app.appPrefs.setPushNotificationsEnabled(false) }
                                        }
                                    },
                                )
                            },
                        )
                    }

                    SettingsTab.RECEIVING -> {
                        ListItem(
                            headlineContent = { Text("Автопечать стикеров") },
                            supportingContent = { Text("После ввода количества печатается этикетка") },
                            trailingContent = {
                                Switch(checked = autoPrintReceiving, onCheckedChange = { enabled ->
                                    scope.launch { app.appPrefs.setAutoPrintReceiving(enabled) }
                                })
                            },
                        )
                        ListItem(
                            headlineContent = { Text("Автопроведение на остаток") },
                            supportingContent = { Text("После «Завершить» сразу проводит документ") },
                            trailingContent = {
                                Switch(checked = autoPostReceivingStock, onCheckedChange = { enabled ->
                                    scope.launch { app.appPrefs.setAutoPostReceivingStock(enabled) }
                                })
                            },
                        )
                        OutlinedTextField(
                            value = targetLocationInput,
                            onValueChange = { targetLocationInput = it },
                            label = { Text("Ячейка приёмки (необязательно)") },
                            placeholder = { Text("Пусто — зона RECV") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        Button(
                            onClick = {
                                scope.launch { app.appPrefs.setReceivingTargetLocationCode(targetLocationInput) }
                            },
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        ) {
                            Text("Сохранить приёмку", color = Color.White)
                        }
                    }

                    SettingsTab.PRINTER -> {
                        SettingsStatusCard(message = printStatus, success = printSuccess, loading = printBusy)
                        Text("Шаблон TSPL (TSC Label / Console)", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(
                            "Создайте макет в TSC Label Editor, экспортируйте TSPL и вставьте сюда. " +
                                "Печать QR WMS: QRCODE … \"{{qrUrl}}\" (ячейка + партия). " +
                                "Старый DMATRIX больше не нужен. Переменные: " +
                                LabelTemplateVars.ALL.joinToString(", ") { "{{$it}}" },
                            fontSize = 11.sp,
                            color = Color.Gray,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { printerBackend = PrinterBackend.TSC_BLUETOOTH }) {
                                Text(if (printerBackend == PrinterBackend.TSC_BLUETOOTH) "✓ TSC BT" else "TSC BT")
                            }
                            OutlinedButton(onClick = { printerBackend = PrinterBackend.SYSTEM }) {
                                Text(if (printerBackend == PrinterBackend.SYSTEM) "✓ Системная" else "Системная")
                            }
                        }
                        if (printerBackend == PrinterBackend.TSC_BLUETOOTH) {
                            if (!hasBluetoothPermission()) {
                                Button(onClick = ::requestBluetoothPermission, modifier = Modifier.fillMaxWidth()) {
                                    Text("Разрешить Bluetooth")
                                }
                            }
                            if (pairedPrinters.isNotEmpty()) {
                                Text("Сопряжённые принтеры", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                                pairedPrinters.forEach { (name, mac) ->
                                    OutlinedButton(
                                        onClick = { printerMacInput = mac },
                                        modifier = Modifier.fillMaxWidth(),
                                    ) {
                                        Text("$name ($mac)", fontSize = 12.sp)
                                    }
                                }
                            }
                            OutlinedTextField(
                                value = printerMacInput,
                                onValueChange = { printerMacInput = it },
                                label = { Text("MAC Bluetooth-принтера") },
                                placeholder = { Text("AA:BB:CC:DD:EE:FF") },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                        OutlinedTextField(
                            value = templateInput,
                            onValueChange = { templateInput = it },
                            label = { Text("TSPL шаблон") },
                            modifier = Modifier.fillMaxWidth().height(220.dp),
                            textStyle = androidx.compose.ui.text.TextStyle(fontFamily = FontFamily.Monospace, fontSize = 11.sp),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            OutlinedButton(
                                onClick = { templateInput = LabelTemplateDefaults.RECEIVING_TSPL },
                                modifier = Modifier.weight(1f),
                            ) {
                                Text("Сбросить шаблон")
                            }
                            Button(
                                onClick = {
                                    scope.launch {
                                        app.appPrefs.setPrinterBackend(printerBackend.prefValue)
                                        app.appPrefs.setPrinterBluetoothMac(printerMacInput.ifBlank { null })
                                        app.appPrefs.setLabelTemplateTspl(templateInput)
                                        app.repository.syncDevicePrefsToServer()
                                        printStatus = "Настройки печати сохранены (копия на сервере)"
                                        printSuccess = true
                                    }
                                },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) {
                                Text("Сохранить", color = Color.White)
                            }
                        }
                        Button(
                            onClick = {
                                if (printerBackend == PrinterBackend.TSC_BLUETOOTH && !hasBluetoothPermission()) {
                                    requestBluetoothPermission()
                                    return@Button
                                }
                                scope.launch {
                                    app.appPrefs.setPrinterBackend(printerBackend.prefValue)
                                    app.appPrefs.setPrinterBluetoothMac(printerMacInput.ifBlank { null })
                                    app.appPrefs.setLabelTemplateTspl(templateInput)
                                    app.repository.syncDevicePrefsToServer()
                                    previewPayload = LabelPrintService.samplePayload()
                                }
                            },
                            enabled = !printBusy,
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(if (printBusy) "Печать…" else "Тестовая печать")
                        }
                    }

                    SettingsTab.UPDATE -> {
                        TsdUpdateSettingsSection(app = app, serverBaseUrl = baseUrl.ifBlank { savedBaseUrl })
                    }
                }
                Spacer(Modifier.height(8.dp))
            }
        }
    }

    previewPayload?.let { payload ->
        LabelPreviewDialog(
            payload = payload,
            onDismiss = { previewPayload = null },
            onConfirmPrint = {
                scope.launch {
                    printBusy = true
                    printStatus = null
                    previewPayload = null
                    val result = LabelPrintService.print(context, app.appPrefs, payload)
                    printBusy = false
                    result.fold(
                        onSuccess = { msg ->
                            printStatus = msg
                            printSuccess = true
                        },
                        onFailure = { err ->
                            printStatus = err.message ?: "Ошибка печати"
                            printSuccess = false
                        },
                    )
                }
            },
        )
    }
}

@Composable
private fun SettingsStatusCard(message: String?, success: Boolean?, loading: Boolean) {
    if (loading) {
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
    }
    if (!message.isNullOrBlank()) {
        val bg = when (success) {
            true -> Color(0xFFE8F5E9)
            false -> Color(0xFFFFEBEE)
            null -> Color(0xFFF5F5F5)
        }
        val fg = when (success) {
            true -> Color(0xFF2E7D32)
            false -> ErrorRed
            null -> Color.DarkGray
        }
        Card(
            modifier = Modifier.fillMaxWidth(),
            colors = CardDefaults.cardColors(containerColor = bg),
            shape = RoundedCornerShape(12.dp),
        ) {
            Text(message, color = fg, fontSize = 13.sp, modifier = Modifier.padding(12.dp))
        }
    }
}

@Composable
private fun UrlHints(baseUrl: String) {
    when {
        WmsEndpointConfig.isKnownMisconfiguredProductionHost(baseUrl) -> Text("scada.ru не существует. Используйте https://scada25.ru/", color = ErrorRed, fontSize = 11.sp)
        baseUrl.contains("10.0.2.2") -> Text("10.0.2.2 — только эмулятор. На ТСД: https://scada25.ru/ или LAN-IP.", color = ErrorRed, fontSize = 11.sp)
        baseUrl.contains("127.0.0.1") || baseUrl.contains("localhost") -> Text("localhost не работает на физическом ТСД.", color = ErrorRed, fontSize = 11.sp)
        else -> Text("Прод: https://scada25.ru/", color = Color.Gray, fontSize = 11.sp)
    }
}
