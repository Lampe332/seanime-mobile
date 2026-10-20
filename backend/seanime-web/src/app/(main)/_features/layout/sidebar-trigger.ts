// Android phones navigate through the native bottom bar menu; tablets (shortest side >= 768, as in UIBottomNav.kt) keep the sidebar trigger.
export function showsSidebarTrigger(platform: string | undefined, width: number, height: number) {
    return platform !== "mobile" || Math.min(width, height) >= 768
}
