package com.vineicut.app.ui.editor

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MusicNote
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
import com.vineicut.app.ui.theme.TrackOverlay
import com.vineicut.app.ui.theme.TrackText
import com.vineicut.app.ui.theme.VcBackground
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcOnSurface
import com.vineicut.app.ui.theme.VcSurfaceHigh
import kotlin.math.ceil
import kotlin.random.Random

private const val RULER_H = 22f
private const val MAIN_H = 54f      // main filmstrip lane
private const val SUB_H = 34f       // overlay / text / audio lanes
private const val LANE_GAP = 5f
private const val HANDLE_W = 16f
private const val TILE_W = 56f      // filmstrip tile width (dp)
private const val ADD_TILE_W = 44f  // trailing "+" tile on the main track

// Drag modes
private const val SCRUB = 0
private const val MOVE = 1
private const val TRIM_L = 2
private const val TRIM_R = 3

private data class Lane(val type: TrackType, val top: Float, val height: Float)

/** Main lane always shows; sub-lanes only when they have content — like CapCut. */
private fun buildLanes(project: Project): Pair<List<Lane>, Float> {
    var y = RULER_H + LANE_GAP
    val lanes = mutableListOf<Lane>()
    lanes += Lane(TrackType.MAIN, y, MAIN_H); y += MAIN_H + LANE_GAP
    for (t in listOf(TrackType.OVERLAY, TrackType.TEXT, TrackType.AUDIO)) {
        if (project.track(t)?.clips?.isNotEmpty() == true) {
            lanes += Lane(t, y, SUB_H); y += SUB_H + LANE_GAP
        }
    }
    return lanes to y
}

private fun anchorDp(viewportWpx: Float, density: Float): Float = (viewportWpx / density) * 0.5f
private fun timeToXdp(ms: Long, playheadMs: Long, pxPerSec: Float, anchor: Float): Float =
    anchor + (ms - playheadMs) / 1000f * pxPerSec
private fun xDpToTime(xDp: Float, playheadMs: Long, pxPerSec: Float, anchor: Float): Long =
    (playheadMs + (xDp - anchor) / pxPerSec * 1000f).toLong()

private data class ClipHit(val clip: Clip, val onLeftEdge: Boolean, val onRightEdge: Boolean)

private fun hitTest(
    xPx: Float, yPx: Float,
    project: Project, lanes: List<Lane>,
    playheadMs: Long, pxPerSec: Float, viewportWpx: Float, density: Float
): ClipHit? {
    val xDp = xPx / density
    val yDp = yPx / density
    val anchor = anchorDp(viewportWpx, density)
    val lane = lanes.firstOrNull { yDp >= it.top && yDp <= it.top + it.height } ?: return null
    val clip = project.track(lane.type)?.clips?.firstOrNull {
        val l = timeToXdp(it.startMs, playheadMs, pxPerSec, anchor)
        val r = timeToXdp(it.endMs, playheadMs, pxPerSec, anchor)
        xDp in l..r
    } ?: return null
    val l = timeToXdp(clip.startMs, playheadMs, pxPerSec, anchor)
    val r = timeToXdp(clip.endMs, playheadMs, pxPerSec, anchor)
    return ClipHit(clip, xDp - l <= HANDLE_W, r - xDp <= HANDLE_W)
}

