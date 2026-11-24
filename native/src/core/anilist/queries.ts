// geschrieben nach: öffentliche AniList-GraphQL-Doku (docs.anilist.co, Schema: Media, MediaListCollection, Page, Studio, Viewer.statistics) und den aufgezeichneten Antworten vom 13.11.2026 (welche Felder die App bekommt; api-anilist-schreibend: die Wertung steht in den Listen von 0 bis 100, auch bei einem Konto mit 10er-Wertung); kein Server-Quelltext

/*
 * The questions the core asks AniList; at the end the two changes it sends (changes.ts). The fields are the ones the recorded
 * answers carry (anilist.test.ts holds each selection against them), so an answer of the core has the form the app knows.
 */

const date = "{ year month day }"
const title = "title { userPreferred romaji english native }"
const cover = "coverImage { extraLarge large medium color }"
const trailer = "trailer { id site thumbnail }"
const nextEpisode = "nextAiringEpisode { airingAt timeUntilAiring episode }"

/** An anime as lists, searches and relations show it */
const animeFields = `id idMal siteUrl status(version: 2) season type format seasonYear bannerImage episodes synonyms isAdult
    countryOfOrigin meanScore description genres duration ${trailer} ${title} ${cover} startDate ${date} endDate ${date}`

/** A manga as the lists show it */
const mangaFields = `id idMal siteUrl status(version: 2) type format bannerImage chapters synonyms isAdult countryOfOrigin
    meanScore description genres ${title} ${cover} startDate ${date} endDate ${date}`

/** The score always from 0 to 100, whatever format the account shows it in (recorded with a 10-point account: 80) */
const entryFields = `id score(format: POINT_100) progress status repeat private startedAt ${date} completedAt ${date} updatedAt createdAt`

const pageInfo = "pageInfo { hasNextPage total perPage currentPage lastPage }"

export const VIEWER_NAME = "query ViewerName { Viewer { name } }"

export function collectionQuery(kind: "ANIME" | "MANGA"): string {
    const media = kind === "ANIME" ? `${animeFields} ${nextEpisode}` : mangaFields
    return `query ListCollection($userName: String) {
        MediaListCollection(userName: $userName, forceSingleCompletedList: true, type: ${kind}) {
            lists { status name isCustomList entries { ${entryFields} media { ${media} } } }
        }
    }`
}

export function collectionTagsQuery(kind: "ANIME" | "MANGA"): string {
    return `query ListCollectionTags($userName: String) {
        MediaListCollection(userName: $userName, forceSingleCompletedList: true, type: ${kind}) {
            lists { entries { media { id tags { name } } } }
        }
    }`
}

export const ANIME_DETAILS = `query AnimeDetails($id: Int) {
    Media(id: $id, type: ANIME) {
        siteUrl id duration genres averageScore popularity meanScore description ${trailer} startDate ${date} endDate ${date}
        studios(isMain: true) { nodes { name id } }
        characters(sort: [ROLE]) {
            edges { id role node { id isFavourite gender age dateOfBirth ${date} name { full native alternative } image { large } description siteUrl } }
        }
        staff(sort: [RELEVANCE]) { edges { role node { name { full } id } } }
        tags { name rank isMediaSpoiler isGeneralSpoiler }
        rankings { context type rank year format allTime season }
        recommendations(page: 1, perPage: 8, sort: [RATING_DESC]) {
            edges { node { mediaRecommendation { id idMal siteUrl status(version: 2) isAdult season type format meanScore description
                episodes ${trailer} startDate ${date} ${cover} bannerImage ${title} } } }
        }
        relations { edges { relationType(version: 2) node { ${animeFields} } } }
    }
}`

export const STUDIO_DETAILS = `query StudioDetails($id: Int, $page: Int) {
    Studio(id: $id) { id isAnimationStudio name media(sort: [START_DATE_DESC], isMain: true, page: $page, perPage: 50) {
        pageInfo { hasNextPage } nodes { ${animeFields} ${nextEpisode} } } }
}`

/** A person and the titles they worked on, 50 a page (anime and manga together, each with its role) */
export const STAFF_DETAILS = `query StaffDetails($id: Int, $page: Int) {
    Staff(id: $id) { id name { full native } image { large } primaryOccupations siteUrl
        staffMedia(sort: [POPULARITY_DESC], page: $page, perPage: 50) {
            pageInfo { hasNextPage } edges { staffRole node { id idMal siteUrl status(version: 2) type format season seasonYear
                bannerImage episodes chapters isAdult countryOfOrigin meanScore genres ${title} ${cover} startDate ${date} ${nextEpisode} } } } }
}`

