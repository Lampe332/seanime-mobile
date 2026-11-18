import { describe, expect, it } from "vitest"
import appJson from "../../../app.json"
import appVariants from "../../../app-variants.json"
import { compareVersions, parseReleases, REPOSITORY, selectUpdate } from "./app-release-policy"
import { checkDownload, DIGEST_MISMATCH, MISSING_DIGEST } from "./updater-state"

/*
 * Stage 8b-4 (docs/EIGENER-KERN.md §4s): which installed updater can reach the release without the Go server
 * (app.json version, app-variants.json "release")?
 *
 * Users run one of two updaters, both pick releases with the same policy (AppReleasePolicy.kt = app-release-policy.ts:
 * the newest stable tag with exactly Seanime-Mobile-<version>.apk):
 * - 2.0.33, the Kotlin app (AppUpdater.kt validate() at 8efb166, transcribed in `oldUpdaterAccepts`): it also demands
 *   lib/<abi>/libseanime.so, the Go server. The release has none, so 2.0.33 refuses it in the app.
 * - 3.0.0, the native app (c3366ab, app-updater.ts + updater-state.ts, unchanged since): GitHub's SHA-256 and size of
 *   the asset (`checkDownload`, used here as is), then Android's package installer, which only takes the same package,
 *   the same certificate and a higher versionCode (`androidInstalls`). No libseanime.so check.
 * Way: 3.0.0 -> release in the app; 2.0.33 -> manual install of the release APK over the app (same package and key,
 * data kept), told in the release notes (docs/RELEASE-4.0-DRAFT.md). A placeholder libseanime.so is not an option.
 */
const OLD_VERSION = "2.0.33"
const OLD_VERSION_CODE = 31128
const V3_VERSION = "3.0.0"
const V3_VERSION_CODE = 31129
const PACKAGE = "com.seanime.app.local"
const release = appVariants.variants.release
const version = appJson.expo.version
const tag = `v${version}`
const assetName = `Seanime-Mobile-${version}.apk`
const DIGEST = `sha256:${"ab".repeat(32)}`

// GitHub's /releases JSON as both updaters read it.
const githubRelease = (name: string, overrides: Record<string, unknown> = {}, releaseTag = tag) => ({
    tag_name: releaseTag, body: "## What's new?", draft: false, prerelease: false,
    assets: [{ name, browser_download_url: `https://github.com/${REPOSITORY}/releases/download/${releaseTag}/${name}`, size: 1, digest: DIGEST }],
    ...overrides,
})
const v3Release = githubRelease(`Seanime-Mobile-${V3_VERSION}.apk`, {}, `v${V3_VERSION}`)

type Archive = { packageName: string, versionName: string, versionCode: number, minSdk: number, sameCertificate: boolean, serverAbis: string[] }

/** AppUpdater.kt validate() of 2.0.33, after size and SHA-256 (GitHub's own digest of the asset): */
function oldUpdaterAccepts(archive: Archive, releaseVersion: string, deviceSdk: number, deviceAbis: string[]): string | null {
    // check(archive.applicationInfo!!.minSdkVersion <= Build.VERSION.SDK_INT)
    if (archive.minSdk > deviceSdk) return "APK requires a newer Android version"
    // check(archive.packageName == activity.packageName)
    if (archive.packageName !== PACKAGE) return "APK belongs to another app"
    // check(archive.versionName == prefs.getString("version", "")): the version AppReleasePolicy.select returned
    if (archive.versionName !== releaseVersion) return "APK version does not match release"
    // check(code > installedCode() && AppReleasePolicy.compare(archive.versionName ?: "", currentVersion()) > 0)
    if (!(archive.versionCode > OLD_VERSION_CODE && compareVersions(archive.versionName, OLD_VERSION) > 0)) return "APK is not newer than installed app"
    // check(certificates(archive).isNotEmpty() && certificates(archive) == certificates(installed))
    if (!archive.sameCertificate) return "APK signing certificate mismatch"
    // check(Build.SUPPORTED_ABIS.any { zip.getEntry("lib/$it/libseanime.so") != null })
    if (!deviceAbis.some(abi => archive.serverAbis.includes(abi))) return "APK does not support this device"
    return null
}

/** Android's package installer on an update (what 3.0.0 relies on after its own checks, and a manual install too). */
function androidInstalls(archive: Archive, installedCode: number): boolean {
    return archive.packageName === PACKAGE && archive.sameCertificate && archive.versionCode > installedCode
}

// What build-android.ps1 -Release produces and checks (aapt2 badging, apksigner, no libseanime.so in the zip).
const releaseApk: Archive = {
    packageName: release.applicationId, versionName: version, versionCode: release.versionCode, minSdk: 24,
    sameCertificate: true, serverAbis: [],
}

describe("the release without the Go server", () => {
    it("is a plain x.y.z above 3.0.0 with a versionCode above both installed apps", () => {
        expect(version).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/)
        expect(compareVersions(version, V3_VERSION)).toBe(1)
        expect(release.versionCode).toBeGreaterThan(V3_VERSION_CODE)
        expect(release.applicationId).toBe(PACKAGE)
    })
})

