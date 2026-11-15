import { rememberAutoSelect, startAutoSelect } from "@/main/entry/_containers/torrent-stream/_lib/auto-select-choice"
import { describe, expect, it } from "vitest"

describe("startAutoSelect", () => {
    it("follows the setting while nothing is remembered", () => {
        expect(startAutoSelect({ mappingError: false, setting: true, saved: null })).toBe(true)
        expect(startAutoSelect({ mappingError: false, setting: false, saved: null })).toBe(false)
        expect(startAutoSelect({ mappingError: false, setting: undefined, saved: null })).toBe(false)
    })

    it("keeps the switch off after leaving the page when it was turned off", () => {
        const saved = rememberAutoSelect(false, true)
        expect(startAutoSelect({ mappingError: false, setting: true, saved })).toBe(false)
    })

    it("keeps the switch on when it was turned on against the setting", () => {
        const saved = rememberAutoSelect(true, false)
        expect(startAutoSelect({ mappingError: false, setting: false, saved })).toBe(true)
    })

    it("lets a later change of the setting win over the remembered choice", () => {
        const saved = rememberAutoSelect(false, true)
        expect(startAutoSelect({ mappingError: false, setting: false, saved })).toBe(false)
        const savedOn = rememberAutoSelect(true, false)
        expect(startAutoSelect({ mappingError: false, setting: true, saved: savedOn })).toBe(true)
        expect(startAutoSelect({ mappingError: false, setting: true, saved: rememberAutoSelect(false, false) })).toBe(true)
    })

    it("is off without a mapping, whatever was remembered", () => {
        expect(startAutoSelect({ mappingError: true, setting: true, saved: rememberAutoSelect(true, true) })).toBe(false)
    })
})
