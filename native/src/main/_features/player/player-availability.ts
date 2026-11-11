/**
 * Whether the app has its own player. Before E3 every control that would start playback (an episode row, the "up next"
 * cards, Continue on Home, an offline episode) stayed disabled, because a stream started on the server without a player
 * to show it would run unseen. Since E3 the mpv player (`native-player.tsx`, mounted in the main layout) answers the
 * server's native player events, so playback is on (docs/NATIVE-UMBAU.md §9).
 */
export const IN_APP_PLAYER_READY: boolean = true
