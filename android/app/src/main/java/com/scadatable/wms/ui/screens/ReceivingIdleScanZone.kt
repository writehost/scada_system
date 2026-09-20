package com.scadatable.wms.ui.screens

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scadatable.wms.ui.theme.DarkGreen
import com.scadatable.wms.ui.theme.LimeAccent

@Composable
fun ReceivingIdleScanZone(
    barcodeInput: String,
    onBarcodeInputChange: (String) -> Unit,
    onSubmitBarcode: () -> Unit,
    focusRequester: FocusRequester,
    keyboard: SoftwareKeyboardController?,
    modifier: Modifier = Modifier,
    pendingStickerBatch: String? = null,
) {
    val pulse by rememberInfiniteTransition(label = "scanPulse").animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(900), RepeatMode.Reverse),
        label = "pulseAlpha",
    )

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF0F7EA)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(999.dp),
                color = LimeAccent.copy(alpha = 0.45f),
            ) {
                Text(
                    "ГОТОВ К СКАНИРОВАНИЮ",
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 5.dp),
                    color = DarkGreen,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
            Icon(
                Icons.Default.QrCodeScanner,
                contentDescription = null,
                tint = DarkGreen,
                modifier = Modifier
                    .size(56.dp)
                    .alpha(pulse),
            )
            Text(
                if (pendingStickerBatch.isNullOrBlank()) "Сканируйте DataMatrix"
                else "Отсканируйте стикер $pendingStickerBatch",
                color = DarkGreen,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                textAlign = TextAlign.Center,
            )
            Text(
                if (pendingStickerBatch.isNullOrBlank()) {
                    "Первый скан создаст позицию в документе"
                } else {
                    "Наклейте напечатанный STK-стикер на партию и отсканируйте QR"
                },
                color = Color(0xFF6B6B6B),
                fontSize = 12.sp,
                textAlign = TextAlign.Center,
            )
            OutlinedTextField(
                value = barcodeInput,
                onValueChange = onBarcodeInputChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                label = { Text("Или введите код вручную") },
                placeholder = { Text("DataMatrix / штрихкод") },
                singleLine = true,
                keyboardActions = KeyboardActions(onDone = {
                    onSubmitBarcode()
                    keyboard?.hide()
                }),
                shape = RoundedCornerShape(14.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Color.White,
                    unfocusedContainerColor = Color.White,
                ),
            )
        }
    }
}

internal fun formatReceivingQty(value: Double): String =
    if (value % 1.0 == 0.0) value.toLong().toString() else "%.2f".format(value)
