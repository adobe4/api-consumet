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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.FileDownload
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
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
            Modifier.fillMaxWidth().background(VcSurface).padding(vertical = 6.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            IconButton(onClick = { isPlaying = !isPlaying }) {
                Icon(
                    if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                    "play/pause",
                    tint = VcOnSurface,
                    modifier = Modifier.size(30.dp)
                )
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
            modifier = Modifier.fillMaxWidth()
        )

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
