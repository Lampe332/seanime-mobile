import React from "react"
// Extensions tab harness: URL-backed router, a fixture extension server with recorded calls, the plugin permission websocket and toasts.
const w = window as any
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())
window.addEventListener("popstate", notify)
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
export const useRouter = () => ({ push: (href: string) => { history.pushState(null, "", href); w.routes.push(href); notify() } })
export const useSearchParams = () => new URLSearchParams(React.useSyncExternalStore(subscribe, () => location.search))
export const usePathname = () => React.useSyncExternalStore(subscribe, () => location.pathname)
// The tour overlay reads the route from TanStack Router; the harness has no router.
export const useLocation = () => ({ pathname: usePathname(), search: location.search })
export const useNavigate = () => async ({ to }: { to: string }) => { history.pushState(null, "", to); w.routes.push(to); notify() }

export const SeaLink = React.forwardRef<HTMLAnchorElement, any>(({ href, warmEntryOnViewport, bypassEntryPreloadBudget, resetScroll, onClick, ...props }, ref) =>
    <a ref={ref} href={href} {...props} onClick={event => {
        onClick?.(event)
        if (event.defaultPrevented || !href) return
        event.preventDefault(); history.pushState(null, "", href); w.routes.push(href); notify()
    }} />)
export const CustomLibraryBanner = () => <div data-desktop-banner />

const record = (kind: string) => (message: any) => { w.toasts.push([kind, String(message)]) }
export const toast = Object.assign(record("default"), { success: record("success"), info: record("info"), warning: record("warning"), error: record("error") })

// The fixture server: window.server holds the lists; every change bumps a version so hooks re-read it.
let version = 0
const serverListeners = new Set<() => void>()
const emit = () => { version++; serverListeners.forEach(listener => listener()) }
const useServer = () => React.useSyncExternalStore(cb => { serverListeners.add(cb); return () => serverListeners.delete(cb) }, () => version)
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const s = () => w.server
const replaceAll = (patch: any) => { s().all = { ...s().all, ...patch }; emit() }
const without = (list: any[] | undefined, id: string) => (list ?? []).filter((item: any) => item.id !== id)
w.serverEmit = emit

export const usePluginWithIssuesCount = () => 0
// The setup tour asks whether a streaming source exists; the page under test starts it by hand.
const noProviders = { data: [], isSuccess: true }
export const useListOnlinestreamProviderExtensions = () => noProviders

export function useGetAllExtensions(withUpdates: boolean) {
    useServer()
    const server = s()
    React.useEffect(() => {
        if (withUpdates && !server.checkState) startCheck()
    }, [withUpdates])
    const checking = withUpdates && server.checkState !== "done"
    const status = server.allStatus
    return {
        data: status === "ok" && !checking ? server.all : undefined,
        isPending: status === "loading" || checking,
        isFetching: status === "loading" || checking,
        isError: status === "error",
        refetch: async () => { server.refetches++; if (withUpdates) startCheck() },
    }
}
function startCheck() {
    s().checkState = "fetching"
    s().checks++
    emit()
    setTimeout(() => { s().checkState = "done"; replaceAll({ hasUpdate: s().updatesOnCheck }) }, 400)
}

export function useGetMarketplaceExtensions(url?: string) {
    useServer()
    const server = s()
    const status = server.marketStatus
    return {
        data: status === "ok" ? server.market[url ?? ""] : undefined,
        isPending: status === "loading", isFetching: status === "loading", isError: status === "error",
        refetch: async () => { server.marketRefetches.push(url ?? "") },
    }
}

function useFakeMutation<V, R>(name: string, run: (vars: V) => R) {
    const [state, setState] = React.useState<{ isPending: boolean, data: R | undefined }>({ isPending: false, data: undefined })
    const mutateAsync = async (vars: V) => {
        w.calls.push([name, vars])
        setState({ isPending: true, data: undefined })
        await sleep(150)
        const data = run(vars)
        setState({ isPending: false, data })
        return data
    }
    return {
        ...state,
        mutateAsync,
        mutate: (vars: V, options?: { onSuccess?: (data: R) => void }) => { void mutateAsync(vars).then(data => options?.onSuccess?.(data)) },
        reset: () => setState({ isPending: false, data: undefined }),
    }
}

