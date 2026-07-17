package com.vineicut.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.model.Clip
import com.vineicut.app.model.ClipType
import com.vineicut.app.model.Project
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
import com.vineicut.app.ui.theme.VcSurfaceHigh

private const val RULER_H = 24f
private const val LANE_H = 46f
private const val LANE_GAP = 4f
private const val HANDLE_W = 16f

private val TRACK_ORDER = listOf(TrackType.MAIN, TrackType.OVERLAY, TrackType.TEXT, TrackType.AUDIO)

// Drag modes
private const val SCRUB = 0
private const val MOVE = 1
private const val TRIM_L = 2
private const val TRIM_R = 3

private fun trackColor(type: TrackType): Color = when (type) {
    TrackType.MAIN -> TrackVideo
    TrackType.OVERLAY -> TrackOverlay
    TrackType.TEXT -> TrackText
    TrackType.AUDIO -> TrackAudio
    TrackType.STICKER -> TrackImage
}

private fun laneTop(index: Int): Float = RULER_H + LANE_GAP + index * (LANE_H + LANE_GAP)
private fun anchorDp(viewportW: Float, density: Float): Float = (viewportW / density) * 0.5f
private fun timeToXdp(ms: Long, playheadMs: Long, pxPerSec: Float, anchor: Float): Float =
    anchor + (ms - playheadMs) / 1000f * pxPerSec
private fun xDpToTime(xDp: Float, playheadMs: Long, pxPerSec: Float, anchor: Float): Long =
    (playheadMs + (xDp - anchor) / pxPerSec * 1000f).toLong()

private data class ClipHit(val clip: Clip, val onLeftEdge: Boolean, val onRightEdge: Boolean)

private fun hitTest(
    xPx: Float, yPx: Float, project: Project, playheadMs: Long, pxPerSec: Float, viewportW: Float, density: Float
): ClipHit? {
    val xDp = xPx / density
    val yDp = yPx / density
    val anchor = anchorDp(viewportW, density)
    val laneIndex = (0 until TRACK_ORDER.size).firstOrNull { i ->
        val top = laneTop(i); yDp >= top && yDp <= top + LANE_H
    } ?: return null
    val type = TRACK_ORDER[laneIndex]
    val clip = project.track(type)?.clips?.firstOrNull {
        val l = timeToXdp(it.startMs, playheadMs, pxPerSec, anchor)
        val r = timeToXdp(it.endMs, playheadMs, pxPerSec, anchor)
        xDp in l..r
    } ?: return null
    val l = timeToXdp(clip.startMs, playheadMs, pxPerSec, anchor)
    val r = timeToXdp(clip.endMs, playheadMs, pxPerSec, anchor)
    return ClipHit(clip, xDp - l <= HANDLE_W, r - xDp <= HANDLE_W)
}

/**
 * CapCut / VN-style timeline: the playhead stays fixed at the centre anchor and
 * the filmstrip scrubs beneath it. A single unified gesture handler (no nested
 * scroll to fight) means: drag empty/unselected strip = scrub time; tap a clip =
 * select; drag the selected clip = move it; drag its edge handles = trim.
 */
