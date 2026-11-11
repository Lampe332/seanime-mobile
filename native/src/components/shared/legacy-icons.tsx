import React from "react"
import Svg, { Path } from "react-native-svg"

/**
 * Icons the old app drew from react-icons and that lucide has no match for, with the same paths (react-icons 5), so the
 * spots that showed them look the same: Home's Playlists action, the Continue pill of Continue watching, the airing badge.
 */
type IconProps = { size?: number, color?: string }

/** MdOutlineVideoLibrary: Home › Playlists (home-toolbar.tsx) */
export function VideoLibraryIcon({ size = 24, color = "#ffffff" }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2m0 14H8V4h12zM12 5.5v9l6-4.5z" />
        </Svg>
    )
}

/** FaCirclePlay: the filled play disc of the Continue pill (episode-card.tsx `home-resume-action`) */
export function CirclePlayFilledIcon({ size = 24, color = "#ffffff" }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox="0 0 512 512" fill={color}>
            <Path d="M0 256a256 256 0 1 1 512 0A256 256 0 1 1 0 256zM188.3 147.1c-7.6 4.2-12.3 12.3-12.3 20.9l0 176c0 8.7 4.7 16.7 12.3 20.9s16.8 4.1 24.3-.5l144-88c7.1-4.4 11.5-12.1 11.5-20.5s-4.4-16.1-11.5-20.5l-144-88c-7.4-4.5-16.7-4.7-24.3-.5z" />
        </Svg>
    )
}

/** BiPlay: the solid triangle of the empty Playlists sheet (mobile-playlists.tsx `.mp-empty`) */
export function PlaySolidIcon({ size = 24, color = "#ffffff" }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Path d="M7 6v12l10-6z" />
        </Svg>
    )
}

/** RiSignalTowerLine: the airing badge of a releasing anime's card (media-entry-card-components.tsx) */
export function SignalTowerIcon({ size = 24, color = "#ffffff" }: IconProps) {
    return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
            <Path d="M6.11629 20.0868L7.1308 18.348C5.2271 16.8856 4 14.5861 4 12C4 7.58172 7.58172 4 12 4C16.4183 4 20 7.58172 20 12C20 14.5861 18.7729 16.8856 16.8692 18.348L17.8837 20.0868C20.3786 18.2684 22 15.3236 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 15.3236 3.62137 18.2684 6.11629 20.0868ZM8.14965 16.6018C6.83562 15.5012 6 13.8482 6 12C6 8.68629 8.68629 6 12 6C15.3137 6 18 8.68629 18 12C18 13.8482 17.1644 15.5012 15.8503 16.6018L14.8203 14.8365C15.549 14.112 16 13.1087 16 12C16 9.79086 14.2091 8 12 8C9.79086 8 8 9.79086 8 12C8 13.1087 8.45105 14.112 9.17965 14.8365L8.14965 16.6018ZM11 13H13V22H11V13Z" />
        </Svg>
    )
}
