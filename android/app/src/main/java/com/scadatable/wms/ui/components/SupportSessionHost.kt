package com.scadatable.wms.ui.components

import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.scadatable.wms.support.SupportSessionController

@Composable
fun SupportSessionHost(
    navController: NavHostController,
    content: @Composable () -> Unit,
) {
    val activity = LocalActivity.current
    val state by SupportSessionController.uiState.collectAsState()

    DisposableEffect(activity) {
        if (activity != null) SupportSessionController.attachActivity(activity)
        onDispose { }
    }

    LaunchedEffect(navController) {
        navController.addOnDestinationChangedListener { _, destination, _ ->
            SupportSessionController.onRouteChanged(destination.route.orEmpty())
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        content()
        if (state.activeSession != null) {
            Surface(
                tonalElevation = 4.dp,
                shadowElevation = 6.dp,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth(),
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        "Поддержка активна",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    TextButton(onClick = { SupportSessionController.endActiveLocally() }) {
                        Text("Завершить")
                    }
                }
            }
        }
    }

    state.pendingSession?.let { session ->
        AlertDialog(
            onDismissRequest = { SupportSessionController.declinePending() },
            title = { Text("Запрос поддержки") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Администратор WMS просит временный доступ для помощи по телефону.")
                    Text(
                        "Будут видны экран приложения, ошибки API и снимок по запросу. Сессия автоматически завершится через ~20 минут.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (session.requestedBy?.isNotBlank() == true) {
                        Text("Запросил: ${session.requestedBy}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            },
            confirmButton = {
                Button(onClick = { SupportSessionController.acceptPending() }, enabled = !state.responding) {
                    Text("Разрешить")
                }
            },
            dismissButton = {
                TextButton(onClick = { SupportSessionController.declinePending() }, enabled = !state.responding) {
                    Text("Отклонить")
                }
            },
        )
    }
}
