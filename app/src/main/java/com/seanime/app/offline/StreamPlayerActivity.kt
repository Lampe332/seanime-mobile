package com.seanime.app.offline

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.os.Bundle
import android.view.WindowManager
import android.widget.Toast
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import com.seanime.app.AppLanguage
import com.seanime.app.AppLanguage.tr

/**
 * Plays a stream of the local server in the app's own player, which decodes AC3, E-AC3, DTS and TrueHD with FFmpeg.
 * The web player opens it for audio the WebView cannot play and continues at the returned position.
 */
@OptIn(UnstableApi::class)
class StreamPlayerActivity : Activity() {
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AppLanguage.init(this)
        val url = intent.getStringExtra(EXTRA_URL)
        if (url == null) {
            finish()
            return
        }
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or android.view.View.SYSTEM_UI_FLAG_FULLSCREEN or
            android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE

        val exo = ExoPlayer.Builder(this, renderers(this)).build()
        player = exo
        exo.setAudioAttributes(AudioAttributes.DEFAULT, true)
        // the web player's languages; Media3 shows subtitles only for a preferred language (or forced/default tracks)
        val subtitles = intent.getStringExtra(EXTRA_SUBTITLE_LANGUAGE)?.takeIf { it.isNotBlank() && it != "none" }
        exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon()
            .setPreferredAudioLanguage(intent.getStringExtra(EXTRA_AUDIO_LANGUAGE)?.takeIf { it.isNotBlank() })
            .setPreferredTextLanguage(subtitles)
            .build()
        exo.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                Toast.makeText(this@StreamPlayerActivity, tr("The app player cannot play this stream.", "Der App-Player kann diesen Stream nicht abspielen."),
                    Toast.LENGTH_LONG).show()
                finish()
            }
        })
        exo.setMediaItem(MediaItem.fromUri(url))
        exo.seekTo(intent.getLongExtra(EXTRA_POSITION, 0))
        exo.prepare()
        exo.playWhenReady = true
        // always fullscreen here, so the fullscreen button has nothing to switch
        setContentView(OfflinePlayerView(this, exo, intent.getStringExtra(EXTRA_TITLE) ?: "Seanime", {}, { finish() }))
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun finish() {
        setResult(RESULT_OK, Intent().putExtra(EXTRA_POSITION, player?.currentPosition ?: 0L))
        super.finish()
    }

    override fun onDestroy() {
        player?.release()
        player = null
        super.onDestroy()
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TITLE = "title"
        const val EXTRA_POSITION = "positionMs"
        const val EXTRA_AUDIO_LANGUAGE = "audioLanguage"
        const val EXTRA_SUBTITLE_LANGUAGE = "subtitleLanguage"

        /** Device decoders first, FFmpeg for what the device cannot decode. */
        @OptIn(UnstableApi::class)
        fun renderers(context: Context) = DefaultRenderersFactory(context).setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
    }
}
