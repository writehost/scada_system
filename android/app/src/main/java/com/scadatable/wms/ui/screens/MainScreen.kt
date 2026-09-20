package com.scadatable.wms.ui.screens

import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.PlatformTextStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavController
import androidx.lifecycle.viewmodel.compose.viewModel
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.R
import com.scadatable.wms.data.remote.RetrofitClient
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.components.TsdAutoUpdateCheck
import com.scadatable.wms.ui.theme.*
import com.scadatable.wms.viewmodel.DeviceViewModel
import com.scadatable.wms.viewmodel.DeviceViewModelFactory
import com.scadatable.wms.viewmodel.SyncViewModel
import com.scadatable.wms.viewmodel.SyncViewModelFactory
import com.scadatable.wms.viewmodel.TasksViewModel
import com.scadatable.wms.viewmodel.TasksViewModelFactory
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun MainScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val deviceVm: DeviceViewModel = viewModel(factory = DeviceViewModelFactory(app.repository, app.appPrefs))
    val syncVm: SyncViewModel = viewModel(factory = SyncViewModelFactory(app.repository))
    val tasksVm: TasksViewModel = viewModel(factory = TasksViewModelFactory(app.repository))
    val deviceState by deviceVm.uiState.collectAsState()
    val syncState by syncVm.uiState.collectAsState()
    val tasksState by tasksVm.uiState.collectAsState()
    val tasks by tasksVm.tasks.collectAsState()
    val savedBaseUrl by app.appPrefs.baseUrl.collectAsState(initial = RetrofitClient.getBaseUrl())
    val isRefreshing = deviceState.loading || syncState.syncing || tasksState.loading

    fun refreshMain() {
        deviceVm.bootstrap()
        syncVm.refreshAll()
        tasksVm.refresh()
    }

    val openCount = tasks.count { it.taskStatus.equals("open", true) }
    val inProgressCount = tasks.count {
        val s = it.taskStatus.lowercase()
        s == "claimed" || s == "in_progress" || s == "started" || s == "on_hold"
    }

    LaunchedEffect(Unit) {
        deviceVm.bootstrap()
        syncVm.refreshAll()
        tasksVm.refresh()
    }

    TsdAutoUpdateCheck(
        app = app,
        serverBaseUrl = savedBaseUrl,
        enabled = savedBaseUrl.isNotBlank(),
    )

    Scaffold(
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Box(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                if (isRefreshing) {
                    LinearWavyProgressIndicator(
                        modifier = Modifier.fillMaxWidth(),
                        color = DarkGreen,
                        wavelength = 36.dp,
                        waveSpeed = 3.dp,
                        amplitude = 0.4f
                    )
                }
                PullToRefreshBox(
                    isRefreshing = isRefreshing,
                    onRefresh = { refreshMain() },
                    modifier = Modifier.fillMaxSize(),
                    // Только волна сверху — без круглого индикатора pull-to-refresh.
                    indicator = {},
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                    ) {
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 10.dp),
                            colors = CardDefaults.cardColors(containerColor = Color.White),
                            onClick = { navController.navigate(Screen.Tasks.route) }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("Задачи", color = DarkGreen, fontWeight = FontWeight.SemiBold)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Surface(shape = RoundedCornerShape(10.dp), color = Color(0xFFF6F3E8)) {
                                        Text(
                                            text = "Открытые: $openCount",
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                            color = Color(0xFF8A6A00),
                                            fontSize = 12.sp
                                        )
                                    }
                                    Surface(shape = RoundedCornerShape(10.dp), color = Color(0xFFEAF3FF)) {
                                        Text(
                                            text = "В работе: $inProgressCount",
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                            color = Color(0xFF2F64C8),
                                            fontSize = 12.sp
                                        )
                                    }
                                }
                            }
                        }

                        if (deviceState.healthy == false && !deviceState.error.isNullOrBlank()) {
                            Card(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(bottom = 10.dp),
                                colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
                                onClick = { navController.navigate(Screen.Settings.route) }
                            ) {
                                Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                                    Text("Нет связи с сервером", color = ErrorRed, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                                    Text(
                                        deviceState.error.orEmpty(),
                                        color = Color(0xFF8A1C1C),
                                        fontSize = 12.sp,
                                        modifier = Modifier.padding(top = 4.dp)
                                    )
                                    Text(
                                        "Нажмите, чтобы открыть настройки подключения",
                                        color = Color.Gray,
                                        fontSize = 11.sp,
                                        modifier = Modifier.padding(top = 4.dp)
                                    )
                                }
                            }
                        }

                        // Grid of operations
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                SiteModuleCard(
                                    label = "Выдача",
                                    subtitle = "Изъятие/отгрузка",
                                    imageRes = getDrawableSafely(R.drawable.img_issue_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Issue.route) }
                                )
                                SiteModuleCard(
                                    label = "Приемка",
                                    subtitle = "Приемка поставки",
                                    imageRes = getDrawableSafely(R.drawable.img_receiving),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Receiving.route) }
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                SiteModuleCard(
                                    label = "Размещение",
                                    subtitle = "Код партии → ячейка",
                                    imageRes = getDrawableSafely(R.drawable.img_putaway_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Putaway.route) }
                                )
                                SiteModuleCard(
                                    label = "Агрегация",
                                    subtitle = "Блок, паллета, изъятие",
                                    imageRes = getDrawableSafely(R.drawable.img_aggregation_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Aggregation.route) }
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                SiteModuleCard(
                                    label = "Перемещение",
                                    subtitle = "Свободный перенос",
                                    imageRes = getDrawableSafely(R.drawable.img_movement_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Movement.createRoute()) }
                                )
                                SiteModuleCard(
                                    label = "Палета",
                                    subtitle = "Ячейка → коробка → товар",
                                    imageRes = getDrawableSafely(R.drawable.img_putaway_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.LpnNest.route) }
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                SiteModuleCard(
                                    label = "Склад",
                                    subtitle = "ГП и материалы",
                                    imageRes = getDrawableSafely(R.drawable.img_warehouse_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Inventory.route) }
                                )
                                SiteModuleCard(
                                    label = "Номенклатура",
                                    subtitle = "Список и поиск",
                                    imageRes = getDrawableSafely(R.drawable.img_nomenclature_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.Nomenclature.route) }
                                )
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
                                SiteModuleCard(
                                    label = "Создать код",
                                    subtitle = "GTIN и QR для партии",
                                    imageRes = getDrawableSafely(R.drawable.img_nomenclature_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.CreateCodeWizard.route) }
                                )
                                SiteModuleCard(
                                    label = "APS",
                                    subtitle = "План выпуска и MRP",
                                    imageRes = getDrawableSafely(R.drawable.img_warehouse_card),
                                    modifier = Modifier.weight(1f),
                                    onClick = { navController.navigate(Screen.ProductionPlans.route) }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun getDrawableSafely(resId: Int): Int {
    return if (resId != 0) resId else R.drawable.ic_launcher_background
}

@Composable
fun SiteModuleCard(
    label: String,
    subtitle: String,
    imageRes: Int,
    imageUrl: String? = null,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit = {}
) {
    Card(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(196.dp),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color.White,
            disabledContainerColor = Color(0xFFF3F3F3),
        ),
        elevation = CardDefaults.cardElevation(3.dp)
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .height(112.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
                    .background(Color(0xFFF8F9F5))
            ) {
                RemoteOrLocalImage(imageUrl = imageUrl, imageRes = imageRes, enabled = enabled)
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .height(3.dp)
                        .background(Color(0xFFF8F9F5))
                )
            }
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .background(Color.White)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                contentAlignment = Alignment.CenterStart
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        label,
                        fontWeight = FontWeight.Bold,
                        color = if (enabled) Color(0xFF111111) else Color(0xFF9E9E9E),
                        fontSize = 17.sp,
                        lineHeight = 18.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = TextStyle(platformStyle = PlatformTextStyle(includeFontPadding = false)),
                    )
                    Spacer(Modifier.height(2.dp))
                    AdaptiveTileSubtitle(
                        text = subtitle,
                        enabled = enabled,
                    )
                }
            }
        }
    }
}

