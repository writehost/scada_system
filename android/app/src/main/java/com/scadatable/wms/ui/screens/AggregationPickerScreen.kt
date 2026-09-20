package com.scadatable.wms.ui.screens

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.aggregation.AggregationModeOption
import com.scadatable.wms.aggregation.AggregationModes
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import kotlinx.coroutines.flow.first

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AggregationPickerScreen(navController: NavController) {
    val context = LocalContext.current
    val db = remember { WmsDatabase.getDatabase(context) }
    var draftDocs by remember { mutableIntStateOf(0) }

    LaunchedEffect(Unit) {
        val docs = db.wmsDao().getAggregationDocuments().first()
        draftDocs = docs.count { it.status == "draft" }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Агрегация", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Выберите, что нужно сделать", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (draftDocs > 0) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                ) {
                    Text(
                        "Черновиков: $draftDocs — откроются внутри выбранной операции",
                        modifier = Modifier.padding(12.dp),
                        color = Color(0xFF6B6B6B),
                        fontSize = 12.sp,
                    )
                }
            }

            AggregationModes.options.forEach { option ->
                AggregationModuleCard(
                    option = option,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        if (option.enabled) {
                            navController.navigate(Screen.AggregationSession.createRoute(option.routeKey))
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun AggregationModuleCard(
    option: AggregationModeOption,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Card(
        onClick = onClick,
        enabled = option.enabled,
        modifier = modifier.heightIn(min = 120.dp),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = Color.White,
            disabledContainerColor = Color(0xFFF3F3F3),
        ),
        elevation = CardDefaults.cardElevation(2.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                modifier = Modifier
                    .size(88.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color(0xFFF8F9F5)),
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    painter = painterResource(getDrawableSafely(option.imageRes)),
                    contentDescription = option.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                    alpha = if (option.enabled) 1f else 0.45f,
                )
            }
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    text = option.title,
                    fontWeight = FontWeight.Bold,
                    color = if (option.enabled) DarkGreen else Color(0xFF9E9E9E),
                    fontSize = 16.sp,
                    lineHeight = 20.sp,
                    maxLines = 2,
                )
                Text(
                    text = if (option.enabled) option.subtitle else "Скоро",
                    color = if (option.enabled) Color(0xFF5A5A5A) else Color(0xFFB0B0B0),
                    fontSize = 13.sp,
                    lineHeight = 17.sp,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
