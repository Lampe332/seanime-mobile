/*
 * App entry. Android may start the JavaScript without the app's screen (widget updates, the background check for new
 * episodes); those handlers are registered here, in the same first pass that loads Expo Router (imports run before the
 * body, the router renders later), so they exist before any task can run.
 */
// first: copies the old app's settings into MMKV before any module creates an atom from it (E6)
import "@/lib/legacy-preferences-run"
import { defineAiringTask } from "@/lib/airing/airing-notifier"
import { widgetTaskHandler } from "@/lib/widget/widget-task"
import { foregroundNoticeBehavior } from "@/main/android-downloads/_lib/notice-behavior"
import * as Notifications from "expo-notifications"
import { registerWidgetTaskHandler } from "react-native-android-widget"
import "expo-router/entry"

defineAiringTask()
registerWidgetTaskHandler(widgetTaskHandler)

// the app's only notification handler: a new-episode notification that arrives while the app is open is shown like any
// other, download notices go to the list quietly
Notifications.setNotificationHandler({
    handleNotification: async notification => foregroundNoticeBehavior(notification.request.content.data?.kind),
})
