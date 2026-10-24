import { cn } from "@/components/ui/core/styling"

export const episodeCardCarouselItemClass = (smaller: boolean) => {
    return cn(
        !smaller && "md:basis-1/2 lg:basis-1/2 2xl:basis-1/3 min-[2000px]:basis-1/4",
        smaller && "md:basis-1/2 lg:basis-1/3 2xl:basis-1/4 min-[2000px]:basis-1/5",
    )
}
