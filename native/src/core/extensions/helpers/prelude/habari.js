// geschrieben nach: goja_plugin_types/core.d.ts ($habari.Metadata, $habari.parse), aufgezeichneten torrentMetadata des Servers (docs/EIGENER-KERN.md §6) und öffentlich beschriebenen Namens-Konventionen von Anime-Releases (Gruppe in eckigen Klammern, SxxExx, Auflösung, Codec, CRC32); keine Vorlage

/*
 * $habari.parse: reads what a release's file name says (title, episode, season, group, resolution …) and gives it as
 * the contract's Metadata. Own reader: the name is cut into words (by spaces, dots, underscores, commas) and groups
 * in brackets; known words fill their fields; the episode is taken by the strongest sign there is (SxxExx, a word
 * like "Episode", a number after " - ", the last free number); the title is what stands before all of that.
 */

const EXTENSIONS = new Set(["mkv", "mp4", "avi", "m4v", "webm", "wmv", "flv", "ts", "m2ts", "ogm", "mov", "rmvb", "3gp", "mpg", "mpeg"])

/** Words (lower case) and the field they fill; several words in a row are written with a space */
const KEYWORDS = new Map()
function keywords(field, words) {
    for (const word of words) KEYWORDS.set(word.toLowerCase(), field)
}
keywords("audio_term", ["AAC", "AACX2", "AACX3", "AACX4", "AC3", "EAC3", "E-AC-3", "FLAC", "FLACX2", "FLACX3", "FLACX4", "Lossless", "MP3", "OGG", "Vorbis", "Opus", "DTS", "DTS-ES", "DTS5.1", "TrueHD", "TrueHD5.1", "DD5.1", "DDP", "DDP5.1", "AAC2.0", "AAC5.1", "Dual Audio", "Dual-Audio", "DualAudio", "Multi Audio", "Multi-Audio", "MultiAudio", "2.0CH", "5.1CH", "2ch", "6ch"])
keywords("video_term", ["8bit", "8-bit", "10bit", "10bits", "10-bit", "10-bits", "Hi10", "Hi10P", "Hi444", "Hi444P", "Hi444PP", "H264", "H.264", "H265", "H.265", "X264", "X265", "AVC", "HEVC", "HEVC2", "DivX", "DivX5", "DivX6", "XviD", "AV1", "VP9", "HDR", "HDR10", "DV", "Dolby Vision", "HD", "FHD", "SD", "UHD", "BT.709", "BT.2020", "AVI", "RMVB", "WMV", "WMV3", "WMV9", "23.976FPS", "24FPS", "29.97FPS", "30FPS", "60FPS", "120FPS"])
keywords("source", ["BD", "BDRip", "BluRay", "Blu-Ray", "Blu Ray", "BD-Rip", "DVD", "DVD5", "DVD9", "DVD-R2J", "DVDRip", "DVD-Rip", "R2DVD", "R2J", "R2JDVD", "R2JDVDRip", "HDTV", "HDTVRip", "TVRip", "TV-Rip", "WebCast", "WEB", "WEB-DL", "WEBDL", "WEB-Rip", "WEBRip", "AMZN", "CR", "NF", "DSNP"])
keywords("subtitles", ["Sub", "Subs", "Subbed", "Dub", "Dubbed", "Multi-Subs", "Multi Subs", "MultiSub", "MultiSubs", "Multi-Sub", "Multiple Subtitle", "Multiple Subtitles", "Softsub", "Softsubs", "Hardsub", "Hardsubs", "ASS", "SRT", "Eng Subs", "Big5", "Dual Sub", "Dual-Sub", "VOSTFR"])
keywords("language", ["English", "Eng", "Japanese", "Jpn", "Jap", "German", "Ger", "Deutsch", "French", "Fre", "Italian", "Ita", "Russian", "Rus", "Chinese", "Chi", "Korean", "Kor", "Portuguese", "Por", "Arabic", "Ara"])
keywords("release_information", ["Batch", "Complete", "Patch", "Remux", "Remastered", "Uncensored", "Uncut", "Repack"])
keywords("device_compatibility", ["iPad3", "iPhone5", "iPod", "PS3", "Xbox", "Xbox360", "Android"])
keywords("anime_type", ["OVA", "OVAs", "ONA", "ONAs", "OAD", "OADs", "OAV", "OAVs", "Movie", "Movies", "Specials", "SP", "ED", "OP", "NCED", "NCOP", "PV", "Preview", "Teaser", "Trailer"])

