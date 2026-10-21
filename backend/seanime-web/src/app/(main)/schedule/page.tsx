import { CustomLibraryBanner } from "@/app/(main)/_features/anime-library/_containers/custom-library-banner"
import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { isAndroidPhone } from "@/app/(main)/_features/video-core/video-core-menu"
import { PageWrapper } from "@/components/shared/page-wrapper"
import { AppLayoutStack } from "@/components/ui/app-layout"
import { useTr } from "@/lib/app-language"
import React from "react"
import { ScheduleCalendar } from "./_components/schedule-calendar"


export default function Page() {
    const t = useTr()

    // the phone calendar brings its own head and frame
    if (isAndroidPhone()) return (
        <PageWrapper className="space-y-6" data-mobile-schedule-page="true">
            <PluginWebviewSlot slot="schedule-screen-top" />
            <ScheduleCalendar />
            <PluginWebviewSlot slot="schedule-screen-bottom" />
        </PageWrapper>
    )

    return (
        <>
            <CustomLibraryBanner discrete />
            <PageWrapper
                className="p-4 sm:p-8 space-y-6 pb-10"
            >
                <PluginWebviewSlot slot="schedule-screen-top" />
                <AppLayoutStack>

                    <div className="space-y-2">
                        <h2 className="!text-2xl font-semibold tracking-tight">{t("Calendar", "Kalender")}</h2>
                        <p className="text-sm text-[--muted]">{t("Anime releases based on your selection", "Anime-Veröffentlichungen nach deiner Auswahl")}</p>
                    </div>

                    <ScheduleCalendar />
                </AppLayoutStack>
                <PluginWebviewSlot slot="schedule-screen-bottom" />
            </PageWrapper>
        </>
    )
}
