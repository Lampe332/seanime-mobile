package com.seanime.app

import com.seanime.app.AppLinks.MalAnime
import com.seanime.app.AppLinks.Page
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AppLinksTest {
    @Test fun widgetAndShortcutLinks() {
        assertEquals(Page("/entry?id=21087"), AppLinks.target("seanime://entry?id=21087"))
        assertEquals(Page("/search"), AppLinks.target("seanime://open?path=%2Fsearch"))
        assertEquals(Page("/android-downloads"), AppLinks.target("seanime://open?path=/android-downloads"))
        // only the shortcut pages, never any page or address
        assertNull(AppLinks.target("seanime://open?path=/settings"))
        assertNull(AppLinks.target("seanime://open?path=https://example.com"))
        assertNull(AppLinks.target("seanime://entry?id=-1"))
    }

    @Test fun animePagesOfAniListAndMyAnimeList() {
        assertEquals(Page("/entry?id=21087"), AppLinks.target("https://anilist.co/anime/21087/One-Punch-Man/"))
        assertEquals(Page("/entry?id=21087"), AppLinks.target("https://www.anilist.co/anime/21087"))
        assertEquals(MalAnime(30276), AppLinks.target("https://myanimelist.net/anime/30276/One_Punch_Man"))
        assertNull(AppLinks.target("https://anilist.co/manga/30013"))
        assertNull(AppLinks.target("https://example.com/anime/21087"))
    }

    @Test fun sharedText() {
        assertEquals(Page("/entry?id=21087"), AppLinks.shared("Schau mal: https://anilist.co/anime/21087/One-Punch-Man/ lol"))
        assertEquals(Page("/search?q=One+Punch+Man"), AppLinks.shared("One Punch Man"))
        assertNull(AppLinks.shared("https://example.com/video"))
        assertNull(AppLinks.shared("   "))
    }
}
