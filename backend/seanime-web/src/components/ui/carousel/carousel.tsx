import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { cva } from "class-variance-authority"
import { EmblaCarouselType } from "embla-carousel"
import AutoScroll from "embla-carousel-autoplay"
import useEmblaCarousel from "embla-carousel-react"
import * as React from "react"
import { IconButton } from "../button"
import { cn, defineStyleAnatomy } from "../core/styling"

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

const CarouselAnatomy = defineStyleAnatomy({
    root: cva([
        "UI-Carousel__root",
        "relative",
    ]),
    content: cva([
        "UI-Carousel__content",
        "overflow-hidden",
    ]),
    innerContent: cva([
        "UI-Carousel__innerContent",
        "flex",
    ], {
        variants: {
            gap: { none: "ml-0", sm: "-ml-2", md: "-ml-4", lg: "-ml-6", xl: "-ml-8" },
        },
    }),
    item: cva([
        "UI-Carousel__item",
        "min-w-0 shrink-0 grow-0 basis-full",
    ], {
        variants: {
            gap: { none: "pl-0", sm: "pl-2", md: "pl-4", lg: "pl-6", xl: "pl-8" },
        },
    }),
    button: cva([
        "UI-Carousel__button",
        "rounded-full z-[10]",
    ]),
    chevronIcon: cva([
        "UI-Carousel__chevronIcon",
        "size-6",
    ]),
})

/* -------------------------------------------------------------------------------------------------
 * Carousel
 * -----------------------------------------------------------------------------------------------*/

const __CarouselContext = React.createContext<CarouselContextProps | null>(null)

function useCarousel() {
    const context = React.useContext(__CarouselContext)

    if (!context) {
        throw new Error("useCarousel must be used within a <Carousel />")
    }

    return context
}

export type CarouselProps = {
    opts?: Parameters<typeof useEmblaCarousel>[0]
    gap?: "none" | "sm" | "md" | "lg" | "xl"
    autoScroll?: boolean
    carouselButtonContainerClass?: string
}

type CarouselContextProps = {
    carouselRef: ReturnType<typeof useEmblaCarousel>[0]
    api: ReturnType<typeof useEmblaCarousel>[1]
    scrollPrev: () => void
    scrollNext: () => void
    canScrollPrev: boolean
    canScrollNext: boolean
} & CarouselProps

export const Carousel = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & CarouselProps>((props, ref) => {

    const {
        opts,
        gap = "md",
        className,
        children,
        autoScroll,
        carouselButtonContainerClass,
        ...rest
    } = props

    const ts = useThemeSettings()

    const plugins = React.useMemo(() => (autoScroll && !ts.disableCarouselAutoScroll) ? [AutoScroll({
        delay: 5000,
        stopOnMouseEnter: true,
        stopOnInteraction: false,
    })] : [], [autoScroll, ts.disableCarouselAutoScroll])

    const [carouselRef, api] = useEmblaCarousel(opts, plugins)
    const [canScrollPrev, setCanScrollPrev] = React.useState(false)
    const [canScrollNext, setCanScrollNext] = React.useState(false)

    const onSelect = React.useCallback((api: EmblaCarouselType) => {
        if (!api) return

        setCanScrollPrev(api.canScrollPrev())
        setCanScrollNext(api.canScrollNext())
    }, [])

    const scrollPrev = React.useCallback(() => {
        api?.scrollPrev()
    }, [api])

    const scrollNext = React.useCallback(() => {
        api?.scrollNext()
    }, [api])

    const handleKeyDown = React.useCallback(
        (event: React.KeyboardEvent<HTMLDivElement>) => {
            if (event.key === "ArrowLeft") {
                event.preventDefault()
                scrollPrev()
            } else if (event.key === "ArrowRight") {
                event.preventDefault()
                scrollNext()
            }
        },
        [scrollPrev, scrollNext],
    )

    const localRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        if (!api) return

        onSelect(api)
        api.on("reInit", onSelect)
        api.on("select", onSelect)

        return () => {
            api.off("reInit", onSelect)
            api.off("select", onSelect)
        }
    }, [api, onSelect])

    React.useEffect(() => {
        if (!ref) return
        if (typeof ref === "function") {
            ref(localRef.current)
        } else {
            (ref as React.MutableRefObject<HTMLDivElement | null>).current = localRef.current
        }
    }, [ref])

    React.useEffect(() => {
        const container = localRef.current
        if (!container || !api) return

        let cooldown = false
        let cooldownTimeout: any = null
        let lastDirection = 0

        // touchpad or mouse on a tablet: a horizontal swipe (or alt + wheel) moves one snap
        const handleWheel = (e: WheelEvent) => {
            const isScrollIntent = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.altKey
            const delta = e.deltaX !== 0 ? e.deltaX : (e.altKey ? e.deltaY : 0)

            if (!isScrollIntent || delta === 0) return

            // Prevent default behavior to prevent page scroll/navigation
            e.preventDefault()

            // Reset cooldown if direction changed
            const direction = Math.sign(delta)
            if (direction !== lastDirection) {
                lastDirection = direction
                cooldown = false
                if (cooldownTimeout) {
                    clearTimeout(cooldownTimeout)
                    cooldownTimeout = null
                }
            }

            if (cooldown) return

            const absDelta = Math.abs(delta)
            const isSignificant = absDelta > 2

            if (isSignificant) {
                if (delta > 0) {
                    api.scrollNext()
                } else {
                    api.scrollPrev()
                }

                cooldown = true
                if (cooldownTimeout) clearTimeout(cooldownTimeout)
                cooldownTimeout = setTimeout(() => {
                    cooldown = false
                }, 80)
            }
        }

        container.addEventListener("wheel", handleWheel, { passive: false })

        return () => {
            container.removeEventListener("wheel", handleWheel)
            if (cooldownTimeout) clearTimeout(cooldownTimeout)
        }
    }, [api])

    return (
        <__CarouselContext.Provider
            value={{
                carouselRef,
                api: api,
                opts,
                gap,
                scrollPrev,
                scrollNext,
                canScrollPrev,
                canScrollNext,
            }}
        >
            <div
                ref={localRef}
                onKeyDownCapture={handleKeyDown}
                className={cn(CarouselAnatomy.root(), className)}
                role="region"
                aria-roledescription="carousel"
                {...rest}
            >
                {children}
                <CarouselButtons containerClass={carouselButtonContainerClass} />
            </div>
        </__CarouselContext.Provider>
    )
})
Carousel.displayName = "Carousel"

