/*
 * When the app comes to the front, its Go server may be gone while the app process lived on: the notification's "Exit"
 * (which then says "Open the app to restart"), a crash, or the tablet switching to another Android user
 * (SeanimeServerService stops on ACTION_USER_BACKGROUND, so the other profile can take the shared port). The old app
 * only started the service in MainActivity.onCreate, so coming back to a living app kept it without a server.
 */

/** Server states of modules/seanime-server (ServerState.kt) after which nothing runs any more. */
export function serverNeedsStart(state: string | null | undefined) {
    return state === "stopped" || state === "error" || state === "idle"
}
