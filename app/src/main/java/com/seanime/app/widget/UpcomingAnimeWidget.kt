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
import com.seanime.app.MainActivity
import com.seanime.app.R
import com.seanime.app.SeanimeService

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
                    WidgetCache(context).clearCache()
                    refreshWidget(context, appWidgetManager, appWidgetId)
                }
            }
            ACTION_DATA_UPDATED -> appWidgetManager.getAppWidgetIds(ComponentName(context, UpcomingAnimeWidget::class.java))
                .forEach { updateWidget(context, appWidgetManager, it) }
        }
    }

    private fun updateWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)
        val cache = WidgetCache(context)
        val error = cache.getError()
        if (error != null || cache.isLoading() || !cache.hasValidCache()) {
            views.setTextViewText(R.id.loading_text, if (error != null) "Error: $error" else "Nothing here yet")
            views.setViewVisibility(R.id.loading_text, View.VISIBLE)
            // Keep the ListView around so RemoteViewsService still runs and can fetch.
            views.setViewVisibility(R.id.anime_list_view, View.INVISIBLE)
        } else {
            views.setViewVisibility(R.id.loading_text, View.GONE)
            views.setViewVisibility(R.id.anime_list_view, View.VISIBLE)
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

    private fun refreshWidget(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int) {
        val serviceIntent = Intent(context, SeanimeService::class.java)
        try {
            if (android.os.Build.VERSION.SDK_INT >= 26) context.startForegroundService(serviceIntent)
            else context.startService(serviceIntent)
        } catch (_: IllegalStateException) {
            // Periodic widget updates are not exempt from Android's background-start limit.
            WidgetCache(context).setError("Open Seanime to start the local server, then refresh the widget.")
            updateWidget(context, appWidgetManager, appWidgetId)
            return
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
