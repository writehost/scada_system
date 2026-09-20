package com.scadatable.wms.ui.components

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Assignment
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import androidx.navigation.compose.currentBackStackEntryAsState
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.viewmodel.NotificationsViewModel
import com.scadatable.wms.viewmodel.NotificationsViewModelFactory

@Composable
fun WmsBottomBar(navController: NavController, profileLabel: String = "Профиль") {
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = navBackStackEntry?.destination?.route
    val context = LocalContext.current
    val activity = context as ComponentActivity
    val app = context.applicationContext as WmsApplication
    val db = remember { WmsDatabase.getDatabase(context) }
    val notificationsVm: NotificationsViewModel = viewModel(
        viewModelStoreOwner = activity,
        factory = NotificationsViewModelFactory(app.repository, db.wmsDao()),
    )
    val notificationsState by notificationsVm.uiState.collectAsState()
    val hasUnreadEvents = notificationsState.unreadCount > 0 &&
        currentRoute != Screen.Notifications.route

    LaunchedEffect(currentRoute) {
        notificationsVm.refresh()
    }

    Box(modifier = Modifier.fillMaxWidth().height(70.dp)) {
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .height(70.dp),
            color = Color.White.copy(alpha = 0.92f),
            shadowElevation = 16.dp,
        ) {
            Row(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BottomNavItem(
                    label = "Главная",
                    icon = Icons.Default.Dashboard,
                    selected = currentRoute == Screen.Main.route,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        if (currentRoute != Screen.Main.route) navController.navigate(Screen.Main.route)
                    },
                )
                BottomNavItem(
                    label = "Задачи",
                    icon = Icons.AutoMirrored.Filled.Assignment,
                    selected = currentRoute == Screen.Tasks.route,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        if (currentRoute != Screen.Tasks.route) navController.navigate(Screen.Tasks.route)
                    },
                )
                Spacer(Modifier.width(72.dp))
                BottomNavItem(
                    label = "События",
                    icon = Icons.Default.Notifications,
                    selected = currentRoute == Screen.Notifications.route,
                    showUnreadDot = hasUnreadEvents,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        if (currentRoute != Screen.Notifications.route) {
                            navController.navigate(Screen.Notifications.route)
                        }
                    },
                )
                BottomNavItem(
                    label = profileLabel,
                    icon = Icons.Outlined.PersonOutline,
                    selected = currentRoute == Screen.Settings.route,
                    modifier = Modifier.weight(1f),
                    onClick = {
                        if (currentRoute != Screen.Settings.route) navController.navigate(Screen.Settings.route)
                    },
                )
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .offset(y = (-18).dp)
                .size(70.dp)
                .shadow(8.dp, RoundedCornerShape(24.dp))
                .background(LimeAccent, RoundedCornerShape(24.dp))
                .clickable {
                    if (currentRoute != Screen.Scan.route) navController.navigate(Screen.Scan.route)
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Default.QrCodeScanner, null, tint = DarkGreen, modifier = Modifier.size(36.dp))
        }
    }
}

@Composable
private fun BottomNavItem(
    label: String,
    icon: ImageVector,
    selected: Boolean,
    modifier: Modifier = Modifier,
    showUnreadDot: Boolean = false,
    onClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp, horizontal = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier.size(28.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                contentDescription = label,
                tint = if (selected) DarkGreen else Color.Gray,
                modifier = Modifier.size(24.dp),
            )
            if (showUnreadDot) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .offset(x = 2.dp, y = 0.dp)
                        .size(8.dp)
                        .background(Color(0xFFE53935), CircleShape),
                )
            }
        }
        Spacer(Modifier.height(2.dp))
        Text(
            text = label,
            fontSize = 10.sp,
            lineHeight = 11.sp,
            color = if (selected) DarkGreen else Color.Gray,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
