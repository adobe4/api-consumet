package com.vineicut.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val VineiDarkColors = darkColorScheme(
    primary = VcAccent,
    onPrimary = VcOnSurface,
    secondary = VcAccentSoft,
    background = VcBackground,
    onBackground = VcOnSurface,
    surface = VcSurface,
    onSurface = VcOnSurface,
    surfaceVariant = VcSurfaceHigh,
    onSurfaceVariant = VcMuted,
    outline = VcDivider,
)

@Composable
fun VineiCutTheme(content: @Composable () -> Unit) {
    // Vinei Cut is a dark-only editor by design (Filmora vibe).
    @Suppress("UNUSED_EXPRESSION")
    isSystemInDarkTheme()
    MaterialTheme(
        colorScheme = VineiDarkColors,
        typography = Typography(),
        content = content
    )
}
