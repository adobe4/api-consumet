package com.vineicut.app.ui.editor

import android.content.Context
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.VideoFrameDecoder
import coil.request.CachePolicy
import coil.request.ImageRequest
import coil.request.videoFrameMillis

/**
 * One app-wide loader so every thumbnail shares a single memory cache —
 * a per-composable loader made the timeline flicker and stutter.
 */
private object ThumbLoader {
    @Volatile private var instance: ImageLoader? = null

    fun get(context: Context): ImageLoader =
        instance ?: synchronized(this) {
            instance ?: ImageLoader.Builder(context.applicationContext)
                .components { add(VideoFrameDecoder.Factory()) }
                .memoryCachePolicy(CachePolicy.ENABLED)
                .crossfade(false)
                .build()
                .also { instance = it }
        }
}

/**
 * Renders a still frame for any media uri. For videos it decodes the frame at
 * [frameMs]; for images it just loads the image.
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
    val loader = remember { ThumbLoader.get(context) }
    val request = remember(uri, frameMs, isVideo) {
        ImageRequest.Builder(context)
            .data(Uri.parse(uri))
            .apply { if (isVideo) videoFrameMillis(frameMs) }
            .build()
    }
    AsyncImage(
        model = request,
        imageLoader = loader,
        contentDescription = null,
        contentScale = contentScale,
        modifier = modifier
    )
}
