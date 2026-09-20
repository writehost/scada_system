package com.scadatable.wms.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val LightColorScheme = lightColorScheme(
    primary = DarkGreen,
    onPrimary = Color.White,
    secondary = LimeAccent,
    onSecondary = DarkGreen,
    background = SoftWhiteBackground,
    surface = CardBackground,
    onSurface = DarkGreen,
    secondaryContainer = LimeAccent.copy(alpha = 0.2f),
    onSecondaryContainer = DarkGreen
)

@Composable
fun WmsTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = LightColorScheme,
        typography = Typography(),
        shapes = Shapes(
            small = RoundedCornerShape(8.dp),
            medium = RoundedCornerShape(16.dp),
            large = RoundedCornerShape(24.dp)
        ),
        content = content
    )
}
