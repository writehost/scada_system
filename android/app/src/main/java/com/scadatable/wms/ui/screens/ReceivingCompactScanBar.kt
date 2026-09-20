package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scadatable.wms.ui.theme.DarkGreen

/** Компактная строка сканирования, когда в документе уже есть позиции — не перекрывает список. */
@Composable
fun ReceivingCompactScanBar(
    barcodeInput: String,
    onBarcodeInputChange: (String) -> Unit,
    onSubmitBarcode: () -> Unit,
    focusRequester: FocusRequester,
    keyboard: SoftwareKeyboardController?,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = Color(0xFFF0F7EA)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Сканировать следующий код",
                    color = DarkGreen,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                )
            }
            OutlinedTextField(
                value = barcodeInput,
                onValueChange = onBarcodeInputChange,
                modifier = Modifier
                    .fillMaxWidth()
                    .focusRequester(focusRequester),
                label = { Text("DataMatrix / штрихкод") },
                leadingIcon = {
                    Icon(Icons.Default.QrCodeScanner, contentDescription = null, tint = DarkGreen)
                },
                singleLine = true,
                keyboardActions = KeyboardActions(onDone = {
                    onSubmitBarcode()
                    keyboard?.hide()
                }),
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = Color.White,
                    unfocusedContainerColor = Color.White,
                ),
            )
        }
    }
}
