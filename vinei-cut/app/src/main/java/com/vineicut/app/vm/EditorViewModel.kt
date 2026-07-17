package com.vineicut.app.vm

import android.app.Application
import android.media.MediaMetadataRetriever
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vineicut.app.engine.MediaRef
import com.vineicut.app.engine.TranscriptAligner
import com.vineicut.app.engine.TranscriptParser
import com.vineicut.app.model.Clip
import com.vineicut.app.model.ClipType
import com.vineicut.app.model.Project
import com.vineicut.app.model.Track
import com.vineicut.app.model.TrackType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Single source of truth for the editor. Holds the [Project], the playhead,
 * selection and zoom, and exposes the editing operations the UI calls.
 */
class EditorViewModel(app: Application) : AndroidViewModel(app) {

    var project by mutableStateOf(Project())
        private set

    var selectedClipId by mutableStateOf<String?>(null)
        private set

    var playheadMs by mutableStateOf(0L)
        private set

    var pixelsPerSecond by mutableStateOf(40f)
        private set

    var statusMessage by mutableStateOf<String?>(null)

    var isBusy by mutableStateOf(false)
        private set

    // ---- undo / redo --------------------------------------------------------

    private val undoStack = ArrayDeque<Project>()
    private val redoStack = ArrayDeque<Project>()

    var canUndo by mutableStateOf(false)
        private set
    var canRedo by mutableStateOf(false)
        private set

    private fun refreshHistoryFlags() {
        canUndo = undoStack.isNotEmpty()
        canRedo = redoStack.isNotEmpty()
    }

    /** Commit a structural change with an undo checkpoint. */
    private fun commit(newProject: Project) {
        undoStack.addLast(project)
        if (undoStack.size > 60) undoStack.removeFirst()
        redoStack.clear()
        project = newProject.copy(updatedAt = System.currentTimeMillis())
        refreshHistoryFlags()
    }

    /** Snapshot once at the start of a drag; live drag updates then skip history. */
    fun beginInteraction() {
        undoStack.addLast(project)
        if (undoStack.size > 60) undoStack.removeFirst()
        redoStack.clear()
        refreshHistoryFlags()
    }

    fun undo() {
        if (undoStack.isEmpty()) return
        redoStack.addLast(project)
        project = undoStack.removeLast()
        refreshHistoryFlags()
        statusMessage = "Undo"
    }

    fun redo() {
        if (redoStack.isEmpty()) return
        undoStack.addLast(project)
        project = redoStack.removeLast()
        refreshHistoryFlags()
        statusMessage = "Redo"
    }

    // ---- selection & transport ---------------------------------------------

    fun selectClip(id: String?) { selectedClipId = id }

    fun setPlayhead(ms: Long) { playheadMs = ms.coerceIn(0, maxOf(0, project.durationMs)) }

    fun setZoom(pxPerSec: Float) { pixelsPerSecond = pxPerSec.coerceIn(8f, 240f) }

    fun selectedClip(): Clip? = project.tracks
        .flatMap { it.clips }
        .firstOrNull { it.id == selectedClipId }

    // ---- project lifecycle --------------------------------------------------

    fun newProject(name: String = "Untitled") {
        project = Project(name = name)
        selectedClipId = null
        playheadMs = 0
    }

    // ---- track mutation helpers --------------------------------------------

    /** Structural track replacement (undoable). */
    private fun replaceTrack(updated: Track) {
        commit(project.copy(tracks = project.tracks.map { if (it.id == updated.id) updated else it }))
    }

    /** Live track replacement used during drags — no undo checkpoint per frame. */
    private fun replaceTrackLive(updated: Track) {
        project = project.copy(
            tracks = project.tracks.map { if (it.id == updated.id) updated else it },
            updatedAt = System.currentTimeMillis()
        )
    }

    private fun trackForType(type: TrackType): Track =
        project.track(type) ?: Track(type = type, name = type.name).also {
            project = project.copy(tracks = project.tracks + it)
        }

