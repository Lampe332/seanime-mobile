import { describe, expect, it } from "vitest"
import type { TrayIcon } from "./plugin-events"
import {
    animeButtonSymbol, backgroundImageUrl, buildWebviewHtml, cssLength, deliverToWebviewScript, forEpisodeType, forMediaKind, isAllowedPluginPath, isWebviewDocumentLoad, mangaButtonSymbol,
    parseWebviewMessage, pinnedTrayIcons, pluginBoxLook, pluginIconButton, pluginSelectOptions, replaceExtensionItems, togglePin, toNativeStyle, withTrayBadge, withTrayIcon,
} from "./plugin-logic"

const icon = (extensionId: string, extra: Partial<TrayIcon> = {}): TrayIcon => ({
    extensionId, extensionName: extensionId, iconUrl: "", withContent: true, tooltipText: "", badgeNumber: 0, badgeIntent: "info", width: "", minHeight: "", isDrawer: false, ...extra,
})

describe("plugin menus by place", () => {
    const items = [{ id: "lib", type: "library" }, { id: "dl", type: "undownloaded" }, { id: "ts", type: "torrentstream" }, { id: "db", type: "debridstream" },
        { id: "any" }]
    const ids = (keep: (item: { type?: string }) => boolean) => items.filter(keep).map(item => item.id)

    it("each episode list takes only its type", () => {
        expect(ids(forEpisodeType("undownloaded"))).toEqual(["dl"])
        expect(ids(forEpisodeType("torrentstream"))).toEqual(["ts"])
        expect(ids(forEpisodeType("debridstream"))).toEqual(["db"])
        expect(ids(forEpisodeType("library"))).toEqual(["lib"])
    })

    it("episode card items without a type show everywhere, grid items never", () => {
        expect(ids(forEpisodeType("undownloaded", true))).toEqual(["dl", "any"])
        expect(ids(forEpisodeType("onlinestream"))).toEqual([])
    })

    it("media card items by kind", () => {
        const cards = [{ id: "a", for: "anime" }, { id: "m", for: "manga" }, { id: "b", for: "both" }, { id: "x" }]
        expect(cards.filter(forMediaKind("anime")).map(c => c.id)).toEqual(["a", "b"])
        expect(cards.filter(forMediaKind("manga")).map(c => c.id)).toEqual(["m", "b"])
    })
})

describe("plugin event lists", () => {
    it("one plugin's new list replaces its old one and keeps the others, in plugin order", () => {
        let items = replaceExtensionItems<{ extensionId: string, id: string }>([], "plugin-10", [{ id: "a" }])
        items = replaceExtensionItems(items, "plugin-2", [{ id: "b" }, { id: "c" }])
        expect(items.map(i => `${i.extensionId}/${i.id}`)).toEqual(["plugin-2/b", "plugin-2/c", "plugin-10/a"])
        items = replaceExtensionItems(items, "plugin-2", [])
        expect(items.map(i => i.id)).toEqual(["a"])
    })

    it("keeps only the items a place takes (media card kind, episode type)", () => {
        const items = replaceExtensionItems<{ extensionId: string, id: string, for: string }>([], "p", [{ id: "1", for: "anime" }, { id: "2", for: "manga" }, { id: "3", for: "both" }],
            item => item.for === "anime" || item.for === "both")
        expect(items.map(i => i.id)).toEqual(["1", "3"])
    })

    it("a tray icon arrives once per plugin; a badge only changes its own plugin", () => {
        let icons = withTrayIcon([], icon("b"), "b")
        icons = withTrayIcon(icons, icon("a"), "a")
        icons = withTrayIcon(icons, icon("b", { extensionName: "B2" }), "b")
        expect(icons.map(i => i.extensionName)).toEqual(["a", "B2"])
        const badged = withTrayBadge(icons, "a", { badgeNumber: 3, badgeIntent: "alert" })
        expect(badged[0].badgeNumber).toBe(3)
        expect(withTrayBadge(badged, "a", { badgeNumber: 3, badgeIntent: "alert" })).toBe(badged)
    })

    it("pins keep their order, drop gone plugins and toggle", () => {
        const icons = [icon("a"), icon("b")]
        expect(pinnedTrayIcons(["b", "gone", "a", "b"], icons).map(i => i.extensionId)).toEqual(["b", "a"])
        expect(togglePin(["a"], "b")).toEqual(["a", "b"])
        expect(togglePin(["a", "b"], "a")).toEqual(["b"])
    })
})

describe("plugin buttons", () => {
    it("picks the symbols of the web's phone buttons", () => {
        expect(animeButtonSymbol("Opening themes")).toBe("music")
        expect(animeButtonSymbol("Watch order")).toBe("order")
        expect(animeButtonSymbol("Something")).toBe("puzzle")
        expect(mangaButtonSymbol("MangaUpdates")).toBe("link")
        expect(mangaButtonSymbol("Change source")).toBe("library")
    })

    it("keeps a button's own icon only from a web or image URL", () => {
        expect(backgroundImageUrl("url(\"https://x.org/i.png\")")).toBe("https://x.org/i.png")
        expect(backgroundImageUrl("url(data:image/png;base64,AAA)")).toBe("data:image/png;base64,AAA")
        expect(backgroundImageUrl("url(javascript:alert(1))")).toBeUndefined()
        expect(backgroundImageUrl(undefined)).toBeUndefined()
    })

    it("draws a label-less tray button by its background image (Random Entry, device run 06.11.)", () => {
        const style = { backgroundImage: "url(data:image/svg+xml;base64,AAA)", backgroundSize: "1.5rem" }
        expect(pluginIconButton("​", style)).toBe("data:image/svg+xml;base64,AAA")
        expect(pluginIconButton("", style)).toBe("data:image/svg+xml;base64,AAA")
        expect(pluginIconButton("Random", style)).toBeUndefined()
        expect(pluginIconButton("​", {})).toBeUndefined()
    })
})

