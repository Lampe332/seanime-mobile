import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { translate } from "@/lib/app-language"
import { customizeInHomeHead, moreProfile, type MoreProfileInput, moreSupportRow, profileHeadOpens } from "./more-panel"

const en = (english: string, german: string) => translate("en", english, german)
const de = (english: string, german: string) => translate("de", english, german)
const ru = (english: string, german: string) => translate("ru", english, german)

const now = 1_800_000_000_000
const anilist = { name: "Chamok", avatar: "https://s4.anilist.co/file/anilistcdn/user/avatar/medium/1.png" }
const signedIn = { loaded: true, signedIn: true, hasKey: true, email: "you@example.com", lastSyncAt: now - 2 * 60_000 }
const signedOut = { loaded: true, signedIn: false, hasKey: false, email: null, lastSyncAt: null }
const notLoaded = { loaded: false, signedIn: false, hasKey: false, email: null, lastSyncAt: null }
const input = (over: Partial<MoreProfileInput>): MoreProfileInput => ({ anilist, account: signedIn, loadFailed: false, lastResult: null, now, ...over })

describe("More panel profile head", () => {
    it("AniList and an account: avatar, name, email and the last sync", () => {
        expect(moreProfile(en, input({}))).toEqual({ title: "Chamok", avatar: anilist.avatar, line: "you@example.com · Synced 2 min ago", lineTone: "muted" })
        expect(moreProfile(de, input({})).line).toBe("you@example.com · Vor 2 Min. synchronisiert")
    })

    it("AniList without an account: the invitation to sync", () => {
        expect(moreProfile(en, input({ account: signedOut }))).toEqual({ title: "Chamok", avatar: anilist.avatar, line: "Sync between your devices", lineTone: "muted" })
    })

    it("AniList, and the account could not be loaded: says so as a warning", () => {
        expect(moreProfile(en, input({ account: notLoaded, loadFailed: true }))).toEqual({
            title: "Chamok", avatar: anilist.avatar, line: "Couldn't load your account", lineTone: "warning",
        })
    })

    it("without AniList: the neutral avatar and Sign in to AniList, the account line stays", () => {
        expect(moreProfile(en, input({ anilist: null }))).toEqual({ title: "Sign in to AniList", avatar: null, line: "you@example.com · Synced 2 min ago", lineTone: "muted" })
        expect(moreProfile(en, input({ anilist: null, account: signedOut })).line).toBe("Sync between your devices")
        expect(moreProfile(en, input({ anilist: null, account: notLoaded, loadFailed: true })).lineTone).toBe("warning")
        expect(moreProfile(de, input({ anilist: null })).title).toBe("Bei AniList anmelden")
        expect(moreProfile(ru, input({ anilist: null })).title).toBe("Войти в AniList")
    })

    it("an AniList account without a name counts as none; one without a picture gets the neutral avatar", () => {
        expect(moreProfile(en, input({ anilist: { name: "  ", avatar: anilist.avatar } }))).toMatchObject({ title: "Sign in to AniList", avatar: null })
        expect(moreProfile(en, input({ anilist: { name: "Chamok", avatar: null } }))).toMatchObject({ title: "Chamok", avatar: null })
    })

    it("an account that is still loading shows no line yet; one never synced says so", () => {
        expect(moreProfile(en, input({ account: notLoaded })).line).toBeNull()
        expect(moreProfile(en, input({ account: { ...signedIn, lastSyncAt: null } })).line).toBe("you@example.com · Not synced yet")
        // a session the server ended counts as signed out
        expect(moreProfile(en, input({ lastResult: { state: "signed-out" } })).line).toBe("Sync between your devices")
    })
})

describe("Support row at the foot of More", () => {
    it("opens Nick's Ko-fi page, its label in the app language", () => {
        expect(moreSupportRow(en)).toEqual({ label: "Support on Ko-fi", href: "https://ko-fi.com/lampe332" })
        expect(moreSupportRow(de).label).toBe("Auf Ko-fi unterstützen")
    })

    it("is the panel's last row, after the entries and actions, on the phone and the tablet (one panel for both)", () => {
        const nav = readFileSync(join(__dirname, "..", "..", "components/navigation/app-navigation.tsx"), "utf8")
        const actions = nav.indexOf("{actions.map(")
        const support = nav.indexOf("<SupportRow ")
        expect(actions).toBeGreaterThan(0)
        expect(support).toBeGreaterThan(actions)
        expect(nav.indexOf("</ScrollView>", support)).toBeGreaterThan(support)
        expect(nav).toMatch(/openTab\(support\.href\)/)
    })
})

describe("Customize Home: head or More", () => {
    it("moves into More on a narrow phone (S22: 360dp) and on every phone in portrait", () => {
        expect(customizeInHomeHead({ rail: false, windowWidth: 360 })).toBe(false)
        expect(customizeInHomeHead({ rail: false, windowWidth: 412 })).toBe(false)
        expect(customizeInHomeHead({ rail: false, windowWidth: 430 })).toBe(false)
    })

    it("stays in the head where the title and five icons fit in one line, and always beside the tablet rail", () => {
        expect(customizeInHomeHead({ rail: false, windowWidth: 780 })).toBe(true)
        expect(customizeInHomeHead({ rail: true, windowWidth: 600 })).toBe(true)
        expect(customizeInHomeHead({ rail: true, windowWidth: 1280 })).toBe(true)
    })
})

// 4.2.0 E (Pixel Tablet): without AniList the head said "Sign in to AniList" and a "Sign in" row under it said it again
describe("signing in to AniList from More", () => {
    const read = (file: string) => readFileSync(join(__dirname, "..", "..", file), "utf8")

    it("is the profile head while the app runs on the local account, else the head opens Settings › Account", () => {
        expect(profileHeadOpens({ isSimulated: true })).toBe("anilist-sign-in")
        expect(profileHeadOpens({ isSimulated: false })).toBe("account")
        expect(profileHeadOpens(null)).toBe("account")
    })

    it("has no Sign in row of its own any more, on the phone and the tablet (one panel for both)", () => {
        const layout = read("app/(main)/_layout.tsx")
        expect(layout).not.toMatch(/id: "sign-in"/)
        expect(layout).toMatch(/onSignIn=\{\(\) => setLoginModal\(true\)\}/)
        const head = read("components/navigation/more-profile-head.tsx")
        expect(head).toMatch(/onPress=\{signIn \? onSignIn : onPress\}/)
        expect(read("components/navigation/app-navigation.tsx")).toMatch(/<MoreProfileHead onPress=\{[^}]*\}\s*onSignIn=/)
    })
})
