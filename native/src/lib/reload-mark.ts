// geschrieben nach: S22 device test 4.2.0 (the launch link ran a second time after the import restart)
import { storage } from "@/lib/storage"

/**
 * reloadAppAsync starts the JS again inside the same activity, so Expo Router hands the activity's launch link to
 * +native-intent.tsx a second time (seen: `core?sodium=selftest` showed its dialog again after the account import).
 * Callers mark the restart first; the next JS start takes the mark once and leaves that launch link out.
 */
const KEY = "sea-reload-skip-launch-link"

/** Called right before reloadAppAsync. */
export function markAppReload() {
    storage.set(KEY, true)
}

/** True when this JS start is a reload of the app; reads and clears the mark (once per start). */
export function takeAppReloadMark(): boolean {
    const marked = storage.getBoolean(KEY) === true
    if (marked) storage.remove(KEY)
    return marked
}
