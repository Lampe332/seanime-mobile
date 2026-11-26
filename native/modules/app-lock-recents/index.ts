// geschrieben nach: Muster von modules/core-sodium/index.ts (lokales Expo-Modul); requireOptionalNativeModule, weil das Modul nur für Android gebaut wird
import { NativeModule, requireOptionalNativeModule } from "expo"

/*
 * The app lock's guard for the recent apps screen (Kotlin, android/): while hidden, recents shows no picture of the app.
 * Android only; elsewhere the module is missing and the app lock works without it. Used by src/lib/app-lock/app-lock.ts.
 */

declare class SeanimeAppLockRecentsModule extends NativeModule {
    setRecentsHidden(hidden: boolean): Promise<void>
}

export default requireOptionalNativeModule<SeanimeAppLockRecentsModule>("SeanimeAppLockRecents")
