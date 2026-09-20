package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scadatable.wms.receiving.ReceivingProductGroups
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.viewmodel.ReceivingUiState
import com.scadatable.wms.viewmodel.ReceivingViewModel

@OptIn(ExperimentalMaterial3ExpressiveApi::class)
@Composable
fun ReceivingConfirmPanel(
    uiState: ReceivingUiState,
    currentDocId: String?,
    normalizedGroup: String,
    qtyInput: String,
    onQtyInputChange: (String) -> Unit,
    qtyFocusRequester: FocusRequester,
    viewModel: ReceivingViewModel,
    focusRequester: FocusRequester,
    barcodeInput: String,
    onBarcodeInputChange: (String) -> Unit,
    keyboard: SoftwareKeyboardController?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when (uiState) {
            is ReceivingUiState.Loading -> {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CircularWavyProgressIndicator(
                        color = DarkGreen,
                        wavelength = 36.dp,
                        waveSpeed = 4.dp,
                        amplitude = 0.5f,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text("Запрос в ЧЗ…", color = DarkGreen, fontWeight = FontWeight.SemiBold)
                }
            }
            is ReceivingUiState.ConfirmQuantity -> {
                val state = uiState
                val expired = state.itemStatus == "просрочен" || state.expiryState == "expired"
                val isStickers = normalizedGroup == ReceivingProductGroups.STICKERS
                val parsedQty = qtyInput.toDoubleOrNull()?.takeIf { it > 0.0 } ?: 0.0

                fun accept(print: Boolean) {
                    if (parsedQty <= 0.0) return
                    viewModel.confirmQuantity(
                        state = state,
                        quantity = parsedQty,
                        printRequested = print,
                    )
                    onQtyInputChange("0")
                }

                ReceivingScanInfoCard(
                    title = state.product.name,
                    documentId = currentDocId,
                    gtin = state.resolvedGtin,
                    itemStatus = state.itemStatus,
                    stickerStatus = state.crptStatus,
                    nestedItemName = state.nestedItemName,
                    code = state.scannedCode ?: state.product.barcode,
                    expiryMessage = state.expiryMessage,
                    secondaryNote = state.batchLookupNote ?: state.warnings.joinToString("\n").takeIf { it.isNotBlank() },
                    blocked = state.blocked,
                    blockReason = state.blockReason,
                    expired = expired,
                    warning = state.gateWarning,
                )
                if (!state.blocked) {
                    if (isStickers) {
                        Text(
                            "Сколько стикеров в партии?",
                            color = DarkGreen,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                            modifier = Modifier.fillMaxWidth(),
                            textAlign = TextAlign.Center,
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        FilledTonalIconButton(
                            onClick = {
                                val current = qtyInput.toDoubleOrNull()?.toInt() ?: 0
                                onQtyInputChange((current - 1).coerceAtLeast(0).toString())
                            },
                            colors = IconButtonDefaults.filledTonalIconButtonColors(
                                containerColor = Color(0xFFE8F5E9),
                                contentColor = DarkGreen,
                            ),
                        ) {
                            Icon(Icons.Default.Remove, contentDescription = "Меньше")
                        }
                        OutlinedTextField(
                            value = qtyInput,
                            onValueChange = onQtyInputChange,
                            label = { Text(if (isStickers) "Стикеров" else "Кол-во") },
                            keyboardOptions = KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Done,
                            ),
                            keyboardActions = KeyboardActions(onDone = { accept(print = false) }),
                            modifier = Modifier
                                .weight(1f)
                                .focusRequester(qtyFocusRequester),
                            shape = RoundedCornerShape(14.dp),
                            singleLine = true,
                            textStyle = LocalTextStyle.current.copy(
                                fontSize = 24.sp,
                                fontWeight = FontWeight.Bold,
                                textAlign = TextAlign.Center,
                            ),
                        )
                        FilledTonalIconButton(
                            onClick = {
                                val current = qtyInput.toDoubleOrNull()?.toInt() ?: 0
                                onQtyInputChange((current + 1).toString())
                            },
                            colors = IconButtonDefaults.filledTonalIconButtonColors(
                                containerColor = Color(0xFFE8F5E9),
                                contentColor = DarkGreen,
                            ),
                        ) {
                            Icon(Icons.Default.Add, contentDescription = "Больше")
                        }
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        (if (isStickers) listOf("10", "25", "50", "100", "500") else listOf("1", "5", "10", "25", "50"))
                            .forEach { preset ->
                                FilterChip(
                                    selected = qtyInput == preset,
                                    onClick = { onQtyInputChange(preset) },
                                    label = { Text(preset) },
                                    modifier = Modifier.weight(1f),
                                )
                            }
                    }
                    Button(
                        onClick = { accept(print = false) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(56.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                        shape = RoundedCornerShape(14.dp),
                        enabled = parsedQty > 0.0,
                    ) {
                        Text(
                            "Принять ${formatReceivingQty(parsedQty)} шт",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 16.sp,
                        )
                    }
                    OutlinedButton(
                        onClick = { accept(print = true) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(14.dp),
                        enabled = parsedQty > 0.0,
                    ) {
                        Text("Принять и печать")
                    }
                    TextButton(
                        onClick = { viewModel.cancelConfirmation() },
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    ) {
                        Text("Отмена (нужен повторный скан)")
                    }
                } else {
                    Button(
                        onClick = { viewModel.cancelConfirmation() },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828)),
                    ) {
                        Text("ПОНЯТНО")
                    }
                }
            }
            is ReceivingUiState.MissingProduct -> {
                val state = uiState
                Card(
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF7E8)),
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Код не найден в базе", color = DarkGreen, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                        Text(state.barcode, color = Color(0xFF575757), fontSize = 12.sp)
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            OutlinedButton(
                                onClick = { viewModel.createMissingLater(state.resolvedGtin ?: state.barcode) },
                                modifier = Modifier.weight(1f),
                            ) { Text("Позже") }
                            Button(
                                onClick = { viewModel.createMissingNow(state.resolvedGtin ?: state.barcode) },
                                modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
                            ) { Text("Создать", color = Color.White) }
                        }
                    }
                }
            }
            is ReceivingUiState.Error -> {
                Text(uiState.message, color = Color(0xFFC62828), fontWeight = FontWeight.SemiBold)
                Button(onClick = { viewModel.cancelConfirmation() }, modifier = Modifier.fillMaxWidth()) {
                    Text("Продолжить сканирование")
                }
            }
            is ReceivingUiState.Idle -> {
                OutlinedTextField(
                    value = barcodeInput,
                    onValueChange = onBarcodeInputChange,
                    modifier = Modifier.fillMaxWidth().focusRequester(focusRequester),
                    label = { Text("Сканируй или введи код") },
                    leadingIcon = { Icon(Icons.Default.QrCodeScanner, contentDescription = null, tint = DarkGreen) },
                    singleLine = true,
                    keyboardActions = KeyboardActions(onDone = {
                        viewModel.onBarcodeScanned(barcodeInput)
                        onBarcodeInputChange("")
                        keyboard?.hide()
                    }),
                    shape = RoundedCornerShape(14.dp),
                )
            }
        }
    }
}
