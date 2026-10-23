package com.seanime.app

import java.net.URI

/** Only published stable universal APKs from this app's own repository are eligible. */
object AppReleasePolicy {
    const val REPOSITORY = "Lampe332/seanime-mobile"
    const val RELEASES_URL = "https://api.github.com/repos/$REPOSITORY/releases?per_page=30"
    data class Asset(val name: String, val url: String, val size: Long = 0, val digest: String = "")
    data class Release(val tag: String, val body: String, val assets: List<Asset>, val draft: Boolean, val prerelease: Boolean)
    data class Update(val version: String, val release: Release, val asset: Asset)

    private fun version(value: String): List<Int>? {
        val clean = value.removePrefix("v")
        if (!Regex("[0-9]+\\.[0-9]+\\.[0-9]+").matches(clean)) return null
        return clean.split('.').map { it.toIntOrNull() ?: return null }
    }

    fun compare(a: String, b: String): Int {
        val left = version(a) ?: return 0
        val right = version(b) ?: return 0
        for (i in left.indices) if (left[i] != right[i]) return left[i].compareTo(right[i])
        return 0
    }

    fun select(current: String, releases: List<Release>): Update? {
        if (version(current) == null) return null
        return releases.mapNotNull { release ->
            if (release.draft || release.prerelease || version(release.tag) == null || compare(release.tag, current) <= 0) return@mapNotNull null
            val version = release.tag.removePrefix("v")
            val name = "Seanime-Mobile-$version.apk"
            val expected = "https://github.com/$REPOSITORY/releases/download/${release.tag}/$name"
            val asset = release.assets.firstOrNull { it.name == name && it.url == expected && URI(it.url).scheme == "https" }
                ?: return@mapNotNull null
            Update(version, release, asset)
        }.maxWithOrNull { a, b -> compare(a.version, b.version) }
    }
}
