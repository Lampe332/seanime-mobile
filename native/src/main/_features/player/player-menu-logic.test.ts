import { vc_initialSettings, type VideoCoreSettings } from "@/main/_features/video-core/video-core.atoms"
import { describe, expect, it } from "vitest"
import {
    assStyleCount,
    colourProperties,
    landscapeMenuPlacement,
    languageSummary,
    listSummary,
    narrowRows,
    mpvColor,
    ROW_LABEL_STYLE,
    rowValueMaxWidth,
    shortValue,
    stepSpeed,
    subtitleKind,
    subtitleLookProperties,
    timeBarPieces,
    TRANSLATE_LANGUAGES,
    TRANSLATE_PROVIDERS,
    translateLanguageLabel,
    translateModelValue,
    translateProviderChanges,
    translateSettings,
} from "./player-menu-logic"

const en = (english: string) => english
const settings = (patch: Partial<VideoCoreSettings> = {}): VideoCoreSettings => ({ ...vc_initialSettings, ...patch })
const props = (list: [string, string][]) => Object.fromEntries(list)

describe("player settings summaries", () => {
    it("names the default languages, a custom list as Custom", () => {
        expect(languageSummary(settings(), en)).toBe("English / Japanese")
        expect(languageSummary(settings({ preferredSubtitleLanguage: "de,ger,deu,german", preferredAudioLanguage: "fr" }), en)).toBe("German / Custom")
    })

    it("counts list entries", () => {
        expect(listSummary("", en)).toBe("None")
        expect(listSummary(" ^Intro$ , ,^Outro$", en)).toBe("2")
    })
})

describe("speed page", () => {
    it("steps 0.05 between 0.25x and 2x", () => {
        expect(stepSpeed(1, 0.05)).toBe(1.05)
        expect(stepSpeed(1.15, -0.05)).toBe(1.1)
        expect(stepSpeed(0.25, -0.05)).toBe(0.25)
        expect(stepSpeed(2, 0.05)).toBe(2)
    })
})

describe("subtitle look", () => {
    it("knows styled, plain and picture subtitles", () => {
        expect(subtitleKind("ass")).toBe("ass")
        expect(subtitleKind("subrip")).toBe("text")
        expect(subtitleKind("webvtt")).toBe("text")
        expect(subtitleKind("hdmv_pgs_subtitle")).toBeNull()
        expect(subtitleKind(undefined)).toBeNull()
    })

    it("counts the styles of an ASS header", () => {
        expect(assStyleCount("[V4+ Styles]\nFormat: Name\nStyle: Default,Arial\nStyle: Signs,Arial\n[Events]")).toBe(2)
        expect(assStyleCount(undefined)).toBe(0)
    })

    it("writes mpv colours with their opacity", () => {
        expect(mpvColor("#ffd700")).toBe("#FFFFD700")
        expect(mpvColor("#000000", 0.7)).toBe("#B3000000")
    })

    it("leaves ASS tracks their own look unless the styles are on and the track has one style", () => {
        expect(props(subtitleLookProperties(settings(), "ass", 1))["sub-ass-override"]).toBe("scale")
        const on = settings({ subtitleCustomization: { enabled: true, fontSize: 72, primaryColor: "#FFD700", outline: 4, shadow: 2, backColorOpacity: 150 } })
        expect(props(subtitleLookProperties(on, "ass", 2))["sub-ass-override"]).toBe("scale")
        expect(props(subtitleLookProperties(on, "ass", 1))).toMatchObject({
            "sub-ass-override": "force",
            "sub-font-size": "54",
            "sub-color": "#FFFFD700",
            "sub-border-color": "#FF000000",
            "sub-border-size": "4",
            "sub-shadow-offset": "2",
            "sub-shadow-color": "#69000000",
        })
    })

    it("draws plain subtitles like the web captions: a 70 % box by default, none at 0 %", () => {
        expect(props(subtitleLookProperties(settings(), "text", 0))).toMatchObject({
            "sub-font-size": "36",
            "sub-border-style": "background-box",
            "sub-back-color": "#B3000000",
            "sub-shadow-offset": "1",
        })
        const noBox = settings({ captionCustomization: { backgroundOpacity: 0, textShadow: 0, fontSize: 6.1 } })
        expect(props(subtitleLookProperties(noBox, "text", 0))).toMatchObject({
            "sub-font-size": "43.9",
            "sub-border-style": "outline-and-shadow",
            "sub-border-size": "0",
            "sub-shadow-offset": "0",
        })
    })

    it("keeps every kind on the video", () => {
        for (const kind of ["ass", "text", null] as const) {
            expect(props(subtitleLookProperties(settings(), kind, 0))).toMatchObject({ "sub-use-margins": "no", "sub-scale-with-window": "no" })
        }
    })
})

describe("player appearance", () => {
    it("Stronger colours: the web filter as mpv equalizer, off = 0", () => {
        expect(colourProperties(true, vc_initialSettings.videoEnhancement)).toEqual([["contrast", "5"], ["saturation", "10"], ["brightness", "2"]])
        expect(colourProperties(false, vc_initialSettings.videoEnhancement)).toEqual([["contrast", "0"], ["saturation", "0"], ["brightness", "0"]])
    })

    it("cuts the time bar at the chapters, else at the skip segments, and marks openings/endings", () => {
        const op = { start: 60, end: 150, label: "Opening" }
        expect(timeBarPieces(1400, [], [op])).toEqual([
            { start: 0, end: 60, skip: false },
            { start: 60, end: 150, skip: true },
            { start: 150, end: 1400, skip: false },
        ])
        expect(timeBarPieces(1400, [0, 60, 150, 1300], [op]).map(p => p.skip)).toEqual([false, true, false, false])
        expect(timeBarPieces(1400, [], [])).toEqual([{ start: 0, end: 1400, skip: false }])
        // an opening from 0 does not leave an empty first piece
        expect(timeBarPieces(1400, [], [{ start: 0, end: 90, label: "Opening" }])[0]).toEqual({ start: 0, end: 90, skip: true })
    })
})

