import { prefersReducedMotion } from "@/lib/motion"
import { HIDE_IMAGES } from "@/types/constants"
import React, { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react"


type ImageProps = React.ImgHTMLAttributes<HTMLImageElement> & {
    fill?: boolean
    priority?: boolean
    overrideSrc?: string
    quality?: number | string
    placeholder?: string
    blurDataURL?: string
    sizes?: string
    allowGif?: boolean
}

export const SeaImage = forwardRef<HTMLImageElement, ImageProps & { isExternal?: boolean }>(
    ({ isExternal, fill, priority, quality, placeholder, sizes, allowGif, ...props }, ref) => {
        const [hasError, setHasError] = useState(false)

        useEffect(() => {
            setHasError(false)
        }, [props.src])

        if (HIDE_IMAGES) {
            return <Image
                ref={ref}
                {...props}
                src="/no-cover.png"
                className={props.className}
                alt={props.alt || "cover"}
                fill={fill}
            />
        }

        const blocked = isExternal && props.src && typeof props.src === "string" && !(
            props.src.endsWith(".png")
            || props.src.endsWith(".jpg")
            || props.src.endsWith(".jpeg")
            || props.src.endsWith(".avif")
            || props.src.endsWith(".webp")
            || props.src.endsWith(".ico")
            || (allowGif && props.src.endsWith(".gif"))
        )

        const effectiveOverride = (blocked || hasError) ? "/no-cover.png" : props.overrideSrc

        function handleError() {
            setHasError(true)
            console.warn(`Error loading image ${props.src}`)
        }

        return <Image
            ref={ref}
            {...props}
            src={props.src || ""}
            alt={props.alt || ""}
            fill={fill}
            priority={priority}
            placeholder={placeholder}
            overrideSrc={effectiveOverride}
            onError={handleError}
        />
    },
)

SeaImage.displayName = "SeaImage"

interface _ImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    src: string | any
    alt: string
    width?: number | string
    height?: number | string
    fill?: boolean
    quality?: number | string
    priority?: boolean
    loader?: any
    placeholder?: string
    blurDataURL?: string
    unoptimized?: boolean
    onLoadingComplete?: (img: HTMLImageElement) => void
    layout?: string
    objectFit?: string
    overrideSrc?: string
}

const Image = forwardRef<HTMLImageElement, _ImageProps>((
    {
        src,
        alt,
        width,
        height,
        fill,
        style,
        className,
        quality,
        priority,
        loader,
        placeholder,
        blurDataURL,
        unoptimized,
        onLoadingComplete,
        layout,
        objectFit,
        overrideSrc,
        onLoad,
        ...props
    },
    ref,
) => {
    const [isLoaded, setIsLoaded] = useState(false)
    const imgRef = useRef<HTMLImageElement | null>(null)
    const setImgRef = React.useCallback((node: HTMLImageElement | null) => {
        imgRef.current = node
        if (typeof ref === "function") ref(node)
        else if (ref) ref.current = node
    }, [ref])
    // A picture that is not there yet when its frame is drawn fades in once it arrives; one from the memory cache is
    // complete at once and simply shows (a revisited screen does not fade its covers again).
    const fadeIn = useRef(false)
    // Such a picture stays hidden (an inline opacity, no layer per cover) until its load event starts the fade. The WebView
    // drew a picture that arrived while its screen was built a frame before that event ran, so it flashed in fully, vanished
    // and faded in (tablet and phone).
    const held = useRef(false)
    const show = (img: HTMLImageElement) => {
        if (!held.current) return
        held.current = false
        img.style.removeProperty("opacity")
    }

    const isStaticImport = typeof src === "object" && src !== null && "src" in src
    const imageSrc = overrideSrc || (isStaticImport ? src.src : src)

    const staticBlur = isStaticImport ? src.blurDataURL : undefined

    useLayoutEffect(() => {
        const img = imgRef.current
        fadeIn.current = !!img && !(img.complete && img.naturalWidth > 0)
        if (!img) return
        show(img)
        if (fadeIn.current && !prefersReducedMotion() && !document.documentElement.hasAttribute("data-entry-cover-transition")) {
            held.current = true
            img.style.opacity = "0"
            img.addEventListener("error", () => show(img), { once: true })
        }
    }, [imageSrc])

    useEffect(() => {
        setIsLoaded(false)
    }, [imageSrc])

    const blurUrl = (placeholder && placeholder !== "blur" && placeholder !== "empty")
        ? placeholder
        : (placeholder === "blur" ? (blurDataURL || staticBlur) : undefined)

    const fillStyle: React.CSSProperties = fill ? {
        position: "absolute",
        height: "100%",
        width: "100%",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        color: "transparent",
    } : {}

    const placeholderStyle: React.CSSProperties = (blurUrl && !isLoaded) ? {
        backgroundImage: `url("${blurUrl}")`,
        backgroundSize: objectFit === "contain" ? "contain" : "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
    } : {}

    const imageWidth = fill ? undefined : (width || (isStaticImport ? src.width : undefined))
    const imageHeight = fill ? undefined : (height || (isStaticImport ? src.height : undefined))

    return (
        <img
            ref={setImgRef}
            src={imageSrc}
            alt={alt}
            width={imageWidth}
            height={imageHeight}
            decoding="async"
            loading={priority ? "eager" : "lazy"}
            className={className}
            style={{
                ...fillStyle,
                ...placeholderStyle,
                ...(objectFit ? { objectFit: objectFit as any } : {}),
                ...style,
            }}
            onLoad={(e) => {
                setIsLoaded(true)
                // Not the page cover a tapped cover flies into (entry-cover-transition.ts).
                if (fadeIn.current && !prefersReducedMotion() && !document.documentElement.hasAttribute("data-entry-cover-transition")) {
                    fadeIn.current = false
                    e.currentTarget.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: "ease-out" })
                }
                show(e.currentTarget)
                onLoad?.(e)
            }}
            {...props}
        />
    )
})

Image.displayName = "Image"
