package com.scadatable.wms.ui.screens

import android.graphics.BitmapFactory
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.scadatable.wms.data.remote.CrptCisInfoDto
import com.scadatable.wms.data.remote.RetrofitClient
import com.scadatable.wms.data.remote.WmsEndpointConfig
import com.scadatable.wms.ui.theme.DarkGreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale

private val statusLabels = mapOf(
    "INTRODUCED" to "В обороте",
    "APPLIED" to "Нанесён",
    "EMITTED" to "Эмитирован",
    "WRITTEN_OFF" to "Списан",
    "RETIRED" to "Выведен",
    "WITHDRAWN" to "Изъят",
)

private fun statusLabel(code: String?): String {
    if (code.isNullOrBlank()) return "—"
    return statusLabels[code] ?: code
}

private fun statusColors(code: String?): Pair<Color, Color> {
    return when (code) {
        "INTRODUCED" -> Color(0xFF1B5E20) to Color(0xFFA5D6A7)
        "APPLIED" -> Color(0xFF0D47A1) to Color(0xFF90CAF9)
        "EMITTED" -> Color(0xFF1565C0) to Color(0xFFBBDEFB)
        "WRITTEN_OFF", "RETIRED", "WITHDRAWN" -> Color(0xFFB71C1C) to Color(0xFFEF9A9A)
        else -> DarkGreen to Color(0xFFC8E6C9)
    }
}

private fun formatDate(value: String?): String? {
    if (value.isNullOrBlank()) return null
    return runCatching {
        val trimmed = value.trim()
        val isoDate = Regex("""^(\d{4})-(\d{2})-(\d{2})""").find(trimmed)
        if (isoDate != null) {
            val (_, y, m, d) = isoDate.groupValues
            return String.format(Locale("ru"), "%02d.%02d.%s", d.toInt(), m.toInt(), y)
        }
        val parsed = java.time.Instant.parse(trimmed)
        java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy")
            .withZone(java.time.ZoneId.of("Europe/Moscow"))
            .format(parsed)
    }.getOrElse {
        runCatching {
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).parse(value.substringBefore("."))
                ?: SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(value.substringBefore("T"))
        }.getOrNull()?.let { SimpleDateFormat("dd.MM.yyyy", Locale("ru")).format(it) } ?: value
    }
}

private fun packageTypeLabel(raw: String?): String? {
    val t = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return when (t.uppercase(Locale.ROOT)) {
        "UNIT" -> "Единица"
        "LEVEL1", "GROUP" -> "Группа"
        "LEVEL2", "BOX" -> "Блок / короб"
        "LEVEL3", "PALLET" -> "Палета"
        "BUNDLE" -> "Набор"
        "SET" -> "Комплект"
        else -> t
    }
}

private fun productGroupLabel(raw: String?): String? {
    val t = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return when (t.lowercase(Locale.ROOT)) {
        "water", "softdrinks" -> "Вода / напитки"
        "milk", "dairy" -> "Молочка"
        "beer" -> "Пиво"
        "shoes" -> "Обувь"
        "clothes", "lp" -> "Одежда"
        "tobacco" -> "Табак"
        else -> t
    }
}

/** Мягкие переносы в длинном коде без пробелов. */
private fun softBreakCode(value: String, every: Int = 4): String {
    val clean = value.trim()
    if (clean.length <= every + 2) return clean
    return clean.chunked(every).joinToString("\u200B")
}

enum class CrptCardStyle {
    Scanner,
    Full,
}

@Composable
fun CrptInfoResultCard(
    scannedCode: String,
    normalizedCode: String,
    info: CrptCisInfoDto,
    modifier: Modifier = Modifier,
    style: CrptCardStyle = CrptCardStyle.Scanner,
) {
    when (style) {
        CrptCardStyle.Scanner -> CrptScannerResultCard(
            scannedCode = scannedCode,
            normalizedCode = normalizedCode,
            info = info,
            modifier = modifier,
        )
        CrptCardStyle.Full -> CrptFullResultCard(
            scannedCode = scannedCode,
            normalizedCode = normalizedCode,
            info = info,
            modifier = modifier,
        )
    }
}

