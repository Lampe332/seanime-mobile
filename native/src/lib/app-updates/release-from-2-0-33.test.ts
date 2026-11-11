import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import appJson from "../../../app.json"
import appVariants from "../../../app-variants.json"
import { compareVersions, parseReleases, REPOSITORY, selectUpdate } from "./app-release-policy"

/*
 * E6: the first native release must be offered and accepted by the in-app updater of Seanime Mobile 2.0.33, and the
 * native updater must find the releases after it.
 *
 * Step 1, offer: AppReleasePolicy.kt (ported 1:1 in app-release-policy.ts, its Kotlin test ported 1:1 in
 * app-release-policy.test.ts) picks the release from GitHub's /releases JSON as AppUpdater.kt reads it (tag_name,
 * draft/prerelease default true, browser_download_url).
 * Step 2, accept: AppUpdater.kt validate() checks the downloaded archive; `oldUpdaterAccepts` below transcribes those
 * checks line by line. The values for the APK come from app-variants.json (release) and app.json, the same files the
 * build reads; build-android.ps1 -Release checks the built APK against them (aapt2 badging, certificate, libseanime.so).
 */
const OLD_VERSION = "2.0.33"
const OLD_VERSION_CODE = 31128
const OLD_PACKAGE = "com.seanime.app.local"
const release = appVariants.variants.release
const version = appJson.expo.version
const tag = `v${version}`
const assetName = `Seanime-Mobile-${version}.apk`

const oldApp = (file: string) => readFileSync(join(__dirname, "../../../../app/src/main/java/com/seanime/app", file), "utf8")

