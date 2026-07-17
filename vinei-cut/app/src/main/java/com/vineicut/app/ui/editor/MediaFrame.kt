package com.vineicut.app.ui.editor

import android.net.Uri
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.VideoFrameDecoder
import coil.request.ImageRequest
import coil.request.videoFrameMillis

/**
 * Renders a still frame for any media uri. For videos it decodes the frame at
 * [frameMs] using Coil's [VideoFrameDecoder]; for images it just loads the image.
 */
@Composable
fun MediaFrame(
    uri: String,
    isVideo: Boolean,
    frameMs: Long,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Fit
) {
    val context = LocalContext.current
    val loader = remember {
        ImageLoader.Builder(context)
            .components { add(VideoFrameDecoder.Factory()) }
            .crossfade(true)
            .build()
    }
    val request = remember(uri, frameMs, isVideo) {
        ImageRequest.Builder(context)
            .data(Uri.parse(uri))
            .apply { if (isVideo) videoFrameMillis(frameMs) }
            .build()
    }
    Box(modifier) {
        AsyncImage(
            model = request,
            imageLoader = loader,
            contentDescription = null,
            contentScale = contentScale,
            modifier = Modifier.fillMaxSize()
        )
    }
}
