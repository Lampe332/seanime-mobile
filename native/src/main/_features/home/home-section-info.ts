// Android "Customize Home": localized section names, a one-line summary, what each section shows once added and what it
// needs to show anything. Texts follow the section's rendering in home-screen.tsx and its options in home-items.utils.ts.
import type { Translate } from "@/lib/app-language"

type Localized = readonly [en: string, de: string]

export const HOME_SECTION_INFO: Record<string, { name: Localized, summary: Localized, info: Localized, needs?: Localized }> = {
    "anime-continue-watching": {
        name: ["Continue watching", "Weiterschauen"],
        summary: ["The next episode of each series you are watching", "Die nächste Folge jeder Serie, die du schaust"],
        info: ["Shows the next episode of each series you are watching. Tapping a card resumes playback where you left off.",
            "Zeigt die nächste Folge jeder Serie, die du gerade schaust. Antippen setzt die Wiedergabe an der gespeicherten Stelle fort."],
    },
    "anime-continue-watching-header": {
        name: ["Continue watching banner", "Weiterschauen-Banner"],
        summary: ["A banner of the series you are watching", "Ein Banner der Serien, die du schaust"],
        info: ["A banner of the series you are watching, always the first section of Home. Android shows it as the Continue watching row, and with the Discover banner on Home it becomes that row where it stands.",
            "Ein Banner der Serien, die du gerade schaust, immer der erste Bereich der Startseite. Android zeigt es als Weiterschauen-Reihe, und mit dem Entdecken-Banner wird es zu dieser Reihe an seiner Stelle."],
    },
    "anime-library": {
        name: ["Anime library", "Anime-Bibliothek"],
        summary: ["Your anime, one row per list status", "Deine Anime, eine Reihe pro Listenstatus"],
        info: ["Your anime grouped by list status, such as Currently watching, one row per status. In Options you choose the statuses.",
            "Deine Anime nach Listenstatus gruppiert, z. B. „Schaue ich gerade“, eine Reihe pro Status. Unter Optionen wählst du die Status."],
    },
    "my-lists": {
        name: ["My lists", "Meine Listen"],
        summary: ["Anime or manga from your lists", "Anime oder Manga aus deinen Listen"],
        info: ["Anime or manga from your AniList lists with the statuses you pick, or from one of your custom lists.",
            "Anime oder Manga aus deinen AniList-Listen mit den gewählten Status oder aus einer deiner eigenen Listen."],
    },
    "local-anime-library": {
        name: ["Local anime library", "Lokale Anime-Bibliothek"],
        summary: ["The anime in your local library folder", "Die Anime in deinem lokalen Bibliotheksordner"],
        info: ["The anime found in your scanned local library folder, one row per list.",
            "Die Anime aus deinem gescannten lokalen Bibliotheksordner, eine Reihe pro Liste."],
        needs: ["Needs a local library folder", "Braucht einen lokalen Bibliotheksordner"],
    },
    "library-upcoming-episodes": {
        name: ["Upcoming episodes", "Kommende Folgen"],
        summary: ["Episodes still to come of the anime in your library", "Noch kommende Folgen der Anime in deiner Bibliothek"],
        info: ["A carousel of upcoming episodes of the anime in your library.",
            "Ein Karussell mit den kommenden Folgen der Anime in deiner Bibliothek."],
    },
    "aired-recently": {
        name: ["Aired recently", "Kürzlich ausgestrahlt"],
        summary: ["Episodes that aired in the last two weeks", "Folgen, die in den letzten zwei Wochen liefen"],
        info: ["A carousel of anime episodes that aired recently, including series that are not on your lists.",
            "Ein Karussell mit kürzlich ausgestrahlten Anime-Folgen, auch von Serien, die nicht in deinen Listen sind."],
    },
    "missed-sequels": {
        name: ["Missed sequels", "Verpasste Fortsetzungen"],
        summary: ["Sequels of completed anime that are on none of your lists", "Fortsetzungen abgeschlossener Anime, die auf keiner Liste stehen"],
        info: ["Sequels of anime you completed that are out or airing and on none of your lists. A sequel already on a list, even Planning, does not count.",
            "Fortsetzungen von Anime, die du abgeschlossen hast, die erschienen sind oder laufen und auf keiner deiner Listen stehen. Eine Fortsetzung auf einer Liste, auch „Geplant“, zählt nicht."],
        needs: ["Needs completed anime on your lists", "Braucht abgeschlossene Anime auf deinen Listen"],
    },
    "anime-schedule-calendar": {
        name: ["Schedule calendar", "Sendeplan-Kalender"],
        summary: ["A calendar of airing episodes", "Ein Kalender der laufenden Folgen"],
        info: ["A calendar of airing episodes. In Options you choose between anime from your lists and all airing anime.",
            "Ein Kalender mit ausgestrahlten Folgen. Unter Optionen wählst du zwischen Anime aus deinen Listen und allen laufenden Anime."],
    },
    "local-anime-library-stats": {
        name: ["Local library stats", "Statistik lokale Bibliothek"],
        summary: ["Numbers about your local library folder", "Zahlen zu deinem lokalen Bibliotheksordner"],
        info: ["Statistics about the anime in your local library folder.",
            "Statistiken zu den Anime in deinem lokalen Bibliotheksordner."],
        needs: ["Needs a local library folder", "Braucht einen lokalen Bibliotheksordner"],
    },
    "discover-header": {
        name: ["Discover banner", "Entdecken-Banner"],
        summary: ["A large banner of trending anime", "Ein großes Banner mit Anime im Trend"],
        info: ["A large banner of trending anime, always the first section of Home. Only one banner can be on top, so with it the Continue watching banner becomes the Continue watching row.",
            "Ein großes Banner mit gerade beliebten Anime, immer der erste Bereich der Startseite. Oben kann nur ein Banner stehen, daher wird das Weiterschauen-Banner dann zur Weiterschauen-Reihe."],
    },
    "anime-carousel": {
        name: ["Anime carousel", "Anime-Karussell"],
        summary: ["A row of anime picked by your options", "Eine Reihe Anime nach deinen Optionen"],
        info: ["A row of anime chosen by your Options, such as sorting, status, genres or season. Like every section, it can be on Home once.",
            "Eine Reihe Anime nach deinen Optionen, z. B. Sortierung, Status, Genres oder Season. Wie jeder Bereich kann sie einmal auf der Startseite stehen."],
    },
    "manga-carousel": {
        name: ["Manga carousel", "Manga-Karussell"],
        summary: ["A row of manga picked by your options", "Eine Reihe Manga nach deinen Optionen"],
        info: ["A row of manga chosen by your Options, such as sorting, status, genres or year. Like every section, it can be on Home once.",
            "Eine Reihe Manga nach deinen Optionen, z. B. Sortierung, Status, Genres oder Jahr. Wie jeder Bereich kann sie einmal auf der Startseite stehen."],
    },
    "manga-library": {
        name: ["Manga library", "Manga-Bibliothek"],
        summary: ["Your manga, one row per reading status", "Deine Manga, eine Reihe pro Lesestatus"],
        info: ["Your manga grouped by reading status, one row per status. In Options you choose the statuses.",
            "Deine Manga nach Lesestatus gruppiert, eine Reihe pro Status. Unter Optionen wählst du die Status."],
        needs: ["Needs manga on your lists", "Braucht Manga auf deinen Listen"],
    },
    "centered-title": {
        name: ["Centered title", "Zentrierter Titel"],
        summary: ["A heading with your own text", "Eine Überschrift mit eigenem Text"],
        info: ["A centered heading with your own text, for example to separate other sections.",
            "Eine zentrierte Überschrift mit eigenem Text, z. B. um andere Bereiche zu trennen."],
    },
}

