package com.seanime.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.RemoteViews
import com.seanime.app.AppLanguage
import com.seanime.app.AppLanguage.tr
import com.seanime.app.MainActivity
import com.seanime.app.R
import com.seanime.app.SeanimeService
import com.seanime.app.notify.AiringNotifier
import java.text.SimpleDateFormat
import java.util.Date

class UpcomingAnimeWidget : AppWidgetProvider() {

    companion object {
        const val ACTION_REFRESH = "com.seanime.app.widget.ACTION_REFRESH"
        const val ACTION_DATA_UPDATED = "com.seanime.app.widget.ACTION_DATA_UPDATED"
    }

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val cache = WidgetCache(context)
        for (id in appWidgetIds) {
            if (!cache.hasValidCache() || cache.isLoading()) refreshWidget(context, appWidgetManager, id)
            else updateWidget(context, appWidgetManager, id)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val appWidgetManager = AppWidgetManager.getInstance(context)
        when (intent.action) {
            ACTION_REFRESH -> {
                val appWidgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
                if (appWidgetId != AppWidgetManager.INVALID_APPWIDGET_ID) {
                    WidgetCache(context).clearError()
                    refreshWidget(context, appWidgetManager, appWidgetId)
                }
            }
            ACTION_DATA_UPDATED -> appWidgetManager.getAppWidgetIds(ComponentName(context, UpcomingAnimeWidget::class.java))
                .forEach { updateWidget(context, appWidgetManager, it) }
        }
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        AppLanguage.init(context)
        val views = RemoteViews(context.packageName, R.layout.widget_layout)
        views.setTextViewText(R.id.widget_title, tr("Upcoming anime", "Demnächst"))
        val cache = WidgetCache(context)
        val error = cache.getError()
        if (cache.getCacheData().isNotEmpty()) {
            // A failed or pending refresh keeps the last list, marked with its time.
            val outdated = error != null || !cache.hasValidCache()
            views.setTextViewText(R.id.loading_text, tr("As of ${time(cache.savedAt())}", "Stand ${time(cache.savedAt())}"))
            views.setViewVisibility(R.id.loading_text, if (outdated) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.anime_list_view, View.VISIBLE)
        } else {
            views.setTextViewText(R.id.loading_text, when {
                cache.isLoading() -> tr("Loading …", "Wird geladen …")
                error != null -> error
                cache.savedAt() > 0 -> tr("No upcoming episodes on your list", "Keine anstehenden Folgen auf deiner Liste")
                else -> tr("Nothing here yet", "Noch nichts da")
            })
            views.setViewVisibility(R.id.loading_text, View.VISIBLE)
            // Keep the ListView around so RemoteViewsService still runs and can fetch.
            views.setViewVisibility(R.id.anime_list_view, View.INVISIBLE)
        }

        val refreshIntent = Intent(context, UpcomingAnimeWidget::class.java)
            .setAction(ACTION_REFRESH).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        views.setOnClickPendingIntent(R.id.refresh_button, PendingIntent.getBroadcast(context, appWidgetId, refreshIntent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))

        val listIntent = Intent(context, AnimeListService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        listIntent.data = Uri.parse(listIntent.toUri(Intent.URI_INTENT_SCHEME))
        views.setRemoteAdapter(R.id.anime_list_view, listIntent)

        // Each row fills in its seanime://entry link (AnimeListFactory.getViewAt).
        val openIntent = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
        views.setPendingIntentTemplate(R.id.anime_list_view, PendingIntent.getActivity(context, 0, openIntent,
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))

        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.anime_list_view)
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    /** HH:mm, with the date when it is not from today. */
    private fun time(millis: Long): String {
        val today = SimpleDateFormat("yyyyMMdd", AppLanguage.locale).let { it.format(Date(millis)) == it.format(Date()) }
        val pattern = if (today) "HH:mm" else tr("MMM d, HH:mm", "dd.MM., HH:mm")
        return SimpleDateFormat(pattern, AppLanguage.locale).format(Date(millis))
    }

    private fun refreshWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        // The list comes from AniList; the local server only tells the user name, which the app remembers.
        if (AiringNotifier.knownUser(context) == null) {
            val serviceIntent = Intent(context, SeanimeService::class.java)
            try {
                if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(serviceIntent)
                else context.startService(serviceIntent)
            } catch (_: IllegalStateException) {
                // Periodic widget updates are not exempt from Android's background-start limit.
                AppLanguage.init(context)
                WidgetCache(context).setError(tr("Open Seanime once, then refresh the widget.", "Seanime einmal öffnen, dann das Widget aktualisieren."))
                updateWidget(context, appWidgetManager, appWidgetId)
                return
            }
        }

        WidgetCache(context).setLoading(true)
        // Bind the adapter right away so the factory starts fetching while the widget shows the loading text.
        updateWidget(context, appWidgetManager, appWidgetId)
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.anime_list_view)
        // Again shortly after, for a slow server boot.
        Handler(Looper.getMainLooper()).postDelayed({
            appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.anime_list_view)
        }, 2000)
    }
}