/** Умещает описание в нижней части плитки без изменения её высоты. */
@Composable
private fun AdaptiveTileSubtitle(
    text: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val clean = text.trim()
    if (clean.isEmpty()) return

    var fontSize by remember(clean) { mutableStateOf(tileSubtitleStartSize(clean)) }
    val color = if (enabled) Color(0xFF5F5F5F) else Color(0xFFB0B0B0)

    Text(
        text = clean,
        modifier = modifier.fillMaxWidth(),
        color = color,
        fontSize = fontSize,
        lineHeight = (fontSize.value * 1.15f).sp,
        maxLines = 4,
        overflow = TextOverflow.Clip,
        style = TextStyle(platformStyle = PlatformTextStyle(includeFontPadding = false)),
        onTextLayout = { layout ->
            if (layout.didOverflowHeight && fontSize > 9.sp) {
                val next = (fontSize.value - 0.5f).sp
                if (next != fontSize) fontSize = next
            }
        },
    )
}

private fun tileSubtitleStartSize(text: String): TextUnit =
    when {
        text.length <= 24 -> 12.sp
        text.length <= 40 -> 11.sp
        text.length <= 58 -> 10.sp
        else -> 9.5.sp
    }

@Composable
private fun RemoteOrLocalImage(imageUrl: String?, imageRes: Int, enabled: Boolean) {
    var bitmap by remember(imageUrl) { mutableStateOf<android.graphics.Bitmap?>(null) }
    val cleanUrl = remember(imageUrl) {
        val raw = imageUrl?.trim().orEmpty()
        when {
            raw.startsWith("http://") || raw.startsWith("https://") -> raw
            raw.startsWith("/") -> RetrofitClient.getBaseUrl().trimEnd('/') + raw
            else -> null
        }
    }

    LaunchedEffect(cleanUrl) {
        bitmap = null
        if (cleanUrl != null) {
            bitmap = withContext(Dispatchers.IO) {
                runCatching {
                    val conn = (URL(cleanUrl).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 5000
                        readTimeout = 5000
                    }
                    conn.inputStream.use { BitmapFactory.decodeStream(it) }
                }.getOrNull()
            }
        }
    }

    val remote = bitmap
    if (remote != null) {
        Image(
            painter = BitmapPainter(remote.asImageBitmap()),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
            alpha = if (enabled) 1f else 0.45f,
        )
    } else {
        Image(
            painter = painterResource(imageRes),
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop,
            alpha = if (enabled) 1f else 0.45f,
        )
    }
}
