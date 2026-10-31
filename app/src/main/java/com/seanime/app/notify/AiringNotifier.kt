package com.seanime.app.notify

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import com.seanime.app.AppLanguage
import com.seanime.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Announces new episodes of the anime on the watching list. One alarm wakes the app shortly after the next episode airs
 * (at the latest every few hours); each check compares AniList's next episodes with the ones from the last check.
 * Reads the public AniList list like the widget; the user name comes from the local server.
 */
object AiringNotifier {
    private const val PREFS = "airing_notifier"
    private const val CHANNEL = "new_episodes"
    private const val ACTION_CHECK = "com.seanime.app.CHECK_AIRING"
    private const val RETRY_SECONDS = 3600L

    fun isEnabled(context: Context) = prefs(context).getBoolean("enabled", true)

    fun setEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean("enabled", enabled).apply()
        if (enabled) checkLater(context, 0) else cancel(context)
    }

    /** Checks off the main thread, e.g. when the app starts and its server is still booting. */
    fun checkLater(context: Context, delayMs: Long) {
        val app = context.applicationContext
        Thread {
            try {
                Thread.sleep(delayMs)
            } catch (_: InterruptedException) {
                return@Thread
            }
            check(app)
        }.start()
    }

    /** Announces the episodes that aired since the last check and plans the next one. Blocks on the network. */
    @Synchronized
    fun check(context: Context) {
        if (!isEnabled(context)) return
        AppLanguage.init(context)
        val prefs = prefs(context)
        val now = System.currentTimeMillis() / 1000
        val fresh = try {
            fetch(context)
        } catch (_: Exception) {
            schedule(context, now + RETRY_SECONDS)
            return
        }

        val announced = decodeAnnounced(prefs.getString("announced", null))
        for (item in AiringPolicy.aired(decodeNext(prefs.getString("next", null)), announced, now)) {
            post(context, item, test = false)
            announced[item.mediaId] = item.episode
        }
        prefs.edit().putString("next", encodeNext(fresh)).putString("announced", JSONObject(announced.mapKeys { it.key.toString() }).toString()).apply()
        schedule(context, AiringPolicy.nextCheck(fresh, now))
    }

    /** Shows how an announcement looks, with the next episode of the list when one is known. */
    fun postTest(context: Context): String {
        if (!canPost(context)) return "permission"
        AppLanguage.init(context)
        val now = System.currentTimeMillis() / 1000
        val sample = decodeNext(prefs(context).getString("next", null)).filter { it.airingAt > now }.minByOrNull { it.airingAt }
            ?: AiringPolicy.Next(0, "Seanime", 1, now)
        post(context, sample, test = true)
        return "ok"
    }

    private fun post(context: Context, item: AiringPolicy.Next, test: Boolean) {
        if (!canPost(context)) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, AppLanguage.tr("New episodes", "Neue Folgen"), NotificationManager.IMPORTANCE_DEFAULT))
        }
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("seanime://entry?id=${item.mediaId}")).setPackage(context.packageName)
        val tap = PendingIntent.getActivity(context, item.mediaId, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
        val text = AppLanguage.tr("Episode ${item.episode} is out", "Folge ${item.episode} ist erschienen")
        manager.notify(item.mediaId, builder
            .setSmallIcon(R.drawable.ic_stat_seanime)
            .setContentTitle(item.title)
            .setContentText(if (test) AppLanguage.tr("Test: $text", "Test: $text") else text)
            .setContentIntent(if (item.mediaId > 0) tap else null)
            .setAutoCancel(true)
            .build())
    }

    private fun canPost(context: Context) =
        Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun schedule(context: Context, atSeconds: Long) {
        val alarms = alarms(context)
        if (Build.VERSION.SDK_INT >= 23) alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atSeconds * 1000, alarm(context))
        else alarms.set(AlarmManager.RTC_WAKEUP, atSeconds * 1000, alarm(context))
    }

    private fun cancel(context: Context) = alarms(context).cancel(alarm(context))

    private fun alarms(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun alarm(context: Context) = PendingIntent.getBroadcast(context, 0,
        Intent(context, AiringReceiver::class.java).setAction(ACTION_CHECK), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun fetch(context: Context): List<AiringPolicy.Next> {
        val prefs = prefs(context)
        // The server knows the user while it runs; alarms may come while it does not, then the last name is used.
        // Without one yet, wait for a booting server like the widget does.
        val known = prefs.getString("user", null)
        var name: String? = null
        for (attempt in 0 until if (known == null) 15 else 1) {
            name = try {
                JSONObject(request("http://localhost:43211/api/v1/status", null, 3000))
                    .getJSONObject("data").getJSONObject("user").getJSONObject("viewer").getString("name")
            } catch (_: Exception) {
                null
            }
            if (name != null) break
            Thread.sleep(2000)
        }
        name?.let { prefs.edit().putString("user", it).apply() }
        name = name ?: known ?: throw IllegalStateException("no AniList user")

        val userId = userId(context, name)

        val lists = JSONObject(anilist("""
            query (${'$'}userId: Int) {
                MediaListCollection(userId: ${'$'}userId, type: ANIME, status_in: [CURRENT, REPEATING]) {
                    lists { entries { media { id title { userPreferred } nextAiringEpisode { airingAt episode } } } }
                }
            }
        """.trimIndent(), JSONObject().put("userId", userId))).getJSONObject("data").getJSONObject("MediaListCollection").getJSONArray("lists")

        val items = mutableListOf<AiringPolicy.Next>()
        for (i in 0 until lists.length()) {
            val entries = lists.getJSONObject(i).getJSONArray("entries")
            for (j in 0 until entries.length()) {
                val media = entries.getJSONObject(j).getJSONObject("media")
                if (media.isNull("nextAiringEpisode")) continue
                val next = media.getJSONObject("nextAiringEpisode")
                items.add(AiringPolicy.Next(media.getInt("id"), media.getJSONObject("title").getString("userPreferred"),
                    next.getInt("episode"), next.getLong("airingAt")))
            }
        }
        return items.distinctBy { it.mediaId }
    }

    /** AniList name the local server reported last; the widget reads the public list with it while the server is off. */
    fun knownUser(context: Context): String? = prefs(context).getString("user", null)

    fun rememberUser(context: Context, name: String) = prefs(context).edit().putString("user", name).apply()

    /** AniList id of a user name, cached. Blocks on the network. */
    fun userId(context: Context, name: String): Int {
        val prefs = prefs(context)
        return prefs.getInt("userId:$name", 0).takeIf { it > 0 } ?: JSONObject(anilist(
            "query (\$name: String) { User(name: \$name) { id } }", JSONObject().put("name", name)))
            .getJSONObject("data").getJSONObject("User").getInt("id")
            .also { prefs.edit().putInt("userId:$name", it).apply() }
    }

    private fun anilist(query: String, variables: JSONObject) =
        request("https://graphql.anilist.co", JSONObject().put("query", query).put("variables", variables).toString(), 8000)

    /** GET without [body], JSON POST with it. */
    private fun request(url: String, body: String?, timeoutMs: Int): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        try {
            if (body != null) {
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Accept", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun encodeNext(items: List<AiringPolicy.Next>) = JSONArray(items.map {
        JSONObject().put("id", it.mediaId).put("title", it.title).put("episode", it.episode).put("airingAt", it.airingAt)
    }).toString()

    private fun decodeNext(json: String?): List<AiringPolicy.Next> = try {
        val array = JSONArray(json ?: "[]")
        (0 until array.length()).map { i ->
            val o = array.getJSONObject(i)
            AiringPolicy.Next(o.getInt("id"), o.getString("title"), o.getInt("episode"), o.getLong("airingAt"))
        }
    } catch (_: Exception) {
        emptyList()
    }

    private fun decodeAnnounced(json: String?): MutableMap<Int, Int> = try {
        val o = JSONObject(json ?: "{}")
        o.keys().asSequence().associate { it.toInt() to o.getInt(it) }.toMutableMap()
    } catch (_: Exception) {
        mutableMapOf()
    }
}
