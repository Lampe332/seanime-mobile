import { PluginWebviewSlot } from "@/app/(main)/_features/plugin/webview/plugin-webviews"
import { PageWrapper } from "@/components/shared/page-wrapper"
import React from "react"
import { ScheduleCalendar } from "./_components/schedule-calendar"


export default function Page() {
    // the phone calendar brings its own head and frame
    return (
        <PageWrapper className="space-y-6" data-mobile-schedule-page="true">
            <PluginWebviewSlot slot="schedule-screen-top" />
            <ScheduleCalendar />
            <PluginWebviewSlot slot="schedule-screen-bottom" />
        </PageWrapper>
    )
}
