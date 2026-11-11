import { APP_VARIANT } from "@/lib/app-variant"

/**
 * Port of the app's own Go server: 43212 in the test package com.seanime.app.native, 43211 in the release that replaces
 * com.seanime.app.local (E6). It comes from native/app-variants.json, like `SeanimeServerService.PORT` on the Kotlin side
 * (via app.config.js → plugins/with-server-port.js → BuildConfig). A plain value so logic tests can import the API layer
 * without the native module.
 */
export const SERVER_PORT = APP_VARIANT.serverPort

export const SERVER_HOST = `127.0.0.1:${SERVER_PORT}`

/** The web app took the host of the page it was served from; the native app always talks to its own server on 127.0.0.1. */
export function getServerBaseUrl(removeProtocol: boolean = false): string {
    return removeProtocol ? SERVER_HOST : `http://${SERVER_HOST}`
}