function CarouselButtons({ containerClass }: { containerClass?: string }) {
    const { scrollSnaps } = useDotButton()

    return (
        <>
            {scrollSnaps.length > 30 && <div className={cn("flex gap-2 absolute top-[-2rem] right-0", containerClass)}>
                <CarouselPrevious />
                <CarouselNext />
            </div>}
        </>
    )
}

/* -------------------------------------------------------------------------------------------------
 * CarouselContent
 * -----------------------------------------------------------------------------------------------*/

export type CarouselContentProps = React.ComponentPropsWithoutRef<"div"> & {
    contentClass?: string
}

export const CarouselContent = React.forwardRef<HTMLDivElement, CarouselContentProps>((props, ref) => {
    const { className, contentClass, ...rest } = props
    const { carouselRef, gap } = useCarousel()

    return (
        <div ref={carouselRef} className={cn(CarouselAnatomy.content(), contentClass)}>
            <div
                ref={ref}
                className={cn(CarouselAnatomy.innerContent({ gap }), className)}
                {...rest}
            />
        </div>
    )
})
CarouselContent.displayName = "CarouselContent"

/* -------------------------------------------------------------------------------------------------
 * CarouselItem
 * -----------------------------------------------------------------------------------------------*/

export type CarouselItemProps = React.ComponentPropsWithoutRef<"div">

export const CarouselItem = React.forwardRef<HTMLDivElement, CarouselItemProps>((props, ref) => {
    const { className, ...rest } = props
    const { gap } = useCarousel()

    return (
        <div
            ref={ref}
            role="group"
            aria-roledescription="slide"
            className={cn(CarouselAnatomy.item({ gap }), className)}
            {...rest}
        />
    )
})
CarouselItem.displayName = "CarouselItem"

/* -------------------------------------------------------------------------------------------------
 * CarouselPrevious
 * -----------------------------------------------------------------------------------------------*/

export type CarouselButtonProps = React.ComponentProps<typeof IconButton> & { chevronIconClass?: string }

const CarouselPrevious = React.forwardRef<HTMLButtonElement, CarouselButtonProps>((props, ref) => {
    const { className, chevronIconClass, intent = "gray-outline", ...rest } = props
    const { scrollPrev, canScrollPrev } = useCarousel()

    return (
        <IconButton
            ref={ref}
            intent={intent}
            className={CarouselAnatomy.button()}
            disabled={!canScrollPrev}
            onClick={scrollPrev}
            icon={<svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(CarouselAnatomy.chevronIcon(), chevronIconClass)}
            >
                <path d="m15 18-6-6 6-6" />
            </svg>}
            {...rest}
        />
    )
})
CarouselPrevious.displayName = "CarouselPrevious"

