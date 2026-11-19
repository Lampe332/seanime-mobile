import { API_ENDPOINTS } from "@/api/generated/endpoints"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { useTabletLayout } from "@/lib/use-tablet-ui"
import { PluginWebviewSlot } from "@/main/_features/plugin/plugin-webview"
import { ScheduleCalendar } from "@/main/schedule/_screens/schedule-phone"
import { useQueryClient } from "@tanstack/react-query"

// Schedule (web app/(main)/schedule/page.tsx → ScheduleCalendar → PhoneSchedule), at "/schedule"; Menu → Schedule.
// The phone column stays 42rem wide like the web page; the tablet uses its width for the day columns.
// Plugin pages above and below the calendar (2.17), as on the web page.
// Pull to refresh loads the shown schedule again (my list's or AniList's whole one; read only).
export default function ScheduleScreen() {
    const { rail } = useTabletLayout()
    const queryClient = useQueryClient()
    const refresh = () => Promise.all([API_ENDPOINTS.ANIME_COLLECTION.GetAnimeCollectionSchedule.key, "schedule-global-day", "schedule-global-counts"]
        .map(key => queryClient.refetchQueries({ queryKey: [key], type: "active" })))
    return (
        <PhoneScreen className={rail ? undefined : "max-w-[672px]"} onRefresh={refresh}>
            <PluginWebviewSlot slot="schedule-screen-top" />
            <ScheduleCalendar />
            <PluginWebviewSlot slot="schedule-screen-bottom" />
        </PhoneScreen>
    )
}