/**
 * The options' labels and choices (the English `label`s of home-items.utils.ts) in English and German; the genres use
 * the genre names of Discover (genreLabel).
 */
export const HOME_OPTION_LABELS: Record<string, Localized> = {
    "Section title": ["Section title", "Bereichstitel"],
    "Sort by": ["Sort by", "Sortieren nach"],
    "Most popular": ["Most popular", "Am beliebtesten"],
    "Trending": ["Trending", "Im Trend"],
    "Romaji title, A to Z": ["Romaji title, A to Z", "Romaji-Titel, A bis Z"],
    "Romaji title, Z to A": ["Romaji title, Z to A", "Romaji-Titel, Z bis A"],
    "English title, A to Z": ["English title, A to Z", "Englischer Titel, A bis Z"],
    "English title, Z to A": ["English title, Z to A", "Englischer Titel, Z bis A"],
    "Score, lowest first": ["Score, lowest first", "Bewertung, niedrigste zuerst"],
    "Score, highest first": ["Score, highest first", "Bewertung, höchste zuerst"],
    "Status": ["Status", "Status"],
    "Releasing": ["Releasing", "Laufend"],
    "Finished": ["Finished", "Beendet"],
    "Not yet released": ["Not yet released", "Noch nicht erschienen"],
    "Format": ["Format", "Format"],
    "TV": ["TV", "TV"],
    "Movie": ["Movie", "Film"],
    "OVA": ["OVA", "OVA"],
    "ONA": ["ONA", "ONA"],
    "Special": ["Special", "Special"],
    "Manga": ["Manga", "Manga"],
    "One shot": ["One shot", "One-Shot"],
    "Genres": ["Genres", "Genres"],
    "Season": ["Season", "Season"],
    "Winter": ["Winter", "Winter"],
    "Spring": ["Spring", "Frühling"],
    "Summer": ["Summer", "Sommer"],
    "Fall": ["Fall", "Herbst"],
    "Year": ["Year", "Jahr"],
    "Country of origin": ["Country of origin", "Herkunftsland"],
    "Japan": ["Japan", "Japan"],
    "South Korea": ["South Korea", "Südkorea"],
    "China": ["China", "China"],
    "Taiwan": ["Taiwan", "Taiwan"],
    "Heading text": ["Heading text", "Text der Überschrift"],
    "Statuses": ["Statuses", "Status"],
    "Currently watching": ["Currently watching", "Schaue ich gerade"],
    "Currently reading": ["Currently reading", "Lese ich gerade"],
    "Current": ["Current", "Aktuell"],
    "Repeating": ["Repeating", "Wiederholen"],
    "Rereading": ["Rereading", "Lese ich erneut"],
    "Paused": ["Paused", "Pausiert"],
    "Planning": ["Planning", "Geplant"],
    "Completed": ["Completed", "Abgeschlossen"],
    "Dropped": ["Dropped", "Abgebrochen"],
    "Anime or manga": ["Anime or manga", "Anime oder Manga"],
    "Anime": ["Anime", "Anime"],
    "Custom list": ["Custom list", "Eigene Liste"],
    "Shows": ["Shows", "Zeigt"],
    "Anime on my lists": ["Anime on my lists", "Anime auf meinen Listen"],
    "All airing anime": ["All airing anime", "Alle laufenden Anime"],
}

/** An option's label or choice in the app language; one without a row stays as the schema has it. */
export function homeOptionLabel(t: Translate, label: string): string {
    const row = HOME_OPTION_LABELS[label]
    return row ? t(row[0], row[1]) : label
}
