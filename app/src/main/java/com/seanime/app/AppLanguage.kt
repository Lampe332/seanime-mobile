package com.seanime.app

import android.content.Context
import java.util.Locale

/** Language of the native Seanime Mobile texts. The web UI sets it via SeanimeAndroid.setLanguage; English is the default. */
object AppLanguage {
    private const val PREFS = "seanime_app"
    private const val KEY = "language"
    @Volatile private var german = false

    fun init(context: Context) {
        german = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "en") == "de"
    }

    fun set(context: Context, language: String) {
        german = language == "de"
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, if (german) "de" else "en").apply()
    }

    val locale: Locale get() = if (german) Locale.GERMANY else Locale.US

    fun tr(en: String, de: String): String = if (german) de else en
}
