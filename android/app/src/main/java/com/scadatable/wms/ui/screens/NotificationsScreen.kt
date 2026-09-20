package com.scadatable.wms.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.ErrorRed
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.NotificationKind
import com.scadatable.wms.viewmodel.NotificationLevel
import com.scadatable.wms.viewmodel.NotificationsViewModel
import com.scadatable.wms.viewmodel.NotificationsViewModelFactory
import com.scadatable.wms.viewmodel.WmsNotification
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun NotificationsScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val db = remember { WmsDatabase.getDatabase(context) }
    val vm: NotificationsViewModel = viewModel(
        factory = NotificationsViewModelFactory(app.repository, db.wmsDao()),
    )
    val state by vm.uiState.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Уведомления", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text(
                            if (state.unreadCount > 0) "${state.unreadCount} требуют внимания" else "Всё актуально",
                            fontSize = 12.sp,
                            color = Color(0xFF6B6B6B),
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { vm.refresh() }, enabled = !state.loading) {
                        Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = DarkGreen)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize(),
        ) {
            if (state.loading && state.items.isEmpty()) {
                LinearWavyProgressIndicator(
                    modifier = Modifier.fillMaxWidth(),
                    color = DarkGreen,
                    wavelength = 24.dp,
                    waveSpeed = 4.dp,
                    amplitude = 0.5f
                )
            }
            state.error?.let { msg ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE)),
                ) {
                    Text(msg, modifier = Modifier.padding(12.dp), color = ErrorRed, fontSize = 13.sp)
                }
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.items, key = { it.id }) { item ->
                    NotificationCard(
                        item = item,
                        onClick = { navigateFromNotification(navController, item) },
                    )
                }
            }
        }
    }
}

private fun navigateFromNotification(navController: NavController, item: WmsNotification) {
    when (item.actionRoute) {
        "tasks" -> navController.navigate(Screen.Tasks.route)
        "receiving" -> navController.navigate(Screen.Receiving.route)
        "receiving_documents" -> navController.navigate(Screen.ReceivingDocuments.allDocumentsRoute())
    }
}

@Composable
private fun NotificationCard(item: WmsNotification, onClick: () -> Unit) {
    val (icon, tint, bg) = notificationVisuals(item)
    val clickable = item.actionRoute != null && item.id != "empty"

    Card(
        onClick = { if (clickable) onClick() },
        enabled = clickable,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                modifier = Modifier
                    .size(42.dp)
                    .background(bg, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        item.title,
                        fontWeight = FontWeight.SemiBold,
                        color = DarkGreen,
                        fontSize = 14.sp,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        formatNotificationTime(item.time),
                        color = Color(0xFF9E9E9E),
                        fontSize = 10.sp,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Text(
                    item.body,
                    color = Color(0xFF5A5A5A),
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                )
                if (clickable) {
                    Text(
                        "Открыть →",
                        color = DarkGreen,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
    }
}

private fun notificationVisuals(item: WmsNotification): Triple<ImageVector, Color, Color> {
    val tint = when (item.level) {
        NotificationLevel.ERROR -> Color(0xFFC62828)
        NotificationLevel.WARNING -> Color(0xFFE65100)
        NotificationLevel.INFO -> DarkGreen
    }
    val bg = tint.copy(alpha = 0.12f)
    val icon = when (item.kind) {
        NotificationKind.TASK -> Icons.Default.Assignment
        NotificationKind.RECEIVING -> Icons.Default.Inventory
        NotificationKind.SYNC -> Icons.Default.CloudSync
        NotificationKind.SYSTEM -> Icons.Default.NotificationsNone
    }
    return Triple(icon, tint, bg)
}

private fun formatNotificationTime(ts: Long): String {
    if (ts <= 0L) return ""
    return SimpleDateFormat("dd.MM HH:mm", Locale("ru")).format(Date(ts))
}
