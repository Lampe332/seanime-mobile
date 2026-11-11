import { redirectAppLink } from "@/lib/app-links-handler"

/**
 * Expo Router hands every incoming system link here first: widget rows and launcher shortcuts (seanime-native://…),
 * the old app's seanime:// links and AniList/MyAnimeList anime pages ("Open with Seanime") become app paths
 * (lib/app-links.ts, AppLinks.kt).
 */
export function redirectSystemPath({ path }: { path: string, initial: boolean }) {
    return redirectAppLink(path)
}