    // ---- media import -------------------------------------------------------

    /** Reads intrinsic duration for video/audio; images get a default 3 s. */
    private fun resolveRef(uri: Uri, isVideo: Boolean): MediaRef {
        val duration = if (isVideo) readDurationMs(uri) else null
        return MediaRef(uri = uri.toString(), isVideo = isVideo, sourceDurationMs = duration)
    }

    private fun readDurationMs(uri: Uri): Long? {
        val r = MediaMetadataRetriever()
        return try {
            r.setDataSource(getApplication(), uri)
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        } catch (e: Exception) {
            null
        } finally {
            r.release()
        }
    }

    /** Appends picked media to the MAIN track, back-to-back after the last clip. */
    fun importToMain(uris: List<Uri>, videoUris: Set<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            isBusy = true
            val newClips = withContext(Dispatchers.IO) {
                val main = project.track(TrackType.MAIN) ?: Track(type = TrackType.MAIN, name = "Video")
                var cursor = main.clips.maxOfOrNull { it.endMs } ?: 0L
                uris.map { uri ->
                    val isVideo = uri in videoUris
                    val dur = if (isVideo) readDurationMs(uri) ?: 4000L else 3000L
                    val clip = Clip(
                        type = if (isVideo) ClipType.VIDEO else ClipType.IMAGE,
                        sourceUri = uri.toString(),
                        startMs = cursor,
                        durationMs = dur,
                        outPointMs = dur
                    )
                    cursor += dur
                    clip
                }
            }
            val main = trackForType(TrackType.MAIN)
            replaceTrack(main.copy(clips = main.clips + newClips))
            statusMessage = "Added ${newClips.size} clip(s)"
            isBusy = false
        }
    }

    /** Adds a single audio file to the AUDIO track at the playhead. */
    fun importAudio(uri: Uri) {
        viewModelScope.launch {
            isBusy = true
            val dur = withContext(Dispatchers.IO) { readDurationMs(uri) ?: 10000L }
            val audio = trackForType(TrackType.AUDIO)
            val start = audio.nextFreeStart(playheadMs, dur)
            val clip = Clip(
                type = ClipType.AUDIO,
                sourceUri = uri.toString(),
                startMs = start,
                durationMs = dur,
                outPointMs = dur,
                label = "Audio"
            )
            replaceTrack(audio.copy(clips = audio.clips + clip))
            statusMessage = "Audio added"
            isBusy = false
        }
    }

    // ---- editing operations -------------------------------------------------

    fun splitAtPlayhead() {
        val clip = selectedClip() ?: run { statusMessage = "Select a clip to split"; return }
        val at = playheadMs
        if (at <= clip.startMs || at >= clip.endMs) {
            statusMessage = "Move playhead over the clip to split"
            return
        }
        val track = project.tracks.first { t -> t.clips.any { it.id == clip.id } }
        val leftDur = at - clip.startMs
        val left = clip.copy(durationMs = leftDur, outPointMs = clip.inPointMs + leftDur)
        val right = clip.copy(
            id = com.vineicut.app.model.newId(),
            startMs = at,
            durationMs = clip.endMs - at,
            inPointMs = clip.inPointMs + leftDur,
            outPointMs = clip.outPointMs
        )
        replaceTrack(track.copy(clips = track.clips.flatMap {
            if (it.id == clip.id) listOf(left, right) else listOf(it)
        }))
        selectedClipId = left.id
        statusMessage = "Split"
    }

    fun duplicateSelected() {
        val clip = selectedClip() ?: return
        val track = project.tracks.first { t -> t.clips.any { it.id == clip.id } }
        val start = track.nextFreeStart(clip.endMs, clip.durationMs)
        val copy = clip.copy(id = com.vineicut.app.model.newId(), startMs = start)
        replaceTrack(track.copy(clips = track.clips + copy))
        selectedClipId = copy.id
        statusMessage = "Duplicated"
    }

    fun deleteSelected() {
        val id = selectedClipId ?: return
        commit(project.copy(tracks = project.tracks.map { t ->
            t.copy(clips = t.clips.filterNot { it.id == id })
        }))
        selectedClipId = null
        statusMessage = "Deleted"
    }

    private val minClipMs = 200L

    /** Live move during a drag. Call [beginInteraction] once at drag start. */
    fun moveSelectedLive(deltaMs: Long) {
        val clip = selectedClip() ?: return
        val track = project.tracks.first { t -> t.clips.any { it.id == clip.id } }
        val newStart = (clip.startMs + deltaMs).coerceAtLeast(0)
        replaceTrackLive(track.copy(clips = track.clips.map {
            if (it.id == clip.id) it.copy(startMs = newStart) else it
        }))
    }

    /** Drag the left edge: moves start and trims in-point, keeping the right edge fixed. */
    fun trimStartLive(deltaMs: Long) {
        val clip = selectedClip() ?: return
        val track = project.tracks.first { t -> t.clips.any { it.id == clip.id } }
        val maxDelta = clip.durationMs - minClipMs
        val d = deltaMs.coerceIn(-clip.startMs, maxDelta)
        val newStart = clip.startMs + d
        val newDur = clip.durationMs - d
        val newIn = (clip.inPointMs + d).coerceAtLeast(0)
        replaceTrackLive(track.copy(clips = track.clips.map {
            if (it.id == clip.id) it.copy(startMs = newStart, durationMs = newDur, inPointMs = newIn) else it
        }))
    }

    /** Drag the right edge: changes duration (and out-point), keeping the left edge fixed. */
    fun trimEndLive(deltaMs: Long) {
        val clip = selectedClip() ?: return
        val track = project.tracks.first { t -> t.clips.any { it.id == clip.id } }
        val newDur = (clip.durationMs + deltaMs).coerceAtLeast(minClipMs)
        replaceTrackLive(track.copy(clips = track.clips.map {
            if (it.id == clip.id) it.copy(durationMs = newDur, outPointMs = it.inPointMs + newDur) else it
        }))
    }

    // ---- bulk transcript alignment (flagship) -------------------------------

    /**
     * The headline feature: distribute [uris] across the MAIN track so cuts land
     * on the transcript timestamps. If [transcriptRaw] is blank the media are
     * split evenly across [totalDurationMs].
     */
    fun applyBulkAlignment(
        uris: List<Uri>,
        videoUris: Set<Uri>,
        transcriptRaw: String,
        totalDurationMs: Long,
        kenBurns: Boolean,
        audioUri: Uri? = null
    ) {
        if (uris.isEmpty()) {
            statusMessage = "Pick some media first"
            return
        }
        viewModelScope.launch {
            isBusy = true
            val total = withContext(Dispatchers.IO) {
                if (totalDurationMs > 0) totalDurationMs
                else audioUri?.let { readDurationMs(it) } ?: 0L
            }
            if (total <= 0) {
                statusMessage = "Add audio or set a total duration"
                isBusy = false
                return@launch
            }
            val refs = withContext(Dispatchers.IO) {
                uris.map { resolveRef(it, it in videoUris) }
            }
            val cues = TranscriptParser.parse(transcriptRaw)
            val options = TranscriptAligner.Options(
                totalDurationMs = total,
                kenBurnsOnImages = kenBurns
            )
            val clips = if (cues.isEmpty())
                TranscriptAligner.alignEven(refs, options)
            else
                TranscriptAligner.align(refs, cues, options)

            val main = trackForType(TrackType.MAIN)
            replaceTrack(main.copy(clips = clips))

            audioUri?.let { importAudio(it) }

            selectedClipId = clips.firstOrNull()?.id
            playheadMs = 0
            statusMessage = if (cues.isEmpty())
                "Placed ${clips.size} clips evenly"
            else
                "Aligned ${clips.size} clips to ${cues.size} transcript points"
            isBusy = false
        }
    }

    fun clearStatus() { statusMessage = null }
}
