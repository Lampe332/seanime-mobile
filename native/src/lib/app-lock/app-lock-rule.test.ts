import { describe, expect, it } from "vitest"
import { APP_LOCK_AFTER_MS, appContentAccessibility, appLockHidesRecents, appLockReducer, type AppLockEvent, type AppLockState, initialAppLockState } from "./app-lock-rule"

const run = (state: AppLockState, ...events: AppLockEvent[]) => events.reduce(appLockReducer, state)
const unlocked = initialAppLockState(false)

describe("app lock rule", () => {
    it("locks at a cold start only when the switch is on", () => {
        expect(initialAppLockState(true).locked).toBe(true)
        expect(initialAppLockState(false).locked).toBe(false)
    })

    it("locks after more than a minute in the background, not after a short trip", () => {
        const back = (after: number) => run(unlocked, { type: "hidden", now: 0 }, { type: "shown", now: after, enabled: true }).locked
        expect(back(APP_LOCK_AFTER_MS)).toBe(false)
        expect(back(APP_LOCK_AFTER_MS + 1)).toBe(true)
        expect(back(5_000)).toBe(false)
    })

    it("does not lock with the switch off, and stays locked until unlocked", () => {
        expect(run(unlocked, { type: "hidden", now: 0 }, { type: "shown", now: 10 * APP_LOCK_AFTER_MS, enabled: false }).locked).toBe(false)
        const locked = run(initialAppLockState(true), { type: "hidden", now: 0 }, { type: "shown", now: 1, enabled: true })
        expect(locked.locked).toBe(true)
        expect(appLockReducer(locked, { type: "unlock" }).locked).toBe(false)
    })

    it("counts from the first time the app went away (a second background event does not restart the minute)", () => {
        const state = run(unlocked, { type: "hidden", now: 0 }, { type: "hidden", now: APP_LOCK_AFTER_MS }, { type: "shown", now: APP_LOCK_AFTER_MS + 1, enabled: true })
        expect(state.locked).toBe(true)
    })

    // (a) the device lock's own prompt sends the app to the background on Android (the screen PIN is its own activity)
    it("does not lock again because of the device lock's prompt, however long the PIN takes", () => {
        const state = run(initialAppLockState(true),
            { type: "prompt", open: true, now: 0, appActive: true },
            { type: "hidden", now: 1 },
            { type: "shown", now: 5 * APP_LOCK_AFTER_MS, enabled: true },
            { type: "prompt", open: false, now: 5 * APP_LOCK_AFTER_MS, appActive: true },
            { type: "unlock" })
        expect(state).toEqual(unlocked)
        // the prompt's result may arrive before the app is in front again
        const early = run(unlocked,
            { type: "prompt", open: true, now: 0, appActive: true },
            { type: "hidden", now: 1 },
            { type: "prompt", open: false, now: 2 * APP_LOCK_AFTER_MS, appActive: false },
            { type: "shown", now: 2 * APP_LOCK_AFTER_MS + 50, enabled: true })
        expect(early.locked).toBe(false)
    })

    it("starts the minute when the user leaves during a prompt", () => {
        const state = run(unlocked,
            { type: "prompt", open: true, now: 0, appActive: true },
            { type: "hidden", now: 1 },
            { type: "prompt", open: false, now: 2, appActive: false },
            { type: "shown", now: 2 + APP_LOCK_AFTER_MS + 1, enabled: true })
        expect(state.locked).toBe(true)
    })

    // (b) picture in picture: the app is in the background while its video still plays
    it("does not lock while a video plays in picture in picture, in either order of the events", () => {
        const pipFirst = run(unlocked,
            { type: "pictureInPicture", active: true, now: 0, appActive: true },
            { type: "hidden", now: 1 },
            { type: "shown", now: 10 * APP_LOCK_AFTER_MS, enabled: true })
        expect(pipFirst.locked).toBe(false)
        const hiddenFirst = run(unlocked,
            { type: "hidden", now: 0 },
            { type: "pictureInPicture", active: true, now: 1, appActive: false },
            { type: "pictureInPicture", active: false, now: 10 * APP_LOCK_AFTER_MS, appActive: false },
            { type: "shown", now: 10 * APP_LOCK_AFTER_MS + 50, enabled: true })
        expect(hiddenFirst.locked).toBe(false)
    })

    it("starts the minute when the picture in picture is closed while the app is away", () => {
        const state = run(unlocked,
            { type: "pictureInPicture", active: true, now: 0, appActive: true },
            { type: "hidden", now: 1 },
            { type: "pictureInPicture", active: false, now: 5 * APP_LOCK_AFTER_MS, appActive: false })
        expect(appLockReducer(state, { type: "shown", now: 5 * APP_LOCK_AFTER_MS + 1_000, enabled: true }).locked).toBe(false)
        expect(appLockReducer(state, { type: "shown", now: 6 * APP_LOCK_AFTER_MS + 1, enabled: true }).locked).toBe(true)
    })
})

