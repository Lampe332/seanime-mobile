// Android phones navigate through the native bottom bar menu; tablets (shortest side >= 768, as in UIBottomNav.kt) keep the sidebar trigger.
export function showsSidebarTrigger(width: number, height: number) {
    return Math.min(width, height) >= 768
}
