// geschrieben nach: Plan „Eigener Kern" Phase 7c-1 und 7b (docs/EIGENER-KERN.md §4r), Gegenstück zu den eigenen Modulen native/modules/core-cast und core-torrent (Ausgang ins WLAN); keine Vorlage
import { type BlockingWatch, type CastOutlet, type CastSearcher, SSDP_HOST, SSDP_PORT, castForward, castForwardClose, castKindOf, castSoap, searchRenderers } from "@/core"
import { logger } from "@/lib/helpers/debug"
import { Platform } from "react-native"

const log = (text: string) => logger("CoreCast").info(text)

/** The device's search for the core's area `cast`: the module's UDP search, with Android's multicast lock held meanwhile */
export async function castSearcherFor(watch?: BlockingWatch): Promise<CastSearcher> {
    const { coreCast, coreCastLock } = await import("../../../modules/core-cast")
    const cast = coreCast()
    const lock = Platform.OS === "android" ? coreCastLock() : null
    const search = async (message: string, waitMs: number) => {
        const held = lock?.hold() ?? false
        try {
            return await cast.search(message, SSDP_HOST, SSDP_PORT, waitMs)
        }
        finally {
            if (held) lock?.release()
        }
    }
    return { search: watch ? watch.waiting(search, "cast search") : search }
}

/**
 * Test and scratch app only (`core?cast=discover`): searches the home network, logs each TV with its control addresses
 * and asks it, reading only, for its transport state and volume. Nothing is played, nothing changed.
 */
export async function runCoreCastCheck(): Promise<void> {
    const started = Date.now()
    try {
        const environment = {
            fetch: async (url: string, init: { method?: string, headers?: Record<string, string>, body?: string, signal: AbortSignal }) => {
                const response = await fetch(url, init)
                return { status: response.status, headers: response.headers, text: () => response.text() }
            },
            cast: () => castSearcherFor(),
        }
        const devices = await searchRenderers(environment)
        log(`cast check: ${devices.length} renderer(s) in ${Date.now() - started} ms`)
        for (const device of devices) {
            log(`cast check: "${device.name}" (${device.manufacturer} ${device.model}, kind ${castKindOf(device)}) AVTransport ${device.avTransport?.controlUrl ?? "-"} RenderingControl ${device.renderingControl?.controlUrl ?? "-"}`)
            if (device.avTransport) {
                const info = await castSoap(environment, device.avTransport, "GetTransportInfo", [["InstanceID", 0]]).then(values => JSON.stringify(values), error => `failed: ${String(error)}`)
                log(`cast check: GetTransportInfo ${info}`)
            }
            if (device.renderingControl) {
                const volume = await castSoap(environment, device.renderingControl, "GetVolume", [["InstanceID", 0], ["Channel", "Master"]]).then(values => JSON.stringify(values), error => `failed: ${String(error)}`)
                log(`cast check: GetVolume ${volume}`)
            }
        }
        log(`cast check: done in ${Date.now() - started} ms`)
    }
    catch (error) {
        logger("CoreCast").error(`cast check failed after ${Date.now() - started} ms: ${String(error)}`)
    }
}

/** A share's address with its token hidden, for the log */
export const withoutToken = (address: string) => address.replace(/\/[0-9a-f]{64}\//, "/<token>/")

/**
 * The outlet into the network for the core's area `cast` (phase 7b): the second port of the torrent module's outlet. A
 * file needs no torrent session; every call is a wait the watch of the screens' thread sees.
 */
export function castOutletFor(watch?: BlockingWatch): CastOutlet {
    const client = () => import("./core-torrent").then(module => module.deviceTorrent())
    const waiting = <Args extends unknown[], Result>(work: (...args: Args) => Promise<Result>, what: string) => (watch ? watch.waiting(work, what) : work)
    return {
        shareFile: waiting(async (path: string, toward: string) => {
            const address = await (await client()).shareFile(path, toward)
            log(`outlet: a file shared into the network at ${withoutToken(address)}`)
            return address
        }, "cast share"),
        shareTorrent: waiting(async (infoHash: string, index: number, toward: string) => {
            const address = await (await client()).shareTorrent(infoHash, index, toward)
            log(`outlet: file ${index} of a torrent shared into the network at ${withoutToken(address)}`)
            return address
        }, "cast share"),
        unshare: waiting(async () => {
            await (await client()).unshare()
            log("outlet: shares into the network ended")
        }, "cast unshare"),
    }
}

/** The check file: lines of 32 bytes, `<10-digit number> seanime outlet check\n`, 4 MiB, then `end\n` */
export const OUTLET_CHECK_LINES = 131_072
export function outletCheckText(): string {
    const lines: string[] = []
    for (let line = 0; line < OUTLET_CHECK_LINES; line++) lines.push(`${String(line).padStart(10, "0")} seanime outlet check\n`)
    return `${lines.join("")}end\n`
}

/** How long the check keeps its share open for the PC */
const OUTLET_CHECK_HOLD_MS = 120_000

/**
 * Test and scratch app only (`core?cast=outlet-check`): writes a check file of its own into the app's documents, shares
 * it into the Wi-Fi through the area `cast` (as for a Google Cast TV, `forward`), logs the WHOLE address (with the token:
 * this link only, so a PC in the same Wi-Fi can read it), keeps it open for 2 minutes, then `forward-close`, and the
 * file is deleted. Nothing is played, no TV is asked.
 */
export async function runCoreCastOutletCheck(): Promise<void> {
    const started = Date.now()
    const { documentDirectory, writeAsStringAsync, deleteAsync } = await import("expo-file-system/legacy")
    const uri = `${documentDirectory ?? ""}core-outlet-check.mkv`
    const environment = { castOutlet: async () => castOutletFor() }
    try {
        const text = outletCheckText()
        await writeAsStringAsync(uri, text)
        log(`outlet check: file of ${text.length} bytes written`)
        const address = await castForward({ body: { host: "", url: uri } }, environment)
        log(`outlet check: shared at ${address} for ${OUTLET_CHECK_HOLD_MS / 1000} s`)
        await new Promise(resolve => setTimeout(resolve, OUTLET_CHECK_HOLD_MS))
        await castForwardClose(environment)
        log(`outlet check: unshared after ${Date.now() - started} ms`)
    }
    catch (error) {
        logger("CoreCast").error(`outlet check failed after ${Date.now() - started} ms: ${String(error)}`)
        await castForwardClose(environment).catch(() => undefined)
    }
    finally {
        await deleteAsync(uri, { idempotent: true }).catch(() => undefined)
    }
}