describe("app lock guards", () => {
    it("keeps the app out of recents for as long as the switch is on, locked or not", () => {
        expect(appLockHidesRecents(true, false)).toBe(true)
        expect(appLockHidesRecents(true, true)).toBe(true)
        expect(appLockHidesRecents(false, false)).toBe(false)
    })

    it("still hides recents while the cover is up, even before the switch is read", () => {
        expect(appLockHidesRecents(false, true)).toBe(true)
    })

    it("hides the app behind the cover from accessibility only while locked", () => {
        expect(appContentAccessibility(true, "android")).toEqual({
            importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true, collapsable: false, style: { flex: 1, display: "none" },
        })
        expect(appContentAccessibility(true, "ios")).toEqual({
            importantForAccessibility: "no-hide-descendants", accessibilityElementsHidden: true, collapsable: false, style: { flex: 1, display: "flex" },
        })
        for (const os of ["android", "ios"]) {
            expect(appContentAccessibility(false, os)).toEqual({
                importantForAccessibility: "auto", accessibilityElementsHidden: false, collapsable: false, style: { flex: 1, display: "flex" },
            })
        }
    })

    it("keeps the wrapper a native view locked and unlocked, so locking never reparents the app", () => {
        for (const os of ["android", "ios"]) {
            expect(appContentAccessibility(true, os).collapsable).toBe(false)
            expect(appContentAccessibility(false, os).collapsable).toBe(false)
        }
    })

    // the cover shows exactly while `locked` (app-lock-screen.tsx); every way into the cover must hide the app on Android
    const hiddenOnAndroid = (state: AppLockState) => {
        const props = appContentAccessibility(state.locked, "android")
        return props.style.display === "none" && props.importantForAccessibility === "no-hide-descendants"
    }

    it("hides the app in every state with the cover up: cold start, back after a minute, prompt open, prompt cancelled", () => {
        expect(hiddenOnAndroid(initialAppLockState(true))).toBe(true)
        const away = run(unlocked, { type: "hidden", now: 0 }, { type: "shown", now: APP_LOCK_AFTER_MS + 1, enabled: true })
        expect(away.locked).toBe(true)
        expect(hiddenOnAndroid(away)).toBe(true)
        // the prompt opens as the cover appears; on Android its PIN screen sends the app to background and back
        const prompting = run(away, { type: "prompt", open: true, now: APP_LOCK_AFTER_MS + 2, appActive: true },
            { type: "hidden", now: APP_LOCK_AFTER_MS + 3 })
        expect(hiddenOnAndroid(prompting)).toBe(true)
        // cancelled (Esc / back): the prompt closes while the app comes back, still locked
        const cancelled = run(prompting, { type: "prompt", open: false, now: APP_LOCK_AFTER_MS + 4, appActive: false },
            { type: "shown", now: APP_LOCK_AFTER_MS + 5, enabled: true })
        expect(cancelled.locked).toBe(true)
        expect(hiddenOnAndroid(cancelled)).toBe(true)
        const cancelledInFront = run(prompting, { type: "shown", now: APP_LOCK_AFTER_MS + 4, enabled: true },
            { type: "prompt", open: false, now: APP_LOCK_AFTER_MS + 5, appActive: true })
        expect(hiddenOnAndroid(cancelledInFront)).toBe(true)
    })

    it("follows the rule: the minute away locks and hides, unlocking shows the app again", () => {
        const away = run(unlocked, { type: "hidden", now: 0 }, { type: "shown", now: APP_LOCK_AFTER_MS + 1, enabled: true })
        expect(appContentAccessibility(away.locked, "android").style.display).toBe("none")
        const open = run(away, { type: "unlock" })
        expect(appContentAccessibility(open.locked, "android")).toMatchObject({ importantForAccessibility: "auto", style: { display: "flex" } })
        expect(appLockHidesRecents(true, open.locked)).toBe(true)
    })
})
