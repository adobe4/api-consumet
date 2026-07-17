package com.vineicut.app.ui.editor

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.model.AnimationType
import com.vineicut.app.model.ClipType
import com.vineicut.app.model.Project
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcSurface
import com.vineicut.app.model.TrackType

/**
 * Shows the frame under the playhead. First-slice preview composites the MAIN
 * clip plus any OVERLAY/TEXT clips active at [playheadMs]. Full GPU compositing
 * with effects arrives with the render engine; this gives an accurate scrub.
 */
@Composable
fun PreviewPanel(
    project: Project,
    playheadMs: Long,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier.background(androidx.compose.ui.graphics.Color.Black),
        contentAlignment = Alignment.Center
    ) {
        // Portrait 9:16 canvas centered.
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val targetRatio = project.width.toFloat() / project.height.toFloat()
            val canvasMod = Modifier
                .fillMaxHeight()
                .aspectRatioSafe(targetRatio)
                .clip(RoundedCornerShape(6.dp))
                .background(VcSurface)

            Box(modifier = canvasMod, contentAlignment = Alignment.Center) {
                val main = project.track(TrackType.MAIN)
                val mainClip = main?.clips?.firstOrNull { playheadMs in it.startMs until it.endMs }

                if (mainClip?.sourceUri != null) {
                    val local = playheadMs - mainClip.startMs
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

                // Overlay track frames stacked above.
                project.track(TrackType.OVERLAY)?.clips
                    ?.firstOrNull { playheadMs in it.startMs until it.endMs && it.sourceUri != null }
                    ?.let { ov ->
                        MediaFrame(
                            uri = ov.sourceUri!!,
                            isVideo = ov.type == ClipType.VIDEO,
                            frameMs = ov.inPointMs + (playheadMs - ov.startMs),
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(24.dp)
                                .graphicsLayer { alpha = ov.transform.opacity }
                        )
                    }

                // Active caption text.
                project.track(TrackType.TEXT)?.clips
                    ?.firstOrNull { playheadMs in it.startMs until it.endMs && it.textStyle != null }
                    ?.let { caption ->
                        Box(
                            Modifier.fillMaxSize().padding(bottom = 40.dp),
                            contentAlignment = Alignment.BottomCenter
                        ) {
                            Text(
                                text = caption.textStyle!!.text,
                                color = androidx.compose.ui.graphics.Color(caption.textStyle.colorArgb),
                                fontSize = caption.textStyle.fontSizeSp.sp
                            )
                        }
                    }
            }
        }
    }
}

@Composable
private fun EmptyPreviewHint() {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        androidx.compose.foundation.layout.Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Filled.Movie, null, tint = VcMuted)
            Text("Add media to begin", color = VcMuted, fontSize = 13.sp)
        }
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

/** aspectRatio that never throws on zero/NaN. */
private fun Modifier.aspectRatioSafe(ratio: Float): Modifier =
    if (ratio.isFinite() && ratio > 0f) this.aspectRatio(ratio) else this