// GitHub's /releases JSON as AppUpdater.kt reads it.
const githubRelease = (name: string, overrides: Record<string, unknown> = {}, releaseTag = tag) => ({
    tag_name: releaseTag, body: "## What's new?", draft: false, prerelease: false,
    assets: [{ name, browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${releaseTag}/${name}`, size: 1, digest: "" }],
    ...overrides,
})

type Archive = { packageName: string, versionName: string, versionCode: number, minSdk: number, sameCertificate: boolean, abis: string[] }

/** AppUpdater.kt validate(), after size and SHA-256 (GitHub's own digest of the asset): */
function oldUpdaterAccepts(archive: Archive, releaseVersion: string, deviceSdk: number, deviceAbis: string[]): string | null {
    // check(archive.applicationInfo!!.minSdkVersion <= Build.VERSION.SDK_INT)
    if (archive.minSdk > deviceSdk) return "APK requires a newer Android version"
    // check(archive.packageName == activity.packageName)
    if (archive.packageName !== OLD_PACKAGE) return "APK belongs to another app"
    // check(archive.versionName == prefs.getString("version", "")): the version AppReleasePolicy.select returned
    if (archive.versionName !== releaseVersion) return "APK version does not match release"
    // check(code > installedCode() && AppReleasePolicy.compare(archive.versionName ?: "", currentVersion()) > 0)
    if (!(archive.versionCode > OLD_VERSION_CODE && compareVersions(archive.versionName, OLD_VERSION) > 0)) return "APK is not newer than installed app"
    // check(certificates(archive).isNotEmpty() && certificates(archive) == certificates(installed))
    if (!archive.sameCertificate) return "APK signing certificate mismatch"
    // check(Build.SUPPORTED_ABIS.any { zip.getEntry("lib/$it/libseanime.so") != null })
    if (!deviceAbis.some(abi => archive.abis.includes(abi))) return "APK does not support this device"
    return null
}

// What build-android.ps1 -Release produces and checks (aapt2 badging, apksigner, zip entries).
const releaseApk: Archive = {
    packageName: release.applicationId, versionName: version, versionCode: release.versionCode, minSdk: 24,
    sameCertificate: true, abis: ["arm64-v8a", "armeabi-v7a"],
}

describe("the Kotlin rules this test transcribes are still the ones in app/", () => {
    it("AppReleasePolicy.kt: own repository, stable, exactly Seanime-Mobile-<version>.apk under the tag", () => {
        const policy = oldApp("AppReleasePolicy.kt")
        expect(policy).toContain(`const val REPOSITORY = "${REPOSITORY}"`)
        expect(policy).toContain("if (release.draft || release.prerelease || version(release.tag) == null || compare(release.tag, current) <= 0)")
        expect(policy).toContain("val name = \"Seanime-Mobile-$version.apk\"")
        expect(policy).toContain("val expected = \"https://github.com/$REPOSITORY/releases/download/${release.tag}/$name\"")
    })
    it("AppUpdater.kt: package, version, versionCode, certificate and libseanime.so checks", () => {
        const updater = oldApp("AppUpdater.kt")
        expect(updater).toContain("check(archive.packageName == activity.packageName)")
        expect(updater).toContain("check(archive.versionName == prefs.getString(\"version\", \"\"))")
        expect(updater).toContain("check(code > installedCode() && AppReleasePolicy.compare(archive.versionName ?: \"\", currentVersion()) > 0)")
        expect(updater).toContain("check(certificates(archive).isNotEmpty() && certificates(archive) == certificates(installed))")
        expect(updater).toContain("zip.getEntry(\"lib/$it/libseanime.so\")")
        expect(updater).toContain("release.optBoolean(\"draft\", true), release.optBoolean(\"prerelease\", true)")
    })
})

describe("v3 release seen by the 2.0.33 updater", () => {
    it("app.json version is a plain x.y.z above 2.0.33 (the tag, and the APK's versionName)", () => {
        expect(version).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/)
        expect(compareVersions(version, OLD_VERSION)).toBe(1)
    })
    it("a stable release with Seanime-Mobile-<version>.apk is offered", () => {
        const update = selectUpdate(OLD_VERSION, parseReleases([githubRelease(assetName)]))
        expect(update?.version).toBe(version)
        expect(update?.asset.name).toBe(assetName)
    })
    it("the test build's file name is not offered", () => {
        expect(selectUpdate(OLD_VERSION, parseReleases([githubRelease(`Seanime-Native-${version}-test.apk`)]))).toBeNull()
    })
    it("a prerelease, a draft, or a release without the flags is not offered", () => {
        expect(selectUpdate(OLD_VERSION, parseReleases([githubRelease(assetName, { prerelease: true })]))).toBeNull()
        expect(selectUpdate(OLD_VERSION, parseReleases([githubRelease(assetName, { draft: true })]))).toBeNull()
        const noFlags: Record<string, unknown> = githubRelease(assetName)
        delete noFlags.draft
        expect(selectUpdate(OLD_VERSION, parseReleases([noFlags]))).toBeNull()
    })
    it("the release APK passes every archive check of the 2.0.33 updater", () => {
        expect(oldUpdaterAccepts(releaseApk, version, 34, ["arm64-v8a", "armeabi-v7a", "armeabi"])).toBeNull()
        expect(oldUpdaterAccepts(releaseApk, version, 34, ["armeabi-v7a", "armeabi"])).toBeNull()
    })
    it("the test APK or a wrong versionCode/versionName is refused", () => {
        const test = appVariants.variants.test
        expect(oldUpdaterAccepts({ ...releaseApk, packageName: test.applicationId, versionCode: test.versionCode }, version, 34, ["arm64-v8a"]))
            .toBe("APK belongs to another app")
        expect(oldUpdaterAccepts({ ...releaseApk, versionCode: OLD_VERSION_CODE }, version, 34, ["arm64-v8a"])).toBe("APK is not newer than installed app")
        expect(oldUpdaterAccepts({ ...releaseApk, versionName: "3.0.0-native" }, version, 34, ["arm64-v8a"])).toBe("APK version does not match release")
        expect(oldUpdaterAccepts({ ...releaseApk, sameCertificate: false }, version, 34, ["arm64-v8a"])).toBe("APK signing certificate mismatch")
    })
})

describe("releases after v3, seen by the native updater (same policy, now with 3.0.0 installed)", () => {
    it("3.0.1 with Seanime-Mobile-3.0.1.apk is offered, 3.0.0 itself and older are not", () => {
        const next = githubRelease("Seanime-Mobile-3.0.1.apk", {}, "v3.0.1")
        expect(selectUpdate(version, parseReleases([next, githubRelease(assetName)]))?.version).toBe("3.0.1")
        expect(selectUpdate(version, parseReleases([githubRelease(assetName), githubRelease("Seanime-Mobile-2.0.33.apk", {}, "v2.0.33")]))).toBeNull()
    })
    it("the newest of several later releases wins", () => {
        const releases = parseReleases([
            githubRelease("Seanime-Mobile-3.0.2.apk", {}, "v3.0.2"),
            githubRelease("Seanime-Mobile-3.1.0.apk", {}, "v3.1.0"),
            githubRelease("Seanime-Mobile-3.0.10.apk", {}, "v3.0.10"),
        ])
        expect(selectUpdate(version, releases)?.version).toBe("3.1.0")
    })
    it("the release versionCode leaves room above 2.0.33 for the next ones", () => {
        expect(release.versionCode).toBeGreaterThan(OLD_VERSION_CODE)
        expect(release.applicationId).toBe(OLD_PACKAGE)
    })
})

describe("no cloud backup of the app's data (r18)", () => {
    it("app.json turns allowBackup off; 2.0.33 had it on, and neither updater nor Android compares it on an update", () => {
        expect(appJson.expo.android.allowBackup).toBe(false)
        const updater = oldApp("AppUpdater.kt")
        expect(updater).not.toContain("allowBackup")
        expect(readFileSync(join(__dirname, "../../../../app/src/main/AndroidManifest.xml"), "utf8")).toContain("android:allowBackup=\"true\"")
    })
})
