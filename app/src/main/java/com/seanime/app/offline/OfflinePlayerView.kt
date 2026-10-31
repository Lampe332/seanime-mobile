package com.seanime.app.offline

import android.app.AlertDialog
import com.seanime.app.AppLanguage.tr
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import java.util.Locale
import kotlin.math.roundToInt

/**
 * Seanime's mobile control arrangement over the native decoder. [badge] marks the source (OFFLINE for downloads);
 * with [playNext], the end of the video counts down to [nextLabel] like the web player does.
 */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OfflinePlayerView(
    context: Context,
    private val exo: ExoPlayer,
    title: String,
    private val fullscreen: () -> Unit,
    private val exit: () -> Unit,
    badge: String? = null,
    private val nextLabel: String? = null,
    private val playNext: (() -> Unit)? = null,
) : FrameLayout(context) {
    private val handler = Handler(Looper.getMainLooper())
    private val controls = FrameLayout(context)
    private val toggle: TextView
    private val time: TextView
    private val seek: SeekBar
    private val speed: TextView
    private val feedback: TextView
    private var scrubbing = false
    private var menuOpen = false
    private var dialog: AlertDialog? = null
    private var visible = true
    private var lastPlaying: Boolean? = null
    private val upNext = LinearLayout(context)
    private val upNextText: TextView
    private var countdown = 0
    private val countdownTick = object : Runnable {
        override fun run() {
            if (countdown <= 0) { cancelNext(); playNext?.invoke(); return }
            upNextText.text = tr("Up next: $nextLabel in $countdown s", "Gleich: $nextLabel in $countdown s")
            countdown--
            handler.postDelayed(this, 1000)
        }
    }
    private val hide = Runnable { if (exo.isPlaying && !scrubbing && !menuOpen) showControls(false) }
    private val update = object : Runnable {
        override fun run() {
            if (!scrubbing) {
                val duration = exo.duration.coerceAtLeast(0)
                seek.progress = if (duration > 0) (exo.currentPosition * 1000 / duration).toInt() else 0
                time.text = "${clock(exo.currentPosition)} / ${clock(duration)}"
            }
            if (lastPlaying != exo.isPlaying) {
                lastPlaying = exo.isPlaying
                icon(toggle, if (exo.isPlaying) "pause" else "play", 28)
                toggle.contentDescription = if (exo.isPlaying) tr("Pause", "Pause") else tr("Play", "Abspielen")
            }
            speed.text = "${exo.playbackParameters.speed}×"
            handler.postDelayed(this, 300)
        }
    }
    private val listener = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (!isPlaying) showControls(true) else scheduleHide()
        }
        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED) {
                showControls(true)
                if (playNext != null && countdown == 0 && upNext.visibility != View.VISIBLE) startNext()
            } else cancelNext()
        }
    }
    private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()
    private fun caption(value: String, size: Float = 13f) = TextView(context).apply {
        text = value; textSize = size; setTextColor(Color.WHITE); includeFontPadding = false
        gravity = Gravity.CENTER_VERTICAL
    }
    private fun button(value: String, description: String, size: Int = 44, action: () -> Unit) = caption(value, 18f).apply {
        gravity = Gravity.CENTER; contentDescription = description
        isClickable = true; isFocusable = true
        background = android.graphics.drawable.RippleDrawable(
            android.content.res.ColorStateList.valueOf(0x44FFFFFF), null,
            GradientDrawable().apply { setColor(Color.WHITE); cornerRadius = dp(size).toFloat() })
        setOnClickListener { action(); scheduleHide() }
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size))
    }
    private fun icon(button: TextView, kind: String, size: Int = 24) {
        button.text = ""
        button.setPadding(dp((if (kind == "play" || kind == "pause") 64 else 44) - size) / 2, 0, 0, 0)
        val drawable = object : android.graphics.drawable.Drawable() {
            private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
            override fun draw(canvas: android.graphics.Canvas) {
                val saved = canvas.save()
                canvas.translate(bounds.left.toFloat(), bounds.top.toFloat()); canvas.scale(bounds.width() / 24f, bounds.height() / 24f)
                when (kind) {
                    "play" -> canvas.drawPath(android.graphics.Path().apply { moveTo(8f, 5f); lineTo(20f, 12f); lineTo(8f, 19f); close() }, paint)
                    "pause" -> { canvas.drawRect(6f, 5f, 10f, 19f, paint); canvas.drawRect(14f, 5f, 18f, 19f, paint) }
                    else -> {
                        paint.style = android.graphics.Paint.Style.STROKE; paint.strokeWidth = 2f
                        canvas.drawPath(android.graphics.Path().apply {
                            moveTo(9f, 4f); lineTo(4f, 4f); lineTo(4f, 9f)
                            moveTo(15f, 4f); lineTo(20f, 4f); lineTo(20f, 9f)
                            moveTo(4f, 15f); lineTo(4f, 20f); lineTo(9f, 20f)
                            moveTo(15f, 20f); lineTo(20f, 20f); lineTo(20f, 15f)
                        }, paint)
                    }
                }
                canvas.restoreToCount(saved)
            }
            override fun setAlpha(alpha: Int) { paint.alpha = alpha }
            override fun setColorFilter(filter: android.graphics.ColorFilter?) { paint.colorFilter = filter }
            @Deprecated("Deprecated in Java") override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
        }.apply { setBounds(0, 0, dp(size), dp(size)) }
        button.setCompoundDrawables(drawable, null, null, null)
    }

    init {
        setBackgroundColor(Color.BLACK)
        val video = PlayerView(context).apply {
            useController = false; player = exo
            setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)
        }
        addView(video, LayoutParams(-1, -1))
        // The native decoder never changes across portrait/fullscreen transitions.
        val touch = View(context)
        val gestures = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent) = true
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean { showControls(!visible); return true }
            override fun onDoubleTap(e: MotionEvent): Boolean {
                val seconds = if (e.x < width / 2) -5 else 10
                skip(seconds); showControls(true); return true
            }
        })
        touch.setOnTouchListener { _, event -> gestures.onTouchEvent(event) }
        touch.contentDescription = tr("Video area: tap for controls, double-tap to seek", "Videofläche: tippen für Steuerung, doppeltippen zum Spulen")
        addView(touch, LayoutParams(-1, -1))
        controls.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0xB3000000.toInt(), 0x10000000, 0xD9000000.toInt()))
        // Leave gaps between controls touch-through for the same tap/double-tap behavior.
        controls.isClickable = false
        addView(controls, LayoutParams(-1, -1))
        val top = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(4), dp(2), dp(6), 0) }
        top.addView(button("‹", tr("Back to downloads", "Zurück zu Downloads")) { exit() })
        top.addView(caption(title, 13f).apply {
            maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END
            setTypeface(typeface, android.graphics.Typeface.BOLD)
        }, LinearLayout.LayoutParams(0, -2, 1f))
        if (badge != null) top.addView(caption(badge, 9f).apply { setTextColor(0xFF65DEB0.toInt()); setPadding(dp(8), 0, dp(8), 0) })
        controls.addView(top, LayoutParams(-1, dp(46), Gravity.TOP))
        val center = LinearLayout(context).apply { gravity = Gravity.CENTER }
        center.addView(button("−5", tr("Back 5 seconds", "5 Sekunden zurück"), 52) { skip(-5) })
        toggle = button("▶", tr("Play", "Abspielen"), 64) {
            if (exo.playbackState == Player.STATE_ENDED) { exo.seekTo(0); exo.play() }
            else if (exo.isPlaying) exo.pause() else exo.play()
        }.apply {
            textSize = 30f
            background = GradientDrawable().apply { setColor(0x55000000); cornerRadius = dp(40).toFloat() }
        }
        icon(toggle, "play", 28)
        center.addView(toggle, LinearLayout.LayoutParams(dp(64), dp(64)).apply { leftMargin = dp(20); rightMargin = dp(20) })
        center.addView(button("+10", tr("Forward 10 seconds", "10 Sekunden vor"), 52) { skip(10) })
        controls.addView(center, LayoutParams(-2, dp(64), Gravity.CENTER))

        val bottom = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(12), dp(2))
        }
        seek = SeekBar(context).apply {
            max = 1000; contentDescription = tr("Playback position", "Wiedergabeposition")
            progressTintList = android.content.res.ColorStateList.valueOf(0xFFAA94FF.toInt())
            thumbTintList = progressTintList
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onStartTrackingTouch(bar: SeekBar) { scrubbing = true; handler.removeCallbacks(hide) }
                override fun onProgressChanged(bar: SeekBar, progress: Int, fromUser: Boolean) {
                    if (fromUser) time.text = "${clock(exo.duration.coerceAtLeast(0) * progress / 1000)} / ${clock(exo.duration.coerceAtLeast(0))}"
                }
                override fun onStopTrackingTouch(bar: SeekBar) {
                    exo.seekTo(exo.duration.coerceAtLeast(0) * bar.progress / 1000)
                    scrubbing = false; scheduleHide()
                }
            })
        }
        // a thin bar, but a finger-sized touch target
        bottom.addView(seek, LinearLayout.LayoutParams(-1, dp(48)))
        val tools = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        time = caption("00:00 / 00:00", 11f)
        tools.addView(time, LinearLayout.LayoutParams(0, dp(44), 1f))
        speed = button("1.0×", tr("Playback speed", "Wiedergabetempo")) { speedMenu() }.apply { textSize = 12f }
        tools.addView(speed)
        tools.addView(button(tr("Audio", "Ton"), tr("Audio track", "Tonspur")) { audioMenu() }.apply { textSize = 12f })
        tools.addView(button("CC", tr("Subtitles", "Untertitel")) { subtitleMenu() }.apply { textSize = 12f })
        tools.addView(button("", tr("Toggle fullscreen", "Vollbild umschalten")) { fullscreen() }.apply { icon(this, "fullscreen") })
        bottom.addView(tools)
        controls.addView(bottom, LayoutParams(-1, -2, Gravity.BOTTOM))
        feedback = caption("", 14f).apply {
            gravity = Gravity.CENTER; visibility = View.GONE
            setBackgroundColor(0xB3000000.toInt()); setPadding(dp(12), dp(8), dp(12), dp(8))
        }
        addView(feedback, LayoutParams(-2, -2, Gravity.CENTER_HORIZONTAL or Gravity.TOP).apply { topMargin = dp(48) })

        upNext.apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; visibility = View.GONE
            setPadding(dp(16), dp(12), dp(16), dp(8))
            background = GradientDrawable().apply { setColor(0xE6000000.toInt()); cornerRadius = dp(14).toFloat() }
        }
        upNextText = caption("", 14f).apply { gravity = Gravity.CENTER; setTypeface(typeface, android.graphics.Typeface.BOLD) }
        upNext.addView(upNextText)
        val choices = LinearLayout(context).apply { gravity = Gravity.CENTER }
        choices.addView(button(tr("Play now", "Jetzt abspielen"), tr("Play the next episode now", "Nächste Folge jetzt abspielen")) {
            countdown = 0; handler.removeCallbacks(countdownTick); countdownTick.run()
        }.apply { textSize = 13f; layoutParams = LinearLayout.LayoutParams(-2, dp(44)); setPadding(dp(12), 0, dp(12), 0) })
        choices.addView(button(tr("Cancel", "Abbrechen"), tr("Stay on this episode", "Bei dieser Folge bleiben")) { cancelNext() }
            .apply { textSize = 13f; layoutParams = LinearLayout.LayoutParams(-2, dp(44)); setPadding(dp(12), 0, dp(12), 0) })
        upNext.addView(choices)
        addView(upNext, LayoutParams(-2, -2, Gravity.CENTER))
    }

    /** 5 seconds, then the next downloaded episode; cancelled by the button or by seeking back into the video. */
    private fun startNext() {
        countdown = 5
        upNext.visibility = View.VISIBLE
        controls.visibility = View.INVISIBLE
        handler.removeCallbacks(countdownTick)
        countdownTick.run()
    }

    private fun cancelNext() {
        handler.removeCallbacks(countdownTick)
        countdown = 0
        if (upNext.visibility == View.VISIBLE) { upNext.visibility = View.GONE; showControls(true) }
    }

    private fun skip(seconds: Int) {
        exo.seekTo((exo.currentPosition + seconds * 1000).coerceIn(0, exo.duration.coerceAtLeast(0)))
        feedback.text = if (seconds < 0) tr("−5 seconds", "−5 Sekunden") else tr("+10 seconds", "+10 Sekunden")
        feedback.visibility = View.VISIBLE
        handler.removeCallbacks(clearFeedback); handler.postDelayed(clearFeedback, 700)
    }
    private val clearFeedback = Runnable { feedback.visibility = View.GONE }
    private fun showControls(show: Boolean) {
        visible = show; controls.visibility = if (show) View.VISIBLE else View.INVISIBLE
        if (show) scheduleHide()
    }
    private fun scheduleHide() { handler.removeCallbacks(hide); handler.postDelayed(hide, 5000) }
    private fun choose(title: String, labels: Array<String>, selected: Int, apply: (Int) -> Unit) {
        menuOpen = true; handler.removeCallbacks(hide)
        dialog = AlertDialog.Builder(context).setTitle(title).setSingleChoiceItems(labels, selected) { dialog, which ->
            apply(which); dialog.dismiss()
        }.setNegativeButton(tr("Close", "Schließen"), null).create().also {
            it.setOnDismissListener { menuOpen = false; scheduleHide() }; it.show()
        }
    }
    private fun speedMenu() {
        val values = floatArrayOf(0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f)
        choose(tr("Playback speed", "Wiedergabetempo"), values.map { "$it×" }.toTypedArray(), values.indexOfFirst { it == exo.playbackParameters.speed }) {
            exo.setPlaybackSpeed(values[it])
        }
    }
    private fun audioMenu() {
        val tracks = exo.currentTracks.groups.filter { it.type == C.TRACK_TYPE_AUDIO }
            .flatMap { group -> (0 until group.length).filter { group.isTrackSupported(it) }.map { group to it } }
        if (tracks.isEmpty()) {
            choose(tr("Audio track", "Tonspur"), arrayOf(tr("No audio track", "Keine Tonspur")), 0) {}; return
        }
        val labels = tracks.mapIndexed { n, (group, index) ->
            val format = group.getTrackFormat(index)
            OfflinePolicy.trackName(format.label, format.language, format.channelCount, tr("Track ${n + 1}", "Spur ${n + 1}"))
        }.toTypedArray()
        choose(tr("Audio track", "Tonspur"), labels, tracks.indexOfFirst { (group, index) -> group.isTrackSelected(index) }) { index ->
            val (group, track) = tracks[index]
            exo.trackSelectionParameters = exo.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_AUDIO)
                .setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, track)).build()
        }
    }
    private fun subtitleMenu() {
        val tracks = exo.currentTracks.groups.filter { it.type == C.TRACK_TYPE_TEXT }
            .flatMap { group -> (0 until group.length).filter { group.isTrackSupported(it) }.map { group to it } }
        if (tracks.isEmpty()) {
            choose(tr("Subtitles", "Untertitel"), arrayOf(tr("No subtitles saved", "Keine Untertitel gespeichert")), 0) {}; return
        }
        val labels = arrayOf(tr("Off", "Aus")) + tracks.map { (group, index) ->
            val format = group.getTrackFormat(index)
            OfflinePolicy.trackName(format.label, format.language, 0, tr("Subtitles", "Untertitel"))
        }
        val selected = if (exo.trackSelectionParameters.disabledTrackTypes.contains(C.TRACK_TYPE_TEXT)) 0
            else tracks.indexOfFirst { (group, index) -> group.isTrackSelected(index) } + 1
        choose(tr("Subtitles", "Untertitel"), labels, selected) { index ->
            val builder = exo.trackSelectionParameters.buildUpon().clearOverridesOfType(C.TRACK_TYPE_TEXT)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, index == 0)
            if (index > 0) {
                val (group, track) = tracks[index - 1]
                builder.setOverrideForType(TrackSelectionOverride(group.mediaTrackGroup, track))
            }
            exo.trackSelectionParameters = builder.build()
        }
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); exo.addListener(listener); handler.post(update); scheduleHide() }
    override fun onDetachedFromWindow() {
        handler.removeCallbacksAndMessages(null); dialog?.dismiss(); exo.removeListener(listener)
        (getChildAt(0) as PlayerView).player = null
        super.onDetachedFromWindow()
    }
    companion object {
        fun clock(ms: Long): String {
            val seconds = ms.coerceAtLeast(0) / 1000
            return if (seconds >= 3600) String.format(Locale.ROOT, "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60)
            else String.format(Locale.ROOT, "%02d:%02d", seconds / 60, seconds % 60)
        }
    }
}
