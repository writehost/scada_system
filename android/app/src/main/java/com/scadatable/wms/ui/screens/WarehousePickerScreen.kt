package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.warehouse.WarehouseKind

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WarehousePickerScreen(navController: NavController) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Склад", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Выберите тип склада", fontSize = 12.sp, color = Color(0xFF6B6B6B))
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
            Text(
                "ТИП СКЛАДА",
                color = DarkGreen,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SiteModuleCard(
                    label = "Склад готовой продукции",
                    subtitle = "Остатки ГП",
                    imageRes = getDrawableSafely(WarehouseKind.FINISHED_GOODS.tileImageRes),
                    modifier = Modifier.weight(1f),
                    onClick = { navController.navigate(Screen.WarehouseFinishedGoods.route) },
                )
                SiteModuleCard(
                    label = "Склад материалов",
                    subtitle = "Материалы и комплектующие",
                    imageRes = getDrawableSafely(WarehouseKind.MATERIALS.tileImageRes),
                    modifier = Modifier.weight(1f),
                    onClick = { navController.navigate(Screen.WarehouseMaterials.route) },
                )
            }
        }
    }
}
