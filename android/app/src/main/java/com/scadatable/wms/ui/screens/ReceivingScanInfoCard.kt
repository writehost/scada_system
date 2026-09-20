package com.scadatable.wms.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scadatable.wms.receiving.crptStatusRu
import com.scadatable.wms.ui.theme.DarkGreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceivingScanInfoCard(
    title: String,
    documentId: String?,
    gtin: String?,
    itemStatus: String?,
    stickerStatus: String?,
    nestedItemName: String?,
    code: String,
    expiryMessage: String?,
    secondaryNote: String?,
    blocked: Boolean,
    blockReason: String? = null,
    expired: Boolean,
    warning: Boolean,
    modifier: Modifier = Modifier,
) {
    val containerColor = when {
        blocked || expired -> Color(0xFFFFEBEE)
        warning -> Color(0xFFFFF8E1)
        else -> Color(0xFFE8F5E9)
    }
    val accent = when {
        blocked || expired -> Color(0xFFC62828)
        warning -> Color(0xFFE65100)
        else -> DarkGreen
    }

    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = containerColor,
        tonalElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = title,
                color = accent,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp,
                lineHeight = 22.sp,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )

            if (!documentId.isNullOrBlank() || !itemStatus.isNullOrBlank()) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (!documentId.isNullOrBlank()) {
                        Column {
                            Text("Документ", color = Color(0xFF757575), fontSize = 10.sp)
                            Text(
                                text = documentId.uppercase(),
                                color = accent,
                                fontWeight = FontWeight.Bold,
                                fontSize = 18.sp,
                                fontFamily = FontFamily.Monospace,
                            )
                        }
                    }
                    if (!itemStatus.isNullOrBlank()) {
                        AssistChip(
                            onClick = {},
                            enabled = false,
                            label = {
                                Text(
                                    itemStatus.replaceFirstChar { it.uppercase() },
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            },
                            colors = AssistChipDefaults.assistChipColors(
                                disabledContainerColor = accent.copy(alpha = 0.14f),
                                disabledLabelColor = accent,
                            ),
                        )
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (!gtin.isNullOrBlank()) {
                    Text("GTIN $gtin", color = Color(0xFF616161), fontSize = 12.sp)
                }
                if (!stickerStatus.isNullOrBlank()) {
                    Text("ЧЗ: ${crptStatusRu(stickerStatus)}", color = Color(0xFF616161), fontSize = 12.sp)
                }
                if (!nestedItemName.isNullOrBlank()) {
                    Text(
                        text = "Вложение: $nestedItemName",
                        color = Color(0xFF616161),
                        fontSize = 12.sp,
                        lineHeight = 16.sp,
                    )
                }
            }

            if (!expiryMessage.isNullOrBlank()) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = Color.White.copy(alpha = 0.72f),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = expiryMessage,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        color = accent,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        lineHeight = 18.sp,
                    )
                }
            }
            if (!secondaryNote.isNullOrBlank()) {
                Text(
                    text = secondaryNote,
                    color = Color(0xFF757575),
                    fontSize = 11.sp,
                    lineHeight = 15.sp,
                )
            }
            if (blocked) {
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = Color(0xFFC62828),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = blockReason ?: "Приёмка заблокирована",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp,
                    )
                }
            }
            Text(
                text = code,
                color = Color(0xFF9E9E9E),
                fontSize = 10.sp,
                lineHeight = 13.sp,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