export const useInstallExternalExtension = () => useFakeMutation("install", ({ manifestUri }: any) => {
    const listed = Object.values(s().market).flat().find((extension: any) => extension.manifestURI === manifestUri) as any
    const all = s().all
    if (listed) replaceAll({ extensions: [...without(all.extensions, listed.id), listed] })
    replaceAll({ hasUpdate: (s().all.hasUpdate ?? []).filter((update: any) => update.manifestURI !== manifestUri) })
    return { message: "Extension installed successfully." }
})
export const useUninstallExternalExtension = () => useFakeMutation("uninstall", ({ id }: any) => {
    const all = s().all
    replaceAll({ extensions: without(all.extensions, id), disabledExtensions: without(all.disabledExtensions, id), invalidExtensions: without(all.invalidExtensions, id) })
    return true
})
export const useSetExternalExtensionDisabled = () => useFakeMutation("disable", ({ id, disabled }: any) => {
    const all = s().all
    const extension = [...(all.extensions ?? []), ...(all.disabledExtensions ?? [])].find((item: any) => item.id === id)
    replaceAll(disabled ? { extensions: without(all.extensions, id), disabledExtensions: [...(all.disabledExtensions ?? []), extension] }
        : { disabledExtensions: without(all.disabledExtensions, id), extensions: [...(all.extensions ?? []), extension] })
    return true
})
export const useReloadExternalExtension = () => useFakeMutation("reload", () => true)
export const useFetchExternalExtensionData = (_id?: string | null) => useFakeMutation("fetch", ({ manifestUri }: any) => s().fetchResults[manifestUri])
export const useInstallExternalExtensionRepository = () => useFakeMutation("repository", ({ install }: any) => {
    if (install) replaceAll({ extensions: [...(s().all.extensions ?? []), ...s().repository] })
    return { extensions: s().repository, message: "" }
})
export const useGrantPluginPermissions = () => useFakeMutation("grant", ({ id, clientId }: any) => {
    if (!clientId) {
        setTimeout(() => w.wsSend("grant-plugin-permission-check", `${id}$$$challenge:4711`), 50)
        return false
    }
    const all = s().all
    const item = all.invalidExtensions.find((entry: any) => entry.id === id)
    replaceAll({ invalidExtensions: without(all.invalidExtensions, id), extensions: [...all.extensions, item.extension] })
    return true
})
export const useGetExtensionPayload = (_id: string) => ({ data: "export function init() {}", isLoading: false })
export const useUpdateExtensionCode = () => useFakeMutation("edit-code", () => true)
export const useGetExtensionUserConfig = (id: string) => {
    const extension = s().all.extensions.find((item: any) => item.id === id)
    return { data: { userConfig: extension?.userConfig, savedUserConfig: { version: 1, values: {} } }, isLoading: false }
}
export const useSaveExtensionUserConfig = () => useFakeMutation("save-config", () => true)

// Plugin permission challenge: the page listens, the test (or the grant stub) sends.
const socket = new Map<string, Set<(payload: any) => void>>()
w.wsSend = (type: string, payload: any) => socket.get(type)?.forEach(listener => listener(payload))
export function useWebsocketMessageListener({ type, onMessage }: { type: string, onMessage: (payload: any) => void }) {
    const latest = React.useRef(onMessage)
    latest.current = onMessage
    React.useEffect(() => {
        const listener = (payload: any) => latest.current(payload)
        if (!socket.has(type)) socket.set(type, new Set())
        socket.get(type)!.add(listener)
        return () => { socket.get(type)!.delete(listener) }
    }, [type])
}
