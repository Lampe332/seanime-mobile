/*
 * The page head's title row (`.ps-header`), the same height on every tab (r16, Nick 10.11., on purpose unlike 2.0.32/2.0.33):
 * the row is as tall as the title's line (Heading, 28/32dp). The 48dp icon buttons beside it overhang the row by 8dp above
 * and below instead of making it 48dp tall, so My lists, Search, Manga and Extensions put title, facts line and first
 * control where Discover, Downloads and Settings have them (before: 8dp / 16dp lower, the head jumped between tabs). The
 * row only gets lower, never higher: nothing moves into the space above the head (page-top.ts stays as it is).
 */
export const HEADING_LINE_HEIGHT = 32
export const HEAD_ACTION_SIZE = 48

/** How far the head's buttons reach above and below the title's line. */
export const HEAD_ACTION_OVERHANG = (HEAD_ACTION_SIZE - HEADING_LINE_HEIGHT) / 2

/** On the view that holds the head's buttons. */
export const HEAD_ACTIONS_STYLE = { marginVertical: -HEAD_ACTION_OVERHANG }