/**
 * CapCut-style timeline: fixed centre playhead, filmstrip scrubs beneath it.
 * Main track renders real frame tiles; audio renders as a waveform block.
 * One unified gesture: drag strip = scrub, tap = select, drag selected = move,
 * drag its edges = trim. Tap the trailing + tile to append media.
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
    onAddMedia: () -> Unit,
    onAddAudio: () -> Unit,
    modifier: Modifier = Modifier
) {
    val density = LocalDensity.current.density
    var viewportW by remember { mutableStateOf(0f) }
    val (lanes, contentH) = buildLanes(project)
    val totalMs = maxOf(project.durationMs, 1L)
    val anchor = anchorDp(viewportW, density)
    val hasAudio = project.track(TrackType.AUDIO)?.clips?.isNotEmpty() == true

    // Live values read inside gestures so a drag never restarts mid-gesture.
    val liveProject = rememberUpdatedState(project)
    val livePlayhead = rememberUpdatedState(playheadMs)
    val livePx = rememberUpdatedState(pxPerSec)
    val liveSel = rememberUpdatedState(selectedClipId)
    val liveVw = rememberUpdatedState(viewportW)
    var dragMode by remember { mutableStateOf(SCRUB) }

    Column(modifier.background(VcBackground)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 10.dp),
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
                .height(contentH.dp)
                .clipToBounds()
                .onSizeChanged { viewportW = it.width.toFloat() }
                .pointerInput(Unit) {
                    detectTapGestures { pos ->
                        val p = liveProject.value
                        val (ln, _) = buildLanes(p)
                        val hit = hitTest(pos.x, pos.y, p, ln, livePlayhead.value, livePx.value, liveVw.value, density)
                        if (hit != null) {
                            onSelectClip(hit.clip.id)
                        } else {
                            // Trailing + tile on the main lane appends media.
                            val a = anchorDp(liveVw.value, density)
                            val mainEndX = timeToXdp(mainEnd(p), livePlayhead.value, livePx.value, a)
                            val xDp = pos.x / density
                            val yDp = pos.y / density
                            val mainLane = ln.first()
                            if (yDp >= mainLane.top && yDp <= mainLane.top + mainLane.height &&
                                xDp >= mainEndX && xDp <= mainEndX + ADD_TILE_W + 8f
                            ) {
                                onAddMedia()
                            } else {
                                onSelectClip(null)
                            }
                        }
                    }
                }
                .pointerInput(Unit) {
                    detectDragGestures(
                        onDragStart = { pos ->
                            val p = liveProject.value
                            val (ln, _) = buildLanes(p)
                            val hit = hitTest(pos.x, pos.y, p, ln, livePlayhead.value, livePx.value, liveVw.value, density)
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
            // Ruler: time labels with dot ticks between, following the scrub.
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
                        fontSize = 9.sp,
                        modifier = Modifier.offset(x = xdp.dp, y = 3.dp)
                    )
                    val midX = timeToXdp((s + stepSec / 2f).toLong() * 1000, playheadMs, pxPerSec, anchor)
                    Box(
                        Modifier
                            .offset(x = midX.dp, y = 9.dp)
                            .size(3.dp)
                            .background(VcMuted.copy(alpha = 0.5f), CircleShape)
                    )
                    s += stepSec
                }
            }

            // Clips per lane (off-screen clips culled for smooth scrubbing).
            val viewportDp = if (viewportW > 0f) viewportW / density else 2000f
            lanes.forEach { lane ->
                project.track(lane.type)?.clips?.forEach { clip ->
                    val left = timeToXdp(clip.startMs, playheadMs, pxPerSec, anchor)
                    val width = clip.durationMs / 1000f * pxPerSec
                    if (left + width < -24f || left > viewportDp + 24f) return@forEach
                    when (lane.type) {
                        TrackType.MAIN -> FilmstripClip(
                            clip, left, width, lane.top, lane.height, pxPerSec,
                            selected = clip.id == selectedClipId
                        )
                        TrackType.AUDIO -> AudioClip(
                            clip, left, width, lane.top, lane.height,
                            selected = clip.id == selectedClipId
                        )
                        else -> LabelClip(
                            clip, left, width, lane.top, lane.height,
                            color = if (lane.type == TrackType.TEXT) TrackText else TrackOverlay,
                            selected = clip.id == selectedClipId
                        )
                    }
                }
            }

            // Trailing "+" tile that appends media to the main track.
            run {
                val mainLane = lanes.first()
                val x = timeToXdp(mainEnd(project), playheadMs, pxPerSec, anchor) + 6f
                Box(
                    Modifier
                        .offset(x = x.dp, y = mainLane.top.dp)
                        .width(ADD_TILE_W.dp)
                        .height(mainLane.height.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(VcSurfaceHigh),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(Icons.Filled.Add, "add media", tint = VcOnSurface)
                }
            }

            // Fixed playhead + knob.
            Box(Modifier.offset(x = anchor.dp).width(2.dp).fillMaxHeight().background(VcOnSurface))
            Box(
                Modifier
                    .offset(x = (anchor - 5f).dp)
                    .size(10.dp)
                    .background(VcOnSurface, RoundedCornerShape(3.dp))
            )
        }

        // "+ Add audio" pill, CapCut-style, when the audio track is empty.
        if (!hasAudio) {
            Row(
                Modifier
                    .padding(start = 12.dp, top = 4.dp, bottom = 2.dp)
                    .clip(RoundedCornerShape(14.dp))
                    .background(VcSurfaceHigh)
                    .clickable(onClick = onAddAudio)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Filled.MusicNote, null, tint = TrackAudio, modifier = Modifier.size(14.dp))
                Spacer(Modifier.width(6.dp))
                Text("Add audio", color = VcOnSurface, fontSize = 12.sp)
            }
        }
    }
}

private fun mainEnd(project: Project): Long =
    project.track(TrackType.MAIN)?.clips?.maxOfOrNull { it.endMs } ?: 0L

/** Main-track clip drawn as a strip of real frame tiles, like CapCut. */
@Composable
private fun FilmstripClip(
    clip: Clip,
    leftDp: Float,
    widthDp: Float,
    topDp: Float,
    heightDp: Float,
    pxPerSec: Float,
    selected: Boolean
) {
    val w = widthDp.dp.coerceAtLeast(12.dp)
    Box(
        Modifier
            .offset(x = leftDp.dp, y = topDp.dp)
            .width(w)
            .height(heightDp.dp)
            .clip(RoundedCornerShape(5.dp))
            .background(VcSurfaceHigh)
            .then(if (selected) Modifier.border(2.dp, VcOnSurface, RoundedCornerShape(5.dp)) else Modifier)
            .clipToBounds()
    ) {
        if (clip.sourceUri != null) {
            if (clip.type == ClipType.VIDEO) {
                // Video: a strip of frame tiles (capped so long clips stay smooth).
                Row(Modifier.fillMaxSize()) {
                    val tiles = ceil(widthDp / TILE_W).toInt().coerceIn(1, 40)
                    repeat(tiles) { i ->
                        MediaFrame(
                            uri = clip.sourceUri,
                            isVideo = true,
                            frameMs = clip.inPointMs + (i * TILE_W / pxPerSec * 1000f).toLong(),
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.width(TILE_W.dp).fillMaxHeight()
                        )
                    }
                }
            } else {
                // Image: single cropped frame filling the block.
                MediaFrame(
                    uri = clip.sourceUri,
                    isVideo = false,
                    frameMs = clip.inPointMs,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            }
        }
        Text(
            text = "${clip.durationMs / 1000f}s".replace(".0s", "s"),
            color = Color.White,
            fontSize = 8.sp,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(3.dp)
                .background(Color.Black.copy(alpha = 0.55f), RoundedCornerShape(3.dp))
                .padding(horizontal = 3.dp, vertical = 1.dp)
        )
        if (selected) {
            EdgeHandle(Alignment.CenterStart)
            EdgeHandle(Alignment.CenterEnd)
        }
    }
}

/** Audio clip: rounded green block with a deterministic pseudo-waveform. */
@Composable
private fun AudioClip(
    clip: Clip,
    leftDp: Float,
    widthDp: Float,
    topDp: Float,
    heightDp: Float,
    selected: Boolean
) {
    val w = widthDp.dp.coerceAtLeast(12.dp)
    Box(
        Modifier
            .offset(x = leftDp.dp, y = topDp.dp)
            .width(w)
            .height(heightDp.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(TrackAudio.copy(alpha = 0.9f))
            .then(if (selected) Modifier.border(2.dp, VcOnSurface, RoundedCornerShape(6.dp)) else Modifier)
            .clipToBounds()
    ) {
        Canvas(Modifier.fillMaxSize().padding(horizontal = 6.dp, vertical = 5.dp)) {
            val rnd = Random(clip.id.hashCode())
            val barW = 2.dp.toPx()
            val gap = 2.dp.toPx()
            var x = 0f
            while (x < size.width) {
                val h = size.height * (0.2f + 0.8f * rnd.nextFloat())
                drawRect(
                    color = Color.White.copy(alpha = 0.6f),
                    topLeft = Offset(x, (size.height - h) / 2f),
                    size = Size(barW, h)
                )
                x += barW + gap
            }
        }
        Text(
            text = clip.label.ifBlank { "Audio" },
            color = Color.White,
            fontSize = 8.sp,
            maxLines = 1,
            modifier = Modifier.align(Alignment.TopStart).padding(horizontal = 5.dp, vertical = 2.dp)
        )
        if (selected) {
            EdgeHandle(Alignment.CenterStart)
            EdgeHandle(Alignment.CenterEnd)
        }
    }
}

/** Text / overlay clip: compact labeled block. */
@Composable
private fun LabelClip(
    clip: Clip,
    leftDp: Float,
    widthDp: Float,
    topDp: Float,
    heightDp: Float,
    color: Color,
    selected: Boolean
) {
    val w = widthDp.dp.coerceAtLeast(12.dp)
    Box(
        Modifier
            .offset(x = leftDp.dp, y = topDp.dp)
            .width(w)
            .height(heightDp.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.85f))
            .then(if (selected) Modifier.border(2.dp, VcOnSurface, RoundedCornerShape(6.dp)) else Modifier)
            .clipToBounds(),
        contentAlignment = Alignment.CenterStart
    ) {
        Text(
            text = clip.textStyle?.text ?: clip.label.ifBlank { clip.type.name.lowercase() },
            color = Color.White,
            fontSize = 10.sp,
            maxLines = 1,
            modifier = Modifier.padding(horizontal = 8.dp)
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
            .background(VcOnSurface.copy(alpha = 0.92f), RoundedCornerShape(3.dp)),
        contentAlignment = Alignment.Center
    ) {
        Box(Modifier.width(2.dp).height(14.dp).background(Color(0xFF2A2A2A), RoundedCornerShape(1.dp)))
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
