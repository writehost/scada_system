package com.scadatable.wms.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.local.TaskCache
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.*
import com.scadatable.wms.viewmodel.TasksViewModel
import com.scadatable.wms.viewmodel.TasksViewModelFactory
import androidx.lifecycle.viewmodel.compose.viewModel

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun TasksScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val viewModel: TasksViewModel = viewModel(factory = TasksViewModelFactory(app.repository))
    val tasks by viewModel.tasks.collectAsState()
    val uiState by viewModel.uiState.collectAsState()

    LaunchedEffect(Unit) {
        viewModel.refresh()
    }

    val openTasks = remember(tasks) { tasks.filter { taskBucket(it.taskStatus) == "open" } }
    val inProgressTasks = remember(tasks) { tasks.filter { taskBucket(it.taskStatus) == "in_progress" } }
    val doneTasks = remember(tasks) { tasks.filter { taskBucket(it.taskStatus) == "done" } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Задачи", fontWeight = FontWeight.Bold, color = DarkGreen) },
                actions = {
                    TextButton(onClick = {
                        viewModel.replayOutbox()
                        viewModel.refresh()
                    }) {
                        Icon(Icons.Default.Refresh, null, tint = DarkGreen)
                        Text(" Обновить", color = DarkGreen)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground)
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
        ) {
            if (uiState.loading) {
                LinearWavyProgressIndicator(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                    color = DarkGreen,
                    wavelength = 32.dp,
                    waveSpeed = 4.dp,
                    amplitude = 0.5f
                )
            }
            if (uiState.error != null) {
                Card(
                    modifier = Modifier
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                        .fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE))
                ) {
                    Text(uiState.error ?: "", color = ErrorRed, modifier = Modifier.padding(12.dp))
                }
            }
            if (!uiState.loading && tasks.isEmpty()) {
                Card(
                    modifier = Modifier
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                        .fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color.White)
                ) {
                    Text("Задач нет", modifier = Modifier.padding(16.dp), color = Color.Gray)
                }
            }

            LazyRow(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                item {
                    KanbanColumn(
                        title = "Открытые",
                        count = openTasks.size,
                        accent = Color(0xFFE0A72E),
                        tasks = openTasks,
                        onClaim = { viewModel.claim(it) },
                        onStart = { viewModel.start(it) },
                        onComplete = { viewModel.complete(it) },
                        onException = { viewModel.exception(it) },
                    )
                }
                item {
                    KanbanColumn(
                        title = "В работе",
                        count = inProgressTasks.size,
                        accent = Color(0xFF3D72E0),
                        tasks = inProgressTasks,
                        onClaim = { viewModel.claim(it) },
                        onStart = { viewModel.start(it) },
                        onComplete = { viewModel.complete(it) },
                        onException = { viewModel.exception(it) },
                    )
                }
                item {
                    KanbanColumn(
                        title = "Готово",
                        count = doneTasks.size,
                        accent = SuccessGreen,
                        tasks = doneTasks,
                        onClaim = { viewModel.claim(it) },
                        onStart = { viewModel.start(it) },
                        onComplete = { viewModel.complete(it) },
                        onException = { viewModel.exception(it) },
                    )
                }
            }
        }
    }
}

@Composable
private fun KanbanColumn(
    title: String,
    count: Int,
    accent: Color,
    tasks: List<TaskCache>,
    onClaim: (TaskCache) -> Unit,
    onStart: (TaskCache) -> Unit,
    onComplete: (TaskCache) -> Unit,
    onException: (TaskCache) -> Unit,
) {
    Card(
        modifier = Modifier.width(300.dp),
        shape = RoundedCornerShape(20.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        border = BorderStroke(1.dp, accent.copy(alpha = 0.35f))
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(title, fontWeight = FontWeight.SemiBold, color = DarkGreen, fontSize = 14.sp)
            Spacer(Modifier.weight(1f))
            Surface(
                color = accent.copy(alpha = 0.15f),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text(
                    count.toString(),
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    color = accent,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
            }
        }
        HorizontalDivider(color = Color(0xFFECECEC))

        if (tasks.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(420.dp),
                contentAlignment = Alignment.Center
            ) {
                Text("Пусто", color = Color.Gray, fontSize = 12.sp)
            }
        } else {
            LazyColumn(
                modifier = Modifier.height(420.dp),
                contentPadding = PaddingValues(10.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(tasks) { task ->
                    TaskCard(
                        task = task,
                        onClaim = { onClaim(task) },
                        onStart = { onStart(task) },
                        onComplete = { onComplete(task) },
                        onException = { onException(task) },
                    )
                }
            }
        }
    }
}

@Composable
private fun TaskCard(
    task: TaskCache,
    onClaim: () -> Unit,
    onStart: () -> Unit,
    onComplete: () -> Unit,
    onException: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = SoftWhiteBackground),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp)
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(Modifier.size(36.dp), shape = RoundedCornerShape(10.dp), color = Color.White) {
                    Icon(Icons.Default.LocalShipping, null, tint = DarkGreen, modifier = Modifier.padding(7.dp))
                }
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(task.taskCode.ifBlank { "#${task.taskId}" }, fontWeight = FontWeight.Bold, fontSize = 14.sp, color = DarkGreen)
                    Text(
                        "${task.sourceLocationCode ?: "—"} → ${task.targetLocationCode ?: "—"}",
                        color = Color.Gray,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1
                    )
                }
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "${task.taskType} • ${task.taskStatus}",
                color = Color(0xFF5A5A5A),
                fontSize = 11.sp
            )
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when (taskBucket(task.taskStatus)) {
                    "open" -> {
                        TaskActionButton("Взять", Icons.Default.PanTool, Modifier.weight(1f), onClick = onClaim)
                        TaskActionButton("Старт", Icons.Default.PlayArrow, Modifier.weight(1f), onClick = onStart)
                    }
                    "in_progress" -> {
                        TaskActionButton("Готово", Icons.Default.CheckCircle, Modifier.weight(1f), LimeAccent, onClick = onComplete)
                        TaskActionButton("Искл.", Icons.Default.Flag, Modifier.weight(1f), onClick = onException)
                    }
                    else -> {
                        TaskActionButton("Повтор", Icons.Default.Refresh, Modifier.weight(1f), onClick = onClaim)
                        Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskActionButton(
    label: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier,
    color: Color = Color.Transparent,
    onClick: () -> Unit = {},
) {
    Button(
        onClick = onClick,
        modifier = modifier.height(40.dp),
        shape = RoundedCornerShape(12.dp),
        colors = if (color != Color.Transparent) ButtonDefaults.buttonColors(containerColor = color) else ButtonDefaults.buttonColors(containerColor = SoftWhiteBackground)
    ) {
        Icon(icon, null, modifier = Modifier.size(16.dp), tint = DarkGreen)
        Text(" $label", color = DarkGreen, fontSize = 11.sp)
    }
}

private fun taskBucket(status: String?): String {
    val normalized = status.orEmpty().trim().lowercase()
    return when {
        normalized in setOf("open", "new", "released", "created") -> "open"
        normalized in setOf("claimed", "in_progress", "in progress", "on_hold", "started") -> "in_progress"
        else -> "done"
    }
}