@Composable
private fun CrptScannerResultCard(
    scannedCode: String,
    normalizedCode: String,
    info: CrptCisInfoDto,
    modifier: Modifier = Modifier,
) {
    var detailsExpanded by remember(info.cis, info.productName) { mutableStateOf(false) }
    var childrenExpanded by remember(info.cis, info.parent) { mutableStateOf(false) }
    val (statusTextColor, statusBg) = statusColors(info.status)
    val emission = formatDate(info.emissionDate)
    val expiration = formatDate(info.expirationDate)
    val parentCode = info.parent?.trim()?.takeIf { it.isNotEmpty() }
    val children = info.child.orEmpty().map { it.trim() }.filter { it.isNotEmpty() }
    val packageLabel = listOfNotNull(
        packageTypeLabel(info.packageType),
        packageTypeLabel(info.generalPackageType),
    ).distinct().joinToString(" · ").ifBlank { null }
    val groupLabel = productGroupLabel(info.productGroup)
    val hasPhoto = !info.gtin.isNullOrBlank() && info.gtin.trim().length >= 8

    Card(
        modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        shape = RoundedCornerShape(12.dp),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
    ) {
        Column {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(statusBg)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = statusLabel(info.status),
                    color = statusTextColor,
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    maxLines = 1,
                )
                if (!emission.isNullOrBlank()) {
                    Text(
                        text = emission,
                        color = statusTextColor,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 13.sp,
                        maxLines = 1,
                    )
                }
            }

            Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
                if (hasPhoto) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        GtinProductPhoto(
                            gtin = info.gtin,
                            brand = null,
                            modifier = Modifier.width(84.dp),
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = info.productName ?: "Без наименования",
                                color = DarkGreen,
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp,
                                lineHeight = 20.sp,
                                maxLines = 4,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (!info.brand.isNullOrBlank() && info.brand != "-") {
                                Spacer(Modifier.height(4.dp))
                                Text(
                                    text = info.brand,
                                    color = Color(0xFF757575),
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                } else {
                    Text(
                        text = info.productName ?: "Без наименования",
                        color = DarkGreen,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp,
                        lineHeight = 20.sp,
                        maxLines = 5,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    if (!info.brand.isNullOrBlank() && info.brand != "-") {
                        Spacer(Modifier.height(4.dp))
                        Text(
                            text = info.brand,
                            color = Color(0xFF757575),
                            fontSize = 12.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color(0xFFF5F7F5))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    CrptFactBlock("GTIN", info.gtin, mono = true)
                    CrptFactBlock("Эмиссия", emission)
                    CrptFactBlock("Упаковка", packageLabel)
                    CrptFactBlock("Родитель", parentCode, mono = true, softBreak = true)
                }

                if (children.isNotEmpty()) {
                    TextButton(
                        onClick = { childrenExpanded = !childrenExpanded },
                        contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp),
                        modifier = Modifier.align(Alignment.Start),
                    ) {
                        Text(
                            text = if (childrenExpanded) {
                                "Скрыть вложенные (${children.size})"
                            } else {
                                "Вложенные коды (${children.size})"
                            },
                            color = DarkGreen,
                            fontSize = 13.sp,
                        )
                        Icon(
                            imageVector = if (childrenExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                            contentDescription = null,
                            tint = DarkGreen,
                            modifier = Modifier.size(18.dp),
                        )
                    }
                    AnimatedVisibility(visible = childrenExpanded) {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color(0xFFF8F9F8))
                                .padding(8.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            children.forEach { code ->
                                Text(
                                    text = softBreakCode(code),
                                    color = DarkGreen,
                                    fontSize = 11.sp,
                                    lineHeight = 15.sp,
                                    fontFamily = FontFamily.Monospace,
                                    modifier = Modifier.fillMaxWidth(),
                                )
                            }
                        }
                    }
                }

                TextButton(
                    onClick = { detailsExpanded = !detailsExpanded },
                    contentPadding = PaddingValues(horizontal = 0.dp, vertical = 2.dp),
                    modifier = Modifier.align(Alignment.Start),
                ) {
                    Text(
                        text = if (detailsExpanded) "Свернуть детали" else "Ещё детали",
                        color = DarkGreen,
                        fontSize = 13.sp,
                    )
                    Icon(
                        imageVector = if (detailsExpanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        contentDescription = null,
                        tint = DarkGreen,
                        modifier = Modifier.size(18.dp),
                    )
                }

                AnimatedVisibility(visible = detailsExpanded) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFFF8F9F8))
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        CrptFactBlock("Код", info.cis ?: normalizedCode, mono = true, softBreak = true)
                        CrptFactBlock("Группа", groupLabel)
                        CrptFactBlock("ТН ВЭД", info.tnVedEaes, mono = true)
                        CrptFactBlock("Годен до", expiration)
                        CrptFactBlock("Производитель", info.manufacturerName)
                        CrptFactBlock("Владелец", info.ownerName)
                        CrptFactBlock("Ввод в оборот", formatDate(info.introducedDate))
                        if (children.isNotEmpty()) {
                            CrptFactBlock("Вложено", children.size.toString())
                        }
                        if (normalizedCode != scannedCode.trim()) {
                            Text(
                                text = "Показан код без криптохвоста",
                                color = Color(0xFF9E9E9E),
                                fontSize = 11.sp,
                                lineHeight = 14.sp,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CrptFullResultCard(
    scannedCode: String,
    normalizedCode: String,
    info: CrptCisInfoDto,
    modifier: Modifier = Modifier,
) {
    CrptScannerResultCard(scannedCode, normalizedCode, info, modifier)
}

@Composable
private fun GtinProductPhoto(
    gtin: String?,
    brand: String?,
    modifier: Modifier = Modifier,
) {
    val cleanGtin = gtin?.trim()?.takeIf { it.length >= 8 } ?: return
    val candidates = remember(cleanGtin) { resolveGtinImageCandidates(cleanGtin) }
    var bitmap by remember(cleanGtin) { mutableStateOf<android.graphics.Bitmap?>(null) }
    var failed by remember(cleanGtin) { mutableStateOf(false) }

    LaunchedEffect(cleanGtin) {
        bitmap = null
        failed = false
        bitmap = withContext(Dispatchers.IO) {
            for (imageUrl in candidates) {
                val bmp = runCatching {
                    val conn = (URL(imageUrl).openConnection() as HttpURLConnection).apply {
                        connectTimeout = 6000
                        readTimeout = 8000
                        instanceFollowRedirects = true
                        setRequestProperty("Accept", "image/*")
                    }
                    if (conn.responseCode !in 200..299) return@runCatching null
                    val type = conn.contentType.orEmpty()
                    if (type.contains("text/html", ignoreCase = true) ||
                        type.contains("text/plain", ignoreCase = true)
                    ) {
                        return@runCatching null
                    }
                    conn.inputStream.use { BitmapFactory.decodeStream(it) }
                }.getOrNull()
                if (bmp != null) return@withContext bmp
            }
            null
        }
        if (bitmap == null) failed = true
    }

    if (failed && bitmap == null) return

    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(0.72f)
                .clip(RoundedCornerShape(10.dp))
                .background(Color(0xFFF0F2F0)),
            contentAlignment = Alignment.Center,
        ) {
            val bmp = bitmap
            if (bmp != null) {
                Image(
                    bitmap = bmp.asImageBitmap(),
                    contentDescription = brand ?: "Фото товара",
                    modifier = Modifier.fillMaxSize().padding(6.dp),
                    contentScale = ContentScale.Fit,
                )
            } else {
                CircularProgressIndicator(
                    modifier = Modifier.size(22.dp),
                    strokeWidth = 2.dp,
                    color = DarkGreen,
                )
            }
        }
        if (!brand.isNullOrBlank() && brand != "-") {
            Spacer(Modifier.height(4.dp))
            Text(
                text = brand,
                color = Color(0xFF757575),
                fontSize = 11.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

/** GSMT фото, затем локальные `/wms-item-images/{gtin}.*`. */
private fun resolveGtinImageCandidates(gtin: String): List<String> {
    val hostBase = WmsEndpointConfig.resolveUpdateServerBaseUrl(RetrofitClient.getBaseUrl()).trimEnd('/')
    val g = gtin.trim()
    return listOf(
        "$hostBase/gsmt/api/gtin-images/$g",
        "$hostBase/wms-item-images/$g.jpg",
        "$hostBase/wms-item-images/$g.jpeg",
        "$hostBase/wms-item-images/$g.webp",
        "$hostBase/wms-item-images/$g.png",
    )
}

/** Подпись сверху, значение на всю ширину — нормально читается на узком ТСД. */
@Composable
private fun CrptFactBlock(
    label: String,
    value: String?,
    mono: Boolean = false,
    softBreak: Boolean = false,
) {
    if (value.isNullOrBlank()) return
    val display = if (softBreak || (mono && value.length > 18)) softBreakCode(value) else value
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = label,
            color = Color(0xFF8A8A8A),
            fontSize = 11.sp,
            lineHeight = 13.sp,
        )
        Text(
            text = display,
            color = DarkGreen,
            fontWeight = FontWeight.Medium,
            fontSize = if (mono) 12.sp else 13.sp,
            lineHeight = if (mono) 16.sp else 17.sp,
            fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
