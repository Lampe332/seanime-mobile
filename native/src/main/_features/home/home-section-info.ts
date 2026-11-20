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
        info: ["A banner of the series you are watching, always the first section of Home. Android shows it as the Continue watching row, and with the Discover banner on Home it becomes that row where it stands.",
            "Ein Banner der Serien, die du gerade schaust, immer der erste Bereich der Startseite. Android zeigt es als Weiterschauen-Reihe, und mit dem Entdecken-Banner wird es zu dieser Reihe an seiner Stelle."],
    },
    "anime-library": {
        name: ["Anime library", "Anime-Bibliothek"],
        info: ["Your anime grouped by list status, such as Currently watching, one row per status. In Options you choose the statuses.",
            "Deine Anime nach Listenstatus gruppiert, z. B. „Schaue ich gerade“, eine Reihe pro Status. Unter Optionen wählst du die Status."],
    },
    "my-lists": {
        name: ["My lists", "Meine Listen"],
        info: ["Anime or manga from your AniList lists with the statuses you pick, or from one of your custom lists.",
            "Anime oder Manga aus deinen AniList-Listen mit den gewählten Status oder aus einer deiner eigenen Listen."],
    },
    "local-anime-library": {
        name: ["Local anime library", "Lokale Anime-Bibliothek"],
        info: ["The anime found in your scanned local library folder, one row per list.",
            "Die Anime aus deinem gescannten lokalen Bibliotheksordner, eine Reihe pro Liste."],
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
        info: ["Sequels of anime you completed that are out or airing and on none of your lists. A sequel already on a list, even Planning, does not count.",
            "Fortsetzungen von Anime, die du abgeschlossen hast, die erschienen sind oder laufen und auf keiner deiner Listen stehen. Eine Fortsetzung auf einer Liste, auch „Geplant“, zählt nicht."],
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
        info: ["A large banner of trending anime, always the first section of Home. Only one banner can be on top, so with it the Continue watching banner becomes the Continue watching row.",
            "Ein großes Banner mit gerade beliebten Anime, immer der erste Bereich der Startseite. Oben kann nur ein Banner stehen, daher wird das Weiterschauen-Banner dann zur Weiterschauen-Reihe."],
    },
    "anime-carousel": {
        name: ["Anime carousel", "Anime-Karussell"],
        info: ["A row of anime chosen by your Options, such as sorting, status, genres or season. Like every section, it can be on Home once.",
            "Eine Reihe Anime nach deinen Optionen, z. B. Sortierung, Status, Genres oder Season. Wie jeder Bereich kann sie einmal auf der Startseite stehen."],
    },
    "manga-carousel": {
        name: ["Manga carousel", "Manga-Karussell"],
        info: ["A row of manga chosen by your Options, such as sorting, status, genres or year. Like every section, it can be on Home once.",
            "Eine Reihe Manga nach deinen Optionen, z. B. Sortierung, Status, Genres oder Jahr. Wie jeder Bereich kann sie einmal auf der Startseite stehen."],
    },
    "manga-library": {
        name: ["Manga library", "Manga-Bibliothek"],
        info: ["Your manga grouped by reading status, one row per status. In Options you choose the statuses.",
            "Deine Manga nach Lesestatus gruppiert, eine Reihe pro Status. Unter Optionen wählst du die Status."],
    },
    "centered-title": {
        name: ["Centered title", "Zentrierter Titel"],
        info: ["A centered heading with your own text, for example to separate other sections.",
            "Eine zentrierte Überschrift mit eigenem Text, z. B. um andere Bereiche zu trennen."],
    },
}
