package com.vineicut.app.ui.editor

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Redo
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Fullscreen
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vineicut.app.engine.ExportManager
import com.vineicut.app.ui.theme.VcAccent
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcOnSurface
import com.vineicut.app.ui.theme.VcSurface
import com.vineicut.app.vm.EditorViewModel

@Composable
fun EditorScreen(
    vm: EditorViewModel,
    onBack: () -> Unit,
    onOpenBulkAlign: () -> Unit
) {
    val context = LocalContext.current
    var isPlaying by remember { mutableStateOf(false) }
    val exporter = remember { ExportManager(context) }

    val pickMedia = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(60)
    ) { uris ->
        if (uris.isNotEmpty()) {
            val videoUris = uris.filter {
                context.contentResolver.getType(it)?.startsWith("video") == true
            }.toSet()
            vm.importToMain(uris, videoUris)
        }
    }
    val pickAudio = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> uri?.let { vm.importAudio(it) } }

    // Playback tick — advances the playhead in real time (visual preview).
    LaunchedEffect(isPlaying) {
        if (isPlaying) {
            var last = 0L
            while (isPlaying) {
                val now = withFrameNanos { it }
                if (last != 0L) {
                    val deltaMs = (now - last) / 1_000_000
                    val next = vm.playheadMs + deltaMs
                    if (next >= vm.project.durationMs) {
                        vm.setPlayhead(vm.project.durationMs)
                        isPlaying = false
                    } else {
                        vm.setPlayhead(next)
                    }
                }
                last = now
            }
        }
    }

    // Auto-clear transient status messages.
    LaunchedEffect(vm.statusMessage) {
        if (vm.statusMessage != null) {
            kotlinx.coroutines.delay(2200)
            vm.clearStatus()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(com.vineicut.app.ui.theme.VcBackground)
            .systemBarsPadding()
    ) {
        // Top bar
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "back", tint = VcOnSurface)
            }
            Text(vm.project.name, color = VcOnSurface, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = {
                vm.statusMessage = "Exporting…"
                exporter.export(vm.project, object : ExportManager.Callback {
                    override fun onDone(outputPath: String) { vm.statusMessage = "Saved: $outputPath" }
                    override fun onError(message: String) { vm.statusMessage = "Export: $message" }
                })
            }) {
                Icon(Icons.Filled.FileDownload, "export", tint = VcAccent)
            }
        }

        // Preview
        PreviewPanel(
            project = vm.project,
            playheadMs = vm.playheadMs,
            modifier = Modifier.fillMaxWidth().weight(1f)
        )

        // Transport
        Row(
            Modifier.fillMaxWidth().background(VcSurface).padding(horizontal = 10.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = { vm.setPlayhead(prevBoundary(vm.project, vm.playheadMs)) }) {
                Icon(Icons.Filled.SkipPrevious, "previous cut", tint = VcOnSurface)
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { isPlaying = !isPlaying }) {
                Icon(
                    if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    "play/pause",
                    tint = VcOnSurface,
                    modifier = Modifier.size(34.dp)
                )
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { vm.setPlayhead(nextBoundary(vm.project, vm.playheadMs)) }) {
                Icon(Icons.Filled.SkipNext, "next cut", tint = VcOnSurface)
            }
            IconButton(onClick = { vm.statusMessage = "Fullscreen preview — coming soon" }) {
                Icon(Icons.Filled.Fullscreen, "fullscreen", tint = VcMuted)
            }
        }

        // Timeline
        TimelinePanel(
            project = vm.project,
            playheadMs = vm.playheadMs,
            pxPerSec = vm.pixelsPerSecond,
            selectedClipId = vm.selectedClipId,
            onSeek = { vm.setPlayhead(it) },
            onSelectClip = { vm.selectClip(it) },
            onZoom = { vm.setZoom(it) },
            onDragStart = { vm.beginInteraction() },
            onMove = { vm.moveSelectedLive(it) },
            onTrimStart = { vm.trimStartLive(it) },
            onTrimEnd = { vm.trimEndLive(it) },
            modifier = Modifier.fillMaxWidth()
        )

        // Quick-action bar: undo/redo · add · split · duplicate · delete
        Row(
            Modifier.fillMaxWidth().background(VcSurface).padding(horizontal = 8.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(enabled = vm.canUndo, onClick = { vm.undo() }) {
                Icon(Icons.AutoMirrored.Filled.Undo, "undo", tint = if (vm.canUndo) VcOnSurface else VcMuted.copy(alpha = 0.4f))
            }
            IconButton(enabled = vm.canRedo, onClick = { vm.redo() }) {
                Icon(Icons.AutoMirrored.Filled.Redo, "redo", tint = if (vm.canRedo) VcOnSurface else VcMuted.copy(alpha = 0.4f))
            }
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { vm.splitAtPlayhead() }) {
                Icon(Icons.Filled.ContentCut, "split", tint = VcOnSurface)
            }
            IconButton(onClick = { vm.duplicateSelected() }) {
                Icon(Icons.Filled.ContentCopy, "duplicate", tint = VcOnSurface)
            }
            IconButton(onClick = { vm.deleteSelected() }) {
                Icon(Icons.Filled.Delete, "delete", tint = VcOnSurface)
            }
            Spacer(Modifier.width(6.dp))
            // Purple add button, like the reference.
            Box(
                Modifier
                    .size(34.dp)
                    .clip(CircleShape)
                    .background(VcAccent)
                    .clickable {
                        pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                    },
                contentAlignment = Alignment.Center
            ) {
                Icon(Icons.Filled.Add, "add media", tint = VcOnSurface)
            }
        }

        // Status line
        vm.statusMessage?.let {
            Text(
                it,
                color = VcMuted,
                fontSize = 12.sp,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 2.dp)
            )
        }

        // Toolbar
        EditorToolbar(
            onAction = { action ->
                when (action) {
                    ToolAction.ADD_MEDIA -> pickMedia.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                    )
                    ToolAction.ADD_AUDIO -> pickAudio.launch("audio/*")
                    ToolAction.BULK_ALIGN -> onOpenBulkAlign()
                    ToolAction.SPLIT -> vm.splitAtPlayhead()
                    ToolAction.DUPLICATE -> vm.duplicateSelected()
                    ToolAction.DELETE -> vm.deleteSelected()
                    else -> vm.statusMessage = "${action.name.lowercase().replaceFirstChar { it.uppercase() }} — coming in the next build"
                }
            },
            modifier = Modifier.fillMaxWidth()
        )
    }
}

/** All clip start/end times across the project, sorted — used for snap navigation. */
private fun boundaries(project: com.vineicut.app.model.Project): List<Long> =
    (listOf(0L, project.durationMs) + project.tracks.flatMap { t -> t.clips.flatMap { listOf(it.startMs, it.endMs) } })
        .distinct()
        .sorted()

private fun prevBoundary(project: com.vineicut.app.model.Project, playheadMs: Long): Long =
    boundaries(project).lastOrNull { it < playheadMs } ?: 0L

private fun nextBoundary(project: com.vineicut.app.model.Project, playheadMs: Long): Long =
    boundaries(project).firstOrNull { it > playheadMs } ?: project.durationMs
