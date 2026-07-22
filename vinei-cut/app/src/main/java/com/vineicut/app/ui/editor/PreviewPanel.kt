package com.vineicut.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.model.AnimationType
import com.vineicut.app.model.ClipType
import com.vineicut.app.model.Project
import com.vineicut.app.model.TrackType
import com.vineicut.app.ui.theme.VcMuted

/**
 * Shows the frame under the playhead on a true-black stage, like CapCut's
 * preview. The 9:16 canvas is centered, rounded, and clipped so animations
 * (Ken-Burns zoom) can never draw outside it.
 */
@Composable
fun PreviewPanel(
    project: Project,
    playheadMs: Long,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        val ratio = if (project.height > 0) project.width.toFloat() / project.height.toFloat() else 9f / 16f
        Box(
            modifier = Modifier
                .fillMaxHeight()
                .padding(vertical = 6.dp)
                .aspectRatio(ratio)
                .clip(RoundedCornerShape(6.dp))
                .background(Color(0xFF050507))
                .clipToBounds(),
            contentAlignment = Alignment.Center
        ) {
            // Clamp so the last frame stays visible when the playhead parks at the end.
            val t = playheadMs.coerceAtMost((project.durationMs - 1).coerceAtLeast(0))

            val main = project.track(TrackType.MAIN)
            val mainClip = main?.clips?.firstOrNull { t in it.startMs until it.endMs }

            if (mainClip?.sourceUri != null) {
                val local = t - mainClip.startMs
                val scale = kenBurnsScale(mainClip.animationIn.type, local, mainClip.durationMs)
                MediaFrame(
                    uri = mainClip.sourceUri,
                    isVideo = mainClip.type == ClipType.VIDEO,
                    frameMs = mainClip.inPointMs + local,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer { scaleX = scale; scaleY = scale }
                )
            } else {
                EmptyPreviewHint()
            }

            // Overlay track frame stacked above.
            project.track(TrackType.OVERLAY)?.clips
                ?.firstOrNull { t in it.startMs until it.endMs && it.sourceUri != null }
                ?.let { ov ->
                    MediaFrame(
                        uri = ov.sourceUri!!,
                        isVideo = ov.type == ClipType.VIDEO,
                        frameMs = ov.inPointMs + (t - ov.startMs),
                        contentScale = ContentScale.Fit,
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(24.dp)
                            .graphicsLayer { alpha = ov.transform.opacity }
                    )
                }

            // Active caption text.
            project.track(TrackType.TEXT)?.clips
                ?.firstOrNull { t in it.startMs until it.endMs && it.textStyle != null }
                ?.let { caption ->
                    Box(
                        Modifier.fillMaxSize().padding(bottom = 40.dp),
                        contentAlignment = Alignment.BottomCenter
                    ) {
                        Text(
                            text = caption.textStyle!!.text,
                            color = Color(caption.textStyle.colorArgb),
                            fontSize = caption.textStyle.fontSizeSp.sp
                        )
                    }
                }
        }
    }
}

@Composable
private fun EmptyPreviewHint() {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Filled.Movie, null, tint = VcMuted)
        Text("Add media to begin", color = VcMuted, fontSize = 13.sp)
    }
}

/** Gentle Ken-Burns zoom used by the aligner's default image animation. */
private fun kenBurnsScale(type: AnimationType, localMs: Long, durationMs: Long): Float {
    if (durationMs <= 0) return 1f
    val t = (localMs.toFloat() / durationMs).coerceIn(0f, 1f)
    return when (type) {
        AnimationType.SLOW_ZOOM_IN -> 1f + 0.12f * t
        AnimationType.SLOW_ZOOM_OUT -> 1.12f - 0.12f * t
        else -> 1f
    }
}
