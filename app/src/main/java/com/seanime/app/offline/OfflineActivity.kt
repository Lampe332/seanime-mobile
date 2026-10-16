package com.seanime.app.offline

import android.app.Activity
import android.app.AlertDialog
import android.content.res.ColorStateList
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import android.widget.FrameLayout
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.PlayerView
import java.util.Locale
import kotlin.math.roundToInt

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class OfflineActivity : Activity() {
    private val store by lazy { EpisodeDownloads.get(this) }
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var rows: LinearLayout
    private lateinit var summary: TextView
    private var player: ExoPlayer? = null
    private var playingId: String? = null
    private var lastRows = ""
    private var filter = "Alle"
    private var chips: LinearLayout? = null
    private var playerRoot: LinearLayout? = null
    private var playerHost: FrameLayout? = null
    private var playerDetails: ScrollView? = null
    private var fullscreen = false
    private var playerInsets: android.view.WindowInsets? = null
    private var playerError: TextView? = null
    private val tick = object : Runnable {
        override fun run() {
            if (isFinishing || isDestroyed) return
            if (player != null) savePosition()
            else if (::rows.isInitialized && ::summary.isInitialized) refresh()
            handler.postDelayed(this, 1000)
        }
    }

    private companion object {
        const val BACKGROUND = 0xFF070707.toInt()
        const val SURFACE = 0xFF121212.toInt()
        const val SURFACE_HIGH = 0xFF1B1B1B.toInt()
        const val BORDER = 0xFF242424.toInt()
        const val PRIMARY = 0xFF9B82FF.toInt()
        const val PRIMARY_DARK = 0xFF7050DE.toInt()
        const val MUTED = 0xFFAAA8B8.toInt()
        const val GREEN = 0xFF55D6A4.toInt()
        const val RED = 0xFFFF777F.toInt()
        const val AMBER = 0xFFFFC66E.toInt()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = BACKGROUND
        window.navigationBarColor = BACKGROUND
        if (Build.VERSION.SDK_INT >= 29) {
            window.isNavigationBarContrastEnforced = false
            window.isStatusBarContrastEnforced = false
        }
        if (Build.VERSION.SDK_INT >= 33) onBackInvokedDispatcher.registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT) { back() }
        val restored = (savedInstanceState?.getString("playingId") ?: intent.getStringExtra("downloadId"))?.let { id -> store.all().find { it.request.id == id && store.ready(id) } }
        if (restored != null) play(restored) else showList()
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()
    private fun rounded(color: Int, radius: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun clickableBackground(color: Int, radius: Int, outline: Int? = null): RippleDrawable {
        val mask = rounded(Color.WHITE, radius)
        return RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), rounded(color, radius, outline), mask)
    }
    private fun column() = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(BACKGROUND)
    }
    private fun text(value: String, size: Float = 14f, color: Int = Color.WHITE, bold: Boolean = false) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        includeFontPadding = false
    }
    private fun label(value: String, size: Float = 14f, color: Int = Color.WHITE, bold: Boolean = false) =
        text(value, size, color, bold).apply { setPadding(dp(2), dp(3), dp(2), dp(3)) }

    private fun rootColumn() = column().apply {
        setPadding(dp(16), dp(12), dp(16), dp(12))
        setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars =
                insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                view.setPadding(dp(16) + bars.left, dp(12) + bars.top, dp(16) + bars.right, dp(12) + bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(dp(16) + insets.systemWindowInsetLeft, dp(12) + insets.systemWindowInsetTop,
                    dp(16) + insets.systemWindowInsetRight, dp(12) + insets.systemWindowInsetBottom)
            }
            insets
        }
    }

    private fun actionButton(label: String, primary: Boolean = false, action: () -> Unit) = TextView(this).apply {
        text = label
        textSize = 14f
        setTextColor(if (primary) Color.WHITE else 0xFFE6E1F4.toInt())
        gravity = Gravity.CENTER
        minHeight = dp(48)
        setPadding(dp(14), dp(8), dp(14), dp(8))
        isClickable = true
        isFocusable = true
        background = clickableBackground(if (primary) PRIMARY_DARK else SURFACE_HIGH, 14, if (primary) null else BORDER)
        contentDescription = label
        setOnClickListener { action() }
    }

    private fun header(onBack: () -> Unit, title: String, subtitle: String, badge: String? = null): LinearLayout {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val back = TextView(this).apply {
            text = "‹"
            textSize = 36f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            isClickable = true
            isFocusable = true
            contentDescription = "Zurück zu Seanime"
            background = clickableBackground(SURFACE_HIGH, 16, BORDER)
            setOnClickListener { onBack() }
        }
        row.addView(back, LinearLayout.LayoutParams(dp(46), dp(46)))
        val titleBox = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), 0, dp(8), 0)
        }
        titleBox.addView(label(title, 22f, Color.WHITE, true))
        titleBox.addView(label(subtitle, 12.5f, MUTED))
        row.addView(titleBox, LinearLayout.LayoutParams(0, -2, 1f))
        if (badge != null) {
            val chip = text(badge, 11f, 0xFFDCD2FF.toInt(), true).apply {
                gravity = Gravity.CENTER
                setPadding(dp(10), dp(8), dp(10), dp(8))
                background = rounded(0xFF29233A.toInt(), 20, 0xFF4C416B.toInt())
            }
            row.addView(chip, LinearLayout.LayoutParams(-2, -2))
        }
        return row
    }

    private fun panel(padding: Int = 16) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
        background = rounded(SURFACE, 18, BORDER)
    }

    private fun showList() {
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        lastRows = ""
        val root = rootColumn()
        root.addView(header({ finish() }, "Downloads", "Deine Anime. Immer dabei."))
        root.addView(View(this), LinearLayout.LayoutParams(1, dp(18)))
        summary = label("", 13f, MUTED)
        val summaryPanel = panel(12).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val indicator = text("↓", 22f, PRIMARY, true).apply {
            gravity = Gravity.CENTER
            background = rounded(0xFF302744.toInt(), 12)
        }
        summaryPanel.addView(indicator, LinearLayout.LayoutParams(dp(34), dp(34)))
        summaryPanel.addView(summary, LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(10) })
        root.addView(summaryPanel, LinearLayout.LayoutParams(-1, -2))
        chips = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(16), 0, dp(16))
        }
        root.addView(chips)
        updateChips()

        val scroll = ScrollView(this).apply { clipToPadding = false; isFillViewport = true }
        rows = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, 0, 0, dp(8))
        }
        scroll.addView(rows)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root)
        refresh()
    }

    private fun updateChips() {
        chips?.removeAllViews()
        listOf("Alle", "Bereit", "Aktiv").forEach { name ->
            chips?.addView(actionButton(name) {
                filter = name; lastRows = ""; updateChips(); refresh()
            }.apply {
                textSize = 12f
                setTextColor(if (filter == name) Color.WHITE else MUTED)
                background = clickableBackground(if (filter == name) PRIMARY_DARK else SURFACE, 22)
            }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { rightMargin = dp(if (name == "Aktiv") 0 else 8) })
        }
    }

    private fun emptyState(): View {
        val card = panel(20).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            minimumHeight = dp(400)
        }
        val icon = text("↓", 30f, 0xFFDCD2FF.toInt(), true).apply {
            gravity = Gravity.CENTER
            background = rounded(0xFF342A53.toInt(), 32)
        }
        card.addView(icon, LinearLayout.LayoutParams(dp(64), dp(64)).apply { bottomMargin = dp(18) })
        card.addView(label("Deine Offline-Bibliothek ist leer", 18f, Color.WHITE, true).apply {
            gravity = Gravity.CENTER
        })
        card.addView(label("Lade Folgen mit Internet herunter und schau sie später ohne Verbindung.", 14f, MUTED).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(9), 0, dp(18))
        })

        val steps = panel(14).apply { background = rounded(SURFACE_HIGH, 14) }
        listOf("1   Öffne eine Anime-Folge", "2   Tippe auf „Auf Handy herunterladen“", "3   Starte sie hier offline").forEachIndexed { index, item ->
            val step = label(item, 13f, if (index == 2) 0xFFDCD2FF.toInt() else 0xFFE5E3ED.toInt())
            steps.addView(step)
            if (index < 2) steps.addView(View(this), LinearLayout.LayoutParams(1, dp(8)))
        }
        card.addView(steps, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(18) })
        card.addView(actionButton("Zurück zu Seanime", primary = true) { finish() }, LinearLayout.LayoutParams(-1, dp(50)))
        return card
    }

    private fun refresh() {
        val all = store.all()
        val mains = all.filter { !it.request.id.contains(":sub:") }.sortedByDescending { it.startTimeMs }
        val readyCount = mains.count { store.ready(it.request.id) }
        val totalBytes = mains.sumOf { download ->
            all.filter { it.request.id == download.request.id || it.request.id.startsWith("${download.request.id}:sub:") }
                .sumOf { it.bytesDownloaded }
        }
        summary.text = "$readyCount ${if (readyCount == 1) "Folge offline bereit" else "Folgen offline bereit"}\n${formatSize(totalBytes)} gespeichert · ${mains.size - readyCount} ausstehend"
        summary.setLineSpacing(dp(5).toFloat(), 1f)

        // Progress changes are rounded to 5% so cards do not flicker or reset the scroll position.
        val fingerprint = filter + all.joinToString { "${it.request.id}:${it.state}:${it.stopReason}:${it.percentDownloaded.toInt() / 5}:${it.failureReason}" }
        if (fingerprint == lastRows && rows.childCount > 0) return
        lastRows = fingerprint
        rows.removeAllViews()
        if (mains.isEmpty()) {
            rows.addView(emptyState(), LinearLayout.LayoutParams(-1, -2))
            return
        }
        val visible = mains.filter { filter == "Alle" || (filter == "Bereit") == store.ready(it.request.id) }
        if (visible.isEmpty()) {
            rows.addView(panel(24).apply {
                addView(label(if (filter == "Bereit") "Noch keine Folge bereit" else "Alles heruntergeladen", 17f, Color.WHITE, true))
                addView(label(if (filter == "Bereit") "Fertige Downloads erscheinen hier automatisch." else "Deine gespeicherten Folgen findest du unter „Bereit“.", 13f, MUTED).apply { setPadding(0, dp(10), 0, 0) })
            })
        }
        var previousTitle = ""
        val sorted = visible.sortedWith(compareBy<Download> { store.metadata(it).optString("title") }
            .thenBy { store.metadata(it).optString("episode").toDoubleOrNull() ?: 0.0 })
        sorted.forEachIndexed { index, download ->
            val id = download.request.id
            val metadata = store.metadata(download)
            val group = all.filter { it.request.id == id || it.request.id.startsWith("$id:sub:") }
            val ready = store.ready(id)
            val failed = group.any { it.state == Download.STATE_FAILED }
            val paused = group.any { it.stopReason != 0 }
            val mb = group.sumOf { it.bytesDownloaded } / (1024.0 * 1024.0)
            val progressValue = download.percentDownloaded.takeIf { it >= 0 }?.toInt()
            val status = when {
                ready -> "Offline bereit"
                failed -> "Download fehlgeschlagen"
                paused -> "Pausiert"
                download.state == Download.STATE_REMOVING -> "Wird gelöscht"
                store.manager.isWaitingForRequirements -> "Wartet auf Internet"
                download.state == Download.STATE_COMPLETED -> "Untertitel werden gespeichert"
                else -> "Wird heruntergeladen"
            }
            val statusColor = when {
                ready -> GREEN
                failed -> RED
                paused -> AMBER
                else -> PRIMARY
            }
            val title = metadata.optString("title").takeIf { it.isNotBlank() } ?: "Anime-Folge"
            val episode = metadata.optString("episode").takeIf { it.isNotBlank() }
            val subtitle = listOfNotNull(
                episode?.let { "Folge $it" },
                metadata.optString("quality").takeIf { it.isNotBlank() },
                metadata.optString("provider").takeIf { it.isNotBlank() },
            ).joinToString(" · ")

            if (title != previousTitle) {
                rows.addView(label(title, 18f, Color.WHITE, true).apply {
                    setPadding(dp(2), dp(if (index == 0) 2 else 14), 0, dp(12))
                })
                previousTitle = title
            }
            val card = panel(14)
            val info = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
            val episodeTile = text(episode ?: "↓", 24f, 0xFFDCD2FF.toInt(), true).apply {
                gravity = Gravity.CENTER
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF3C2C62.toInt(), 0xFF242032.toInt())).apply { cornerRadius = dp(12).toFloat() }
            }
            info.addView(episodeTile, LinearLayout.LayoutParams(dp(58), dp(66)))
            val infoText = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0) }
            infoText.addView(label(episode?.let { "Folge $it" } ?: title, 16f, Color.WHITE, true))
            infoText.addView(label(listOf(metadata.optString("quality"), metadata.optString("provider")).filter { it.isNotBlank() }.joinToString(" · "), 11f, MUTED).apply {
                maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(dp(2), dp(6), 0, 0)
            })
            info.addView(infoText, LinearLayout.LayoutParams(0, -2, 1f))
            card.addView(info)
            card.addView(View(this), LinearLayout.LayoutParams(1, dp(12)))

            val statusRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val pill = text(status, 11.5f, statusColor, true).apply {
                setPadding(dp(9), dp(7), dp(9), dp(7))
                background = rounded(when {
                    ready -> 0xFF17352D.toInt()
                    failed -> 0xFF40252C.toInt()
                    paused -> 0xFF3D3322.toInt()
                    else -> 0xFF29233A.toInt()
                }, 20)
                maxLines = 1
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            statusRow.addView(pill, LinearLayout.LayoutParams(-2, -2))
            val amount = if (!ready && progressValue != null) "$progressValue% · ${formatSize((mb * 1024 * 1024).toLong())}" else formatSize((mb * 1024 * 1024).toLong())
            statusRow.addView(label(amount, 11f, MUTED).apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL; setPadding(dp(6), 0, 0, 0) }, LinearLayout.LayoutParams(0, -2, 1f))
            card.addView(statusRow)

            val progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                progressTintList = ColorStateList.valueOf(if (ready) GREEN else PRIMARY)
                progressBackgroundTintList = ColorStateList.valueOf(0xFF353443.toInt())
                indeterminateTintList = ColorStateList.valueOf(PRIMARY)
                isIndeterminate = progressValue == null && !ready
                if (progressValue != null) progress = progressValue.coerceIn(0, 100)
            }
            if (!ready) card.addView(progress, LinearLayout.LayoutParams(-1, dp(4)).apply { topMargin = dp(10) })
            val position = getSharedPreferences("offline-playback", MODE_PRIVATE).getLong(id, 0)
            if (ready && position > 0) card.addView(label("Weiter bei ${OfflinePlayerView.clock(position)}", 11f, PRIMARY).apply { setPadding(dp(2), dp(8), 0, 0) })
            card.addView(View(this), LinearLayout.LayoutParams(1, dp(12)))

            val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val actionText = when {
                ready -> if (position > 0) "▶  Weiterschauen" else "▶  Ansehen"
                paused || failed -> "Fortsetzen"
                else -> "Pausieren"
            }
            val primaryAction = actionButton(actionText, primary = ready) {
                if (ready) play(download) else store.pause(id, !(paused || failed)).also { lastRows = "" }
            }
            actions.addView(primaryAction, LinearLayout.LayoutParams(0, dp(48), 1f))
            actions.addView(View(this), LinearLayout.LayoutParams(dp(8), 1))
            val deleteAction = actionButton("Löschen") {
                AlertDialog.Builder(this)
                    .setTitle("Folge vom Handy löschen?")
                    .setMessage("$title${episode?.let { " · Folge $it" } ?: ""}")
                    .setPositiveButton("Löschen") { _, _ -> store.remove(id); lastRows = "" }
                    .setNegativeButton("Abbrechen", null)
                    .show()
            }
            actions.addView(deleteAction, LinearLayout.LayoutParams(dp(92), dp(48)))
            card.addView(actions)
            rows.addView(card, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(10) })
        }
    }

    private fun formatMb(bytes: Long): String = String.format(Locale.GERMANY, "%.1f", bytes / (1024.0 * 1024.0))
    private fun formatSize(bytes: Long): String = if (bytes >= 1024L * 1024 * 1024) String.format(Locale.GERMANY, "%.2f GB", bytes / (1024.0 * 1024 * 1024)) else "${formatMb(bytes)} MB"

    private fun play(download: Download) {
        stopPlayer()
        playingId = download.request.id
        val metadata = store.metadata(download)
        val title = metadata.optString("title", "Anime")
        val episode = metadata.optString("episode", "")
        val root = column()
        playerRoot = root
        root.setOnApplyWindowInsetsListener { _, insets -> playerInsets = insets; applyPlayerLayout(); insets }
        val host = FrameLayout(this)
        playerHost = host
        root.addView(host, LinearLayout.LayoutParams(-1, dp(220)))
        val details = ScrollView(this)
        playerDetails = details
        val info = column().apply { setPadding(dp(20), dp(24), dp(20), dp(24)) }
        details.addView(info)
        root.addView(details, LinearLayout.LayoutParams(-1, 0, 1f))
        val heading = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        OfflineLibrary.get(this).artworkFile(metadata.optString("coverAsset"))?.let { file ->
            val image = android.widget.ImageView(this).apply {
                scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
                setImageBitmap(android.graphics.BitmapFactory.decodeFile(file.absolutePath))
                contentDescription = title
                background = rounded(SURFACE_HIGH, 8); clipToOutline = true
            }
            heading.addView(image, LinearLayout.LayoutParams(dp(66), dp(96)).apply { rightMargin = dp(14) })
        }
        val titles = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        titles.addView(label(title, 21f, Color.WHITE, true))
        titles.addView(label("Folge $episode", 13f, MUTED).apply { setPadding(0, dp(8), 0, 0) })
        metadata.optString("episodeTitle").takeIf { it.isNotBlank() }?.let {
            titles.addView(label(it, 14f, Color.WHITE, true).apply { setPadding(0, dp(8), 0, 0) })
        }
        heading.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        info.addView(heading)
        info.addView(label("✓  Offline verfügbar", 12f, GREEN).apply { setPadding(0, dp(16), 0, dp(12)) })
        val facts = listOfNotNull(metadata.optInt("year").takeIf { it > 0 }?.toString(),
            metadata.optInt("duration").takeIf { it > 0 }?.let { "$it Min." }, metadata.optString("format").takeIf { it.isNotBlank() })
        if (facts.isNotEmpty()) info.addView(label(facts.joinToString(" · "), 12f, MUTED))
        metadata.optString("episodeDescription").takeIf { it.isNotBlank() }?.let { value ->
            val plain = if (Build.VERSION.SDK_INT >= 24) android.text.Html.fromHtml(value, android.text.Html.FROM_HTML_MODE_LEGACY)
                else { @Suppress("DEPRECATION") android.text.Html.fromHtml(value) }
            info.addView(label(plain.toString(), 13f, MUTED).apply { setPadding(0, dp(16), 0, 0); setLineSpacing(dp(4).toFloat(), 1f) })
        }
        val status = label("", 13f, RED).apply { setPadding(0, dp(14), 0, dp(8)); visibility = View.GONE }
        playerError = status
        info.addView(status)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        player = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(store.offlineDataSource())).build().also { exo ->
            exo.setAudioAttributes(androidx.media3.common.AudioAttributes.DEFAULT, true)
            exo.addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    status.text = "Datei unvollständig oder nicht abspielbar. Bitte die Folge erneut herunterladen."
                    status.visibility = View.VISIBLE
                    if (fullscreen) setFullscreen(false)
                }
            })
            exo.setMediaItem(store.mediaItem(download))
            exo.seekTo(getSharedPreferences("offline-playback", MODE_PRIVATE).getLong(download.request.id, 0))
            exo.prepare(); exo.playWhenReady = true
            host.addView(OfflinePlayerView(this, exo, if (episode.isBlank()) title else "$title · Folge $episode",
                { setFullscreen(!fullscreen) }, { back() }), FrameLayout.LayoutParams(-1, -1))
        }
        val next = store.all().filter { !it.request.id.contains(":sub:") && store.ready(it.request.id) &&
            store.metadata(it).optString("title") == title &&
            (store.metadata(it).optString("episode").toDoubleOrNull() ?: -1.0) > (episode.toDoubleOrNull() ?: Double.MAX_VALUE) }
            .minByOrNull { store.metadata(it).optString("episode").toDoubleOrNull() ?: Double.MAX_VALUE }
        if (next != null) {
            info.addView(View(this), LinearLayout.LayoutParams(1, dp(24)))
            info.addView(label("ALS NÄCHSTES", 10f, MUTED, true))
            info.addView(actionButton("Folge ${store.metadata(next).optString("episode")} abspielen", true) { play(next) },
                LinearLayout.LayoutParams(-1, dp(52)).apply { topMargin = dp(10) })
        }
        info.addView(actionButton("Alle Downloads") { stopPlayer(); if (intent.hasExtra("downloadId")) finish() else showList() }, LinearLayout.LayoutParams(-1, dp(48)).apply { topMargin = dp(24) })
        setContentView(root)
        applyPlayerLayout()
    }

    private fun setFullscreen(enabled: Boolean) {
        fullscreen = enabled
        requestedOrientation = if (enabled) ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE else ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        applyPlayerLayout()
    }
    @Suppress("DEPRECATION")
    private fun applyPlayerLayout() {
        val root = playerRoot ?: return
        val wide = fullscreen || resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE
        if (Build.VERSION.SDK_INT >= 30) {
            window.decorView.windowInsetsController?.let {
                it.systemBarsBehavior = android.view.WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                if (wide) it.hide(android.view.WindowInsets.Type.systemBars()) else it.show(android.view.WindowInsets.Type.systemBars())
            }
        } else window.decorView.systemUiVisibility = if (wide) 5894 else 0
        val insets = playerInsets ?: if (Build.VERSION.SDK_INT >= 23) root.rootWindowInsets else null
        val left: Int; val top: Int; val right: Int; val bottom: Int
        if (Build.VERSION.SDK_INT >= 30 && insets != null) {
            val bars = insets.getInsets(if (wide) android.view.WindowInsets.Type.displayCutout() else
                android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
            left = bars.left; top = bars.top; right = bars.right; bottom = bars.bottom
        } else {
            left = 0; right = 0; top = if (wide) 0 else insets?.systemWindowInsetTop ?: 0
            bottom = if (wide) 0 else insets?.systemWindowInsetBottom ?: 0
        }
        root.setPadding(left, top, right, bottom)
        playerDetails?.visibility = if (wide) View.GONE else View.VISIBLE
        playerHost?.layoutParams = if (wide) LinearLayout.LayoutParams(-1, 0, 1f)
            else LinearLayout.LayoutParams(-1, ((resources.displayMetrics.widthPixels - left - right) * 9f / 16).roundToInt())
    }
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (player != null) applyPlayerLayout()
    }
    override fun onSaveInstanceState(outState: Bundle) {
        savePosition(); playingId?.let { outState.putString("playingId", it) }
        super.onSaveInstanceState(outState)
    }

    private fun savePosition() {
        player?.let { exo -> playingId?.let { id ->
            getSharedPreferences("offline-playback", MODE_PRIVATE).edit()
                .putLong(id, if (exo.playbackState == Player.STATE_ENDED) 0 else exo.currentPosition).apply()
        } }
    }
    private fun stopPlayer() {
        savePosition(); player?.release(); player = null; playingId = null
        playerRoot = null; playerHost = null; playerDetails = null; playerError = null
        fullscreen = false
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
        if (Build.VERSION.SDK_INT >= 30) window.decorView.windowInsetsController?.show(android.view.WindowInsets.Type.systemBars())
        else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = 0
        }
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    override fun onStart() { super.onStart(); handler.post(tick) }
    override fun onStop() { handler.removeCallbacks(tick); savePosition(); player?.pause(); super.onStop() }
    override fun onDestroy() { handler.removeCallbacks(tick); stopPlayer(); super.onDestroy() }
    private fun back() { if (player != null) { if (fullscreen) setFullscreen(false) else { stopPlayer(); if (intent.hasExtra("downloadId")) finish() else showList() } } else finish() }
    @android.annotation.SuppressLint("GestureBackNavigation")
    override fun onBackPressed() = back()
}