@Composable
fun TimelinePanel(
    project: Project,
    playheadMs: Long,
    pxPerSec: Float,
    selectedClipId: String?,
    onSeek: (Long) -> Unit,
    onSelectClip: (String?) -> Unit,
    onZoom: (Float) -> Unit,
    onDragStart: () -> Unit,
    onMove: (Long) -> Unit,
    onTrimStart: (Long) -> Unit,
    onTrimEnd: (Long) -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current.density
    var viewportW by remember { mutableStateOf(0f) }
    val timelineH = RULER_H + TRACK_ORDER.size * (LANE_H + LANE_GAP) + LANE_GAP
    val totalMs = maxOf(project.durationMs, 1L)
    val anchor = anchorDp(viewportW, density)

    // Live values read inside gestures so the gesture never restarts mid-drag.
    val liveProject = rememberUpdatedState(project)
    val livePlayhead = rememberUpdatedState(playheadMs)
    val livePx = rememberUpdatedState(pxPerSec)
    val liveSel = rememberUpdatedState(selectedClipId)
    val liveVw = rememberUpdatedState(viewportW)
    var dragMode by remember { mutableStateOf(SCRUB) }

    Column(modifier.background(VcBackground)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(formatTime(playheadMs), color = VcOnSurface, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Text(" / ${formatTime(project.durationMs)}", color = VcMuted, fontSize = 12.sp)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { onZoom(pxPerSec / 1.4f) }) { Icon(Icons.Filled.Remove, "zoom out", tint = VcMuted) }
            IconButton(onClick = { onZoom(pxPerSec * 1.4f) }) { Icon(Icons.Filled.Add, "zoom in", tint = VcMuted) }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(timelineH.dp)
                .clipToBounds()
                .onSizeChanged { viewportW = it.width.toFloat() }
                .pointerInput(Unit) {
                    detectTapGestures { pos ->
                        val hit = hitTest(pos.x, pos.y, liveProject.value, livePlayhead.value, livePx.value, liveVw.value, density)
                        onSelectClip(hit?.clip?.id)
                    }
                }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { pos ->
                            val hit = hitTest(pos.x, pos.y, liveProject.value, livePlayhead.value, livePx.value, liveVw.value, density)
                            dragMode = when {
                                hit == null -> SCRUB
                                hit.clip.id != liveSel.value -> SCRUB
                                hit.onLeftEdge -> TRIM_L
                                hit.onRightEdge -> TRIM_R
                                else -> MOVE
                            }
                            if (dragMode != SCRUB) onDragStart()
                        },
                        onDrag = { change, drag ->
                            change.consume()
                            val deltaMs = (drag.x / density / livePx.value * 1000f).toLong()
                            when (dragMode) {
                                SCRUB -> onSeek((livePlayhead.value - deltaMs).coerceIn(0, totalMs))
                                MOVE -> onMove(deltaMs)
                                TRIM_L -> onTrimStart(deltaMs)
                                TRIM_R -> onTrimEnd(deltaMs)
                            }
                        }
                    )
                }
        ) {
            // Lane backgrounds
            for (i in TRACK_ORDER.indices) {
                Box(
                    Modifier
                        .offset(x = 0.dp, y = laneTop(i).dp)
                        .fillMaxWidth()
                        .height(LANE_H.dp)
                        .background(VcSurfaceHigh.copy(alpha = 0.25f))
                )
            }

            // Ruler ticks across the visible window
            if (viewportW > 0f) {
                val stepSec = tickStepSeconds(pxPerSec)
                val leftTime = xDpToTime(0f, playheadMs, pxPerSec, anchor).coerceAtLeast(0L)
                val rightTime = xDpToTime(viewportW / density, playheadMs, pxPerSec, anchor)
                var s = (leftTime / 1000 / stepSec) * stepSec
                while (s * 1000 <= rightTime + stepSec * 1000) {
                    val xdp = timeToXdp(s * 1000, playheadMs, pxPerSec, anchor)
                    Text(
                        text = formatTime(s * 1000),
                        color = VcMuted,
                        fontSize = 10.sp,
                        modifier = Modifier.offset(x = xdp.dp, y = 4.dp)
                    )
                    s += stepSec
                }
            }

            // Clips
            for (i in TRACK_ORDER.indices) {
                val type = TRACK_ORDER[i]
                project.track(type)?.clips?.forEach { clip ->
                    ClipBlock(
                        clip = clip,
                        color = trackColor(type),
                        leftDp = timeToXdp(clip.startMs, playheadMs, pxPerSec, anchor),
                        widthDp = clip.durationMs / 1000f * pxPerSec,
                        topDp = laneTop(i),
                        selected = clip.id == selectedClipId
                    )
                }
            }

            // Fixed playhead + knob
            Box(
                Modifier.offset(x = anchor.dp).width(2.dp).fillMaxHeight().background(VcAccent)
            )
            Box(
                Modifier
                    .offset(x = (anchor - 6f).dp)
                    .width(12.dp).height(12.dp)
                    .background(VcAccent, RoundedCornerShape(3.dp))
            )
        }
    }
}

@Composable
private fun ClipBlock(
    clip: Clip,
    color: Color,
    leftDp: Float,
    widthDp: Float,
    topDp: Float,
    selected: Boolean
) {
    val w = widthDp.dp.coerceAtLeast(10.dp)
    Box(
        Modifier
            .offset(x = leftDp.dp, y = topDp.dp)
            .width(w)
            .height(LANE_H.dp)
            .background(color.copy(alpha = 0.85f), RoundedCornerShape(4.dp))
            .then(if (selected) Modifier.border(2.dp, VcOnSurface, RoundedCornerShape(4.dp)) else Modifier)
            .clipToBounds()
    ) {
        if (clip.sourceUri != null &&
            (clip.type == ClipType.VIDEO || clip.type == ClipType.IMAGE || clip.type == ClipType.OVERLAY)
        ) {
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
            EdgeHandle(Alignment.CenterStart)
            EdgeHandle(Alignment.CenterEnd)
        }
    }
}

@Composable
private fun androidx.compose.foundation.layout.BoxScope.EdgeHandle(align: Alignment) {
    Box(
        Modifier
            .align(align)
            .width(HANDLE_W.dp)
            .fillMaxHeight()
            .background(VcOnSurface.copy(alpha = 0.9f), RoundedCornerShape(3.dp)),
        contentAlignment = Alignment.Center
    ) {
        Box(Modifier.width(2.dp).height(16.dp).background(Color(0xFF303030)))
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
