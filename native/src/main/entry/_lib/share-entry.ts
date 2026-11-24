import { Share } from "react-native"

/** What the system's share sheet sends for a title: its name and its link on one line each (Android shares only `message`) */
export function shareContent(title: string, link: string) {
    return { title, message: `${title}\n${link}` }
}

/** Opens the system's share sheet with the title and its link; rejects only when the sheet cannot open */
export async function shareEntry(title: string, link: string) {
    await Share.share(shareContent(title, link), { dialogTitle: title })
}
