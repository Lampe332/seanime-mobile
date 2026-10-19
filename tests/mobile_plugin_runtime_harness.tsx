import { PluginActionModal } from "../backend/seanime-web/src/app/(main)/_features/plugin/actions/plugin-action-modal"
import { PluginCommandPalette } from "../backend/seanime-web/src/app/(main)/_features/plugin/command/plugin-command-palette"
import React from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "jotai"
import { PluginTray } from "../backend/seanime-web/src/app/(main)/_features/plugin/tray/plugin-tray"
const icon: any = { extensionId: "controlled-runtime", extensionName: "Controlled runtime", iconUrl: "", withContent: true, isDrawer: false, badgeNumber: 0, width: "800px", minHeight: "900px" }
const n = (type: string, props: any, id = type) => ({ type, props, id })
const field = n("input", { label: "Filter history", fieldRef: { __ID: "search", current: "" } }, "search")
const nested = n("modal", { title: "AnimeThemes settings", trigger: n("button", { label: "Open settings" }, "settings-open"), items: [
    n("select", { label: "Default Provider", value: "", fieldRef: { __ID: "provider", current: "themes" }, options: [{ label: "AnimeThemes", value: "themes" }, { label: "AniSongDB", value: "song" }] }),
    n("select", { label: "Initial Volume", value: "", fieldRef: { __ID: "volume", current: .7 }, options: [{ label: "0%", value: 0 }, { label: "25%", value: .25 }, { label: "100%", value: 1 }] }, "volume"),
    n("switch", { label: "Autoplay first OP", fieldRef: { __ID: "autoplay", current: true } }),
    n("button", { label: "Save settings", onClick: "save-settings" }),
] }, "settings")
const items = [field, n("tabs", { defaultValue: "history", items: [n("tabs-list", { items: ["history", "schedule", "marketplace"].map(value => n("tabs-trigger", { value, item: n("text", { text: value }) }, value)) }), n("tabs-content", { value: "history", items: [nested, ...Array.from({ length: 28 }, (_, i) => n("button", { label: `History episode ${i + 1}`, onClick: `episode-${i + 1}` }, `history-${i}`))] }), n("tabs-content", { value: "schedule", items: [n("text", { text: "Schedule settings" })] }), n("tabs-content", { value: "marketplace", items: [n("text", { text: "Marketplace settings" })] })] })]
;(window as any).runtimeFixture = n("stack", { items })
function Harness() { return <Provider><main style={{ height: 1800 }}>Home scroll marker</main><PluginActionModal extensionId="controlled-runtime" /><PluginCommandPalette extensionId="controlled-runtime" info={{extensionId:"controlled-runtime",placeholder:"Search anime",keyboardShortcut:""}} /><PluginTray trayIcon={icon} place="top" width={320} isPinned /></Provider> }
createRoot(document.getElementById("root")!).render(<Harness />)
