import { describe, expect, it } from "vitest"
// the config plugin is CommonJS (plugins/), tested here because vitest only runs src/**
import plugin from "../../plugins/with-single-react-root"

const { addSingleReactRoot } = plugin as unknown as { addSingleReactRoot: (src: string) => string }

// shape of the MainActivity.kt that expo prebuild (SDK 58) writes, with the splash screen block in front of super.onCreate
const MAIN_ACTIVITY = `package com.seanime.app.nativeapp
import expo.modules.splashscreen.SplashScreenManager

import com.facebook.react.ReactActivity

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
  }
}
`

describe("with-single-react-root", () => {
    it("stops an older Activity's React surface before onCreate loads the new one", () => {
        const out = addSingleReactRoot(MAIN_ACTIVITY)
        expect(out).toContain("import java.lang.ref.WeakReference")
        expect(out).toContain("private var liveActivity: WeakReference<MainActivity>? = null")
        const unload = out.indexOf("?.reactDelegate?.unloadApp()")
        const remember = out.indexOf("liveActivity = WeakReference(this)")
        const superCreate = out.indexOf("super.onCreate(null)")
        expect(unload).toBeGreaterThan(out.indexOf("SplashScreenManager.registerOnActivity(this)"))
        expect(unload).toBeLessThan(remember)
        expect(remember).toBeLessThan(superCreate)
        // only another Activity, never itself
        expect(out).toContain("takeIf { it !== this }")
    })

    it("is applied once", () => {
        const once = addSingleReactRoot(MAIN_ACTIVITY)
        expect(addSingleReactRoot(once)).toBe(once)
    })

    it("refuses a MainActivity it does not know", () => {
        expect(() => addSingleReactRoot("package x\nclass Other\n")).toThrow(/unexpected MainActivity/)
    })
})
