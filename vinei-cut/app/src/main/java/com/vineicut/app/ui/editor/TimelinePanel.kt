package com.vineicut.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.model.Clip
import com.vineicut.app.model.Project
import com.vineicut.app.model.Track
import com.vineicut.app.model.TrackType
import com.vineicut.app.ui.theme.TrackAudio
import com.vineicut.app.ui.theme.TrackImage
import com.vineicut.app.ui.theme.TrackOverlay
import com.vineicut.app.ui.theme.TrackText
import com.vineicut.app.ui.theme.TrackVideo
import com.vineicut.app.ui.theme.VcAccent
import com.vineicut.app.ui.theme.VcBackground
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcOnSurface
import com.vineicut.app.ui.theme.VcSurface
import com.vineicut.app.ui.theme.VcSurfaceHigh

private fun trackColor(type: TrackType): Color = when (type) {
    TrackType.MAIN -> TrackVideo
    TrackType.OVERLAY -> TrackOverlay
    TrackType.TEXT -> TrackText
    TrackType.AUDIO -> TrackAudio
    TrackType.STICKER -> TrackImage
}

@Composable
fun TimelinePanel(
    project: Project,
    playheadMs: Long,
    pxPerSec: Float,
    selectedClipId: String?,
    onSeek: (Long) -> Unit,
    onSelectClip: (String) -> Unit,
    onZoom: (Float) -> Unit,
    modifier: Modifier = Modifier
) {
    val scroll = rememberScrollState()
    val density = LocalDensity.current

    // Timeline content width: at least a comfortable minimum.
    val totalMs = maxOf(project.durationMs, 8000L)
    val contentWidthDp = (totalMs / 1000f) * pxPerSec

    Column(modifier.background(VcBackground)) {
        // Zoom controls + time readout
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(formatTime(playheadMs), color = VcOnSurface, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text(" / ${formatTime(project.durationMs)}", color = VcMuted, fontSize = 12.sp)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { onZoom(pxPerSec / 1.4f) }) {
                Icon(Icons.Filled.Remove, "zoom out", tint = VcMuted)
            }
            IconButton(onClick = { onZoom(pxPerSec * 1.4f) }) {
                Icon(Icons.Filled.Add, "zoom in", tint = VcMuted)
            }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(scroll)
        ) {
            Column(
                Modifier
                    .width(contentWidthDp.dp)
                    .pointerInput(pxPerSec, totalMs) {
                        detectTapGestures { offset ->
                            val ms = with(density) { (offset.x.toDp().value / pxPerSec * 1000f).toLong() }
                            onSeek(ms.coerceIn(0, totalMs))
                        }
                    }
            ) {
                TimeRuler(totalMs = totalMs, pxPerSec = pxPerSec)
                for (type in listOf(TrackType.MAIN, TrackType.OVERLAY, TrackType.TEXT, TrackType.AUDIO)) {
                    val track = project.track(type)
                    TrackLane(
                        track = track,
                        type = type,
                        pxPerSec = pxPerSec,
                        widthDp = contentWidthDp,
                        selectedClipId = selectedClipId,
                        onSelectClip = onSelectClip
                    )
                }
            }

            // Playhead line spanning the lanes.
            val playheadDp = (playheadMs / 1000f) * pxPerSec
            Box(
                Modifier
                    .offset(x = playheadDp.dp)
                    .width(2.dp)
                    .height(234.dp) // ruler (26) + 4 lanes (~52 each)
                    .background(VcAccent)
            )
        }
    }
}

@Composable
private fun TimeRuler(totalMs: Long, pxPerSec: Float) {
    Box(
        Modifier
            .height(26.dp)
            .background(VcSurface)
    ) {
        val stepSec = tickStepSeconds(pxPerSec)
        var s = 0L
        while (s * 1000 <= totalMs) {
            val x = (s.toFloat()) * pxPerSec
            Text(
                text = formatTime(s * 1000),
                color = VcMuted,
                fontSize = 10.sp,
                modifier = Modifier.offset(x = x.dp).padding(start = 2.dp)
            )
            s += stepSec
        }
    }
}

@Composable
private fun TrackLane(
    track: Track?,
    type: TrackType,
    pxPerSec: Float,
    widthDp: Float,
    selectedClipId: String?,
    onSelectClip: (String) -> Unit
) {
    Box(
        Modifier
            .padding(vertical = 3.dp)
            .width(widthDp.dp)
            .height(46.dp)
            .background(VcSurfaceHigh.copy(alpha = 0.35f), RoundedCornerShape(4.dp))
    ) {
        track?.clips?.forEach { clip ->
            ClipBlock(
                clip = clip,
                color = trackColor(type),
                pxPerSec = pxPerSec,
                selected = clip.id == selectedClipId,
                onClick = { onSelectClip(clip.id) }
            )
        }
    }
}

@Composable
private fun ClipBlock(
    clip: Clip,
    color: Color,
    pxPerSec: Float,
    selected: Boolean,
    onClick: () -> Unit
) {
    val x = (clip.startMs / 1000f) * pxPerSec
    val w = (clip.durationMs / 1000f) * pxPerSec
    Box(
        Modifier
            .offset(x = x.dp)
            .width(w.dp.coerceAtLeast(10.dp))
            .height(46.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.85f))
            .then(if (selected) Modifier.border(2.dp, VcOnSurface, RoundedCornerShape(4.dp)) else Modifier)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 4.dp)
    ) {
        Text(
            text = clip.label.ifBlank { clip.type.name.lowercase() },
            color = Color.White,
            fontSize = 10.sp,
            maxLines = 1
        )
    }
}

private fun tickStepSeconds(pxPerSec: Float): Long = when {
    pxPerSec >= 120 -> 1
    pxPerSec >= 60 -> 2
    pxPerSec >= 30 -> 5
    pxPerSec >= 15 -> 10
    else -> 30
}

private fun formatTime(ms: Long): String {
    val totalSec = ms / 1000
    val m = totalSec / 60
    val s = totalSec % 60
    return "%d:%02d".format(m, s)
}