const EPISODE_WORDS = new Set(["episode", "episodes", "ep", "eps", "episódio", "episodio", "capitulo", "capítulo", "cap", "folge", "épisode"])
const SEASON_WORDS = new Set(["season", "seasons", "saison", "temporada", "staffel"])
const VOLUME_WORDS = new Set(["vol", "volume", "volumes"])
const PART_WORDS = new Set(["part", "parts", "teil"])
const OPEN = "[({【「『"
const CLOSE = "])}】」』"
const DELIMITERS = /[\s_.,]/

/**
 * Cuts the name into words. Each word knows where it stands in the name (for the title, which keeps the name's own
 * spelling), whether it stands in brackets (and which group of brackets), and which kind of bracket.
 */
function words(name) {
    const out = []
    let group = -1
    let bracket = ""
    let groups = 0
    let start = -1
    const end = at => {
        if (start >= 0) out.push({ text: name.slice(start, at), start, end: at, group, bracket, field: null })
        start = -1
    }
    for (let i = 0; i < name.length; i++) {
        const character = name[i]
        const opening = OPEN.indexOf(character)
        if (opening >= 0 && group < 0) {
            end(i)
            group = groups++
            bracket = character
            out.push({ text: character, start: i, end: i + 1, group, bracket, field: "open" })
            continue
        }
        if (group >= 0 && CLOSE.indexOf(character) === OPEN.indexOf(bracket)) {
            end(i)
            out.push({ text: character, start: i, end: i + 1, group, bracket, field: "close" })
            group = -1
            bracket = ""
            continue
        }
        // a dot inside a number (5.1, H.264) and a dash inside a word (Multi-Subs) stay part of the word
        if (DELIMITERS.test(character) && !(character === "." && start >= 0 && keepsDot(name.slice(start, i), name.slice(i + 1)))) {
            end(i)
            continue
        }
        if (start < 0) start = i
    }
    end(name.length)
    return out.filter(word => word.text.length > 0)
}

/** H.264, Ep.12, 5.1, 29.97FPS stay one word; "4.720p" are two */
function keepsDot(before, after) {
    if (/^[A-Za-z]{1,3}$/.test(before)) return /^\d/.test(after)
    return /^(\d{1,2}|[A-Za-z]{2,3}\d)$/.test(before) && /^\d{1,2}(?:\D|$)/.test(after) && !/^\d{1,2}[pP]/.test(after)
}

const isNumber = text => /^\d{1,4}$/.test(text)

/** Marks keywords, also two words in a row ("Dual Audio", "Blu Ray") */
function markKeywords(list) {
    const firstFree = list.find(word => word.group < 0)
    const lastOutside = list.filter(word => word.group < 0).pop()
    for (let i = 0; i < list.length; i++) {
        const word = list[i]
        if (word.field) continue
        // the scene's "…H.264-GROUP" at the very end: the keyword, then the group
        const scene = word === lastOutside ? /^(.+)-([A-Za-z0-9]+)$/.exec(word.text) : null
        if (scene && KEYWORDS.has(scene[1].toLowerCase())) {
            word.field = KEYWORDS.get(scene[1].toLowerCase())
            word.sceneGroup = scene[2]
            word.text = scene[1]
            continue
        }
        // "Movie Title (2019)": a type word that opens the title belongs to it
        if (word === firstFree && KEYWORDS.get(word.text.toLowerCase()) === "anime_type") continue
        const next = list[i + 1]
        if (next && !next.field && next.group === word.group) {
            const pair = KEYWORDS.get(`${word.text} ${next.text}`.toLowerCase())
            if (pair) {
                word.field = pair
                word.joined = next
                next.field = "joined"
                continue
            }
        }
        const field = KEYWORDS.get(word.text.toLowerCase())
        // "HEVC-265": the codec with its number written on
        const codec = /^([A-Za-z0-9.]+)-\d{3}$/.exec(word.text)
        if (field) word.field = field
        else if (codec && KEYWORDS.get(codec[1].toLowerCase()) === "video_term") {
            word.field = "video_term"
            word.text = codec[1]
        }
        else if (/^\d{3,4}[pi]$/i.test(word.text) || /^\d{3,4}x\d{3,4}[pi]?$/i.test(word.text) || /^(4k|2k|8k)$/i.test(word.text)) word.field = "video_resolution"
        else if (/^[0-9A-F]{8}$/i.test(word.text) && /\d/.test(word.text)) word.field = "file_checksum"
        else if (/^v\d{1,2}$/i.test(word.text)) word.field = "release_version"
    }
}

