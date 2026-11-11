import { buildSeaQuery } from "@/api/client/requests"
import type { MobileStorageAccess_Variables } from "@/api/generated/endpoint.types"
import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { MobileStorage_Access } from "@/api/generated/types"
import { accessProblem, androidUserId, type FolderPickProblem, treeUriToPath } from "@/lib/folder-path"
import * as Application from "expo-application"
import { Directory, Paths } from "expo-file-system"
import * as IntentLauncher from "expo-intent-launcher"
import { PermissionsAndroid, Platform } from "react-native"

/*
 * "Choose folder" for the library and manga folders (old MainActivity.startFolderPicker / onFolderPicked). The Go server
 * reads plain paths, so it needs "All files access": the server checks it (backend/internal/mobilestorage), the app opens
 * the system screen for it and checks again on return, then opens the folder picker and turns the tree URI into a path.
 */

export type FolderPickResult = { path: string } | { problem: FolderPickProblem }

const needsAllFiles = () => Platform.OS === "android" && Number(Platform.Version) >= 30

async function serverAccess(path: string, password: string | undefined) {
    return await buildSeaQuery<MobileStorage_Access, MobileStorageAccess_Variables>({
        endpoint: API_ENDPOINTS.MOBILE_STORAGE.MobileStorageAccess.endpoint,
        method: API_ENDPOINTS.MOBILE_STORAGE.MobileStorageAccess.methods[0],
        data: { path },
        password,
    }).catch(() => undefined) ?? null
}

async function openAllFilesSettings() {
    try {
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
            { data: `package:${Application.applicationId}` })
        return true
    }
    catch {
        // some systems only have the list of all apps
        try {
            await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_ALL_FILES_ACCESS_PERMISSION)
            return true
        }
        catch {
            return false
        }
    }
}

/** True when the server may read shared storage; asks for it first (Android 11+: system screen, older: permission). */
async function ensureFileAccess(storage: string, password: string | undefined) {
    if (Platform.OS !== "android") return true
    if (!needsAllFiles()) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE).catch(() => null)
        return result === PermissionsAndroid.RESULTS.GRANTED
    }
    if ((await serverAccess(storage, password))?.allFilesAccess) return true
    // the promise settles when the user comes back from the settings screen
    if (!(await openAllFilesSettings())) return false
    return !!(await serverAccess(storage, password))?.allFilesAccess
}

export async function pickServerFolder(password: string | undefined): Promise<FolderPickResult> {
    const userId = androidUserId(Paths.document.uri)
    if (!(await ensureFileAccess(`/storage/emulated/${userId}`, password))) return { problem: "permission" }
    let uri: string
    try {
        uri = (await Directory.pickDirectoryAsync()).uri
    }
    catch (error) {
        return { problem: (error as { code?: string } | null)?.code === "ERR_PICKER_CANCELLED" ? "cancelled" : "unavailable" }
    }
    const path = treeUriToPath(uri, userId)
    if (!path) return { problem: "not-local" }
    const problem = accessProblem(await serverAccess(path, password), needsAllFiles())
    return problem ? { problem } : { path }
}
