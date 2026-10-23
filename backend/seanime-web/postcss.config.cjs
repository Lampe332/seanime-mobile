const isTabletEdition = process.env.SEA_PUBLIC_PLATFORM === "mobile" && process.env.SEA_PUBLIC_EDITION === "tablet"

// Tablet edition: the phone UI on a tablet. Width media queries above a phone width resolve as on a phone held upright.
const PHONE_LAYOUT_WIDTH = 430
const phoneWidthQueries = {
    postcssPlugin: "seanime-phone-width-queries",
    AtRule: {
        media(atRule) {
            atRule.params = atRule.params.replace(/\((min|max)-width:\s*([\d.]+)(px|rem|em)\)/g, (query, bound, value, unit) => {
                const px = Number(value) * (unit === "px" ? 1 : 16)
                if (px <= PHONE_LAYOUT_WIDTH) return query
                return bound === "min" ? "(min-width: 100000px)" : "(max-width: 100000px)"
            })
        },
    },
}

module.exports = {
    plugins: [
        require("tailwindcss"),
        require("autoprefixer"),
        ...(isTabletEdition ? [phoneWidthQueries] : []),
    ],
}
