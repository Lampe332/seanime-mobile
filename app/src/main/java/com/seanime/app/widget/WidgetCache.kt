package com.seanime.app.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * The widget's last list. Entries keep their airing time, so the countdowns stay right on every redraw without a fetch.
 * The list is fresh for a few hours or until its first episode airs (then the next one is unknown); after that it is
 * still shown, with its time, until a fetch succeeds.
 */
class WidgetCache(context: Context) {
    private val prefs = context.getSharedPreferences("widget_cache", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_CACHE_DATA = "anime_cache_data"
        private const val KEY_CACHE_TIMESTAMP = "cache_timestamp"
        private const val KEY_IS_LOADING = "is_loading"
        private const val KEY_ERROR = "error_message"
        private const val KEY_ERROR_TIMESTAMP = "error_timestamp"
        private const val KEY_NEXT_AIRING = "next_airing"
        private const val CACHE_DURATION = 3 * 60 * 60 * 1000L
        // a failed fetch is not repeated by every redraw, only by the refresh button or after this
        private const val ERROR_PAUSE = 15 * 60 * 1000L
    }

    fun saveCacheData(animeEntries: List<AnimeListFactory.AnimeEntry>) {
        val now = System.currentTimeMillis()
        val array = JSONArray()
        animeEntries.forEach {
            array.put(JSONObject().put("title", it.title).put("episode", it.episode).put("airingAt", now / 1000 + it.timeUntil)
                .put("mediaId", it.mediaId).put("coverUrl", it.coverUrl))
        }
        val nextAiring = animeEntries.minOfOrNull { now / 1000 + it.timeUntil } ?: Long.MAX_VALUE
        prefs.edit().putString(KEY_CACHE_DATA, array.toString()).putLong(KEY_CACHE_TIMESTAMP, now).putLong(KEY_NEXT_AIRING, nextAiring)
            .putBoolean(KEY_IS_LOADING, false).remove(KEY_ERROR).remove(KEY_ERROR_TIMESTAMP).apply()
    }

    /** The last list, also an outdated one, without the episodes that aired since. Thumbnails load on demand. */
    fun getCacheData(): List<AnimeListFactory.AnimeEntry> = try {
        val now = System.currentTimeMillis() / 1000
        val saved = prefs.getLong(KEY_CACHE_TIMESTAMP, 0) / 1000
        val array = JSONArray(prefs.getString(KEY_CACHE_DATA, null) ?: "[]")
        (0 until array.length()).mapNotNull { i ->
            val entry = array.getJSONObject(i)
            // lists from before the airing time was stored
            val airingAt = entry.optLong("airingAt", saved + entry.optLong("timeUntil"))
            if (airingAt <= now) null
            else AnimeListFactory.AnimeEntry(entry.getString("title"), entry.getInt("episode"), airingAt - now,
                entry.getInt("mediaId"), entry.optString("coverUrl", ""), null)
        }
    } catch (e: Exception) {
        e.printStackTrace()
        emptyList()
    }

    fun setLoading(isLoading: Boolean) = prefs.edit().putBoolean(KEY_IS_LOADING, isLoading).apply()

    fun isLoading(): Boolean = prefs.getBoolean(KEY_IS_LOADING, false)

    /** The refresh button forgets the last error; its loading flag makes the list fetch while the last one stays visible. */
    fun clearError() = prefs.edit().remove(KEY_ERROR).remove(KEY_ERROR_TIMESTAMP).apply()

    fun setError(message: String) = prefs.edit().putString(KEY_ERROR, message).putLong(KEY_ERROR_TIMESTAMP, System.currentTimeMillis())
        .putBoolean(KEY_IS_LOADING, false).apply()

    fun getError(): String? = prefs.getString(KEY_ERROR, null)

    fun recentError(): Boolean = getError() != null && System.currentTimeMillis() - prefs.getLong(KEY_ERROR_TIMESTAMP, 0) < ERROR_PAUSE

    /** When the shown list was fetched (ms), 0 for none. */
    fun savedAt(): Long = prefs.getLong(KEY_CACHE_TIMESTAMP, 0)

    fun hasValidCache(): Boolean {
        val now = System.currentTimeMillis()
        return prefs.contains(KEY_CACHE_DATA) && now - prefs.getLong(KEY_CACHE_TIMESTAMP, 0) < CACHE_DURATION &&
            now / 1000 < prefs.getLong(KEY_NEXT_AIRING, Long.MAX_VALUE)
    }
}
