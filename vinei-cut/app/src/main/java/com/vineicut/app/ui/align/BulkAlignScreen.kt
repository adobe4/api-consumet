package com.vineicut.app.ui.align

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import com.vineicut.app.ui.theme.VcAccent
import com.vineicut.app.ui.theme.VcBackground
import com.vineicut.app.ui.theme.VcMuted
import com.vineicut.app.ui.theme.VcOnSurface
import com.vineicut.app.ui.theme.VcSurface
import com.vineicut.app.vm.EditorViewModel

@Composable
fun BulkAlignScreen(
    vm: EditorViewModel,
    onDone: () -> Unit,
    onBack: () -> Unit
) {
    val context = LocalContext.current
    var mediaUris by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var videoUris by remember { mutableStateOf<Set<Uri>>(emptySet()) }
    var audioUri by remember { mutableStateOf<Uri?>(null) }
    var transcript by remember { mutableStateOf("") }
    var transcriptFile by remember { mutableStateOf<String?>(null) }
    var manualDuration by remember { mutableStateOf("") }
    var kenBurns by remember { mutableStateOf(true) }
    val scope = rememberCoroutineScope()

    val pickMedia = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(80)
    ) { uris ->
        mediaUris = uris
        videoUris = uris.filter {
            context.contentResolver.getType(it)?.startsWith("video") == true
        }.toSet()
    }
    val pickAudio = rememberLauncherForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri -> audioUri = uri }
    val pickTranscriptFile = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        if (uri != null) scope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching {
                    context.contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                }.getOrNull()
            }
            if (!text.isNullOrBlank()) {
                transcript = text
                transcriptFile = uri.lastPathSegment?.substringAfterLast('/') ?: "instructions"
            }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(VcBackground)
            .systemBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "back", tint = VcOnSurface)
            }
            Text("Bulk Auto-Align", color = VcOnSurface, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            "Paste your transcript, add your media and (optionally) the audio. " +
                "Vinei Cut lands every cut on the timestamps — you just add transitions.",
            color = VcMuted, fontSize = 13.sp
        )
        Spacer(Modifier.height(16.dp))

        StepLabel("1 · Media")
        OutlinedButton(onClick = {
            pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
        }) {
            Text(if (mediaUris.isEmpty()) "Pick images / videos" else "${mediaUris.size} selected (${videoUris.size} video)")
        }

        Spacer(Modifier.height(14.dp))
        StepLabel("2 · Audio (optional — sets total length)")
        OutlinedButton(onClick = { pickAudio.launch("audio/*") }) {
            Text(if (audioUri == null) "Pick audio / voice-over" else "Audio selected")
        }
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = manualDuration,
            onValueChange = { manualDuration = it.filter { c -> c.isDigit() } },
            label = { Text("…or total seconds", color = VcMuted) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(Modifier.height(14.dp))
        StepLabel("3 · Instructions — upload .srt / .json, or paste below")
        OutlinedButton(onClick = {
            pickTranscriptFile.launch(
                arrayOf(
                    "application/json",
                    "application/x-subrip",
                    "text/plain",
                    "text/*",
                    "application/octet-stream"
                )
            )
        }) {
            Text(transcriptFile?.let { "Loaded: $it" } ?: "Upload .srt / .json file")
        }
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = transcript,
            onValueChange = { transcript = it; transcriptFile = null },
            label = { Text("…or paste transcript / SRT / JSON", color = VcMuted) },
            modifier = Modifier
                .fillMaxWidth()
                .height(150.dp)
        )

        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(checked = kenBurns, onCheckedChange = { kenBurns = it })
            Spacer(Modifier.width(8.dp))
            Text("Add slow-zoom to photos", color = VcOnSurface, fontSize = 14.sp)
        }

        Spacer(Modifier.height(20.dp))
        Button(
            onClick = {
                vm.applyBulkAlignment(
                    uris = mediaUris,
                    videoUris = videoUris,
                    transcriptRaw = transcript,
                    totalDurationMs = (manualDuration.toLongOrNull() ?: 0L) * 1000L,
                    kenBurns = kenBurns,
                    audioUri = audioUri
                )
                onDone()
            },
            enabled = mediaUris.isNotEmpty(),
            colors = ButtonDefaults.buttonColors(containerColor = VcAccent),
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Align to timeline", color = VcOnSurface, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun StepLabel(text: String) {
    Text(
        text,
        color = VcOnSurface,
        fontSize = 14.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(bottom = 6.dp)
    )
}
