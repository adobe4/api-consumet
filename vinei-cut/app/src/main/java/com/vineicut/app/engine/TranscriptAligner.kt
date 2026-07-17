package com.vineicut.app.engine

import com.vineicut.app.model.Animation
import com.vineicut.app.model.AnimationType
import com.vineicut.app.model.Clip
import com.vineicut.app.model.ClipType

/** A piece of media the user bulk-imported, before it has a place on the timeline. */
data class MediaRef(
    val uri: String,
    val isVideo: Boolean,
    /** Intrinsic duration of the source (ms) if known — only relevant for video. */
    val sourceDurationMs: Long? = null,
    val label: String = ""
)

/**
 * The heart of Vinei Cut's bulk workflow.
 *
 * Takes the media you dumped in and lays them onto the MAIN track so that clip
 * boundaries fall on the transcript's timestamps — exactly the manual chore the
 * user described ("if it says 1:20, make that a point for a clip to start/finish").
 * You're then left with only transitions to add.
 */
object TranscriptAligner {

    data class Options(
        /** Total length to fill — normally the narration/audio duration (ms). */
        val totalDurationMs: Long,
        /** Add a gentle Ken-Burns slow-zoom to still images for life. */
        val kenBurnsOnImages: Boolean = true,
        /** Shortest allowed clip; shorter spans get merged upward. */
        val minClipMs: Long = 700
    )

    /**
     * Align [media] to [cues]. Clip count always equals media count; the cue
     * start times drive where cuts land. Extra media beyond the cue count are
     * distributed into the longest gaps; fewer media span multiple cues.
     */
    fun align(media: List<MediaRef>, cues: List<TranscriptCue>, options: Options): List<Clip> {
        if (media.isEmpty() || options.totalDurationMs <= 0) return emptyList()

        val boundaries = buildBoundaries(cues, options.totalDurationMs)
        val cuts = fitCutsToMediaCount(boundaries, media.size, options.totalDurationMs, options.minClipMs)
        return buildClips(media, cuts, options)
    }

    /** No transcript available: just tile the media evenly across the duration. */
    fun alignEven(media: List<MediaRef>, options: Options): List<Clip> {
        if (media.isEmpty() || options.totalDurationMs <= 0) return emptyList()
        val step = options.totalDurationMs.toDouble() / media.size
        val cuts = (0 until media.size).map { Math.round(it * step) }
        return buildClips(media, cuts, options)
    }

    // --- internals -----------------------------------------------------------

    private fun buildBoundaries(cues: List<TranscriptCue>, total: Long): List<Long> {
        val starts = cues.map { it.startMs }
            .filter { it in 0 until total }
            .toSortedSet()
        starts.add(0L) // always start at zero
        return starts.toList()
    }

    /**
     * Produces exactly [count] clip start times covering [0, total).
     * - more media than boundaries: split the longest gaps until we have enough.
     * - fewer media than boundaries: pick a spread-out subset of boundaries.
     */
    private fun fitCutsToMediaCount(
        boundaries: List<Long>,
        count: Int,
        total: Long,
        minClipMs: Long
    ): List<Long> {
        if (count <= 0) return emptyList()
        val b = boundaries.ifEmpty { listOf(0L) }

        val starts: MutableList<Long> = when {
            count == b.size -> b.toMutableList()

            count < b.size -> (0 until count)
                .map { b[((it.toLong() * b.size) / count).toInt()] }
                .distinct()
                .toMutableList()

            else -> { // count > b.size: subdivide widest gaps
                val list = b.toMutableList()
                while (list.size < count) {
                    val cut = widestGapMidpoint(list, total) ?: break
                    list.add(cut)
                    list.sort()
                }
                list
            }
        }

        starts.sort()
        // Guard against duplicates from subset selection when count < b.size.
        val deduped = starts.distinct().toMutableList()
        // If dedup lost entries, top up by subdividing so we still return `count`.
        while (deduped.size < count) {
            val cut = widestGapMidpoint(deduped, total) ?: break
            deduped.add(cut); deduped.sort()
        }
        return deduped.take(count)
    }

    private fun widestGapMidpoint(starts: List<Long>, total: Long): Long? {
        var bestMid: Long? = null
        var bestLen = -1L
        for (i in starts.indices) {
            val segStart = starts[i]
            val segEnd = if (i + 1 < starts.size) starts[i + 1] else total
            val len = segEnd - segStart
            if (len > bestLen) {
                val mid = segStart + len / 2
                if (mid != segStart && mid != segEnd) {
                    bestLen = len
                    bestMid = mid
                }
            }
        }
        return bestMid
    }

    private fun buildClips(media: List<MediaRef>, cuts: List<Long>, options: Options): List<Clip> {
        val clips = mutableListOf<Clip>()
        // Guarantee one cut per media even in degenerate inputs (total < count).
        val safeCuts = if (cuts.size >= media.size) cuts else {
            val step = options.totalDurationMs.toDouble() / media.size
            (0 until media.size).map { Math.round(it * step) }
        }
        for (i in media.indices) {
            val start = safeCuts[i]
            val end = if (i + 1 < safeCuts.size) safeCuts[i + 1] else options.totalDurationMs
            val duration = (end - start).coerceAtLeast(1L)
            val ref = media[i]

            val outPoint = if (ref.isVideo && ref.sourceDurationMs != null)
                minOf(duration, ref.sourceDurationMs) else duration

            clips.add(
                Clip(
                    type = if (ref.isVideo) ClipType.VIDEO else ClipType.IMAGE,
                    sourceUri = ref.uri,
                    startMs = start,
                    durationMs = duration,
                    inPointMs = 0,
                    outPointMs = outPoint,
                    animationIn = if (!ref.isVideo && options.kenBurnsOnImages)
                        Animation(AnimationType.SLOW_ZOOM_IN, duration) else Animation(),
                    label = ref.label.ifBlank { "Clip ${i + 1}" }
                )
            )
        }
        return clips
    }
}