export const LIST_ANIME = `query ListAnime($page: Int, $search: String, $perPage: Int, $sort: [MediaSort], $status: [MediaStatus],
    $genres: [String], $tags: [String], $averageScore_greater: Int, $season: MediaSeason, $seasonYear: Int,
    $format: MediaFormat, $isAdult: Boolean, $countryOfOrigin: CountryCode) {
    Page(page: $page, perPage: $perPage) {
        ${pageInfo}
        media(type: ANIME, search: $search, sort: $sort, status_in: $status, genre_in: $genres, tag_in: $tags,
            averageScore_greater: $averageScore_greater, season: $season, seasonYear: $seasonYear, format: $format,
            isAdult: $isAdult, countryOfOrigin: $countryOfOrigin) { ${animeFields} }
    }
}`

/**
 * The search for a file's or folder's title (library scan and folder suggestions, phase 5b-2): only what matching and the
 * pickers need. LIST_ANIME's descriptions, genres and trailers made the answer many times larger; reading it held the
 * screens' thread 36.0 ms on the tablet (docs/EIGENER-KERN.md §4p).
 */
export const SEARCH_FILE_MATCH = `query SearchFileMatch($search: String) {
    Page(page: 1, perPage: 10) {
        media(type: ANIME, search: $search, sort: [SEARCH_MATCH]) {
            id idMal siteUrl status(version: 2) season type format seasonYear episodes synonyms isAdult ${title} ${cover} startDate ${date}
        }
    }
}`

/** The variables LIST_ANIME declares; anything else in a request is not passed on */
export const LIST_ANIME_VARIABLES = ["page", "search", "perPage", "sort", "status", "genres", "tags", "averageScore_greater", "season", "seasonYear", "format", "isAdult", "countryOfOrigin"]

export const LIST_MANGA = `query ListManga($page: Int, $search: String, $perPage: Int, $sort: [MediaSort], $status: [MediaStatus],
    $genres: [String], $tags: [String], $averageScore_greater: Int, $startDate_greater: FuzzyDateInt,
    $startDate_lesser: FuzzyDateInt, $format: MediaFormat, $isAdult: Boolean, $countryOfOrigin: CountryCode) {
    Page(page: $page, perPage: $perPage) {
        ${pageInfo}
        media(type: MANGA, search: $search, sort: $sort, status_in: $status, genre_in: $genres, tag_in: $tags,
            averageScore_greater: $averageScore_greater, startDate_greater: $startDate_greater, startDate_lesser: $startDate_lesser,
            format: $format, isAdult: $isAdult, countryOfOrigin: $countryOfOrigin) { ${mangaFields} volumes }
    }
}`

export const LIST_MANGA_VARIABLES = ["page", "search", "perPage", "sort", "status", "genres", "tags", "averageScore_greater", "format", "isAdult", "countryOfOrigin"]

export const LIST_RECENT_AIRING = `query ListRecentAiring($page: Int, $perPage: Int, $airingAt_greater: Int, $airingAt_lesser: Int,
    $notYetAired: Boolean, $sort: [AiringSort]) {
    Page(page: $page, perPage: $perPage) {
        ${pageInfo}
        airingSchedules(notYetAired: $notYetAired, airingAt_greater: $airingAt_greater, airingAt_lesser: $airingAt_lesser, sort: $sort) {
            id airingAt episode timeUntilAiring media { ${animeFields} ${nextEpisode} }
        }
    }
}`

export const LIST_RECENT_AIRING_VARIABLES = ["page", "perPage", "airingAt_greater", "airingAt_lesser", "notYetAired", "sort"]

const statFields = "count meanScore minutesWatched chaptersRead mediaIds"

export const VIEWER_STATS = `query ViewerStats {
    Viewer {
        statistics {
            anime {
                count minutesWatched episodesWatched meanScore
                genres { genre ${statFields} }
                formats { format ${statFields} }
                statuses { status ${statFields} }
                studios { studio { id name isAnimationStudio } ${statFields} }
                scores { score ${statFields} }
                startYears { startYear ${statFields} }
                releaseYears { releaseYear ${statFields} }
            }
            manga {
                count chaptersRead meanScore
                genres { genre ${statFields} }
                statuses { status ${statFields} }
                scores { score ${statFields} }
                startYears { startYear ${statFields} }
                releaseYears { releaseYear ${statFields} }
            }
        }
    }
}`

