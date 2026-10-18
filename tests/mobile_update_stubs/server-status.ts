export function useServerStatus() {
    return { settings: { library: { disableUpdateCheck: false } } }
}
export function useSetServerStatus() { return () => undefined }
