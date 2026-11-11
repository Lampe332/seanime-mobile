// The widget is rendered outside React (react-native-android-widget calls the function itself): the React Compiler's
// memo hooks make that an "Invalid Hook Call" and the widget stays empty (device run 06.11., tablet). Keep it uncompiled.
"use no memo"
import React from "react"
import { FlexWidget, ImageWidget, ListWidget, SvgWidget, TextWidget } from "react-native-android-widget"
import { entryLink } from "@/lib/app-links"
import { countdown, WidgetEntry } from "./widget-cache"

/*
 * The "Upcoming anime" widget in the look of the old one (res/layout/widget_layout.xml, widget_item_anime.xml):
 * black, the round app logo and the title in the middle of the head, the refresh button at its right, rows of 85 dp
 * with a 55 dp cover (radius 8 on #1A1A1A), the title (white, 15, bold, one line) and the countdown in a dark pill.
 */
export const WIDGET_NAME = "UpcomingAnime"
export const REFRESH_ACTION = "REFRESH"

// android.R.drawable.ic_popup_sync: two circling arrows, light grey
const SYNC_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path fill="#BBBBBB" d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/></svg>`

export type UpcomingWidgetProps = {
    title: string
    /** text above the list: loading, an error, "As of 14:05" for an outdated list, or nothing */
    note: string | null
    entries: WidgetEntry[]
    nowSeconds: number
    episodeText: (episode: number, time: string) => string
}

export function UpcomingWidget({ title, note, entries, nowSeconds, episodeText }: UpcomingWidgetProps) {
    return (
        <FlexWidget style={{ height: "match_parent", width: "match_parent", backgroundColor: "#000000", padding: 12, flexDirection: "column" }}>
            <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
                {/* the refresh button is 24 dp wide: the same space on the left keeps logo and title in the middle */}
                <FlexWidget style={{ width: 24, height: 24 }} />
                <FlexWidget style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" }} clickAction="OPEN_APP">
                    <ImageWidget image={require("../../../assets/images/icon.png")} imageWidth={24} imageHeight={24} radius={12} />
                    <TextWidget text={title} style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "bold", marginLeft: 10 }} maxLines={1} truncate="END" />
                </FlexWidget>
                <FlexWidget style={{ width: 24, height: 24, padding: 2 }} clickAction={REFRESH_ACTION}>
                    <SvgWidget svg={SYNC_SVG} style={{ width: 20, height: 20 }} />
                </FlexWidget>
            </FlexWidget>
            {note !== null && (
                <TextWidget
                    text={note}
                    style={{ width: "match_parent", color: "#888888", fontSize: 14, textAlign: "center", marginBottom: 8 }}
                    maxLines={3}
                />
            )}
            <ListWidget style={{ height: "match_parent", width: "match_parent" }}>
                {entries.map(entry => (
                    <FlexWidget key={entry.mediaId} style={{ width: "match_parent", height: 95, paddingBottom: 10 }}>
                        <FlexWidget
                            clickAction="OPEN_URI"
                            clickActionData={{ uri: entryLink(entry.mediaId) }}
                            style={{
                                width: "match_parent", height: 85, flexDirection: "row", alignItems: "center", padding: 8,
                                backgroundColor: "#000000", borderWidth: 1, borderColor: "#222222", borderRadius: 12,
                            }}
                        >
                            <FlexWidget style={{ width: 55, height: 69, backgroundColor: "#1A1A1A", borderRadius: 8, overflow: "hidden" }}>
                                {entry.coverUrl.startsWith("https:") && (
                                    <ImageWidget image={entry.coverUrl as `https:${string}`} imageWidth={55} imageHeight={69} radius={8} resizeMode="cover" />
                                )}
                            </FlexWidget>
                            <FlexWidget style={{ flex: 1, flexDirection: "column", marginLeft: 14 }}>
                                <TextWidget
                                    text={entry.title}
                                    style={{ width: "match_parent", color: "#FFFFFF", fontSize: 15, fontWeight: "bold" }}
                                    maxLines={1}
                                    truncate="END"
                                />
                                <TextWidget
                                    text={episodeText(entry.episode, countdown(entry.airingAt - nowSeconds))}
                                    style={{
                                        color: "#BBBBBB", fontSize: 12, marginTop: 4, paddingHorizontal: 6, paddingVertical: 2,
                                        backgroundColor: "#1A1A1A", borderRadius: 4,
                                    }}
                                    maxLines={1}
                                />
                            </FlexWidget>
                        </FlexWidget>
                    </FlexWidget>
                ))}
            </ListWidget>
        </FlexWidget>
    )
}
