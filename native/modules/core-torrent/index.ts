// geschrieben nach: öffentlicher Doku von Nitro Modules (NitroModules.createHybridObject); keine Vorlage
import { NitroModules } from "react-native-nitro-modules"
import type { CoreTorrent } from "./src/CoreTorrent.nitro"

export type { CoreTorrent, CoreTorrentFile, CoreTorrentSettings, CoreTorrentStatus } from "./src/CoreTorrent.nitro"

/**
 * The one BitTorrent session of the app, on a thread of its own (cpp/TorrentCore.cpp, shared C++ around libtorrent).
 * Used through src/api/client/core-torrent.ts only.
 */
export default NitroModules.createHybridObject<CoreTorrent>("CoreTorrent")
