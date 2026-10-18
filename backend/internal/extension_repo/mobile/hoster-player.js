/**
 * Hoster Player
 *
 * Opens the original hoster player (Filemoon, PlayN, ...) embedded in the app.
 *
 * Why: Filemoon (Byse) and PlayN (waaw) protect their streams with captcha / proof-of-work
 * attestation. Those cannot be resolved programmatically and must not be bypassed, so this plugin
 * embeds the hoster's own player page in an iframe — same as watching on the website, but without
 * leaving the app. Everything else keeps using Seanime's normal player.
 *
 * Works for every anime: episode + hoster links are read from the provider pages at runtime.
 */

function init() {
    $ui.register((ctx) => {

        ////////////////////////////////////////////////////////////////////////////////
        // Helpers
        ////////////////////////////////////////////////////////////////////////////////

        const H = {
            norm(value) {
                return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
            },

            cleanText(value) {
                return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
            },

            absolute(base, value) {
                if (!value) return null
                if (/^https?:\/\//i.test(value)) return value
                if (/^\/\//.test(value)) return "https:" + value
                if (value.charAt(0) === "/") return base + value
                return base + "/" + value
            },

            getAll(regex, text) {
                const out = []
                let m
                regex.lastIndex = 0
                while ((m = regex.exec(text)) !== null) {
                    out.push(m)
                    if (out.length > 3000) break
                }
                return out
            },

            escapeHtml(value) {
                return String(value || "")
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
            },

            similarity(a, b) {
                const x = H.norm(a)
                const y = H.norm(b)
                if (!x || !y) return 0
                if (x === y) return 1000
                if (x.indexOf(y) !== -1 || y.indexOf(x) !== -1) return 500 + Math.min(x.length, y.length)
                let hits = 0
                const words = y.split(/[^a-z0-9]+/).filter(Boolean)
                for (const w of words) {
                    if (w.length > 2 && x.indexOf(w) !== -1) hits++
                }
                return hits
            },

            slugCandidates(title) {
                const base = String(title || "").toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-+|-+$/g, "")
                const out = []
                const add = (value) => {
                    const v = String(value || "").replace(/^-+|-+$/g, "")
                    if (v && out.indexOf(v) === -1) out.push(v)
                }
                add(base)
                const noRoman = base.replace(/-[ivxlcdm]{1,6}$/, "")
                add(noRoman)
                add(noRoman.replace(/-\d{1,2}$/, ""))
                add(base.replace(/-(1st|2nd|3rd|4th|5th)-season$/, ""))
                add(noRoman.replace(/-(1st|2nd|3rd|4th|5th)-season$/, ""))
                return out
            },

            // ---- AniWorld ----

            async awSearch(query) {
                try {
                    const res = await ctx.fetch("https://aniworld.to/ajax/search", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "X-Requested-With": "XMLHttpRequest",
                            Referer: "https://aniworld.to/",
                        },
                        body: "keyword=" + encodeURIComponent(query),
                    })
                    const text = res.text()
                    if (!text) return []
                    let data
                    try { data = JSON.parse(text) } catch (e) { return [] }
                    if (!Array.isArray(data)) return []
                    return data
                        .filter((item) => item.link && item.link.indexOf("/anime/stream/") === 0)
                        .map((item) => ({
                            id: item.link.replace("/anime/stream/", ""),
                            title: H.cleanText(String(item.title || "").replace(/&#8230;/g, "...")),
                            url: "https://aniworld.to" + item.link,
                        }))
                } catch (e) {
                    return []
                }
            },

            async awLookup(title) {
                // 1) AJAX search (may be rate limited / empty)
                const results = await H.awSearch(title)
                if (results.length) {
                    results.sort((a, b) => H.similarity(title, b.title) - H.similarity(title, a.title))
                    return results[0]
                }
                // 2) Fallback: derive the slug from the title and probe the anime page
                const candidates = H.slugCandidates(title)
                for (const slug of candidates) {
                    try {
                        const html = (await ctx.fetch("https://aniworld.to/anime/stream/" + slug, {
                            headers: { Referer: "https://aniworld.to/" },
                        })).text()
                        if (html && html.indexOf("data-episode-id") !== -1) {
                            return { id: slug, title: title, url: "https://aniworld.to/anime/stream/" + slug }
                        }
                    } catch (e) {}
                }
                return null
            },

            collectAwRows(html, out) {
                const rows = H.getAll(/<tr[^>]*data-episode-id="(\d+)"[^>]*>[\s\S]*?<meta itemprop="episodeNumber" content="(\d+)"[\s\S]*?<a itemprop="url" href="([^"]+)"/g, html)
                for (const row of rows) {
                    out.push({ number: parseInt(row[2], 10), url: "https://aniworld.to" + row[3] })
                }
            },

            async awEpisodes(slug) {
                const base = "https://aniworld.to"
                const animeUrl = base + "/anime/stream/" + slug
                const html = (await ctx.fetch(animeUrl, { headers: { Referer: base + "/" } })).text()
                const episodes = []

                const seen = {}
                const pushRows = (rows, seasonNumber) => {
                    for (const row of rows) {
                        if (seen[row.url]) continue
                        seen[row.url] = true
                        episodes.push({
                            number: row.number,
                            season: seasonNumber,
                            label: seasonNumber > 1 ? "S" + seasonNumber + " F" + row.number : "F" + row.number,
                            url: row.url,
                        })
                    }
                }

                const seasons = H.getAll(/href="([^"]+\/staffel-(\d+))"[^>]*>\s*\d+\s*<\/a>/gi, html)
                if (seasons.length > 0) {
                    for (const season of seasons) {
                        const rows = []
                        try {
                            const seasonHtml = (await ctx.fetch(base + season[1], { headers: { Referer: animeUrl } })).text()
                            H.collectAwRows(seasonHtml, rows)
                        } catch (e) {}
                        pushRows(rows, parseInt(season[2], 10))
                    }
                } else {
                    const rows = []
                    H.collectAwRows(html, rows)
                    pushRows(rows, 1)
                }
                return episodes
            },

            awHosterTarget(html, hosterKey, priority) {
                const blocks = html.split(/<li/g)
                const key = H.norm(hosterKey)
                const findForLanguages = (languages) => {
                    const langs = Array.isArray(languages) && languages.length ? languages : [null]
                    for (const lang of langs) {
                        for (const block of blocks) {
                            const langMatch = block.match(/data-lang-key\s*=\s*["']([^"']+)["']/i)
                            if (lang !== null && (!langMatch || langMatch[1] !== lang)) continue
                            const icon = block.match(/class\s*=\s*["'][^"']*\bicon\s+([^"' ]+)/i)
                            if (!icon || H.norm(icon[1]) !== key) continue
                            const target = block.match(/data-link-target\s*=\s*["']([^"']+)["']/i)
                            if (target) return target[1]
                        }
                    }
                    return null
                }
                return findForLanguages(priority) || findForLanguages([])
            },

            async awEmbed(episodeUrl, hosterKey, priority) {
                const html = (await ctx.fetch(episodeUrl, { headers: { Referer: "https://aniworld.to/" } })).text()
                const target = H.awHosterTarget(html, hosterKey, priority)
                if (!target) throw new Error("AniWorld: " + hosterKey + " ist bei dieser Folge nicht verfuegbar.")
                const redirectUrl = H.absolute("https://aniworld.to", target)
                const head = await ctx.fetch(redirectUrl, { headers: { Referer: episodeUrl }, redirect: "manual" })
                const location = head.headers && (head.headers.Location || head.headers.location)
                if (location && /^https?:\/\//i.test(location)) return location
                return redirectUrl
            },

            // ---- AnimeToast ----

            async atSearch(query) {
                try {
                    const html = (await ctx.fetch("https://www.animetoast.cc/?s=" + encodeURIComponent(query))).text()
                    const results = []
                    const matches = H.getAll(/<div id="post-\d+"[^>]*>[\s\S]*?<h3><a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g, html)
                    for (const m of matches) {
                        const rawTitle = m[2]
                        results.push({
                            id: m[1].replace("https://www.animetoast.cc", "").replace(/^\//, "").replace(/\/$/, ""),
                            title: H.cleanText(rawTitle.replace(/\s*Ger\s*(Sub|Dub)\s*/gi, "")),
                            url: m[1],
                            subOrDub: rawTitle.toLowerCase().indexOf("dub") !== -1 ? "dub" : "sub",
                        })
                    }
                    return results
                } catch (e) {
                    return []
                }
            },

            atServerKey(label) {
                const value = H.norm(label)
                if (value.indexOf("voe") !== -1) return "voe"
                if (value.indexOf("playn") !== -1 || value.indexOf("waaw") !== -1) return "playn"
                if (value.indexOf("fmoon") !== -1 || value.indexOf("filemoon") !== -1) return "fmoon"
                if (value.indexOf("mp4upload") !== -1) return "mp4upload"
                if (value.indexOf("dood") !== -1) return "doodstream"
                if (value.indexOf("vidmoly") !== -1 || value === "vidm" || value === "v") return "vidmoly"
                return value
            },

            atParseTabs(html) {
                const tabs = []
                const headers = H.getAll(/<a[^>]*href=["']#multi_link_tab(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi, html)
                for (const header of headers) {
                    const id = header[1]
                    const label = H.cleanText(header[2])
                    const openRegex = new RegExp("<div[^>]*id=[\\\"']multi_link_tab" + id + "[\\\"'][^>]*>", "i")
                    const open = html.match(openRegex)
                    if (!open) continue
                    const start = html.indexOf(open[0]) + open[0].length
                    const end = html.indexOf("</div>", start)
                    if (end === -1) continue
                    tabs.push({ id: id, label: label, key: H.atServerKey(label), content: html.slice(start, end) })
                }
                return tabs
            },

            atEpisodeLinks(content) {
                const links = []
                const matches = H.getAll(/<a[^>]+href=["']([^"']*\?link=\d+[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, content)
                for (const m of matches) {
                    const label = H.cleanText(m[2])
                    const numbers = []
                    const numberRegex = /\d+/g
                    let nm
                    while ((nm = numberRegex.exec(label)) !== null) numbers.push(parseInt(nm[0], 10))
                    if (!numbers.length) continue
                    const range = label.indexOf("-") !== -1 && numbers.length >= 2
                    links.push({
                        href: m[1],
                        start: range ? Math.min(numbers[0], numbers[1]) : numbers[0],
                        end: range ? Math.max(numbers[0], numbers[1]) : numbers[0],
                    })
                }
                return links
            },

            async atEpisodes(animeUrl) {
                const html = (await ctx.fetch(animeUrl, { headers: { Referer: "https://www.animetoast.cc/" } })).text()
                const tabs = H.atParseTabs(html)
                const numbers = {}
                for (const tab of tabs) {
                    for (const link of H.atEpisodeLinks(tab.content)) {
                        for (let n = link.start; n <= link.end; n++) numbers[n] = true
                    }
                }
                return Object.keys(numbers)
                    .map((n) => ({ number: parseInt(n, 10), label: "F" + n }))
                    .sort((a, b) => a.number - b.number)
            },

            async atEmbed(animeUrl, episodeNumber, hosterKey) {
                const html = (await ctx.fetch(animeUrl, { headers: { Referer: "https://www.animetoast.cc/" } })).text()
                const tabs = H.atParseTabs(html)
                const tab = tabs.find((item) => item.key === hosterKey)
                if (!tab) throw new Error("AnimeToast: " + hosterKey + " ist bei diesem Anime nicht verfuegbar.")
                const link = H.atEpisodeLinks(tab.content).find((item) => episodeNumber >= item.start && episodeNumber <= item.end)
                if (!link) throw new Error(tab.label + " hat keinen Link fuer Folge " + episodeNumber + ".")

                const pageUrl = H.absolute("https://www.animetoast.cc", link.href)
                const page = (await ctx.fetch(pageUrl, { headers: { Referer: animeUrl } })).text()

                const block = page.match(/id=["']player-embed["'][^>]*>([\s\S]*?)<\/div>/i)
                const scope = block ? block[1] : page
                const hrefMatch = scope.match(/(?:href|src)=["']([^"']+)["']/i)
                if (!hrefMatch) throw new Error(tab.label + ": Player-Link nicht gefunden.")

                const playerUrl = H.absolute("https://www.animetoast.cc", hrefMatch[1])
                if (playerUrl.indexOf("https://www.animetoast.cc") === 0) {
                    const nested = (await ctx.fetch(playerUrl, { headers: { Referer: pageUrl } })).text()
                    const voe = nested.match(/<a[^>]+href=["'](https:\/\/voe\.sx\/[^"']+)["']/i)
                    if (voe) return voe[1]
                    const anyExternal = nested.match(/<a[^>]+href=["'](https?:\/\/(?!(?:www\.)?animetoast\.cc)[^"']+)["']/i)
                    if (anyExternal) return anyExternal[1]
                }
                return playerUrl
            },

            // ---- generic ----

            async lookup(providerKey, title) {
                if (providerKey === "aniworld") {
                    const entry = await H.awLookup(title)
                    if (!entry) throw new Error("Kein AniWorld-Eintrag fuer '" + title + "' gefunden.")
                    return entry
                }
                const results = await H.atSearch(title)
                if (!results.length) throw new Error("Kein AnimeToast-Eintrag fuer '" + title + "' gefunden.")
                results.sort((a, b) => H.similarity(title, b.title) - H.similarity(title, a.title))
                return results[0]
            },

            async episodes(providerKey, entry) {
                if (providerKey === "aniworld") return await H.awEpisodes(entry.id)
                return await H.atEpisodes(entry.url)
            },

            async embed(providerKey, entry, episode, hosterKey) {
                if (providerKey === "aniworld") {
                    if (!episode || !episode.url) throw new Error("Folge nicht gefunden.")
                    return await H.awEmbed(episode.url, hosterKey, ["3", "1", "2"])
                }
                return await H.atEmbed(entry.url, episode ? episode.number : 1, hosterKey)
            },
        }

        ////////////////////////////////////////////////////////////////////////////////
        // Providers
        ////////////////////////////////////////////////////////////////////////////////

        const PROVIDERS = [
            {
                key: "aniworld",
                label: "AniWorld",
                hosters: [
                    { key: "voe", label: "VOE" },
                    { key: "vidmoly", label: "VidMoly" },
                    { key: "doodstream", label: "Doodstream" },
                    { key: "filemoon", label: "Filemoon" },
                ],
            },
            {
                key: "animetoast",
                label: "AnimeToast",
                hosters: [
                    { key: "voe", label: "Voe" },
                    { key: "playn", label: "PlayN" },
                    { key: "fmoon", label: "FMoon" },
                    { key: "vidmoly", label: "VidM" },
                    { key: "mp4upload", label: "Mp4Upload" },
                    { key: "doodstream", label: "DoodStream" },
                ],
            },
        ]

        ////////////////////////////////////////////////////////////////////////////////
        // UI
        ////////////////////////////////////////////////////////////////////////////////

        const nav = ctx.screen.state()
        const S = {
            provider: "aniworld",
            title: "",
            entry: null,
            episodes: [],
            episode: null,
            busy: false,
        }

        let overlay = null
        let panel = null

        function providerDef() {
            return PROVIDERS.find((p) => p.key === S.provider) || PROVIDERS[0]
        }

        function panelHtml() {
            return [
                '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#141414;border-bottom:1px solid #2a2a2a;">',
                '<span style="font-weight:700;font-size:14px;color:#fff;">Hoster-Player</span>',
                '<span style="font-size:11px;color:#888;">Original-Player im App-Fenster (Filemoon, PlayN, ...)</span>',
                '<div style="flex:1"></div>',
                '<div id="hp-close" style="cursor:pointer;color:#bbb;font-size:18px;padding:0 6px;">&#10005;</div>',
                "</div>",
                '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 14px;border-bottom:1px solid #222;">',
                '<select id="hp-provider" style="background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:6px;padding:6px 8px;font-size:13px;">',
                '<option value="aniworld">AniWorld</option><option value="animetoast">AnimeToast</option>',
                "</select>",
                '<input id="hp-title" placeholder="Anime-Titel" style="background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:6px;padding:6px 8px;font-size:13px;min-width:240px;flex:1;" />',
                '<select id="hp-episode" style="background:#1b1b1b;color:#eee;border:1px solid #333;border-radius:6px;padding:6px 8px;font-size:13px;"></select>',
                '<button id="hp-load" style="background:#6152df;color:#fff;border:0;border-radius:6px;padding:7px 14px;font-size:13px;font-weight:600;cursor:pointer;">Laden</button>',
                "</div>",
                '<div id="hp-status" style="padding:6px 14px;font-size:12px;color:#999;"></div>',
                '<div id="hp-hosters" style="display:flex;flex-wrap:wrap;gap:8px;padding:0 14px 10px;"></div>',
                '<div id="hp-stage" style="position:relative;flex:1;background:#000;min-height:200px;"></div>',
            ].join("")
        }

        async function setStatus(text) {
            const el = panel ? await panel.queryOne("#hp-status") : null
            if (el) el.setText(text || "")
        }

        async function openOverlay() {
            try {
                const body = await ctx.dom.queryOne("body")
                if (!body) return
                if (!overlay) {
                    const existing = await ctx.dom.queryOne("[data-hp-overlay]")
                    if (existing) overlay = existing
                }
                if (!overlay) {
                    overlay = await ctx.dom.createElement("div")
                    await overlay.setDataAttribute("hpOverlay", "1")
                    await overlay.setAttribute("style", "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.94);display:flex;flex-direction:column;")
                    await body.append(overlay)

                    panel = await ctx.dom.createElement("div")
                    await panel.setAttribute("style", "display:flex;flex-direction:column;height:100%;width:100%;max-width:1500px;margin:0 auto;")
                    await panel.setInnerHTML(panelHtml())
                    await overlay.append(panel)

                    const close = await panel.queryOne("#hp-close")
                    if (close) close.addEventListener("click", () => { hideOverlay() })

                    const load = await panel.queryOne("#hp-load")
                    if (load) load.addEventListener("click", () => { doSearch() })

                    const providerSelect = await panel.queryOne("#hp-provider")
                    if (providerSelect) {
                        providerSelect.addEventListener("change", async () => {
                            const sel = await panel.queryOne("#hp-provider")
                            const value = sel ? (await sel.getProperty("value")) : "aniworld"
                            S.provider = value || "aniworld"
                            const hosters = await panel.queryOne("#hp-hosters")
                            if (hosters) await hosters.setInnerHTML("")
                            const stage = await panel.queryOne("#hp-stage")
                            if (stage) await stage.setInnerHTML("")
                            await setStatus("")
                        })
                    }

                    const episodeSelect = await panel.queryOne("#hp-episode")
                    if (episodeSelect) {
                        episodeSelect.addEventListener("change", async () => {
                            // the client event payload does not carry the input value — read it from the DOM
                            const sel = await panel.queryOne("#hp-episode")
                            if (!sel) return
                            const value = await sel.getProperty("value")
                            const idx = parseInt(value || "0", 10) || 0
                            S.episode = (S.episodes && S.episodes[idx]) || null
                        })
                    }

                    // prefill the title from the current media entry
                    const current = nav.get()
                    const mediaId = current && current.searchParams ? parseInt(current.searchParams.id || "0", 10) : 0
                    if (mediaId) {
                        try {
                            const entry = await ctx.anime.getAnimeEntry(mediaId)
                            const media = entry && entry.media
                            const title = media && media.title
                                ? (media.title.userPreferred || media.title.romaji || media.title.english)
                                : ""
                            if (title) {
                                S.title = title
                                const input = await panel.queryOne("#hp-title")
                                if (input) input.setProperty("value", title)
                            }
                        } catch (e) {}
                    }
                } else {
                    await overlay.setStyle("display", "flex")
                }
            } catch (e) {
                ctx.toast.error("Hoster-Player: " + (e && e.message ? e.message : e))
            }
        }

        async function hideOverlay() {
            if (!overlay) return
            await overlay.setStyle("display", "none")
        }

        async function doSearch() {
            if (S.busy) return
            S.busy = true
            try {
                const input = await panel.queryOne("#hp-title")
                if (input) {
                    const value = await input.getProperty("value")
                    if (value) S.title = String(value)
                }
                if (!S.title) {
                    await setStatus("Bitte Anime-Titel eingeben.")
                    return
                }
                const provider = providerDef()
                await setStatus("Suche auf " + provider.label + " ...")
                const entry = await H.lookup(provider.key, S.title)
                S.entry = entry
                await setStatus("Treffer: " + entry.title + " — lade Folgen ...")

                const episodes = await H.episodes(provider.key, entry)
                S.episodes = episodes
                const select = await panel.queryOne("#hp-episode")
                if (select) {
                    let html = ""
                    if (!episodes.length) {
                        html = '<option value="0">F1</option>'
                    } else {
                        for (let i = 0; i < episodes.length; i++) {
                            html += '<option value="' + i + '">' + H.escapeHtml(episodes[i].label || ("F" + episodes[i].number)) + "</option>"
                        }
                    }
                    await select.setInnerHTML(html)
                    const value = await select.getProperty("value")
                    const idx = parseInt(value || "0", 10) || 0
                    S.episode = episodes[idx] || episodes[0] || null
                }
                await setStatus(entry.title + ": " + episodes.length + " Folgen — Hoster waehlen")
                await renderHosters()
            } catch (e) {
                await setStatus("Fehler: " + (e && e.message ? e.message : e))
            } finally {
                S.busy = false
            }
        }

        async function renderHosters() {
            const provider = providerDef()
            const hosters = await panel.queryOne("#hp-hosters")
            if (!hosters) return
            let html = ""
            for (const hoster of provider.hosters) {
                html += '<div data-hoster="' + hoster.key + '" style="cursor:pointer;background:#222;color:#eee;border:1px solid #333;' +
                    'border-radius:6px;padding:8px 14px;font-size:13px;font-weight:600;">' + H.escapeHtml(hoster.label) + "</div>"
            }
            await hosters.setInnerHTML(html)
            for (const hoster of provider.hosters) {
                const el = await hosters.queryOne('[data-hoster="' + hoster.key + '"]')
                if (el) el.addEventListener("click", () => { playHoster(hoster) })
            }
        }

        async function playHoster(hoster) {
            if (!S.entry) return
            const provider = providerDef()
            await setStatus("Loese " + hoster.label + " auf ...")
            try {
                const url = await H.embed(provider.key, S.entry, S.episode, hoster.key)
                await setStatus(provider.label + " / " + hoster.label + " / " + (S.episode && S.episode.label ? S.episode.label : "Folge"))
                const stage = await panel.queryOne("#hp-stage")
                if (!stage) return
                await stage.setInnerHTML(
                    '<iframe src="' + H.escapeHtml(url) + '" referrerpolicy="no-referrer" ' +
                    'allow="autoplay; fullscreen; encrypted-media; picture-in-picture" ' +
                    'style="position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;"></iframe>')
            } catch (e) {
                await setStatus("Fehler: " + (e && e.message ? e.message : e))
            }
        }

        ctx.dom.onReady(() => {
            overlay = null
            panel = null
            ctx.screen.loadCurrent()
        })

        ctx.screen.loadCurrent()
    })
}
