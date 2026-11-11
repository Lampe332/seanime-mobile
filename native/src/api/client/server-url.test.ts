import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import appVariants from "../../../app-variants.json"
import { APP_VARIANT, APP_VARIANT_NAME } from "../../lib/app-variant"
import { getServerBaseUrl, SERVER_PORT } from "./server-url"

const native = join(__dirname, "../../..")
const read = (path: string) => readFileSync(join(native, path), "utf8")
const require = createRequire(import.meta.url)

// The port is used twice on purpose (logic tests import the API layer without the native module): here and in the
// Kotlin service that starts the Go server. Both must come from app-variants.json, so the test app and the release
// (E6: 43211, the port of the app it replaces) can never talk to a server on another port.
describe("server port", () => {
    it("is the port of the variant in app-variants.json", () => {
        expect(APP_VARIANT_NAME).toBe(appVariants.current)
        expect(SERVER_PORT).toBe(APP_VARIANT.serverPort)
        expect(getServerBaseUrl()).toBe(`http://127.0.0.1:${SERVER_PORT}`)
    })

    it("test app 43212 next to the real app, release 43211 like Seanime Mobile 2.0.33", () => {
        expect(appVariants.current).toBe("test")
        expect(appVariants.variants.test.serverPort).toBe(43212)
        expect(appVariants.variants.release.serverPort).toBe(43211)
    })

    it("the Kotlin service takes it from BuildConfig, filled from the same variant at prebuild", () => {
        const kotlin = read("modules/seanime-server/android/src/main/java/com/seanime/server/SeanimeServerService.kt")
        expect(kotlin).toMatch(/const val PORT = BuildConfig\.SERVER_PORT\b/)
        expect(kotlin).not.toMatch(/\b4321\d\b/)
        const gradle = read("modules/seanime-server/android/build.gradle")
        expect(gradle).toMatch(/findProperty\('seanime\.serverPort'\)/)
        expect(gradle).toMatch(/buildConfigField "int", "SERVER_PORT", serverPort\.toString\(\)/)

        // app.config.js hands the variant's port to plugins/with-server-port.js, which writes seanime.serverPort
        const appConfig = require(join(native, "app.config.js")) as (ctx: { config: any }) => any
        const config = appConfig({ config: { plugins: [], android: { adaptiveIcon: {} } } })
        const plugin = config.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "./plugins/with-server-port")
        expect(plugin?.[1]).toEqual({ port: SERVER_PORT })
        expect(read("plugins/with-server-port.js")).toMatch(/const KEY = 'seanime\.serverPort'/)
    })
})
