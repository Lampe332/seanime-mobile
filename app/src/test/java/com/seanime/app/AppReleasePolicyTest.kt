package com.seanime.app

import org.junit.Assert.*
import org.junit.Test

class AppReleasePolicyTest {
    private fun release(v: String, draft: Boolean = false, prerelease: Boolean = false) = AppReleasePolicy.Release(
        "v$v", "- App fixes", listOf(AppReleasePolicy.Asset("Seanime-Mobile-$v.apk", "https://github.com/Lampe332/seanime-mobile/releases/download/v$v/Seanime-Mobile-$v.apk")), draft, prerelease,
    )
    @Test fun newerOwnApkIsOffered() { assertEquals("1.8.3", AppReleasePolicy.select("1.8.2", listOf(release("1.8.3")))?.version) }
    @Test fun selectedAssetRetainsExpectedBytesAndDigestForArchiveValidation() {
        val release = release("2.0.0")
        val asset = release.assets.single().copy(size = 67154647L, digest = "sha256:expected")
        assertEquals(asset, AppReleasePolicy.select("1.8.8", listOf(release.copy(assets = listOf(asset))))?.asset)
    }
    @Test fun releaseCannotBorrowAnApkFromAnotherVersion() {
        assertNull(AppReleasePolicy.select("1.8.8", listOf(release("2.0.0").copy(assets = release("1.8.9").assets))))
    }
    @Test fun sameAndOlderAreNotOffered() { assertNull(AppReleasePolicy.select("1.8.2", listOf(release("1.8.2"), release("1.8.1")))) }
    @Test fun comparesNumericallyAndDoesNotCompareBackendVersion() { assertEquals("1.10.0", AppReleasePolicy.select("1.9.0", listOf(release("1.10.0")))?.version) }
    @Test fun draftsAndPrereleasesAreSkipped() { assertNull(AppReleasePolicy.select("1.8.2", listOf(release("2.0.0", draft = true), release("2.1.0", prerelease = true)))) }
    @Test fun newestEligibleReleaseWinsRegardlessOfOrder() { assertEquals("2.0.0", AppReleasePolicy.select("1.8.2", listOf(release("1.8.3"), release("2.0.0")))?.version) }
    @Test fun releasesWithoutOwnApkAreSkipped() { assertNull(AppReleasePolicy.select("1.8.2", listOf(release("2.0.0").copy(assets = emptyList())))) }
    @Test fun desktopAndOtherApkNamesAreRejected() { assertNull(AppReleasePolicy.select("1.8.2", listOf(release("2.0.0").copy(assets = listOf(AppReleasePolicy.Asset("seanime-desktop.apk", "https://github.com/Lampe332/seanime-mobile/releases/download/v2.0.0/seanime-desktop.apk")))))) }
    @Test fun foreignRepositoryAndInsecureUrlsAreRejected() {
        val r = release("2.0.0")
        for (url in listOf(r.assets[0].url.replace("Lampe332", "someone"), r.assets[0].url.replace("https:", "http:"), r.assets[0].url + "?other=1")) {
            assertNull(AppReleasePolicy.select("1.8.2", listOf(r.copy(assets = listOf(r.assets[0].copy(url = url))))))
        }
    }
    @Test fun malformedAndNonStableVersionsAreRejected() {
        for (v in listOf("garbage", "1.8.3-beta", "999999999999999.0.0")) assertNull(AppReleasePolicy.select("1.8.2", listOf(release(v))))
        assertNull(AppReleasePolicy.select("unknown", listOf(release("2.0.0"))))
    }
}
