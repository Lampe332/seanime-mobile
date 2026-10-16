import { PageWrapper } from "@/components/shared/page-wrapper"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { Skeleton } from "@/components/ui/skeleton"

export function StreamPageSkeleton() {
    return (
        <PageWrapper
            data-stream-page-skeleton
            className="relative 2xl:order-first pb-10 lg:pt-0"
            {...{
                initial: { opacity: 0, y: 24 },
                animate: { opacity: 1, y: 0 },
                exit: { opacity: 0, scale: 0.99 },
                transition: { duration: 0.18, ease: "easeOut" },
            }}
        >
            <div className="h-10 lg:h-0" />
            <AppLayoutStack data-stream-page-skeleton-content>
                <div className="flex flex-col flex-wrap lg:flex-nowrap items-start md:items-center md:flex-row gap-2 md:gap-6 lg:h-12">
                    <Skeleton className="h-7 w-36 rounded-xl" />
                    <Skeleton className="h-7 w-44 rounded-xl" />
                </div>

                <div className="w-full overflow-hidden">
                    <div className="flex gap-4">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="flex-none w-full md:w-1/2 2xl:w-1/3 space-y-2">
                                <Skeleton className="w-full aspect-[4/2] h-full rounded-xl" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-16 rounded-xl opacity-70" />
                                    <Skeleton className="h-5 w-48 rounded-xl" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div>
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex gap-4 py-3 pr-12">
                            <Skeleton className="h-28 w-36 lg:h-32 lg:w-44 flex-none rounded-[--radius-md]" />
                            <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                                <Skeleton className="h-5 w-20 rounded-xl" />
                                <Skeleton className="h-4 w-full max-w-[28rem] rounded-xl opacity-80" />
                                <Skeleton className="h-3 w-2/3 max-w-[20rem] rounded-xl opacity-50" />
                            </div>
                        </div>
                    ))}
                </div>
            </AppLayoutStack>
        </PageWrapper>
    )
}