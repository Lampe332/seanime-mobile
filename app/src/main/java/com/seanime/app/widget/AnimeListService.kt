package com.seanime.app.widget

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.graphics.RectF
import android.net.Uri
import android.util.Log
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.seanime.app.AppLanguage
import com.seanime.app.AppLanguage.tr
import com.seanime.app.R
import com.seanime.app.notify.AiringNotifier
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.Collections

class AnimeListService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = AnimeListFactory(applicationContext)
}

class AnimeListFactory(private val context: Context) : RemoteViewsService.RemoteViewsFactory {
    private val animeItems = Collections.synchronizedList(mutableListOf<AnimeEntry>())
    private val cache = WidgetCache(context)

    data class AnimeEntry(
        val title: String,
        val episode: Int,
        val timeUntil: Long,
        val mediaId: Int,
        val coverUrl: String,
        var thumbnail: Bitmap?
    )

    override fun onCreate() = loadFromCache()

    override fun onDestroy() = animeItems.clear()

    override fun getCount(): Int = animeItems.size

    override fun getViewAt(position: Int): RemoteViews? {
        val item = synchronized(animeItems) { animeItems.getOrNull(position) } ?: return null
        val views = RemoteViews(context.packageName, R.layout.widget_item_anime)
        views.setTextViewText(R.id.anime_title, item.title)
        val s = item.timeUntil
        val timeStr = if (s / 86400 > 0) "${s / 86400}d ${(s % 86400) / 3600}h" else "${(s % 86400) / 3600}h ${(s % 3600) / 60}m"
        views.setTextViewText(R.id.anime_timer, tr("Ep ${item.episode}: $timeStr", "Folge ${item.episode}: $timeStr"))
        if (item.thumbnail == null) item.thumbnail = downloadAndScale(item.coverUrl)
        item.thumbnail?.let { views.setImageViewBitmap(R.id.anime_cover, it) }
        views.setOnClickFillInIntent(R.id.widget_item_container, Intent().setData(Uri.parse("seanime://entry?id=${item.mediaId}")))
        return views
    }

    override fun getLoadingView(): RemoteViews? = null

    override fun getViewTypeCount(): Int = 1

    override fun getItemId(position: Int): Long = synchronized(animeItems) {
        animeItems.getOrNull(position)?.mediaId?.toLong() ?: -1L
    }

    override fun hasStableIds(): Boolean = true

    override fun onDataSetChanged() {
        AppLanguage.init(context)
        // Redraws use the stored list; a fetch runs when asked (refresh) or when the list is outdated, not right after a failed one.
        if (!cache.isLoading() && (cache.hasValidCache() || cache.recentError())) {
            loadFromCache()
            return
        }
        cache.setLoading(true)
        try {
            val fresh = fetchFreshData()
            synchronized(animeItems) {
                animeItems.clear()
                animeItems.addAll(fresh)
            }
            cache.saveCacheData(fresh)
            Log.d("SeanimeWidget", "Widget fetch completed: ${fresh.size} items")
            // The Activity, player and widget share this server. Only its owner may stop it.
        } catch (e: Exception) {
            Log.e("SeanimeWidget", "Sync Error: ${e.message}")
            cache.setError(if (e is NoUserException) tr("Open Seanime and log in to AniList, then refresh.", "Seanime öffnen und bei AniList anmelden, dann aktualisieren.")
                else tr("No connection. The list updates once you are online.", "Keine Verbindung. Die Liste wird mit Internet aktualisiert."))
            loadFromCache()
        } finally {
            cache.setLoading(false)
            // shows the new list or the error; the redraw this causes finds a fresh list or a recent error and does not fetch
            context.sendBroadcast(Intent(context, UpcomingAnimeWidget::class.java).setAction(UpcomingAnimeWidget.ACTION_DATA_UPDATED))
        }
    }

    private class NoUserException : Exception("no AniList user")

    private fun loadFromCache() {
        val cached = cache.getCacheData()
        synchronized(animeItems) {
            animeItems.clear()
            animeItems.addAll(cached)
        }
    }

    private fun fetchFreshData(): List<AnimeEntry> {
        // The server knows who is logged in; while it is off (widget in the background), the name it reported last.
        val known = AiringNotifier.knownUser(context)
        val username = serverUser(if (known == null) 40 else 1) ?: known ?: throw NoUserException()
        AiringNotifier.rememberUser(context, username)
        val userId = AiringNotifier.userId(context, username)

        val listQuery = """
            query (${'$'}userId: Int) {
                MediaListCollection(userId: ${'$'}userId, type: ANIME) {
                    lists { entries { media { id title { userPreferred } coverImage { medium } nextAiringEpisode { timeUntilAiring episode } } } }
                }
            }
        """.trimIndent()
        val lists = JSONObject(anilist(listQuery, JSONObject().put("userId", userId)))
            .getJSONObject("data").getJSONObject("MediaListCollection").getJSONArray("lists")

        val items = mutableListOf<AnimeEntry>()
        for (i in 0 until lists.length()) {
            val entries = lists.getJSONObject(i).getJSONArray("entries")
            for (j in 0 until entries.length()) {
                val media = entries.getJSONObject(j).getJSONObject("media")
                if (media.isNull("nextAiringEpisode")) continue
                val next = media.getJSONObject("nextAiringEpisode")
                val coverUrl = media.getJSONObject("coverImage").getString("medium")
                items.add(AnimeEntry(media.getJSONObject("title").getString("userPreferred"), next.getInt("episode"),
                    next.getLong("timeUntilAiring"), media.getInt("id"), coverUrl, downloadAndScale(coverUrl)))
            }
        }
        return items.sortedBy { it.timeUntil }
    }

    private fun anilist(query: String, variables: JSONObject) =
        makeRequest("https://graphql.anilist.co", JSONObject().put("query", query).put("variables", variables).toString())

    /** AniList name of the local server's user; a booting server gets several [attempts] (about 10 s for 40). */
    private fun serverUser(attempts: Int): String? {
        repeat(attempts) {
            try {
                return JSONObject(makeRequest("http://localhost:43211/api/v1/status", null))
                    .getJSONObject("data").getJSONObject("user").getJSONObject("viewer").getString("name")
            } catch (_: Exception) {
                try { Thread.sleep(250L) } catch (_: InterruptedException) { }
            }
        }
        return null
    }

    /** GET without [body], JSON POST with it. */
    private fun makeRequest(url: String, body: String?): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 10000
        conn.readTimeout = 10000
        try {
            if (body != null) {
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally { conn.disconnect() }
    }

    private fun downloadAndScale(url: String): Bitmap? = try {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 10000
        connection.readTimeout = 10000
        val raw = try { connection.inputStream.use { BitmapFactory.decodeStream(it) } } finally { connection.disconnect() }
        raw?.let { roundedCorners(Bitmap.createScaledBitmap(it, 150, 220, true), 24f) }
    } catch (_: Exception) {
        null
    }

    private fun roundedCorners(bitmap: Bitmap, radius: Float): Bitmap {
        val output = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        val paint = Paint().apply { isAntiAlias = true; color = 0xff424242.toInt() }
        val rect = Rect(0, 0, bitmap.width, bitmap.height)
        canvas.drawRoundRect(RectF(rect), radius, radius, paint)
        paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        canvas.drawBitmap(bitmap, rect, rect, paint)
        return output
    }
}
