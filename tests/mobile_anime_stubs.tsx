import React from "react"
export const useServerStatus = () => ({ settings: { library: { enableWatchContinuity: true } } })
export const useThemeSettings = () => ({})
export const useEpisodeSpoilerState = () => ({})
export const getImageUrl = (s: string) => s
export const SeaImage = React.forwardRef<HTMLImageElement, any>(({fill,quality,sizes,placeholder,priority,loadedClassName,...props}, ref) => <img ref={ref} {...props} />)
// AniList list entry harness: record mutations instead of calling the server.
const calls = () => ((window as any).anilistCalls ??= [])
export const useCurrentUser = () => ({ viewer: { name: "harness" } })
export const useEditAnilistListEntry = () => ({ mutate: (v: any) => calls().push(["edit", v]), isPending: false, isSuccess: false, reset: () => {} })
export const useDeleteAnilistListEntry = () => ({ mutate: (v: any) => calls().push(["delete", v]), isPending: false })
export const useUpdateAnimeEntryRepeat = () => ({ mutate: (v: any) => calls().push(["repeat", v]), isPending: false })
export const PluginWebviewSlot = () => null
export const useRefreshAnimeCollection = () => () => {}
export const useIsSimulatedUser = () => false
