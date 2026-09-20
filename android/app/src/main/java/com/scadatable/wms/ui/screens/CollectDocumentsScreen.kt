package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
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
import androidx.compose.material.icons.filled.Description
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.local.CollectScanDocument
import com.scadatable.wms.data.local.WmsDatabase
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import com.scadatable.wms.viewmodel.ScannerViewModel
import com.scadatable.wms.viewmodel.ScannerViewModelFactory
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectDocumentsScreen(navController: NavController) {
    val context = LocalContext.current
    val db = remember { WmsDatabase.getDatabase(context) }
    val app = context.applicationContext as WmsApplication
    val viewModel: ScannerViewModel = viewModel(factory = ScannerViewModelFactory(db.wmsDao(), app.repository))
    val documents by viewModel.collectDocuments.collectAsState()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Списки кодов", fontWeight = FontWeight.Bold, color = DarkGreen, fontSize = 18.sp)
                        Text(
                            "Синхронизируются в раздел «Документы» на сервере",
                            color = Color(0xFF757575),
                            fontSize = 12.sp,
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SoftWhiteBackground,
                    titleContentColor = DarkGreen,
                ),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = null, tint = DarkGreen)
                    }
                },
            )
        },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        if (documents.isEmpty()) {
            Column(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(Icons.Default.Description, contentDescription = null, tint = Color(0xFFBDBDBD))
                Spacer(modifier = Modifier.height(12.dp))
                Text("Пока нет списков", color = Color(0xFF757575), fontSize = 16.sp)
                Text(
                    "Создайте список в сканере: режим «Список» → сканируйте коды",
                    color = Color(0xFF9E9E9E),
                    fontSize = 13.sp,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(documents, key = { it.id }) { doc ->
                    CollectDocumentCard(
                        doc = doc,
                        onOpen = {
                            viewModel.openCollectDocument(doc.id)
                            navController.navigate(Screen.Scan.route) {
                                popUpTo(Screen.Scan.route) { inclusive = true }
                                launchSingleTop = true
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun CollectDocumentCard(doc: CollectScanDocument, onOpen: () -> Unit) {
    val dateLabel = remember(doc.createdAt) {
        SimpleDateFormat("dd.MM.yyyy HH:mm", Locale("ru")).format(Date(doc.createdAt))
    }
    Card(
        onClick = onOpen,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "SCAN-${doc.id.take(8).uppercase()}",
                    color = DarkGreen,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    fontFamily = FontFamily.Monospace,
                )
                Text(dateLabel, color = Color(0xFF757575), fontSize = 12.sp)
                if (!doc.serverCodeListId.isNullOrBlank()) {
                    Text(
                        "На сервере: code-list:${doc.serverCodeListId}",
                        color = Color(0xFF9E9E9E),
                        fontSize = 11.sp,
                    )
                } else {
                    Text("Только на ТСД (ожидает синхронизации)", color = Color(0xFFE65100), fontSize = 11.sp)
                }
            }
        }
    }
}
