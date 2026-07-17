package com.vineicut.app.engine

/** A single timestamped line from a transcript or subtitle file. */
data class TranscriptCue(
    val startMs: Long,
    val endMs: Long?,   // null when the source only gives a start time
    val text: String
)

/**
 * Parses the two transcript shapes Vinei Cut users actually paste:
 *
 *  1. **SRT / VTT** subtitle blocks:
 *         1
 *         00:00:01,000 --> 00:00:04,000
 *         Hello world
 *
 *  2. **Loose timestamp lines** like the user described ("if it says 1:20…"):
 *         0:00 intro
 *         1:20 - the big reveal
 *         [2:05] outro
 *
 * Both are auto-detected. Times are returned in milliseconds.
 */
object TranscriptParser {

    private val srtRange = Regex(
        """(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})"""
    )

    // Matches a leading timestamp: 90, 1:20, 01:20, 1:02:03, optionally bracketed.
    private val looseStart = Regex(
        """^\s*[\[(]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2}|\d{1,3})\s*[\])]?\s*[-–—:]?\s*(.*)$"""
    )

    fun parse(raw: String): List<TranscriptCue> {
        if (raw.isBlank()) return emptyList()
        return if (srtRange.containsMatchIn(raw)) parseSrt(raw) else parseLoose(raw)
    }

    private fun parseSrt(raw: String): List<TranscriptCue> {
        val cues = mutableListOf<TranscriptCue>()
        val lines = raw.replace("\r\n", "\n").replace('\r', '\n').split("\n")
        var i = 0
        while (i < lines.size) {
            val m = srtRange.find(lines[i])
            if (m == null) { i++; continue }
            val start = parseClock(m.groupValues[1])
            val end = parseClock(m.groupValues[2])
            val text = StringBuilder()
            i++
            while (i < lines.size && lines[i].isNotBlank() && !srtRange.containsMatchIn(lines[i])) {
                // Skip a lone numeric subtitle index line.
                if (!(text.isEmpty() && lines[i].trim().toIntOrNull() != null)) {
                    if (text.isNotEmpty()) text.append(' ')
                    text.append(lines[i].trim())
                }
                i++
            }
            if (start != null) cues.add(TranscriptCue(start, end, text.toString().trim()))
        }
        return cues.sortedBy { it.startMs }
    }

    private fun parseLoose(raw: String): List<TranscriptCue> {
        val cues = mutableListOf<TranscriptCue>()
        for (line in raw.replace("\r\n", "\n").split("\n")) {
            if (line.isBlank()) continue
            val m = looseStart.find(line) ?: continue
            val ts = parseClock(m.groupValues[1]) ?: continue
            cues.add(TranscriptCue(ts, null, m.groupValues[2].trim()))
        }
        return cues.sortedBy { it.startMs }
    }

    /**
     * Parses a clock token into ms. Accepts:
     *   "90"            -> 90 seconds
     *   "1:20"          -> 1 min 20 s
     *   "01:02:03"      -> 1 h 2 min 3 s
     *   "00:00:04,500"  -> with millis (SRT comma or dot)
     */
    fun parseClock(token: String): Long? {
        val t = token.trim()
        if (t.isEmpty()) return null
        val msSplit = t.split(',', '.')
        val clock = msSplit[0]
        val millis = if (msSplit.size > 1) msSplit[1].padEnd(3, '0').take(3).toLongOrNull() ?: 0L else 0L
        val parts = clock.split(':')
        return try {
            val secondsTotal = when (parts.size) {
                1 -> parts[0].toLong()
                2 -> parts[0].toLong() * 60 + parts[1].toLong()
                3 -> parts[0].toLong() * 3600 + parts[1].toLong() * 60 + parts[2].toLong()
                else -> return null
            }
            secondsTotal * 1000 + millis
        } catch (e: NumberFormatException) {
            null
        }
    }
}
