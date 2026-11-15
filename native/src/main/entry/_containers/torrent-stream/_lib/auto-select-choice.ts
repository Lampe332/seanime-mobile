// geschrieben nach: dem App-Test 15.11. (S2): "Pick the best torrent" fiel nach jedem Verlassen der Seite auf die Einstellung zurück

/**
 * The page switch "Pick the best torrent" as the user left it, and the setting "Auto-select the best torrent" it was set
 * against. A change of the setting afterwards wins again (the choice was made against the old one).
 */
export type AutoSelectChoice = { value: boolean, setting: boolean }

/** The switch's value as the page opens: off without a mapping, else the remembered choice, else the setting. */
export function startAutoSelect({ mappingError, setting, saved }: {
    mappingError: boolean
    /** the torrent streaming setting; unknown until the server status is there */
    setting: boolean | undefined
    saved: AutoSelectChoice | null
}): boolean {
    if (mappingError) return false
    const fromSettings = setting ?? false
    return saved && saved.setting === fromSettings ? saved.value : fromSettings
}

/** What a flip of the switch remembers. */
export function rememberAutoSelect(value: boolean, setting: boolean | undefined): AutoSelectChoice {
    return { value, setting: setting ?? false }
}
