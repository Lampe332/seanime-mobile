// geschrieben nach: öffentlicher Doku von Nitro Modules (NitroModules.createHybridObject); keine Vorlage
import { NitroModules } from "react-native-nitro-modules"
import type { CoreSandboxFactory } from "./src/CoreSandbox.nitro"

export type { CoreSandboxBox, CoreSandboxFactory } from "./src/CoreSandbox.nitro"

/**
 * QuickJS sandboxes, each on a thread of its own (cpp/SandboxCore.cpp, shared C++ around quickjs-ng). Used through the
 * core only: src/core/extensions/sandbox/device-engine.ts, wired in src/api/client/core-sandbox.ts.
 */
export default NitroModules.createHybridObject<CoreSandboxFactory>("CoreSandboxFactory")