/** Episode, season, volume and part signs inside a single word: S01E05, 1x05, E05, Ep05, 05v2, #05 */
function markCombined(list, found) {
    for (const word of list) {
        if (word.field) continue
        let match = /^S(\d{1,2})E(\d{1,4})(?:v(\d))?$/i.exec(word.text)
        if (match) {
            word.field = "episode"
            found.season.push(match[1])
            found.episode.push(match[2])
            if (match[3]) found.version.push(match[3])
            continue
        }
        match = /^S(\d{1,2})$/i.exec(word.text) ?? /^(\d{1,2})(?:st|nd|rd|th)$/i.exec(word.text)
        if (match && (/^S/i.test(word.text) || SEASON_WORDS.has(String(list[list.indexOf(word) + 1]?.text).toLowerCase()))) {
            word.field = "season"
            found.season.push(match[1])
            continue
        }
        match = /^(\d{1,2})x(\d{1,4})$/i.exec(word.text)
        if (match) {
            word.field = "episode"
            found.season.push(match[1])
            found.episode.push(match[2])
            continue
        }
        match = /^(?:E|Ep|Episode|#)\.?(\d{1,4})(?:v(\d))?$/i.exec(word.text)
        if (match) {
            word.field = "episode"
            found.episode.push(match[1])
            if (match[2]) found.version.push(match[2])
            continue
        }
        match = /^(\d{1,4})v(\d{1,2})$/i.exec(word.text)
        if (match) {
            word.field = "episode"
            found.episode.push(match[1])
            found.version.push(match[2])
        }
    }
}

/** A word like "Episode", "Season", "Vol" followed by a number */
function markPrefixed(list, found) {
    for (let i = 0; i < list.length - 1; i++) {
        const word = list[i]
        const next = list[i + 1]
        if (word.field || next.field || next.group !== word.group || !isNumber(next.text)) continue
        const lower = word.text.toLowerCase()
        const into = EPISODE_WORDS.has(lower) ? found.episode : SEASON_WORDS.has(lower) ? found.season : VOLUME_WORDS.has(lower) ? found.volume : PART_WORDS.has(lower) ? found.part : null
        if (!into) continue
        into.push(next.text)
        word.field = "prefix"
        next.field = EPISODE_WORDS.has(lower) ? "episode" : "number"
        i++
    }
}

export function parse(filename) {
    let name = String(filename)
    const metadata = {}
    const extension = /\.([A-Za-z0-9]{2,4})$/.exec(name)
    if (extension && EXTENSIONS.has(extension[1].toLowerCase())) {
        metadata.file_extension = extension[1]
        name = name.slice(0, -extension[0].length)
    }
    metadata.file_name = name

    const list = words(name)
    const found = { episode: [], season: [], volume: [], part: [], version: [] }
    markKeywords(list)
    markCombined(list, found)
    markPrefixed(list, found)
    const free = word => !word.field

    // a name that starts with a number and a dot ("12. The title") numbers an episode
    const leading = /^(\d{1,4})\.\s/.exec(name)
    if (!found.episode.length && leading && list[0] && free(list[0])) {
        list[0].field = "episode"
        found.episode.push(leading[1])
    }
    // a number after " - " outside of brackets
    if (!found.episode.length) {
        const dash = list.find(word => free(word) && word.group < 0 && /^\d{1,5}$/.test(word.text) && !/^(19|20)\d\d$/.test(word.text) && /\s[-–~]\s*$/.test(name.slice(0, word.start)))
        if (dash) {
            dash.field = "episode"
            found.episode.push(dash.text)
        }
    }
    // the year: a number from 1900 to 2099 in brackets
    const year = list.find(word => free(word) && word.group >= 0 && /^(19|20)\d\d$/.test(word.text))
    if (year) {
        year.field = "year"
        metadata.year = year.text
    }
    // the last free number outside of brackets, unless the name is nothing but a title and that number
    if (!found.episode.length) {
        const outside = list.filter(word => word.group < 0)
        const marked = list.some(word => word.field && word.field !== "open" && word.field !== "close" && word.group < 0)
        for (let i = outside.length - 1; i > 0; i--) {
            const word = outside[i]
            // one digit alone, a year or a resolution is no episode here; nor the 264 of "X 264"
            if (!free(word) || !/^\d{2,3}$/.test(word.text)) continue
            if (/^26[45]$/.test(word.text) && /^[xh]$/i.test(outside[i - 1]?.text ?? "")) continue
            const after = outside[i + 1]
            // "720 P" is a resolution written apart, "1 X 24" puts the episode after the X
            if (after && /^[pP]$/.test(after.text)) continue
            if (!list[list.indexOf(word) + 1] && !marked) break
            word.field = "episode"
            found.episode.push(word.text)
            break
        }
    }

    // the group: the first group in square brackets (or any brackets at the start) that holds no keyword
    const groupsOf = new Map()
    for (const word of list) {
        if (word.group < 0 || word.field === "open" || word.field === "close") continue
        if (!groupsOf.has(word.group)) groupsOf.set(word.group, [])
        groupsOf.get(word.group).push(word)
    }
    let releaseGroup = null
    for (const [, inside] of groupsOf) {
        const atStart = inside[0].start <= 2 || list[0]?.group === inside[0].group
        if (!(inside[0].bracket === "[" || atStart)) continue
        if (inside.some(word => word.field) || inside.every(word => /^\d+$/.test(word.text))) continue
        releaseGroup = inside
        break
    }
    if (!releaseGroup) {
        // a name that ends in round brackets: their last word, or the word before them when they hold a number
        const last = list[list.length - 1]
        if (last?.field === "close" && last.bracket === "(") {
            const inside = groupsOf.get(last.group) ?? []
            const word = inside.length && !/^\d+$/.test(inside[inside.length - 1].text) ? inside[inside.length - 1] : list[list.indexOf(list.find(item => item.group === last.group)) - 1]
            if (word && free(word)) releaseGroup = [word]
        }
    }
    if (releaseGroup) {
        metadata.release_group = name.slice(releaseGroup[0].start, releaseGroup[releaseGroup.length - 1].end).trim()
        for (const word of releaseGroup) word.field = "release_group"
    }
    else {
        const scene = list.find(word => word.sceneGroup)
        if (scene) metadata.release_group = scene.sceneGroup
    }

    // fields from keywords
    const lists = {}
    for (const word of list) {
        if (!word.field || ["open", "close", "joined", "episode", "season", "number", "prefix", "year", "release_group"].includes(word.field)) continue
        const text = word.joined ? name.slice(word.start, word.joined.end) : word.text
        if (word.field === "video_resolution") metadata.video_resolution = text
        else if (word.field === "file_checksum") metadata.file_checksum = text
        else if (word.field === "release_version") (lists.release_version ??= []).push(text.slice(1))
        else (lists[word.field] ??= []).push(text)
    }

    // the title: free words from the start (after a leading group) up to the first word that is something else
    // round brackets in the middle of a title without anything known in them belong to the title ("Show (PSP) Mode")
    const plainRound = group => list.every(word => word.group !== group || word.bracket === "(" && (!word.field || word.field === "open" || word.field === "close"))
    const isStop = word => word.field && word.field !== "joined" && !(word.group >= 0 && plainRound(word.group) && (word.field === "open" || word.field === "close")) ? true : word.group >= 0 && !plainRound(word.group)
    let first = 0
    while (first < list.length && (list[first].group >= 0 || list[first].field === "file_checksum")) first++
    let last = first
    while (last < list.length && !isStop(list[last])) last++
    if (last > first) {
        const title = name.slice(list[first].start, list[last - 1].end).replace(/[\s\-–~_.,:;]+$/, "").trim()
        if (title) {
            metadata.title = title
            // a name without spaces ("Show.Name.S01E02") uses dots or underscores for them
            metadata.formatted_title = /\s/.test(name) ? title : title.replace(/[._]+/g, " ")
        }
    }
    // the episode's title: free words right after the episode, up to the next keyword or bracket
    let episodeAt = list.findIndex(word => word.field === "episode")
    // an episode in brackets ("[Ep.12] - Its Title"): the title follows the closing bracket
    if (episodeAt >= 0 && list[episodeAt].group >= 0) episodeAt = list.findIndex(word => word.field === "close" && word.group === list[episodeAt].group)
    if (episodeAt >= 0 && list[episodeAt].group < 0 || list[episodeAt]?.field === "close") {
        let to = episodeAt + 1
        while (to < list.length && !isStop(list[to])) to++
        if (to > episodeAt + 1) {
            const text = name.slice(list[episodeAt + 1].start, list[to - 1].end).replace(/^[\s\-–~_.,:;]+|[\s\-–~_.,:;]+$/g, "")
            if (text) metadata.episode_title = text
        }
    }

    if (found.season.length) metadata.season_number = found.season
    if (found.part.length) metadata.part_number = found.part
    if (found.episode.length) metadata.episode_number = found.episode
    if (found.volume.length) metadata.volume_number = found.volume
    if (found.version.length) (lists.release_version ??= []).push(...found.version)
    Object.assign(metadata, lists)
    return metadata
}
