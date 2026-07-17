package com.vineicut.app.engine

import android.content.Context
import android.net.Uri
import android.os.Environment
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import com.vineicut.app.model.ClipType
import com.vineicut.app.model.Project
import com.vineicut.app.model.TrackType
import java.io.File

/**
 * Renders the project to an MP4 with Media3 [Transformer].
 *
 * First-slice scope: concatenates the MAIN track (images + trimmed video) into a
 * video sequence and lays the AUDIO track underneath. Per-clip GPU effects,
 * keyframed transforms and overlay compositing are wired into [Effects] as the
 * render engine matures; the sequence/timeline structure is already correct.
 */
@androidx.annotation.OptIn(UnstableApi::class)
class ExportManager(private val context: Context) {

    interface Callback {
        fun onProgress(percent: Int) {}
        fun onDone(outputPath: String)
        fun onError(message: String)
    }

    private var transformer: Transformer? = null

    fun export(project: Project, callback: Callback) {
        val main = project.track(TrackType.MAIN)
        val mainClips = main?.clips?.sortedBy { it.startMs }.orEmpty()
        if (mainClips.isEmpty()) {
            callback.onError("Nothing on the video track to export")
            return
        }

        val videoItems = mainClips.map { clip ->
            val builder = EditedMediaItem.Builder(mediaItemFor(clip.sourceUri, clip))
            // Images have no intrinsic duration — give them their timeline length.
            if (clip.type == ClipType.IMAGE) {
                builder.setDurationUs(clip.durationMs * 1000)
            }
            builder.build()
        }
        val videoSequence = EditedMediaItemSequence(videoItems)

        val sequences = mutableListOf(videoSequence)

        val audioClips = project.track(TrackType.AUDIO)?.clips?.sortedBy { it.startMs }.orEmpty()
        if (audioClips.isNotEmpty()) {
            val audioItems = audioClips.map { clip ->
                EditedMediaItem.Builder(mediaItemFor(clip.sourceUri, clip)).build()
            }
            sequences.add(EditedMediaItemSequence(audioItems))
        }

        val composition = Composition.Builder(sequences).build()

        val output = outputFile()
        val t = Transformer.Builder(context)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    callback.onDone(output.absolutePath)
                }

                override fun onError(
                    composition: Composition,
                    exportResult: ExportResult,
                    exportException: ExportException
                ) {
                    callback.onError(exportException.message ?: "Export failed")
                }
            })
            .build()
        transformer = t
        try {
            t.start(composition, output.absolutePath)
        } catch (e: Exception) {
            callback.onError(e.message ?: "Export could not start")
        }
    }

    fun cancel() {
        transformer?.cancel()
        transformer = null
    }

    private fun mediaItemFor(uri: String?, clip: com.vineicut.app.model.Clip): MediaItem {
        val builder = MediaItem.Builder().setUri(uri?.let { Uri.parse(it) })
        if (clip.type == ClipType.VIDEO && clip.outPointMs > clip.inPointMs) {
            builder.setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(clip.inPointMs)
                    .setEndPositionMs(clip.outPointMs)
                    .build()
            )
        }
        return builder.build()
    }

    private fun outputFile(): File {
        val dir = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
            ?: context.filesDir
        if (!dir.exists()) dir.mkdirs()
        return File(dir, "VineiCut_${System.currentTimeMillis()}.mp4")
    }
}
