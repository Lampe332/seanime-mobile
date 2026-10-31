package com.seanime.app

import java.net.URI
import java.net.URISyntaxException
import java.net.URLDecoder
import java.net.URLEncoder

/** Where a link from outside (widget, launcher shortcut, AniList/MyAnimeList page, shared text) opens in the app. Pure, so it can be unit tested. */
object AppLinks {
    sealed interface Target
    /** A page of the app: a path under its origin, with its query. */
    data class Page(val path: String) : Target
    /** A MyAnimeList anime; the app works with AniList ids, so it is looked up first. */
    data class MalAnime(val malId: Long) : Target

    private val SHORTCUT_PAGES = setOf("/", "/search", "/android-downloads", "/schedule")

    fun target(link: String?): Target? {
        val uri = try {
            URI(link?.trim() ?: return null)
        } catch (_: URISyntaxException) {
            return null
        }
        val segments = uri.rawPath.orEmpty().split('/').filter { it.isNotEmpty() }
        val host = uri.host?.lowercase()?.removePrefix("www.")
        return when {
            uri.scheme == "seanime" && host == "entry" -> query(uri, "id")?.toLongOrNull()?.takeIf { it > 0 }?.let { Page("/entry?id=$it") }
            uri.scheme == "seanime" && host == "open" -> query(uri, "path")?.takeIf { it in SHORTCUT_PAGES }?.let { Page(it) }
            uri.scheme != "http" && uri.scheme != "https" -> null
            segments.getOrNull(0) != "anime" -> null
            host == "anilist.co" -> segments.getOrNull(1)?.toLongOrNull()?.takeIf { it > 0 }?.let { Page("/entry?id=$it") }
            host == "myanimelist.net" -> segments.getOrNull(1)?.toLongOrNull()?.takeIf { it > 0 }?.let { MalAnime(it) }
            else -> null
        }
    }

    /** The first AniList or MyAnimeList link in shared text; other text is searched as a title. */
    fun shared(text: String?): Target? {
        val value = text?.trim().orEmpty()
        if (value.isEmpty()) return null
        Regex("""https?://\S+""").findAll(value).firstNotNullOfOrNull { target(it.value) }?.let { return it }
        if (value.startsWith("http://") || value.startsWith("https://")) return null
        return Page("/search?q=" + URLEncoder.encode(value.take(100), "UTF-8"))
    }

    private fun query(uri: URI, key: String): String? = uri.rawQuery.orEmpty().split('&')
        .map { it.split('=', limit = 2) }
        .firstOrNull { it[0] == key && it.size == 2 }
        ?.let { URLDecoder.decode(it[1], "UTF-8") }
}
