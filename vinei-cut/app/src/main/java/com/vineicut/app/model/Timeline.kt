package com.vineicut.app.model

import kotlinx.serialization.Serializable
import java.util.UUID

/**
 * Vinei Cut timeline model.
 *
 * All times are in **milliseconds** on the project timeline. Source trim points
 * ([Clip.inPointMs]/[Clip.outPointMs]) are also in ms, relative to the media source.
 *
 * The model is immutable data classes so Compose can diff cheaply; edits produce
 * copies via [copy]. Persistence is handled with kotlinx.serialization.
 */

enum class ClipType { VIDEO, IMAGE, AUDIO, TEXT, OVERLAY, STICKER, SHAPE }

enum class TrackType {
    /** Primary video/image row — the backbone the transcript aligns to. */
    MAIN,
    /** Picture-in-picture / overlay video & images stacked above MAIN. */
    OVERLAY,
    /** Text captions and titles. */
    TEXT,
    /** Music, voice-over, sound effects. */
    AUDIO,
    /** Stickers / emoji / imported PNG sequences. */
    STICKER
}

enum class BlendMode { NORMAL, SCREEN, MULTIPLY, ADD, OVERLAY, LIGHTEN, DARKEN }

enum class EffectType { BLUR, GRAIN, CHROMA_KEY, BRIGHTNESS, CONTRAST, SATURATION, HUE, SHARPEN, VIGNETTE }

/** Preset in/out animations comparable to CapCut / Motion Ninja. */
enum class AnimationType {
    NONE,
    SLOW_ZOOM_IN,
    SLOW_ZOOM_OUT,
    FADE_IN,
    FADE_OUT,
    SLIDE_IN_LEFT,
    SLIDE_IN_RIGHT,
    SLIDE_OUT_LEFT,
    SLIDE_OUT_RIGHT,
    POP_IN,
    SPIN
}

enum class KeyframeProperty { X, Y, SCALE, ROTATION, OPACITY, VOLUME }

fun newId(): String = UUID.randomUUID().toString()

@Serializable
data class Transform(
    val x: Float = 0f,        // normalized offset from center, -1..1 of canvas width
    val y: Float = 0f,
    val scale: Float = 1f,
    val rotation: Float = 0f, // degrees
    val opacity: Float = 1f   // 0..1
)

@Serializable
data class Keyframe(
    val timeMs: Long,         // relative to the clip start
    val property: KeyframeProperty,
    val value: Float,
    val easing: String = "linear"
)

@Serializable
data class Effect(
    val id: String = newId(),
    val type: EffectType,
    /** Generic 0..1 intensity plus named params (e.g. chroma key color). */
    val intensity: Float = 0.5f,
    val params: Map<String, Float> = emptyMap()
)

@Serializable
data class Animation(
    val type: AnimationType = AnimationType.NONE,
    val durationMs: Long = 600
)

@Serializable
data class TextStyle(
    val text: String = "Text",
    val fontFamily: String = "default",
    val fontSizeSp: Float = 42f,
    val colorArgb: Long = 0xFFFFFFFF,
    val hasBackground: Boolean = false,
    val backgroundArgb: Long = 0x99000000,
    val gradientStartArgb: Long? = null,
    val gradientEndArgb: Long? = null,
    val strokeWidth: Float = 0f,
    val strokeArgb: Long = 0xFF000000,
    val shadowRadius: Float = 0f,
    val shadowArgb: Long = 0x88000000,
    val alignment: String = "center", // left | center | right
    val bold: Boolean = false,
    val italic: Boolean = false
)

@Serializable
data class Clip(
    val id: String = newId(),
    val type: ClipType,
    /** Source content URI as string; null for pure text/shape clips. */
    val sourceUri: String? = null,
    /** Position of the clip's start on the timeline (ms). */
    val startMs: Long,
    /** Duration on the timeline (ms). */
    val durationMs: Long,
    /** Trim-in point inside the source media (ms). Ignored for images/text. */
    val inPointMs: Long = 0,
    /** Trim-out point inside the source media (ms). */
    val outPointMs: Long = durationMs,
    val transform: Transform = Transform(),
    val volume: Float = 1f,
    val speed: Float = 1f,
    val blendMode: BlendMode = BlendMode.NORMAL,
    val keyframes: List<Keyframe> = emptyList(),
    val effects: List<Effect> = emptyList(),
    val animationIn: Animation = Animation(),
    val animationOut: Animation = Animation(),
    val textStyle: TextStyle? = null,
    /** Grouping id — clips sharing it move/select together. */
    val groupId: String? = null,
    val label: String = ""
) {
    val endMs: Long get() = startMs + durationMs

    fun overlaps(other: Clip): Boolean =
        startMs < other.endMs && other.startMs < endMs
}

@Serializable
data class Track(
    val id: String = newId(),
    val type: TrackType,
    val name: String,
    val clips: List<Clip> = emptyList(),
    val muted: Boolean = false,
    val locked: Boolean = false,
    val hidden: Boolean = false
) {
    /** First free position at/after [fromMs] that fits [durationMs] with no overlap. */
    fun nextFreeStart(fromMs: Long, durationMs: Long): Long {
        val sorted = clips.sortedBy { it.startMs }
        var cursor = fromMs
        for (c in sorted) {
            if (c.endMs <= cursor) continue
            if (c.startMs >= cursor + durationMs) break
            cursor = c.endMs
        }
        return cursor
    }
}

@Serializable
data class Project(
    val id: String = newId(),
    val name: String = "Untitled",
    val width: Int = 1080,
    val height: Int = 1920,   // portrait 9:16 by default
    val fps: Int = 30,
    val tracks: List<Track> = defaultTracks(),
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis()
) {
    val durationMs: Long
        get() = tracks.flatMap { it.clips }.maxOfOrNull { it.endMs } ?: 0L

    fun track(type: TrackType): Track? = tracks.firstOrNull { it.type == type }

    companion object {
        fun defaultTracks(): List<Track> = listOf(
            Track(type = TrackType.MAIN, name = "Video"),
            Track(type = TrackType.OVERLAY, name = "Overlay"),
            Track(type = TrackType.TEXT, name = "Text"),
            Track(type = TrackType.AUDIO, name = "Audio")
        )
    }
}
