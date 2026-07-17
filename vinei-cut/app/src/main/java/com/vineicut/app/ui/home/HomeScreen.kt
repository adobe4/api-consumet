package com.vineicut.app.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesomeMotion
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.ui.theme.VcAccent
import com.vineicut.app.ui.theme.VcAccentSoft
import com.vineicut.app.ui.theme.VcBackground
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcOnSurface
import com.vineicut.app.ui.theme.VcSurface

@Composable
fun HomeScreen(
    onNewProject: () -> Unit,
    onBulkAlign: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(VcBackground)
            .padding(20.dp)
    ) {
        Spacer(Modifier.height(32.dp))
        Text(
            text = "Vinei Cut",
            color = VcOnSurface,
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = "Bulk video editor — align media to your transcript, then just add transitions.",
            color = VcMuted,
            fontSize = 14.sp
        )
        Spacer(Modifier.height(28.dp))

        // Flagship action
        HomeCard(
            title = "Bulk Auto-Align",
            subtitle = "Drop 60 clips + a transcript/audio → cuts land on every timestamp",
            gradient = Brush.horizontalGradient(listOf(VcAccent, VcAccentSoft)),
            icon = { Icon(Icons.Filled.AutoAwesomeMotion, null, tint = VcOnSurface, modifier = Modifier.size(28.dp)) },
            onClick = onBulkAlign
        )
        Spacer(Modifier.height(16.dp))
        HomeCard(
            title = "New Project",
            subtitle = "Start an empty 9:16 timeline and edit manually",
            gradient = Brush.horizontalGradient(listOf(VcSurface, VcSurface)),
            icon = { Icon(Icons.Filled.Add, null, tint = VcOnSurface, modifier = Modifier.size(28.dp)) },
            onClick = onNewProject
        )
    }
}

@Composable
private fun HomeCard(
    title: String,
    subtitle: String,
    gradient: Brush,
    icon: @Composable () -> Unit,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(gradient)
            .clickable(onClick = onClick)
            .padding(20.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        icon()
        Column(Modifier.fillMaxWidth()) {
            Text(title, color = VcOnSurface, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
            Text(subtitle, color = VcOnSurface.copy(alpha = 0.8f), fontSize = 13.sp)
        }
    }
}
