package com.vineicut.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.model.Clip
import com.vineicut.app.model.ClipType
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

private const val LANE_HEIGHT = 48
private const val LANE_GAP = 4
private const val RULER_HEIGHT = 26

private fun trackColor(type: TrackType): Color = when (type) {
    TrackType.MAIN -> TrackVideo
    TrackType.OVERLAY -> TrackOverlay
    TrackType.TEXT -> TrackText
    TrackType.AUDIO -> TrackAudio
    TrackType.STICKER -> TrackImage
}

/** px drag distance -> timeline milliseconds. */
private fun Density.pxToMs(px: Float, pxPerSec: Float): Long =
    (px.toDp().value / pxPerSec * 1000f).toLong()

@Composable
fun TimelinePanel(
    project: Project,
    playheadMs: Long,
    pxPerSec: Float,
    selectedClipId: String?,
    onSeek: (Long) -> Unit,
    onSelectClip: (String) -> Unit,
    onZoom: (Float) -> Unit,
    onDragStart: () -> Unit,
    onMove: (Long) -> Unit,
    onTrimStart: (Long) -> Unit,
    onTrimEnd: (Long) -> Unit,
    modifier: Modifier = Modifier
) {
    val scroll = rememberScrollState()

    val totalMs = maxOf(project.durationMs, 8000L)
    val contentWidthDp = (totalMs / 1000f) * pxPerSec
    val lanesHeight = (RULER_HEIGHT + 4 * (LANE_HEIGHT + 2 * LANE_GAP)).dp

    Column(modifier.background(VcBackground)) {
        // Zoom controls + time readout
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
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
                            val ms = pxToMs(offset.x, pxPerSec)
                            onSeek(ms.coerceIn(0, totalMs))
                        }
                    }
            ) {
                TimeRuler(totalMs = totalMs, pxPerSec = pxPerSec)
                for (type in listOf(TrackType.MAIN, TrackType.OVERLAY, TrackType.TEXT, TrackType.AUDIO)) {
                    TrackLane(
                        track = project.track(type),
                        type = type,
                        pxPerSec = pxPerSec,
                        widthDp = contentWidthDp,
                        selectedClipId = selectedClipId,
                        onSelectClip = onSelectClip,
                        onDragStart = onDragStart,
                        onMove = onMove,
                        onTrimStart = onTrimStart,
                        onTrimEnd = onTrimEnd
                    )
                }
            }

            // Playhead line + draggable knob spanning the lanes.
            val playheadDp = (playheadMs / 1000f) * pxPerSec
            Box(
                Modifier
                    .offset(x = playheadDp.dp)
                    .width(2.dp)
                    .height(lanesHeight)
                    .background(VcAccent)
            )
            Box(
                Modifier
                    .offset(x = (playheadDp - 9).dp)
                    .width(20.dp)
                    .height(RULER_HEIGHT.dp)
                    .pointerInput(pxPerSec, totalMs) {
                        detectDragGestures { change, drag ->
                            change.consume()
                            onSeek((playheadMs + pxToMs(drag.x, pxPerSec)).coerceIn(0, totalMs))
                        }
                    }
            ) {
                Box(
                    Modifier
                        .align(Alignment.TopCenter)
                        .width(14.dp)
                        .height(14.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(VcAccent)
                )
            }
        }
    }
}

@Composable
private fun TimeRuler(totalMs: Long, pxPerSec: Float) {
    Box(
        Modifier
            .height(RULER_HEIGHT.dp)
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
    onSelectClip: (String) -> Unit,
    onDragStart: () -> Unit,
    onMove: (Long) -> Unit,
    onTrimStart: (Long) -> Unit,
    onTrimEnd: (Long) -> Unit
) {
    Box(
        Modifier
            .padding(vertical = LANE_GAP.dp)
            .width(widthDp.dp)
            .height(LANE_HEIGHT.dp)
            .background(VcSurfaceHigh.copy(alpha = 0.30f), RoundedCornerShape(4.dp))
    ) {
        track?.clips?.forEach { clip ->
            ClipBlock(
                clip = clip,
                color = trackColor(type),
                pxPerSec = pxPerSec,
                selected = clip.id == selectedClipId,
                onClick = { onSelectClip(clip.id) },
                onDragStart = { onSelectClip(clip.id); onDragStart() },
                onMove = onMove,
                onTrimStart = onTrimStart,
                onTrimEnd = onTrimEnd
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
    onClick: () -> Unit,
    onDragStart: () -> Unit,
    onMove: (Long) -> Unit,
    onTrimStart: (Long) -> Unit,
    onTrimEnd: (Long) -> Unit
) {
    val density = LocalDensity.current
    val x = (clip.startMs / 1000f) * pxPerSec
    val w = ((clip.durationMs / 1000f) * pxPerSec).dp.coerceAtLeast(14.dp)

    Box(
        Modifier
            .offset(x = x.dp)
            .width(w)
            .height(LANE_HEIGHT.dp)
            .clip(RoundedCornerShape(4.dp))
            .background(color.copy(alpha = 0.85f))
            .then(if (selected) Modifier.border(2.dp, VcOnSurface, RoundedCornerShape(4.dp)) else Modifier)
            // Tap to select; drag body to move the clip.
            .pointerInput(clip.id, pxPerSec) {
                detectTapGestures(onTap = { onClick() })
            }
            .pointerInput(clip.id, pxPerSec) {
                detectDragGestures(
                    onDragStart = { onDragStart() },
                    onDrag = { change, drag ->
                        change.consume()
                        onMove(density.pxToMs(drag.x, pxPerSec))
                    }
                )
            }
    ) {
        // Thumbnail fill for visual clips.
        if (clip.sourceUri != null && (clip.type == ClipType.VIDEO || clip.type == ClipType.IMAGE || clip.type == ClipType.OVERLAY)) {
            MediaFrame(
                uri = clip.sourceUri,
                isVideo = clip.type == ClipType.VIDEO,
                frameMs = clip.inPointMs,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize()
            )
        }
        Text(
            text = clip.label.ifBlank { clip.type.name.lowercase() },
            color = Color.White,
            fontSize = 9.sp,
            maxLines = 1,
            modifier = Modifier.align(Alignment.TopStart).padding(horizontal = 5.dp, vertical = 3.dp)
        )

        if (selected) {
            // Left/right trim handles.
            TrimHandle(
                align = Alignment.CenterStart,
                onDragStart = onDragStart,
                onDrag = { px -> onTrimStart(density.pxToMs(px, pxPerSec)) }
            )
            TrimHandle(
                align = Alignment.CenterEnd,
                onDragStart = onDragStart,
                onDrag = { px -> onTrimEnd(density.pxToMs(px, pxPerSec)) }
            )
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.TrimHandle(
    align: Alignment,
    onDragStart: () -> Unit,
    onDrag: (Float) -> Unit
) {
    Box(
        Modifier
            .align(align)
            .width(12.dp)
            .fillMaxHeight()
            .background(VcOnSurface.copy(alpha = 0.9f), RoundedCornerShape(3.dp))
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { onDragStart() },
                    onDrag = { change, drag -> change.consume(); onDrag(drag.x) }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        Box(Modifier.width(2.dp).height(16.dp).background(color = Color(0xFF303030)))
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
