package com.seanime.app.audit

import android.app.Instrumentation
import android.content.Intent
import android.os.Build
import android.os.Bundle
import com.seanime.app.SeanimeService
import com.seanime.app.widget.AnimeListFactory
import com.seanime.app.widget.WidgetCache
import java.net.HttpURLConnection
import java.net.URL

/** Device regression checks. Reads AniList; restores the widget's original cache. */
class MobileInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    private fun serverResponds(): Boolean {
        val connection = URL("http://127.0.0.1:43211/api/v1/status").openConnection() as HttpURLConnection
        connection.connectTimeout = 2000
        connection.readTimeout = 2000
        return try { connection.inputStream.use { it.read() }; connection.responseCode == 200 }
            catch (_: Exception) { false } finally { connection.disconnect() }
    }

    override fun onStart() {
        val result = Bundle()
        val prefs = targetContext.getSharedPreferences("widget_cache", android.content.Context.MODE_PRIVATE)
        val previous = prefs.all.toMap()
        try {
            val service = Intent(targetContext, SeanimeService::class.java)
            if (Build.VERSION.SDK_INT >= 26) targetContext.startForegroundService(service)
            else targetContext.startService(service)
            var ready = false
            repeat(15) { if (!ready) { ready = serverResponds(); if (!ready) Thread.sleep(1000) } }
            check(ready) { "Local server unavailable before widget check" }

            val cache = WidgetCache(targetContext)
            cache.clearCache()
            val factory = AnimeListFactory(targetContext)
            factory.onCreate()
            factory.onDataSetChanged()
            check(cache.getError() == null) { "Widget fetch failed: ${cache.getError()}" }
            check(serverResponds()) { "Widget refresh stopped the shared server" }
            val entries = factory.count

            val field = AnimeListFactory::class.java.getDeclaredField("animeItems").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val items = field.get(factory) as MutableList<AnimeListFactory.AnimeEntry>
            synchronized(items) {
                items.clear()
                items.add(AnimeListFactory.AnimeEntry("first",1,120,101,"",null))
                items.add(AnimeListFactory.AnimeEntry("second",1,120,202,"",null))
            }
            check(factory.getItemId(0) == 101L)
            synchronized(items) { items.reverse() }
            check(factory.getItemId(0) == 202L)
            check(factory.getViewAt(-1) == null && factory.getViewAt(200) == null)
            factory.onDestroy()
            result.putString("stream", "PASS: live widget GraphQL fetch ($entries entries); shared server survives; stable media IDs; invalid row bounds.\n")
            result.putBoolean("passed", true)
        } catch (failure: Throwable) {
            result.putString("stream", "FAIL: ${failure.javaClass.simpleName}: ${failure.message}\n")
            result.putBoolean("passed", false)
        } finally {
            val editor = prefs.edit().clear()
            previous.forEach { (key,value) ->
                when (value) {
                    is String -> editor.putString(key,value)
                    is Boolean -> editor.putBoolean(key,value)
                    is Int -> editor.putInt(key,value)
                    is Long -> editor.putLong(key,value)
                    is Float -> editor.putFloat(key,value)
                    is Set<*> -> { @Suppress("UNCHECKED_CAST") editor.putStringSet(key,value as Set<String>) }
                }
            }
            editor.commit()
        }
        finish(if (result.getBoolean("passed")) -1 else 0, result)
    }
}