describe("seen by the 2.0.33 updater", () => {
    it("is offered, also when 3.0.0 is listed: the newest wins, 3.0.0 is never picked again", () => {
        const update = selectUpdate(OLD_VERSION, parseReleases([v3Release, githubRelease(assetName)]))
        expect(update?.version).toBe(version)
        expect(update?.asset.name).toBe(assetName)
    })
    it("is refused in the app: no libseanime.so", () => {
        expect(oldUpdaterAccepts(releaseApk, version, 34, ["arm64-v8a", "armeabi-v7a", "armeabi"])).toBe("APK does not support this device")
    })
    it("passes every other check, so only the server library is missing", () => {
        expect(oldUpdaterAccepts({ ...releaseApk, serverAbis: ["arm64-v8a"] }, version, 34, ["arm64-v8a"])).toBeNull()
    })
    it("installs by hand over 2.0.33: same package, same key, higher versionCode", () => {
        expect(androidInstalls(releaseApk, OLD_VERSION_CODE)).toBe(true)
    })
    it("the test build, a wrong versionCode/versionName or another key stay refused", () => {
        const test = appVariants.variants.test
        expect(oldUpdaterAccepts({ ...releaseApk, packageName: test.applicationId, versionCode: test.versionCode }, version, 34, ["arm64-v8a"]))
            .toBe("APK belongs to another app")
        expect(oldUpdaterAccepts({ ...releaseApk, versionCode: OLD_VERSION_CODE }, version, 34, ["arm64-v8a"])).toBe("APK is not newer than installed app")
        expect(oldUpdaterAccepts({ ...releaseApk, versionName: `${version}-native` }, version, 34, ["arm64-v8a"])).toBe("APK version does not match release")
        expect(oldUpdaterAccepts({ ...releaseApk, sameCertificate: false }, version, 34, ["arm64-v8a"])).toBe("APK signing certificate mismatch")
    })
})

describe("seen by the 3.0.0 updater (native app)", () => {
    it("is offered with Seanime-Mobile-<version>.apk; the test build's name, a prerelease or a draft are not", () => {
        expect(selectUpdate(V3_VERSION, parseReleases([v3Release, githubRelease(assetName)]))?.version).toBe(version)
        expect(selectUpdate(V3_VERSION, parseReleases([githubRelease(`Seanime-Native-${version}-test.apk`)]))).toBeNull()
        expect(selectUpdate(V3_VERSION, parseReleases([githubRelease(assetName, { prerelease: true })]))).toBeNull()
        expect(selectUpdate(V3_VERSION, parseReleases([githubRelease(assetName, { draft: true })]))).toBeNull()
        const noFlags: Record<string, unknown> = githubRelease(assetName)
        delete noFlags.draft
        expect(selectUpdate(V3_VERSION, parseReleases([noFlags]))).toBeNull()
    })
    it("takes the download only with GitHub's checksum and size, never looks for libseanime.so", () => {
        expect(checkDownload(1, "ab".repeat(32), 1, DIGEST)).toBeNull()
        expect(checkDownload(1, "cd".repeat(32), 1, DIGEST)).toBe(DIGEST_MISMATCH)
        expect(checkDownload(1, "ab".repeat(32), 1, "")).toBe(MISSING_DIGEST)
    })
    it("Android installs it over 3.0.0; another key or a lower versionCode not", () => {
        expect(androidInstalls(releaseApk, V3_VERSION_CODE)).toBe(true)
        expect(androidInstalls({ ...releaseApk, sameCertificate: false }, V3_VERSION_CODE)).toBe(false)
        expect(androidInstalls({ ...releaseApk, versionCode: V3_VERSION_CODE }, V3_VERSION_CODE)).toBe(false)
    })
})

describe("4.2.0, seen by the 4.x updater (same updater as 3.0.0)", () => {
    it("is offered over 4.1.0, 4.0.1 and 4.0.0 and installs over versionCode 40100", () => {
        expect(version).toBe("4.2.0")
        expect(release.versionCode).toBe(40200)
        const v410Release = githubRelease("Seanime-Mobile-4.1.0.apk", {}, "v4.1.0")
        const v401Release = githubRelease("Seanime-Mobile-4.0.1.apk", {}, "v4.0.1")
        const v4Release = githubRelease("Seanime-Mobile-4.0.0.apk", {}, "v4.0.0")
        const all = parseReleases([githubRelease(assetName), v410Release, v401Release, v4Release, v3Release])
        expect(selectUpdate("4.1.0", all)?.version).toBe("4.2.0")
        expect(selectUpdate("4.0.1", all)?.version).toBe("4.2.0")
        expect(selectUpdate("4.0.0", all)?.version).toBe("4.2.0")
        expect(selectUpdate("3.0.0", all)?.version).toBe("4.2.0")
        expect(androidInstalls(releaseApk, 40100)).toBe(true)
    })
})

describe("releases after it, seen by the native updater", () => {
    it("the next one is offered, the installed one and older are not", () => {
        const next = githubRelease("Seanime-Mobile-4.2.1.apk", {}, "v4.2.1")
        expect(selectUpdate(version, parseReleases([next, githubRelease(assetName)]))?.version).toBe("4.2.1")
        expect(selectUpdate(version, parseReleases([githubRelease(assetName), v3Release]))).toBeNull()
    })
    it("the newest of several later releases wins", () => {
        const releases = parseReleases([
            githubRelease("Seanime-Mobile-4.2.1.apk", {}, "v4.2.1"),
            githubRelease("Seanime-Mobile-4.3.0.apk", {}, "v4.3.0"),
            githubRelease("Seanime-Mobile-4.2.10.apk", {}, "v4.2.10"),
        ])
        expect(selectUpdate(version, releases)?.version).toBe("4.3.0")
    })
})

describe("no cloud backup of the app's data (r18)", () => {
    it("app.json turns allowBackup off; 2.0.33 had it on, and neither updater nor Android compares it on an update", () => {
        expect(appJson.expo.android.allowBackup).toBe(false)
    })
})
