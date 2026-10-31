package com.seanime.app.offline

import androidx.media3.datasource.HttpDataSource
import com.seanime.app.AppLanguage
import com.seanime.app.AppLanguage.tr
import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Locale

/** Platform-free rules of the offline features (failure texts, subtitle and audio track names), kept separate for unit tests. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
object OfflinePolicy {
    /** Why a download failed, as far as its error tells; stored by name, so only add entries. */
    enum class Failure { SOURCE_REFUSED, SERVER_OFF, CONNECTION, STORAGE_FULL, UNKNOWN }

    /** [localProxy]: the download goes through the app's own server (127.0.0.1:43211), which may not have been running. */
    fun failure(error: Throwable?, localProxy: Boolean): Failure {
        val chain = generateSequence(error) { it.cause }.take(10).toList()
        return when {
            chain.any { it.message.orEmpty().let { message -> "ENOSPC" in message || "No space left" in message } } -> Failure.STORAGE_FULL
            chain.any { it is HttpDataSource.InvalidResponseCodeException } -> Failure.SOURCE_REFUSED
            localProxy && chain.any { it is ConnectException } -> Failure.SERVER_OFF
            chain.any { it is UnknownHostException || it is SocketTimeoutException || it is SocketException || it is HttpDataSource.HttpDataSourceException } ->
                Failure.CONNECTION
            else -> Failure.UNKNOWN
        }
    }

    fun failureText(failure: Failure): String = when (failure) {
        Failure.SOURCE_REFUSED -> tr("The source link expired or was refused. Retry, or download from another server.",
            "Der Quell-Link ist abgelaufen oder wurde abgelehnt. Erneut versuchen oder von einem anderen Server laden.")
        Failure.SERVER_OFF -> tr("Seanime's local server was not running. Retrying starts it.",
            "Der lokale Seanime-Server lief nicht. Erneut versuchen startet ihn.")
        Failure.CONNECTION -> tr("The connection dropped. Retry when you are online.", "Die Verbindung ist abgebrochen. Mit Internet erneut versuchen.")
        Failure.STORAGE_FULL -> tr("The phone's storage is full. Free up space, then retry.", "Der Speicher des Handys ist voll. Platz schaffen, dann erneut versuchen.")
        Failure.UNKNOWN -> tr("Unknown error. Retry, or download from another server.", "Unbekannter Fehler. Erneut versuchen oder von einem anderen Server laden.")
    }

    /**
     * Language code of a subtitle from a source's language field, which holds codes ("de", "pt-BR") or names ("English",
     * "Deutsch", "Portuguese (Brazil)"); null when it names no known language.
     */
    fun subtitleLanguage(raw: String?): String? {
        val value = raw?.trim().orEmpty()
        if (value.isEmpty()) return null
        if (Regex("[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})*").matches(value)) {
            return Locale.forLanguageTag(value.replace('_', '-')).language.takeIf { it.isNotEmpty() && it != "und" }
        }
        val name = value.substringBefore('(').substringBefore(" - ").trim()
        return Locale.getAvailableLocales().firstOrNull { locale ->
            locale.language.isNotEmpty() && (locale.getDisplayLanguage(Locale.ENGLISH).equals(name, true) || locale.getDisplayLanguage(locale).equals(name, true))
        }?.language
    }

    /** Readable name of an audio or subtitle track in the app's language, e.g. "Japanese · 5.1". */
    fun trackName(label: String?, language: String?, channels: Int, fallback: String): String {
        val languageName = language?.takeIf { it.isNotBlank() && it != "und" }
            ?.let { Locale.forLanguageTag(it).getDisplayLanguage(AppLanguage.locale) }
            ?.takeIf { it.isNotBlank() }
            ?.replaceFirstChar { it.titlecase(AppLanguage.locale) }
        val name = when {
            label.isNullOrBlank() -> languageName ?: fallback
            languageName == null || label.contains(languageName, true) -> label
            else -> "$label · $languageName"
        }
        val layout = when (channels) {
            1 -> "Mono"
            6 -> "5.1"
            8 -> "7.1"
            else -> null
        }
        return if (layout == null) name else "$name · $layout"
    }
}
