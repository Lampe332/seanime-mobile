// Android "Customize Home": localized section names and what each section shows once added.
// Texts follow the section's rendering in home-screen.tsx and its options in home-items.utils.ts.
type Localized = readonly [en: string, de: string]

export const HOME_SECTION_INFO: Record<string, { name: Localized, info: Localized }> = {
    "anime-continue-watching": {
        name: ["Continue watching", "Weiterschauen"],
        info: ["Shows the next episode of each series you are watching. Tapping a card resumes playback where you left off.",
            "Zeigt die nächste Folge jeder Serie, die du gerade schaust. Antippen setzt die Wiedergabe an der gespeicherten Stelle fort."],
    },
    "anime-continue-watching-header": {
        name: ["Continue watching banner", "Weiterschauen-Banner"],
        info: ["A large banner at the top of Home that cycles through the series you are currently watching.",
            "Ein großes Banner oben auf der Startseite, das die Serien zeigt, die du gerade schaust."],
    },
    "anime-library": {
        name: ["Anime library", "Anime-Bibliothek"],
        info: ["Your anime grouped by list status, such as Currently watching. In Options you choose the statuses and grid or carousel layout.",
            "Deine Anime nach Listenstatus gruppiert, z. B. „Schaue ich gerade“. Unter Optionen wählst du Status und Raster- oder Karussell-Ansicht."],
    },
    "my-lists": {
        name: ["My lists", "Meine Listen"],
        info: ["Anime or manga from your AniList lists with the statuses you pick, or from one of your custom lists.",
            "Anime oder Manga aus deinen AniList-Listen mit den gewählten Status oder aus einer deiner eigenen Listen."],
    },
    "local-anime-library": {
        name: ["Local anime library", "Lokale Anime-Bibliothek"],
        info: ["A complete grid of the anime found in your scanned local library folder.",
            "Ein vollständiges Raster der Anime aus deinem gescannten lokalen Bibliotheksordner."],
    },
    "library-upcoming-episodes": {
        name: ["Upcoming episodes", "Kommende Folgen"],
        info: ["A carousel of upcoming episodes of the anime in your library.",
            "Ein Karussell mit den kommenden Folgen der Anime in deiner Bibliothek."],
    },
    "aired-recently": {
        name: ["Aired recently", "Kürzlich ausgestrahlt"],
        info: ["A carousel of anime episodes that aired recently, including series that are not on your lists.",
            "Ein Karussell mit kürzlich ausgestrahlten Anime-Folgen, auch von Serien, die nicht in deinen Listen sind."],
    },
    "missed-sequels": {
        name: ["Missed sequels", "Verpasste Fortsetzungen"],
        info: ["A carousel of sequels to your anime that are not in your collection yet.",
            "Ein Karussell mit Fortsetzungen deiner Anime, die noch nicht in deiner Sammlung sind."],
    },
    "anime-schedule-calendar": {
        name: ["Schedule calendar", "Sendeplan-Kalender"],
        info: ["A calendar of airing episodes. In Options you choose between anime from your lists and all airing anime.",
            "Ein Kalender mit ausgestrahlten Folgen. Unter Optionen wählst du zwischen Anime aus deinen Listen und allen laufenden Anime."],
    },
    "local-anime-library-stats": {
        name: ["Local library stats", "Statistik lokale Bibliothek"],
        info: ["Statistics about the anime in your local library folder.",
            "Statistiken zu den Anime in deinem lokalen Bibliotheksordner."],
    },
    "discover-header": {
        name: ["Discover banner", "Entdecken-Banner"],
        info: ["A large banner at the top of Home that cycles through trending anime.",
            "Ein großes Banner oben auf der Startseite, das gerade beliebte Anime zeigt."],
    },
    "anime-carousel": {
        name: ["Anime carousel", "Anime-Karussell"],
        info: ["A row of anime chosen by your Options, such as sorting, status, genres or season. You can add it more than once.",
            "Eine Reihe Anime nach deinen Optionen, z. B. Sortierung, Status, Genres oder Season. Kann mehrfach hinzugefügt werden."],
    },
    "manga-carousel": {
        name: ["Manga carousel", "Manga-Karussell"],
        info: ["A row of manga chosen by your Options, such as sorting, status, genres or season. You can add it more than once.",
            "Eine Reihe Manga nach deinen Optionen, z. B. Sortierung, Status, Genres oder Season. Kann mehrfach hinzugefügt werden."],
    },
    "manga-library": {
        name: ["Manga library", "Manga-Bibliothek"],
        info: ["Your manga grouped by reading status. In Options you choose the statuses and layout.",
            "Deine Manga nach Lesestatus gruppiert. Unter Optionen wählst du Status und Ansicht."],
    },
    "centered-title": {
        name: ["Centered title", "Zentrierter Titel"],
        info: ["A centered heading with your own text, for example to separate other sections.",
            "Eine zentrierte Überschrift mit eigenem Text, z. B. um andere Bereiche zu trennen."],
    },
}
