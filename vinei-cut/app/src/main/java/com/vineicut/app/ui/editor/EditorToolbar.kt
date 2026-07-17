package com.vineicut.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Animation
import androidx.compose.material.icons.filled.AutoAwesomeMotion
import androidx.compose.material.icons.filled.Brightness6
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Gradient
import androidx.compose.material.icons.filled.Grain
import androidx.compose.material.icons.filled.Layers
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Speed
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.Transform
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcOnSurface
import com.vineicut.app.ui.theme.VcSurface

enum class ToolAction {
    ADD_MEDIA, ADD_AUDIO, BULK_ALIGN, SPLIT, DUPLICATE, DELETE,
    TEXT, OVERLAY, STICKER, EFFECT, ADJUST, CHROMA, KEYFRAME, ANIMATION, SPEED, TRANSITION
}

private data class Tool(val action: ToolAction, val label: String, val icon: ImageVector, val implemented: Boolean)

private val tools = listOf(
    Tool(ToolAction.ADD_MEDIA, "Media", Icons.Filled.Movie, true),
    Tool(ToolAction.BULK_ALIGN, "Bulk Align", Icons.Filled.AutoAwesomeMotion, true),
    Tool(ToolAction.SPLIT, "Split", Icons.Filled.ContentCut, true),
    Tool(ToolAction.DUPLICATE, "Duplicate", Icons.Filled.ContentCopy, true),
    Tool(ToolAction.DELETE, "Delete", Icons.Filled.Delete, true),
    Tool(ToolAction.ADD_AUDIO, "Audio", Icons.Filled.LibraryMusic, true),
    Tool(ToolAction.TEXT, "Text", Icons.Filled.TextFields, false),
    Tool(ToolAction.OVERLAY, "Overlay", Icons.Filled.Layers, false),
    Tool(ToolAction.STICKER, "Sticker", Icons.Outlined.EmojiEmotions, false),
    Tool(ToolAction.EFFECT, "Effect", Icons.Filled.Grain, false),
    Tool(ToolAction.ADJUST, "Adjust", Icons.Filled.Tune, false),
    Tool(ToolAction.CHROMA, "Chroma", Icons.Filled.Gradient, false),
    Tool(ToolAction.KEYFRAME, "Keyframe", Icons.Filled.Timeline, false),
    Tool(ToolAction.ANIMATION, "Animation", Icons.Filled.Animation, false),
    Tool(ToolAction.SPEED, "Speed", Icons.Filled.Speed, false),
    Tool(ToolAction.TRANSITION, "Transition", Icons.Filled.Transform, false),
)

@Composable
fun EditorToolbar(onAction: (ToolAction) -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .background(VcSurface)
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        tools.forEach { tool ->
            ToolButton(tool, onClick = { onAction(tool.action) })
        }
    }
}

@Composable
private fun ToolButton(tool: Tool, onClick: () -> Unit) {
    Column(
        modifier = Modifier
            .width(64.dp)
            .clickable(onClick = onClick)
            .padding(vertical = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            tool.icon,
            contentDescription = tool.label,
            tint = if (tool.implemented) VcOnSurface else VcMuted,
            modifier = Modifier.size(24.dp)
        )
        Text(
            tool.label,
            color = if (tool.implemented) VcOnSurface else VcMuted,
            fontSize = 10.sp,
            textAlign = TextAlign.Center
        )
    }
}
