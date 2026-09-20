package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavController
import com.scadatable.wms.WmsApplication
import com.scadatable.wms.data.remote.LpnNestActionRequest
import com.scadatable.wms.data.remote.LpnNestNodeDto
import com.scadatable.wms.data.remote.RetrofitClient
import com.scadatable.wms.navigation.Screen
import com.scadatable.wms.ui.components.WmsBottomBar
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.SoftWhiteBackground
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LpnNestScreen(navController: NavController) {
    val context = LocalContext.current
    val app = context.applicationContext as WmsApplication
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    var locationCode by remember { mutableStateOf("") }
    var palletCode by remember { mutableStateOf("") }
    var boxCode by remember { mutableStateOf("") }
    var itemCode by remember { mutableStateOf("") }
    var qty by remember { mutableStateOf("1") }
    var busy by remember { mutableStateOf(false) }
    var tree by remember { mutableStateOf<LpnNestNodeDto?>(null) }
    var roots by remember { mutableStateOf<List<LpnNestNodeDto>>(emptyList()) }
    var status by remember { mutableStateOf<String?>(null) }

    fun typeTitle(t: String): String = when (t.trim().lowercase()) {
        "pallet" -> "Палета"
        "box", "carton", "case", "tote" -> "Коробка"
        else -> t.ifBlank { "LPN" }
    }

    suspend fun site(): String = app.repository.getSiteCode()

    fun runAction(block: suspend () -> Unit) {
        scope.launch {
            busy = true
            status = null
            runCatching { block() }
                .onFailure { err ->
                    status = err.message
                    snackbar.showSnackbar(err.message ?: "Ошибка")
                }
            busy = false
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Палета / коробка", fontWeight = FontWeight.Bold, color = DarkGreen)
                        Text("Ячейка → палета → коробка → товар", fontSize = 12.sp, color = Color(0xFF6B6B6B))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = SoftWhiteBackground),
                navigationIcon = {
                    IconButton(onClick = { navController.popBackStack() }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Назад", tint = DarkGreen)
                    }
                },
                actions = {
                    TextButton(
                        onClick = {
                            navController.navigate(
                                Screen.FreeReceiving.createRoute(
                                    location = locationCode.trim(),
                                    lpn = palletCode.trim().ifBlank { boxCode.trim() },
                                )
                            )
                        },
                    ) {
                        Text("Приёмка", color = DarkGreen, fontWeight = FontWeight.SemiBold)
                    }
                },
            )
        },
        bottomBar = { WmsBottomBar(navController) },
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = SoftWhiteBackground,
    ) { padding ->
        Column(
            Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Button(
                onClick = {
                    navController.navigate(
                        Screen.FreeReceiving.createRoute(
                            location = locationCode.trim(),
                            lpn = palletCode.trim().ifBlank { boxCode.trim() },
                        )
                    )
                },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                shape = RoundedCornerShape(14.dp),
            ) { Text("Свободная приёмка") }

            OutlinedTextField(
                value = locationCode,
                onValueChange = { locationCode = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Ячейка стеллажа") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
            )
            OutlinedTextField(
                value = palletCode,
                onValueChange = { palletCode = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Палета (LPN)") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
            )
            OutlinedTextField(
                value = boxCode,
                onValueChange = { boxCode = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("Коробка (LPN / STK)") },
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = itemCode,
                    onValueChange = { itemCode = it },
                    modifier = Modifier.weight(1f),
                    label = { Text("Товар") },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                )
                OutlinedTextField(
                    value = qty,
                    onValueChange = { qty = it },
                    modifier = Modifier.width(100.dp),
                    label = { Text("Кол-во") },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                )
            }

            if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth(), color = DarkGreen)
            status?.let { Text(it, color = Color(0xFFB71C1C), fontSize = 12.sp) }

            Button(
                onClick = {
                    runAction {
                        app.repository.applyBaseUrl()
                        val res = RetrofitClient.api.postLpnNest(
                            LpnNestActionRequest(
                                siteCode = site(),
                                action = "place",
                                childCode = palletCode.trim(),
                                locationCode = locationCode.trim(),
                            )
                        )
                        tree = res.tree
                        status = "Палета в ячейке"
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
            ) { Text("Палету в ячейку") }

            Button(
                onClick = {
                    runAction {
                        app.repository.applyBaseUrl()
                        val res = RetrofitClient.api.postLpnNest(
                            LpnNestActionRequest(
                                siteCode = site(),
                                action = "nest",
                                parentCode = palletCode.trim(),
                                childCode = boxCode.trim(),
                            )
                        )
                        tree = res.tree
                        status = "Коробка на палете"
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
            ) { Text("Коробку на палету") }

            Button(
                onClick = {
                    runAction {
                        app.repository.applyBaseUrl()
                        val res = RetrofitClient.api.postLpnNest(
                            LpnNestActionRequest(
                                siteCode = site(),
                                action = "addGoods",
                                lpnCode = palletCode.trim().ifBlank { boxCode.trim() },
                                itemCode = itemCode.trim(),
                                qty = qty.replace(',', '.').toDoubleOrNull(),
                            )
                        )
                        tree = res.tree
                        status = "Товар добавлен"
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Товар на палету/коробку") }

            OutlinedButton(
                onClick = {
                    runAction {
                        app.repository.applyBaseUrl()
                        val sc = site()
                        if (locationCode.isNotBlank()) {
                            val res = RetrofitClient.api.getLpnNest(siteCode = sc, locationCode = locationCode.trim())
                            roots = res.roots
                            tree = null
                        } else if (palletCode.isNotBlank()) {
                            val res = RetrofitClient.api.getLpnNest(siteCode = sc, code = palletCode.trim())
                            tree = res.tree
                            roots = emptyList()
                        }
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Показать дерево") }

            OutlinedButton(
                onClick = {
                    runAction {
                        app.repository.applyBaseUrl()
                        val res = RetrofitClient.api.postLpnNest(
                            LpnNestActionRequest(
                                siteCode = site(),
                                action = "create",
                                loadUnitType = "pallet",
                                locationCode = locationCode.trim().ifBlank { null },
                            )
                        )
                        tree = res.tree
                        palletCode = res.tree?.lpn?.lpnCode.orEmpty()
                        status = "Создана палета $palletCode"
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Создать палету") }

            OutlinedButton(
                onClick = {
                    runAction {
                        app.repository.applyBaseUrl()
                        val res = RetrofitClient.api.postLpnNest(
                            LpnNestActionRequest(
                                siteCode = site(),
                                action = "create",
                                loadUnitType = "box",
                                parentCode = palletCode.trim().ifBlank { null },
                            )
                        )
                        tree = res.tree
                        boxCode = res.tree?.lpn?.lpnCode.orEmpty()
                        status = "Создана коробка $boxCode"
                    }
                },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) { Text("Создать коробку") }

            tree?.let { NestTreeCard(it, ::typeTitle) }
            roots.forEach { NestTreeCard(it, ::typeTitle) }
        }
    }
}

@Composable
private fun NestTreeCard(node: LpnNestNodeDto, typeTitle: (String) -> String) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(14.dp),
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            NestTreeLines(node, typeTitle, 0)
        }
    }
}

@Composable
private fun NestTreeLines(node: LpnNestNodeDto, typeTitle: (String) -> String, depth: Int) {
    val pad = (depth * 12).dp
    Text(
        "${typeTitle(node.lpn.loadUnitType)} · ${node.lpn.lpnCode}",
        fontWeight = FontWeight.SemiBold,
        color = DarkGreen,
        fontFamily = FontFamily.Monospace,
        fontSize = 13.sp,
        modifier = Modifier.padding(start = pad),
    )
    node.lpn.targetLocationCode?.let {
        Text("ячейка $it", fontSize = 11.sp, color = Color.Gray, modifier = Modifier.padding(start = pad))
    }
    node.lines.forEach { line ->
        Text(
            "${line.itemName} · ${line.qty} ${line.uom}",
            fontSize = 12.sp,
            modifier = Modifier.padding(start = pad + 8.dp),
        )
    }
    node.children.forEach { NestTreeLines(it, typeTitle, depth + 1) }
}
