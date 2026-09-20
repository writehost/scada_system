package com.scadatable.wms.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.scadatable.wms.receiving.ReceivingStickerPayload
import com.scadatable.wms.ui.theme.DarkGreen
import java.text.SimpleDateFormat
import java.util.Date
import java.util.EnumMap
import java.util.Locale

@Composable
fun LabelPreviewDialog(
    payload: ReceivingStickerPayload,
    onDismiss: () -> Unit,
    onConfirmPrint: () -> Unit,
) {
    val qrBitmap = remember(payload.qrUrl) { encodeQrBitmap(payload.qrUrl, 420) }
    val qtyText = remember(payload.qty) {
        if (payload.qty % 1.0 == 0.0) payload.qty.toLong().toString() else payload.qty.toString()
    }
    val emission = remember(payload.emissionAt) { formatDate(payload.emissionAt) }
    val expires = remember(payload.expiresAt) { formatDate(payload.expiresAt) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text("Предпросмотр этикетки", fontWeight = FontWeight.Bold, color = DarkGreen)
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .border(1.dp, Color(0xFFBDBDBD), RoundedCornerShape(12.dp))
                        .background(Color.White, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        "Этикетка",
                        fontSize = 11.sp,
                        color = Color(0xFF757575),
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        payload.itemName,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        color = DarkGreen,
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                    PreviewRow("Ячейка", payload.cellCode?.ifBlank { null } ?: "—")
                    PreviewRow("Партия", payload.batchCode)
                    PreviewRow("Группа", payload.productGroupLabel?.ifBlank { null } ?: "—")
                    PreviewRow("GTIN", payload.gtin?.ifBlank { null } ?: "—")
                    PreviewRow("Кол-во", "$qtyText шт")
                    PreviewRow("Эмиссия", emission)
                    PreviewRow("Годен до", expires)
                    Spacer(Modifier.height(4.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.Center,
                    ) {
                        if (qrBitmap != null) {
                            Image(
                                bitmap = qrBitmap.asImageBitmap(),
                                contentDescription = "QR этикетки",
                                modifier = Modifier.size(160.dp),
                            )
                        }
                    }
                    Text(
                        "QR",
                        fontSize = 11.sp,
                        color = Color(0xFF757575),
                        modifier = Modifier.align(Alignment.CenterHorizontally),
                    )
                    Text(
                        payload.qrUrl,
                        fontSize = 9.sp,
                        fontFamily = FontFamily.Monospace,
                        color = Color(0xFF9E9E9E),
                        maxLines = 3,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirmPrint,
                colors = ButtonDefaults.buttonColors(containerColor = DarkGreen),
            ) {
                Text("Печать")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Отмена") }
        },
    )
}

@Composable
private fun PreviewRow(label: String, value: String) {
    Row(modifier = Modifier.fillMaxWidth()) {
        Text("$label: ", fontSize = 12.sp, color = Color(0xFF757575))
        Text(value, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

private fun formatDate(ts: Long?): String {
    if (ts == null || ts <= 0L) return "—"
    return SimpleDateFormat("dd.MM.yyyy", Locale("ru")).format(Date(ts))
}

private fun encodeQrBitmap(text: String, sizePx: Int): Bitmap? {
    val trimmed = text.trim()
    if (trimmed.isBlank()) return null
    return runCatching {
        val hints = EnumMap<EncodeHintType, Any>(EncodeHintType::class.java)
        hints[EncodeHintType.MARGIN] = 1
        val matrix = QRCodeWriter().encode(trimmed, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val w = matrix.width
        val h = matrix.height
        val pixels = IntArray(w * h)
        for (y in 0 until h) {
            for (x in 0 until w) {
                pixels[y * w + x] = if (matrix[x, y]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
            }
        }
        Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also {
            it.setPixels(pixels, 0, w, 0, 0, w, h)
        }
    }.getOrNull()
}
