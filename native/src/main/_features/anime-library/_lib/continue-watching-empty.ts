// geschrieben nach: Befund S-scan #6 (15.11.2026) und dem Leerzustand von lists-phone.tsx (Knopf „Discover anime“)

/**
 * The ways on from Home's empty "Continue watching": the user's lists first (a series set to Watching shows here), then
 * Discover for something new. The first is the filled button, the second the quiet one.
 */
export const CONTINUE_WATCHING_EMPTY_ACTIONS = [
    { id: "lists", href: "/lists", labelEn: "Your lists", labelDe: "Deine Listen" },
    { id: "discover", href: "/discover", labelEn: "Discover anime", labelDe: "Anime entdecken" },
] as const satisfies readonly { id: string, href: string, labelEn: string, labelDe: string }[]
