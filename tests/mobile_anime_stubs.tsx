import React from "react"
export const useServerStatus = () => ({ settings: { library: { enableWatchContinuity: true } } })
export const useThemeSettings = () => ({})
export const useEpisodeSpoilerState = () => ({})
export const getImageUrl = (s: string) => s
export const SeaImage = React.forwardRef<HTMLImageElement, any>(({fill,quality,sizes,placeholder,priority,loadedClassName,...props}, ref) => <img ref={ref} {...props} />)