describe("narrowRows", () => {
    it("drops the row icons in a group of 16em (256dp) or less, like the container query", () => {
        // S22 landscape: (784 - 2 × 8) / 3 = 256 per group
        expect(narrowRows(256)).toBe(true)
        expect(narrowRows(254)).toBe(true)
        expect(narrowRows(257)).toBe(false)
        // portrait: one full-width column without a set width
        expect(narrowRows(undefined)).toBe(false)
    })
})

describe("landscapeMenuPlacement", () => {
    const gear = { x: 1100, y: 14, width: 48, height: 48 }

    it("keeps the tablet menu 16dp inside the right edge and off the bottom (collisionPadding)", () => {
        // 1280×800 dp: 50rem wide, centred under the gear would end at 1524 → shifted to 1280 − 800 − 16
        expect(landscapeMenuPlacement({ width: 1280, height: 800 }, gear, true)).toEqual({ width: 800, top: 66, left: 464, maxHeight: 718 })
    })

    it("lets a phone's menu touch the screen edge as before", () => {
        // S22 quer 823×384 dp: 800 wide → from 23 (screen − width), no padding off the height
        expect(landscapeMenuPlacement({ width: 823, height: 384 }, { x: 700, y: 4, width: 44, height: 44 }, false))
            .toEqual({ width: 800, top: 52, left: 23, maxHeight: 332 })
        expect(landscapeMenuPlacement({ width: 823, height: 384 }, { x: 0, y: 4, width: 44, height: 44 }, false).left).toBe(0)
    })

    it("lets long values take 62 % only on a tablet", () => {
        expect(rowValueMaxWidth(true)).toBe("62%")
        expect(rowValueMaxWidth(false)).toBe("45%")
    })

    it("never squeezes a row label below its 6em, so a long value moves under it (tablet: \"Languag|es\")", () => {
        // `flex: 1 1 6em` at 15dp; Yoga only breaks the wrapping row at the label's 6em when it is also the minimum
        expect(ROW_LABEL_STYLE.flexBasis).toBe(90)
        expect(ROW_LABEL_STYLE.minWidth).toBe(ROW_LABEL_STYLE.flexBasis)
        // tablet, narrow 256dp group (232dp inside): 90 + 12 gap + "English / Japanese" 133dp > 232 → the value wraps;
        // the S22's 45 % (104dp) still fits beside the label: 90 + 12 + 104 + 12 + 12 (chevron) ≤ 232
        expect(90 + 12 + 133).toBeGreaterThan(232)
        expect(90 + 12 + 0.45 * 232 + 12 + 12).toBeLessThanOrEqual(232)
    })
})

describe("translate subtitles settings", () => {
    it("falls back to the old defaults", () => {
        expect(translateSettings(undefined)).toEqual({
            enabled: false, provider: "google", target: "en", hasKey: false, apiKey: "",
            baseUrl: "http://localhost:1234/v1", model: "local-model", usesOpenAI: false,
        })
        expect(translateSettings({ vcTranslate: true, vcTranslateProvider: "openai", vcTranslateApiKey: "k" })).toMatchObject({
            enabled: true, provider: "openai", model: "gpt-4o-mini", usesOpenAI: true, hasKey: true,
        })
    })

    it("labels the target language, the server default as its code", () => {
        expect(translateLanguageLabel("en-US")).toBe("English (US)")
        expect(translateLanguageLabel("en")).toBe("en")
        expect(TRANSLATE_LANGUAGES).toHaveLength(51)
        expect(TRANSLATE_PROVIDERS.map(p => p.value)).toEqual(["google", "deepl", "openai", "openai-compatible"])
    })

    it("stores a provider's defaults along with it", () => {
        expect(translateProviderChanges("google", {})).toEqual([["vcTranslateProvider", "google"]])
        expect(translateProviderChanges("openai", { vcTranslateModel: "local-model" })).toEqual([["vcTranslateProvider", "openai"], ["vcTranslateModel", "gpt-4o-mini"]])
        expect(translateProviderChanges("openai-compatible", {})).toEqual([
            ["vcTranslateProvider", "openai-compatible"], ["vcTranslateBaseUrl", "http://localhost:1234/v1"], ["vcTranslateModel", "local-model"],
        ])
        expect(translateProviderChanges("openai-compatible", { vcTranslateModel: "m", vcTranslateBaseUrl: "http://x" })).toEqual([["vcTranslateProvider", "openai-compatible"]])
        expect(translateModelValue("openai", "local-model")).toBe("gpt-4o-mini")
        expect(translateModelValue("openai-compatible", "")).toBe("")
    })

    it("shortens long values", () => {
        expect(shortValue("http://localhost:1234/v1")).toBe("http://localhost:12…")
        expect(shortValue("gpt-4o-mini")).toBe("gpt-4o-mini")
    })
})
