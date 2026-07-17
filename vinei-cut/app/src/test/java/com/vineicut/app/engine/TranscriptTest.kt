package com.vineicut.app.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptParserTest {

    @Test
    fun parsesLooseTimestamps() {
        val raw = """
            0:00 intro
            1:20 - the reveal
            [2:05] outro
        """.trimIndent()
        val cues = TranscriptParser.parse(raw)
        assertEquals(3, cues.size)
        assertEquals(0L, cues[0].startMs)
        assertEquals(80_000L, cues[1].startMs)
        assertEquals(125_000L, cues[2].startMs)
        assertEquals("the reveal", cues[1].text)
    }

    @Test
    fun parsesSrt() {
        val raw = """
            1
            00:00:01,000 --> 00:00:04,000
            Hello world

            2
            00:00:04,000 --> 00:00:06,500
            Second line
        """.trimIndent()
        val cues = TranscriptParser.parse(raw)
        assertEquals(2, cues.size)
        assertEquals(1000L, cues[0].startMs)
        assertEquals(4000L, cues[0].endMs)
        assertEquals("Hello world", cues[0].text)
        assertEquals(6500L, cues[1].endMs)
    }

    @Test
    fun parsesBareSeconds() {
        assertEquals(90_000L, TranscriptParser.parseClock("90"))
        assertEquals(3_723_000L, TranscriptParser.parseClock("1:02:03"))
        assertEquals(4_500L, TranscriptParser.parseClock("00:00:04,500"))
    }
}

class TranscriptAlignerTest {

    private fun media(n: Int, video: Boolean = false) =
        (1..n).map { MediaRef(uri = "img$it", isVideo = video, label = "m$it") }

    @Test
    fun oneMediaPerCueTilesFullTimeline() {
        val cues = listOf(
            TranscriptCue(0, null, "a"),
            TranscriptCue(5000, null, "b"),
            TranscriptCue(12000, null, "c"),
        )
        val clips = TranscriptAligner.align(
            media(3), cues, TranscriptAligner.Options(totalDurationMs = 20000)
        )
        assertEquals(3, clips.size)
        // Cuts land exactly on the transcript timestamps.
        assertEquals(0L, clips[0].startMs)
        assertEquals(5000L, clips[1].startMs)
        assertEquals(12000L, clips[2].startMs)
        // Fully tiled, no gaps, no overlaps.
        assertEquals(20000L, clips.last().endMs)
        for (i in 0 until clips.size - 1) {
            assertEquals(clips[i].endMs, clips[i + 1].startMs)
        }
    }

    @Test
    fun moreMediaThanCuesStillTilesAndCountMatches() {
        val cues = listOf(TranscriptCue(0, null, "a"), TranscriptCue(10000, null, "b"))
        val clips = TranscriptAligner.align(
            media(6), cues, TranscriptAligner.Options(totalDurationMs = 30000)
        )
        assertEquals(6, clips.size)
        assertEquals(0L, clips.first().startMs)
        assertEquals(30000L, clips.last().endMs)
        for (i in 0 until clips.size - 1) {
            assertEquals(clips[i].endMs, clips[i + 1].startMs)
            assertTrue(clips[i].durationMs > 0)
        }
    }

    @Test
    fun fewerMediaThanCuesCoversTimeline() {
        val cues = (0 until 8).map { TranscriptCue(it * 3000L, null, "c$it") }
        val clips = TranscriptAligner.align(
            media(3), cues, TranscriptAligner.Options(totalDurationMs = 24000)
        )
        assertEquals(3, clips.size)
        assertEquals(0L, clips.first().startMs)
        assertEquals(24000L, clips.last().endMs)
    }

    @Test
    fun evenSplitWithoutTranscript() {
        val clips = TranscriptAligner.alignEven(
            media(4), TranscriptAligner.Options(totalDurationMs = 20000)
        )
        assertEquals(4, clips.size)
        assertEquals(0L, clips[0].startMs)
        assertEquals(20000L, clips.last().endMs)
    }
}