describe("plugin select values", () => {
    it("keeps numeric values, including zero, and a saved value outside the presets", () => {
        const options = [{ label: "0%", value: 0 }, { label: "25%", value: 0.25 }]
        expect(pluginSelectOptions(options, 0).value).toBe("plugin-option-0")
        expect(pluginSelectOptions(options, 0).decode("plugin-option-1")).toBe(0.25)
        const odd = pluginSelectOptions(options, 0.7)
        expect(odd.options[0]).toMatchObject({ label: "0.7", value: "plugin-current" })
        expect(odd.decode(odd.value!)).toBe(0.7)
    })
})

describe("plugin styles", () => {
    it("converts lengths a native view can take", () => {
        expect(cssLength("12px")).toBe(12)
        expect(cssLength("1.5rem")).toBe(24)
        expect(cssLength("50%")).toBe("50%")
        expect(cssLength("calc(100% - 2px)")).toBeUndefined()
        expect(cssLength("10vh")).toBeUndefined()
    })

    it("takes the safe part of an inline style and drops web-only values", () => {
        expect(toNativeStyle({ padding: "1rem", color: "#fff", backgroundColor: "var(--x)", display: "grid", justifyContent: "end", opacity: "0.5", cursor: "pointer" }))
            .toEqual({ padding: 16, color: "#fff", justifyContent: "flex-end", opacity: 0.5 })
    })

    it("lets a fixed-height scroll box flow (one scroll in the window)", () => {
        expect(toNativeStyle({ height: "300px", maxHeight: "20rem", overflowY: "auto", width: "100%" })).toEqual({ width: "100%" })
    })

    it("turns outlined boxes into raised surfaces", () => {
        expect(pluginBoxLook("flex border rounded")).toBe("raised")
        expect(pluginBoxLook("border-b pb-2")).toBe("line")
        expect(pluginBoxLook("p-2")).toBeNull()
    })
})

describe("plugin navigation", () => {
    it("opens only pages with a native screen", () => {
        expect(isAllowedPluginPath("/entry?id=1")).toBe(true)
        expect(isAllowedPluginPath("/webview?id=plugin")).toBe(true)
        expect(isAllowedPluginPath("/debrid")).toBe(false)
        expect(isAllowedPluginPath("/entryx")).toBe(false)
        expect(isAllowedPluginPath(42)).toBe(false)
    })
})

describe("plugin HTML", () => {
    it("puts the bridge before the plugin's own scripts", () => {
        const html = buildWebviewHtml("<html><head><title>x</title></head><body><script>webview.send('a')</script></body></html>", "tok", "p-fixed")
        expect(html.indexOf("window.webview=")).toBeLessThan(html.indexOf("webview.send('a')"))
        expect(html.indexOf("<head>")).toBeLessThan(html.indexOf("window.webview="))
        expect(buildWebviewHtml("<div>fragment</div>", "tok", "p").startsWith("<script>")).toBe(true)
    })

    it("embeds the id and token as JS strings, never as code", () => {
        const html = buildWebviewHtml("", "a\"b", "x</script>")
        expect(html).toContain(JSON.stringify("a\"b"))
        expect(html).not.toContain("x</script>")
        expect(html).toContain("x\\u003c/script>")
    })

    it("takes only this page's bridge messages", () => {
        const ok = JSON.stringify({ type: "plugin-webview-trigger", event: "save", payload: { a: 1 }, webviewId: "p-fixed", token: "tok" })
        expect(parseWebviewMessage(ok, "p-fixed", "tok")).toEqual({ type: "plugin-webview-trigger", event: "save", payload: { a: 1 } })
        expect(parseWebviewMessage(ok, "p-fixed", "other")).toBeNull()
        expect(parseWebviewMessage(ok, "q-fixed", "tok")).toBeNull()
        expect(parseWebviewMessage("not json", "p-fixed", "tok")).toBeNull()
        expect(parseWebviewMessage(JSON.stringify({ type: "plugin-webview-resize", width: 10, height: 20, webviewId: "p-fixed", token: "tok" }), "p-fixed", "tok"))
            .toEqual({ type: "plugin-webview-resize", width: 10, height: 20 })
        expect(parseWebviewMessage(JSON.stringify({ type: "something-else", webviewId: "p-fixed", token: "tok" }), "p-fixed", "tok")).toBeNull()
    })

    it("delivers state as a message event and loads nothing but the page", () => {
        expect(deliverToWebviewScript({ type: "plugin-webview-sync", key: "k", value: "</script>", token: "t" })).toContain("new MessageEvent(\"message\"")
        expect(isWebviewDocumentLoad("about:blank")).toBe(true)
        expect(isWebviewDocumentLoad("https://example.com")).toBe(false)
        expect(isWebviewDocumentLoad("intent://x")).toBe(false)
    })
})