/** The number of the account a token belongs to (the guard before a change, changes.ts) */
export const VIEWER_ID = "query ViewerId { Viewer { id } }"

/** The signed-in user's own entry for one title, or null */
export const VIEWER_ENTRY = `query ViewerEntry($id: Int) { Media(id: $id) { mediaListEntry { ${entryFields} } } }`

/**
 * Creates or changes the user's entry for one title. Only the variables sent are changed; the answer is the entry with
 * its title, in the form the lists carry.
 */
export function saveEntryMutation(kind: "ANIME" | "MANGA"): string {
    const media = kind === "ANIME" ? `${animeFields} ${nextEpisode}` : mangaFields
    return `mutation SaveEntry($mediaId: Int, $status: MediaListStatus, $scoreRaw: Int, $progress: Int, $repeat: Int,
        $startedAt: FuzzyDateInput, $completedAt: FuzzyDateInput) {
        SaveMediaListEntry(mediaId: $mediaId, status: $status, scoreRaw: $scoreRaw, progress: $progress, repeat: $repeat,
            startedAt: $startedAt, completedAt: $completedAt) { ${entryFields} media { ${media} } }
    }`
}

export const DELETE_ENTRY = "mutation DeleteEntry($id: Int) { DeleteMediaListEntry(id: $id) { deleted } }"

/** One anime as lists show it, for the online streams' search (§4m) and the media of their episode list */
export const ANIME_BASE = `query AnimeBase($id: Int) { Media(id: $id, type: ANIME) { ${animeFields} } }`

/** An anime as its page in the library carries it (phase 5a-1): the fields of the lists and the next episode to air */
export const ENTRY_MEDIA = `query EntryMedia($id: Int) { Media(id: $id, type: ANIME) { ${animeFields} ${nextEpisode} } }`

/** One manga as the lists show it, with the user's entry for it (or null), for the manga page in the core (§4n) */
export const MANGA_WITH_ENTRY = `query MangaWithEntry($id: Int) { Media(id: $id, type: MANGA) { ${mangaFields} mediaListEntry { ${entryFields} } } }`

/** The details of a manga page (§4n): the fields of the recorded answer */
export const MANGA_DETAILS = `query MangaDetails($id: Int) {
    Media(id: $id, type: MANGA) {
        siteUrl id genres
        tags { name rank isMediaSpoiler isGeneralSpoiler }
        staff(sort: [RELEVANCE], perPage: 25) { edges { role node { name { full } id } } }
        rankings { context type rank year format allTime season }
        characters(sort: [ROLE]) {
            edges { id role node { id isFavourite gender dateOfBirth ${date} name { full native } image { large } siteUrl } }
        }
        recommendations(page: 1, perPage: 8, sort: [RATING_DESC]) {
            edges { node { mediaRecommendation { id siteUrl status(version: 2) isAdult type format meanScore description chapters
                countryOfOrigin startDate ${date} endDate ${date} ${cover} ${title} } } }
        }
        relations { edges { relationType(version: 2) node { ${mangaFields} } } }
    }
}`

/**
 * The sequels of the user's completed anime (phase 5a-3, docs/EIGENER-KERN.md §4p): for a page of AniList numbers, each
 * anime's relations with the related anime as lists show it
 */
export const RELATED_ANIME = `query RelatedAnime($ids: [Int], $page: Int) { Page(page: $page, perPage: 25) { pageInfo { hasNextPage }
    media(id_in: $ids, type: ANIME) { id relations { edges { relationType(version: 2) node { ${animeFields} ${nextEpisode} } } } } } }`

/** The airing times of the episodes of a page of anime (phase 5a-3, the schedule) */
export const AIRING_SCHEDULES = `query AiringSchedules($ids: [Int], $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
    media(id_in: $ids, type: ANIME) { id airingSchedule(perPage: 50) { nodes { airingAt episode } } } } }`

/** Title and cover of anime and manga the History screen shows but the core never kept (playback.ts historyMedia) */
export const HISTORY_TITLES = `query HistoryTitles($ids: [Int], $page: Int) { Page(page: $page, perPage: 50) { pageInfo { hasNextPage }
    media(id_in: $ids) { id type format ${title} ${cover} } } }`
