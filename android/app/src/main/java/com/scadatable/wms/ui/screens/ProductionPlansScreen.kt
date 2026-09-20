package com.scadatable.wms.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronLeft
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.ProductionPlanDto
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.LimeAccent
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.ProductionPlansViewModel
import com.scadatable.wms.viewmodel.ProductionPlansViewModelFactory
import java.time.Month
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.roundToLong

@Composable
fun ProductionPlansScreen(navController: NavController) {
    val app = LocalContext.current.applicationContext as WmsApplication
    val vm: ProductionPlansViewModel = viewModel(
        factory = ProductionPlansViewModelFactory(app.repository),
    )
    val state by vm.uiState.collectAsState()

    Scaffold(
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 12.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { navController.popBackStack() }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад")
                }
                Column(modifier = Modifier.weight(1f)) {
                    Text("APS · план выпуска", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = DarkGreen)
                    Text("Заказы, MRP и резерв материалов", fontSize = 12.sp, color = Color.Gray)
                }
                IconButton(onClick = vm::refresh) {
                    Icon(Icons.Default.Refresh, contentDescription = "Обновить", tint = DarkGreen)
                }
            }

            MonthToolbar(
                month = state.month.month,
                year = state.month.year,
                onPrevious = vm::previousMonth,
                onCurrent = vm::currentMonth,
                onNext = vm::nextMonth,
            )

            val shortage = state.plans.count { it.shortageCount > 0 }
            val covered = state.plans.count { it.isFullyCovered }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                SummaryChip("Заказы ${state.plans.size}", Color(0xFFF2EFE5), DarkGreen, Modifier.weight(1f))
                SummaryChip("Дефицит $shortage", Color(0xFFFFE8E8), Color(0xFFB3261E), Modifier.weight(1f))
                SummaryChip("Готовы $covered", Color(0xFFE4F5EA), Color(0xFF08783E), Modifier.weight(1f))
            }

            when {
                state.loading && state.plans.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(color = LimeAccent)
                }
                state.error != null && state.plans.isEmpty() -> ErrorPanel(state.error.orEmpty(), vm::refresh)
                state.plans.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("На выбранный месяц заказов нет", color = Color.Gray)
                }
                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (state.error != null) {
                        item { ErrorPanel(state.error.orEmpty(), vm::refresh) }
                    }
                    items(state.plans, key = { it.planId }) { plan ->
                        ProductionPlanCard(plan)
                    }
                    item { Spacer(Modifier.height(8.dp)) }
                }
            }
        }
    }
}

@Composable
private fun MonthToolbar(
    month: Month,
    year: Int,
    onPrevious: () -> Unit,
    onCurrent: () -> Unit,
    onNext: () -> Unit,
) {
    Surface(shape = RoundedCornerShape(16.dp), color = Color.White) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onPrevious) { Icon(Icons.Default.ChevronLeft, "Предыдущий месяц") }
            Text(
                "${month.getDisplayName(TextStyle.FULL_STANDALONE, Locale("ru"))} $year"
                    .replaceFirstChar { it.uppercase() },
                modifier = Modifier.weight(1f),
                fontWeight = FontWeight.Bold,
            )
            Button(
                onClick = onCurrent,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFF2EFE5), contentColor = DarkGreen),
            ) { Text("Сегодня") }
            IconButton(onClick = onNext) { Icon(Icons.Default.ChevronRight, "Следующий месяц") }
        }
    }
}

@Composable
private fun SummaryChip(text: String, background: Color, foreground: Color, modifier: Modifier = Modifier) {
    Surface(modifier = modifier, shape = RoundedCornerShape(12.dp), color = background) {
        Text(text, modifier = Modifier.padding(horizontal = 8.dp, vertical = 7.dp), color = foreground, fontSize = 12.sp)
    }
}

@Composable
private fun ProductionPlanCard(plan: ProductionPlanDto) {
    val shortage = plan.shortageCount > 0
    val statusColor = when {
        shortage -> Color(0xFFB3261E)
        plan.reservedAt != null -> Color(0xFF08783E)
        plan.isFullyCovered -> Color(0xFF1565C0)
        else -> Color(0xFF6B6252)
    }
    val statusLabel = when {
        shortage -> "Дефицит: ${plan.shortageCount}"
        plan.reservedAt != null -> "Резерв"
        plan.isFullyCovered -> "MRP OK"
        else -> plan.status
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(plan.itemName, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    Text(
                        "${plan.code} · ${plan.itemCode}",
                        color = Color.Gray,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Surface(shape = RoundedCornerShape(10.dp), color = statusColor.copy(alpha = 0.12f)) {
                    Text(
                        statusLabel,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                        color = statusColor,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                PlanMetric("План", formatQty(plan.plannedQty))
                PlanMetric("Период", formatPeriod(plan))
                PlanMetric("Линия", plan.lineCode ?: plan.workshopCode ?: "—")
            }
            val materials = plan.materials.orEmpty()
            if (materials.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                val required = materials.sumOf { it.requiredQty }
                val available = materials.sumOf { it.availableQty }
                Text(
                    "Материалы: ${materials.size} · доступно ${formatQty(available)} из ${formatQty(required)}",
                    fontSize = 11.sp,
                    color = if (shortage) Color(0xFFB3261E) else Color(0xFF52604E),
                )
            }
        }
    }
}

@Composable
private fun PlanMetric(label: String, value: String) {
    Column {
        Text(label, color = Color.Gray, fontSize = 10.sp)
        Text(value, color = DarkGreen, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun ErrorPanel(message: String, retry: () -> Unit) {
    Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFEBEE))) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(message, modifier = Modifier.weight(1f), color = Color(0xFF8A1C1C), fontSize = 12.sp)
            Button(onClick = retry) { Text("Повторить") }
        }
    }
}

private fun formatQty(value: Double): String =
    if (value == value.roundToLong().toDouble()) "%,d".format(Locale("ru"), value.roundToLong())
    else "%.2f".format(Locale("ru"), value)

private fun formatPeriod(plan: ProductionPlanDto): String =
    if (plan.planDateTo.isNullOrBlank() || plan.planDateTo == plan.planDate) plan.planDate
    else "${plan.planDate}–${plan.planDateTo}"
