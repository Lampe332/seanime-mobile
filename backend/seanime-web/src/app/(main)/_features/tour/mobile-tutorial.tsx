import { useListOnlinestreamProviderExtensions } from "@/api/hooks/extensions.hooks"
import { isLoginModalOpenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { useServerStatus } from "../../_hooks/use-server-status"
import { tourHelpers, TourStep, useTour } from "./tour"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

const OPEN_MODAL = ".UI-Modal__content[data-state=\"open\"]"

export const mobileTutorialSeenAtom = atomWithStorage<boolean>("sea-mobile-tutorial-seen", false, undefined, { getOnInit: true })

// First-run walkthrough for the Android app: shows how to add an extension repository
// and install a streaming source, since the app ships without any.
function getMobileTutorialSteps(): TourStep[] {
    return [
        {
            id: "welcome",
            title: "Welcome to Seanime Mobile 👋",
            content: (
                <div className="space-y-2">
                    <p>Seanime doesn't come with any streaming or manga sources. You add them yourself as extensions.</p>
                    <p>This short tour shows you how. It takes about a minute.</p>
                </div>
            ),
            nextLabel: "Show me",
            ignoreOutsideClick: true,
        },
        {
            id: "menu",
            target: "#__seanime_bottom_nav button[data-nav-id=\"menu\"]",
            title: "Open the menu",
            content: <p>Tap <b>Menu</b> at the bottom.</p>,
            placement: "top",
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "extensions",
            target: "#android-floating-menu .float-nav-item[aria-label=\"Extensions\"]",
            title: "Extensions",
            content: <p>Tap <b>Extensions</b>.</p>,
            placement: "left",
            // let the menu's slide-in animation settle before measuring
            prepare: () => new Promise((r) => setTimeout(r, 450)),
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            spotlightPadding: 4,
            waitForTargetMs: 5000,
        },
        {
            id: "marketplace-tab",
            target: "[data-extensions-page-tabs] [data-tab-name=\"Marketplace\"]",
            title: "Marketplace",
            content: <p>Open the <b>Marketplace</b> tab.</p>,
            placement: "bottom",
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 10000,
        },
        {
            id: "change-repo",
            target: "[data-tour=\"marketplace-change-repo\"]",
            title: "Add a repository",
            content: (
                <p>The default marketplace only has plugins. Tap <b>Change repository</b> to add a community repository with streaming and manga
                    sources.</p>
            ),
            placement: "bottom",
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 10000,
        },
        {
            id: "paste-url",
            target: OPEN_MODAL,
            title: "Paste the repository URL",
            content: (
                <div className="space-y-2">
                    <p>Paste the <b>repository URL</b> (it ends with <code>.json</code>) and tap <b>Save</b>.</p>
                    <p className="text-xs">You can find Seanime extension repositories online in the Seanime community.</p>
                </div>
            ),
            placement: "top",
            spotlightPadding: 4,
            allowTargetInteraction: true,
            advanceOnSelectorClick: "[data-tour=\"marketplace-repo-save\"]",
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "streaming-tab",
            target: "[data-marketplace-type-tabs] [data-tab-name=\"Online Streaming\"]",
            title: "Streaming sources",
            content: <p>Tap <b>Online Streaming</b> to see the anime sources from that repository.</p>,
            placement: "bottom",
            // wait for the repository dialog to close and the list to reload
            prepare: () => tourHelpers.waitForSelectorGone(OPEN_MODAL),
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 10000,
        },
        {
            id: "install",
            target: "[data-tour-install=\"onlinestream-provider\"]",
            title: "Install a source",
            content: (
                <div className="space-y-2">
                    <p>Tap the <b>download icon</b> to install a streaming extension.</p>
                    <p className="text-xs">Each extension is a different source. You can install several and switch between them later.</p>
                </div>
            ),
            placement: "bottom",
            // let the filtered list settle first
            prepare: () => new Promise((r) => setTimeout(r, 600)),
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 15000,
        },
        {
            id: "manga",
            target: "[data-marketplace-type-tabs] [data-tab-name=\"Manga\"]",
            title: "Manga works the same way",
            content: <p>Switch to <b>Manga</b> and install a manga source to read and download chapters.</p>,
            placement: "bottom",
            prepare: () => new Promise((r) => setTimeout(r, 800)),
            disableBack: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "done",
            title: "You're all set! 🎉",
            content: (
                <ul className="list-disc pl-4 space-y-1.5">
                    <li>Open any anime and tap <b>Online streaming</b> to watch.</li>
                    <li><b>Staffel / Folgen herunterladen</b> saves episodes to your phone.</li>
                    <li>Saved episodes and chapters are under <b>Downloads</b> at the bottom, also offline.</li>
                    <li>Replay this tour any time in <b>Settings → Extensions</b>.</li>
                </ul>
            ),
            nextLabel: "Done",
            disableBack: true,
            ignoreOutsideClick: true,
        },
    ]
}

export function useStartMobileTutorial() {
    const { start } = useTour()
    const setSeen = useSetAtom(mobileTutorialSeenAtom)
    return React.useCallback(() => {
        start(getMobileTutorialSteps(), "mobile-tutorial", () => setSeen(true))
    }, [start, setSeen])
}

// Starts the tutorial once, after the first login on the Android app.
// Users who already have a streaming extension (e.g. after an update) are marked as done silently.
export function MobileTutorialListener() {
    const serverStatus = useServerStatus()
    const [seen, setSeen] = useAtom(mobileTutorialSeenAtom)
    const { active } = useTour()
    const startTutorial = useStartMobileTutorial()
    const { data: streamingExtensions, isSuccess } = useListOnlinestreamProviderExtensions()
    const started = React.useRef(false)

    // the AniList login dialog opens right after the setup wizard, wait until it's dealt with
    const loginModalOpen = useAtomValue(isLoginModalOpenAtom)

    const hasStreamingSource = isSuccess && !!streamingExtensions?.length
    const ready = IS_ANDROID_APP && !seen && isSuccess && !hasStreamingSource && !loginModalOpen
        && !!serverStatus?.settings && !!serverStatus?.user && !serverStatus?.isOffline

    React.useEffect(() => {
        if (!seen && hasStreamingSource) setSeen(true)
    }, [seen, hasStreamingSource, setSeen])

    React.useEffect(() => {
        if (!ready || active || started.current) return
        // start once the screen is free of other dialogs
        const t = setInterval(() => {
            if (document.querySelector(OPEN_MODAL)) return
            clearInterval(t)
            started.current = true
            startTutorial()
        }, 1500)
        return () => clearInterval(t)
    }, [ready, active, startTutorial])

    return null
}
