const isAndroidApp = process.env.SEA_PUBLIC_PLATFORM === "mobile"

/*
 * Android: one app for phones and tablets. A tablet (main.tsx sets html[data-layout="tablet"], lib/tablet-ui.ts) shows the
 * phone screens, so every width media query above a phone width must resolve on it as on a phone held upright, while a phone
 * keeps the real query. Each such @media block is kept for phones, scoped to :not(tablet), and followed by a copy for tablets
 * whose width conditions above 430px are resolved (min-width: never, max-width: always). :where() adds no specificity, so the
 * cascade is the same as before on both. app/tablet.css lays the tablet out by its real width and is left alone.
 */
const PHONE_LAYOUT_WIDTH = 430
const TABLET = "[data-layout=\"tablet\"]"
const widthQueries = () => /\((min|max)-width:\s*([\d.]+)(px|rem|em)\)/g
const toPx = (value, unit) => Number(value) * (unit === "px" ? 1 : 16)

function hasWideQuery(params) {
    return [...params.matchAll(widthQueries())].some(([, , value, unit]) => toPx(value, unit) > PHONE_LAYOUT_WIDTH)
}

function asOnPhoneHeldUpright(params) {
    return params.replace(widthQueries(), (query, bound, value, unit) => {
        if (toPx(value, unit) <= PHONE_LAYOUT_WIDTH) return query
        return bound === "min" ? "(min-width: 100000px)" : "(max-width: 100000px)"
    })
}

/** A resolved query that cannot match: every alternative needs the impossible width and none is negated ("not all and"). */
function neverOnTablet(params) {
    return params.split(",").every(query => /\(min-width: 100000px\)/.test(query) && !/^\s*not\b/i.test(query))
}

function scope(selector, tablet) {
    const condition = tablet ? TABLET : `:not(${TABLET})`
    // a selector for the root element takes the condition itself; any other gets it as an ancestor
    if (/^\s*(html|:root)(?=$|[\s.:#[>+~])/.test(selector)) return selector.replace(/^(\s*)(html|:root)/, `$1$2:where(${condition})`)
    return `:where(html${condition}) ${selector}`
}

function scopeRules(node, tablet) {
    node.walkRules(rule => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return
        rule.selectors = rule.selectors.map(selector => scope(selector, tablet))
    })
}

const phoneAndTabletWidthQueries = {
    postcssPlugin: "seanime-phone-and-tablet-width-queries",
    OnceExit(root) {
        if (/tablet\.css$/.test(root.source?.input.file ?? "")) return
        const wide = []
        root.walkAtRules("media", atRule => {
            if (!hasWideQuery(atRule.params)) return
            // the outermost wide query only; queries nested in it are resolved with it
            for (let parent = atRule.parent; parent && parent.type !== "root"; parent = parent.parent) {
                if (parent.type === "atrule" && parent.name === "media" && hasWideQuery(parent.params)) return
            }
            wide.push(atRule)
        })
        for (const atRule of wide) {
            const tablet = atRule.clone()
            tablet.params = asOnPhoneHeldUpright(tablet.params)
            tablet.walkAtRules("media", nested => { nested.params = asOnPhoneHeldUpright(nested.params) })
            scopeRules(atRule, false)
            if (neverOnTablet(tablet.params)) continue
            scopeRules(tablet, true)
            atRule.after(tablet)
        }
    },
}

module.exports = {
    plugins: [
        require("tailwindcss"),
        require("autoprefixer"),
        ...(isAndroidApp ? [phoneAndTabletWidthQueries] : []),
    ],
}
