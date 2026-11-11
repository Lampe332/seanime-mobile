import { PhoneScreen } from "@/components/shared/phone-screen"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import { ScheduleCalendar } from "@/main/schedule/_screens/schedule-phone"

// Schedule (web app/(main)/schedule/page.tsx → ScheduleCalendar → PhoneSchedule), at "/schedule"; Menu → Schedule.
// The phone column stays 42rem wide like the web page; the tablet uses its width for the day columns.
// Plugin pages above and below the calendar (2.17), as on the web page.
export default function ScheduleScreen() {
    const { rail } = useTabletLayout()
    return (
        <PhoneScreen className={rail ? undefined : "max-w-[672px]"}>
            <PluginWebviewSlot slot="schedule-screen-top" />
            <ScheduleCalendar />
            <PluginWebviewSlot slot="schedule-screen-bottom" />
        </PhoneScreen>
    )
}
