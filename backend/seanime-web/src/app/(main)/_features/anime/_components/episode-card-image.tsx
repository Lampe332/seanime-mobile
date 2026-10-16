import { SeaImage } from "@/components/shared/sea-image"
import { cn } from "@/components/ui/core/styling"
import React from "react"

type EpisodeCardImageProps = React.ComponentProps<typeof SeaImage> & {
    loadedClassName?: string
    faster?: boolean
    disabled?: boolean
}

export function EpisodeCardImage(props: EpisodeCardImageProps) {
    const {
        className,
        loadedClassName = "opacity-100 scale-100",
        src,
        onLoad,
        faster,
        disabled,
        ...rest
    } = props

    const [loaded, setLoaded] = React.useState(disabled)
    const imageRef = React.useRef<HTMLImageElement | null>(null)

    React.useEffect(() => {
        setLoaded(disabled)
    }, [src])

    React.useEffect(() => {
        const image = imageRef.current
        if (!image) return

        if (image.complete && image.naturalWidth > 0) {
            setLoaded(true)
        }
    }, [src])

    return (
        <>
            <span
                aria-hidden="true"
                className={cn(
                    "absolute inset-0 z-0 bg-gradient-to-br from-gray-900/80 via-gray-800/70 to-gray-950/80",
                    "transition-opacity duration-300 ease-out motion-reduce:transition-none",
                    loaded ? "opacity-0" : "opacity-100",
                )}
            />
            <SeaImage
                ref={imageRef}
                {...rest}
                src={src}
                onLoad={(event) => {
                    setLoaded(true)
                    onLoad?.(event)
                }}
                className={cn(
                    className,
                    "transition-[opacity,transform] ease-out motion-reduce:transition-none",
                    faster ? "duration-200" : "duration-400",
                    loaded ? loadedClassName : "opacity-0 scale-[0.97]",
                )}
            />
        </>
    )
}