/* -------------------------------------------------------------------------------------------------
 * CarouselNext
 * -----------------------------------------------------------------------------------------------*/

const CarouselNext = React.forwardRef<HTMLButtonElement, CarouselButtonProps>((props, ref) => {
    const { className, chevronIconClass, intent = "gray-outline", ...rest } = props
    const { scrollNext, canScrollNext } = useCarousel()

    return (
        <IconButton
            ref={ref}
            intent={intent}
            className={CarouselAnatomy.button()}
            disabled={!canScrollNext}
            onClick={scrollNext}
            icon={<svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn(CarouselAnatomy.chevronIcon(), chevronIconClass)}
            >
                <path d="m9 18 6-6-6-6" />
            </svg>}
            {...rest}
        />
    )
})
CarouselNext.displayName = "CarouselNext"

type UseDotButtonType = {
    selectedIndex: number
    scrollSnaps: number[]
    onDotButtonClick: (index: number) => void
}

const useDotButton = (): UseDotButtonType => {
    const { api: emblaApi } = useCarousel()
    const [selectedIndex, setSelectedIndex] = React.useState(0)
    const [scrollSnaps, setScrollSnaps] = React.useState<number[]>([])

    const onDotButtonClick = React.useCallback(
        (index: number) => {
            if (!emblaApi) return
            emblaApi.scrollTo(index)
        },
        [emblaApi],
    )

    const onInit = React.useCallback((emblaApi: EmblaCarouselType) => {
        setScrollSnaps(emblaApi.scrollSnapList())
    }, [])

    const onSelect = React.useCallback((emblaApi: EmblaCarouselType) => {
        setSelectedIndex(emblaApi.selectedScrollSnap())
    }, [])

    React.useEffect(() => {
        if (!emblaApi) return

        onInit(emblaApi)
        onSelect(emblaApi)
        emblaApi.on("reInit", onInit)
        emblaApi.on("reInit", onSelect)
        emblaApi.on("select", onSelect)
        return () => {
            emblaApi.off("reInit", onInit)
            emblaApi.off("reInit", onSelect)
            emblaApi.off("select", onSelect)
        }
    }, [emblaApi, onInit, onSelect])

    return {
        selectedIndex,
        scrollSnaps,
        onDotButtonClick,
    }
}

const DotButton = (props: React.ComponentPropsWithoutRef<"div">) => {
    const { children, className, onClick, ...rest } = props

    return (
        <div
            className={cn(
                "rounded-full px-[2.5px] size-5 lg:w-5 lg:h-4 group/dot-button flex items-center justify-center cursor-pointer",
            )}
            onClick={onClick}
        >
            <div
                className={cn(
                    "cursor-pointer w-full lg:h-2 lg:group-hover/dot-button:h-3 transition-all duration-300 rounded-full bg-gray-600 dark:bg-opacity-50",
                    className)} {...rest} />
        </div>
    )
}

export const CarouselDotButtons = (props: { className?: string, flag?: any }) => {

    const { api: emblaApi } = useCarousel()
    const { selectedIndex, scrollSnaps, onDotButtonClick } = useDotButton()
    const wasAutoScrollPlayingRef = React.useRef(false)

    const stopAutoScroll = React.useCallback(() => {
        const autoplay = emblaApi?.plugins().autoplay
        if (!autoplay) return

        wasAutoScrollPlayingRef.current = autoplay.isPlaying()
        if (wasAutoScrollPlayingRef.current) {
            autoplay.stop()
        }
    }, [emblaApi])

    const resumeAutoScroll = React.useCallback(() => {
        const autoplay = emblaApi?.plugins().autoplay
        if (!autoplay) return

        if (wasAutoScrollPlayingRef.current) {
            autoplay.play()
        }

        wasAutoScrollPlayingRef.current = false
    }, [emblaApi])

    React.useEffect(() => {
        onDotButtonClick(0)
    }, [onDotButtonClick, scrollSnaps, props.flag])

    React.useEffect(() => {
        return () => {
            const autoplay = emblaApi?.plugins().autoplay
            if (wasAutoScrollPlayingRef.current && autoplay) {
                autoplay.play()
            }
        }
    }, [emblaApi])

    if (scrollSnaps.length > 30) return null

    return (
        <div
            className={cn("absolute -top-8 right-0 hidden md:flex items-center z-[10]", props.className)}
            onMouseEnter={stopAutoScroll}
            onMouseLeave={resumeAutoScroll}
        >
            {scrollSnaps.map((_, index) => (
                <DotButton
                    key={index}
                    onClick={() => onDotButtonClick(index)}
                    className={cn(index === selectedIndex && "bg-white")}
                />
            ))}
        </div>
    )
}
