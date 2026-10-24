package com.seanime.app.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

class WidgetCache(context: Context) {
    private val prefs = context.getSharedPreferences("widget_cache", Context.MODE_PRIVATE)

    companion object {
        private const val KEY_CACHE_DATA = "anime_cache_data"
        private const val KEY_CACHE_TIMESTAMP = "cache_timestamp"
        private const val KEY_IS_LOADING = "is_loading"
        private const val KEY_ERROR = "error_message"
        private const val CACHE_DURATION = 30 * 60 * 1000L
    }

    fun saveCacheData(animeEntries: List<AnimeListFactory.AnimeEntry>) {
        val array = JSONArray()
        animeEntries.forEach {
            array.put(JSONObject().put("title", it.title).put("episode", it.episode).put("timeUntil", it.timeUntil)
                .put("mediaId", it.mediaId).put("coverUrl", it.coverUrl))
        }
        prefs.edit().putString(KEY_CACHE_DATA, array.toString()).putLong(KEY_CACHE_TIMESTAMP, System.currentTimeMillis())
            .putBoolean(KEY_IS_LOADING, false).remove(KEY_ERROR).apply()
    }

    /** Thumbnails are not cached; the list loads them on demand. */
    fun getCacheData(): List<AnimeListFactory.AnimeEntry> = try {
        if (!hasValidCache()) emptyList() else {
            val array = JSONArray(prefs.getString(KEY_CACHE_DATA, null))
            (0 until array.length()).map { i ->
                val entry = array.getJSONObject(i)
                AnimeListFactory.AnimeEntry(entry.getString("title"), entry.getInt("episode"), entry.getLong("timeUntil"),
                    entry.getInt("mediaId"), entry.optString("coverUrl", ""), null)
            }
        }
    } catch (e: Exception) {
        e.printStackTrace()
        emptyList()
    }

    fun setLoading(isLoading: Boolean) = prefs.edit().putBoolean(KEY_IS_LOADING, isLoading).apply()

    fun isLoading(): Boolean = prefs.getBoolean(KEY_IS_LOADING, false)

    fun clearCache() = prefs.edit().remove(KEY_CACHE_DATA).remove(KEY_CACHE_TIMESTAMP).remove(KEY_IS_LOADING).remove(KEY_ERROR).apply()

    fun setError(message: String) = prefs.edit().putString(KEY_ERROR, message).putBoolean(KEY_IS_LOADING, false).apply()

    fun getError(): String? = prefs.getString(KEY_ERROR, null)

    fun hasValidCache(): Boolean =
        prefs.contains(KEY_CACHE_DATA) && System.currentTimeMillis() - prefs.getLong(KEY_CACHE_TIMESTAMP, 0) < CACHE_DURATION
}
