// geschrieben nach: Nicks Vorgabe für den Bereich Legal (Impressum und Links der Website seanimemobile.com)

/** Settings › About › Legal: who runs the app, how to reach him, and the website's privacy policy and imprint. */
export const LEGAL = {
    name: "Nick Schäfer",
    region: "Kanton Basel-Landschaft, Switzerland",
    email: "info@seanimemobile.com",
    website: "https://seanimemobile.com",
    privacy: "https://seanimemobile.com/privacy",
    imprint: "https://seanimemobile.com/imprint",
} as const

/** The imprint in one line, as on the website: name · region · e-mail */
export function imprintLine() {
    return [LEGAL.name, LEGAL.region, LEGAL.email].join(" · ")
}

/** The link the Contact row hands to the mail app */
export function contactHref() {
    return `mailto:${LEGAL.email}`
}

/** The website without its scheme, as the row shows it */
export function shortLink(url: string) {
    return url.replace(/^https?:\/\//, "")
}
