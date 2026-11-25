// geschrieben nach: upcoming-widget.tsx (gleiche Bibliothek) und dem Home-Kachel-Look (continue-watching.tsx, tokens.ts).
// Rendered outside React by react-native-android-widget: the React Compiler's memo hooks would break it (see upcoming-widget.tsx).
"use no memo"
import React from "react"
import { FlexWidget, ImageWidget, TextWidget } from "react-native-android-widget"
import { entryLink } from "@/lib/app-links"
import { storedPalette } from "@/lib/theme/appearance"
import { accentTextHex } from "@/lib/theme/palette"
import { ContinueEntry, continueLayout, ROW } from "./continue-widget-data"

/*
 * The "Continue watching" widget: the app's dark surface (tokens.ts smSurface / smSurfaceRaised), rounded rows with the
 * cover, the title and "Episode N" in the accent. One cell high it shows the first row alone; taller, the head and up to
 * four rows. A row opens the anime's page (never the player), the head and the empty widget open the app.
 */
export const CONTINUE_WIDGET_NAME = "ContinueWatching"

export type ContinueWidgetProps = {
    entries: ContinueEntry[]
    heightDp: number
    title: string
    empty: string
    episodeText: (episode: number) => string
}

export function ContinueWidget({ entries, heightDp, title, empty, episodeText }: ContinueWidgetProps) {
    const layout = continueLayout(heightDp)
    const shown = entries.slice(0, layout.rows)
    /** "Episode N" in the accent the app was set to (read here: the widget renders without the app running) */
    const accent = accentTextHex(storedPalette()) as `#${string}`
    return (
        <FlexWidget style={{ height: "match_parent", width: "match_parent", backgroundColor: "#141416", borderRadius: 20, padding: 12, flexDirection: "column" }}>
            {layout.header && (
                <FlexWidget clickAction="OPEN_APP" style={{ width: "match_parent", height: 30, flexDirection: "row", alignItems: "center", paddingBottom: 8 }}>
                    <ImageWidget image={require("../../../assets/images/icon.png")} imageWidth={20} imageHeight={20} radius={10} />
                    <TextWidget text={title} style={{ color: "#EDEDF0", fontSize: 14, fontWeight: "bold", marginLeft: 8 }} maxLines={1} truncate="END" />
                </FlexWidget>
            )}
            {shown.length === 0 ? (
                <FlexWidget clickAction="OPEN_APP" style={{ width: "match_parent", height: "match_parent", justifyContent: "center", alignItems: "center" }}>
                    <TextWidget text={empty} style={{ color: "#B6B6BC", fontSize: 13, textAlign: "center" }} maxLines={3} />
                </FlexWidget>
            ) : shown.map((entry, index) => (
                <FlexWidget
                    key={entry.mediaId}
                    clickAction="OPEN_URI"
                    clickActionData={{ uri: entryLink(entry.mediaId) }}
                    style={{
                        width: "match_parent", height: layout.header ? ROW : "match_parent", marginTop: index > 0 ? 8 : 0,
                        flexDirection: "row", alignItems: "center", padding: 4, paddingRight: 12, backgroundColor: "#1C1C1F", borderRadius: 14,
                    }}
                >
                    <FlexWidget style={{ width: 34, height: 48, backgroundColor: "#26262A", borderRadius: 10 }}>
                        {entry.coverUrl.startsWith("https:") && (
                            <ImageWidget image={entry.coverUrl as `https:${string}`} imageWidth={34} imageHeight={48} radius={10} resizeMode="cover" />
                        )}
                    </FlexWidget>
                    <FlexWidget style={{ flex: 1, flexDirection: "column", marginLeft: 12 }}>
                        <TextWidget text={entry.title} style={{ width: "match_parent", color: "#EDEDF0", fontSize: 14, fontWeight: "bold" }} maxLines={1} truncate="END" />
                        <TextWidget text={episodeText(entry.episode)} style={{ color: accent, fontSize: 12, marginTop: 2 }} maxLines={1} />
                    </FlexWidget>
                </FlexWidget>
            ))}
        </FlexWidget>
    )
}
