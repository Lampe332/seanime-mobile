import { useListOnlinestreamProviderExtensions } from "@/api/hooks/extensions.hooks"
import { isLoginModalOpenAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { tr } from "@/lib/app-language"
import { useAtom, useAtomValue, useSetAtom } from "jotai/react"
import { atomWithStorage } from "jotai/utils"
import React from "react"
import { useServerStatus } from "../../_hooks/use-server-status"
import { tourHelpers, TourStep, useTour } from "./tour"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

const OPEN_MODAL = ".UI-Modal__content[data-state=\"open\"]"

export const mobileTutorialSeenAtom = atomWithStorage<boolean>("sea-mobile-tutorial-seen", false, undefined, { getOnInit: true })

/**
 * The repository step names the button it points at: "Add repository" in the notice shown while the official repository
 * has no content sources, otherwise "Change" next to the repository in use.
 */
function RepositoryStepText() {
    const [noSources] = React.useState(() => !!document.querySelector("[data-marketplace-missing]"))
    return noSources
        ? <p>{tr("Seanime's own repository only has plugins. Tap ", "Das Repository von Seanime hat nur Plugins. Tippe auf ")}
            <b>{tr("Add repository", "Repository hinzufügen")}</b>
            {tr(" to add a community repository with streaming and manga sources.", ", um ein Community-Repository mit Streaming- und Manga-Quellen hinzuzufügen.")}</p>
        : <p>{tr("Tap ", "Tippe auf ")}<b>{tr("Change", "Ändern")}</b>{tr(" to use another repository with streaming and manga sources.",
            ", um ein anderes Repository mit Streaming- und Manga-Quellen zu nutzen.")}</p>
}

// First-run walkthrough for the Android app: shows how to add an extension repository
// and install a streaming source, since the app ships without any. Texts follow the app language;
// button names are written as the screen shows them.
function getMobileTutorialSteps({ fromExtensions = false } = {}): TourStep[] {
    const steps: TourStep[] = [
        {
            id: "welcome",
            title: tr("Welcome to Seanime Mobile", "Willkommen bei Seanime Mobile"),
            content: (
                <div className="space-y-2">
                    <p>{tr("Seanime doesn't come with any streaming or manga sources. You add them yourself as extensions.",
                        "Seanime bringt keine Streaming- oder Manga-Quellen mit. Du fügst sie selbst als Erweiterungen hinzu.")}</p>
                    <p>{tr("This short tour shows you how. It takes about a minute.", "Diese kurze Tour zeigt dir wie. Sie dauert etwa eine Minute.")}</p>
                </div>
            ),
            nextLabel: tr("Show me", "Zeig es mir"),
            ignoreOutsideClick: true,
        },
        {
            id: "menu",
            target: "#__seanime_bottom_nav button[data-nav-id=\"menu\"]",
            title: tr("Open the menu", "Menü öffnen"),
            content: <p>{tr("Tap ", "Tippe unten auf ")}<b>Menu</b>{tr(" at the bottom.", ".")}</p>,
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
            title: tr("Extensions", "Erweiterungen"),
            content: <p>{tr("Tap ", "Tippe auf ")}<b>Extensions</b>.</p>,
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
            title: tr("Marketplace", "Marktplatz"),
            content: <p>{tr("Open the ", "Öffne den Tab ")}<b>{tr("Marketplace", "Marktplatz")}</b>{tr(" tab.", ".")}</p>,
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
            title: tr("Add a repository", "Repository hinzufügen"),
            content: <RepositoryStepText />,
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
            title: tr("Paste the repository link", "Repository-Link einfügen"),
            content: (
                <div className="space-y-2">
                    <p>{tr("Copy the link to a repository (it ends with ", "Kopiere den Link zu einem Repository (er endet auf ")}<b>.json</b>
                        {tr("), tap the ", "), tippe im Feld auf den ")}<b>{tr("paste button", "Einfügen-Knopf")}</b>
                        {tr(" in the field, then ", " und dann auf ")}<b>{tr("Save", "Speichern")}</b>.</p>
                    <p className="text-xs">{tr("You can find Seanime extension repositories online in the Seanime community.",
                        "Repositorys für Seanime findest du online in der Seanime-Community.")}</p>
                </div>
            ),
            placement: "top",
            // the repository sheet slides up from the bottom; measured mid-way, the card would cover its title
            prepare: () => new Promise((r) => setTimeout(r, 450)),
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
            title: tr("Streaming sources", "Streaming-Quellen"),
            content: <p>{tr("Tap ", "Tippe auf ")}<b>Streaming</b>{tr(" to see the anime sources of this repository.", ", um die Anime-Quellen dieses Repositorys zu sehen.")}</p>,
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
            title: tr("Install a source", "Quelle installieren"),
            content: (
                <div className="space-y-2">
                    <p>{tr("Tap the ", "Tippe neben einer Quelle auf den ")}<b>{tr("download button", "Download-Knopf")}</b>
                        {tr(" next to a source to install it.", ", um sie zu installieren.")}</p>
                    <p className="text-xs">{tr("Sources in your language come first; the line under each name shows its language. You can install several and switch between them later.",
                        "Quellen in deiner Sprache stehen oben, die Zeile unter dem Namen zeigt die Sprache. Du kannst mehrere installieren und später wechseln.")}</p>
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
            title: tr("Manga works the same way", "Manga funktioniert genauso"),
            content: <p>{tr("Tap ", "Tippe auf ")}<b>Manga</b>{tr(" to see the manga sources of this repository.", ", um die Manga-Quellen dieses Repositorys zu sehen.")}</p>,
            placement: "bottom",
            prepare: () => new Promise((r) => setTimeout(r, 800)),
            disableBack: true,
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "manga-install",
            target: "[data-tour-install=\"manga-provider\"]",
            title: tr("Install a manga source", "Manga-Quelle installieren"),
            content: <p>{tr("Tap the ", "Tippe neben einer Manga-Quelle auf den ")}<b>{tr("download button", "Download-Knopf")}</b>
                {tr(" next to a manga source to read and download chapters.", ", um Kapitel zu lesen und zu laden.")}</p>,
            placement: "bottom",
            prepare: () => new Promise((r) => setTimeout(r, 600)),
            disableBack: true,
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 8000,
            // repositories without manga sources go straight to the end
            targetNotFoundBehavior: "skip",
        },
        {
            id: "done",
            title: tr("You're all set", "Alles bereit"),
            content: (
                <ul className="list-disc pl-4 space-y-1.5">
                    <li>{tr("Open any anime and tap ", "Öffne einen Anime und tippe auf ")}<b>Online streaming</b>{tr(" to watch.", ", um ihn zu schauen.")}</li>
                    <li><b>Download</b>{tr(" next to Subtitles / Dub saves the whole season or just the current episode to your phone.",
                        " neben Subtitles / Dub speichert die ganze Staffel oder nur die aktuelle Folge auf dem Handy.")}</li>
                    <li>{tr("Saved episodes and chapters are under ", "Gespeicherte Folgen und Kapitel findest du unten unter ")}<b>Downloads</b>
                        {tr(" at the bottom, also offline.", ", auch offline.")}</li>
                    <li>{tr("Your sources are under ", "Deine Quellen stehen unter ")}<b>Extensions</b>
                        {tr(". Replay this tour any time from the ⋮ menu there.", ". Diese Tour startest du dort jederzeit wieder über das ⋮-Menü.")}</li>
                </ul>
            ),
            nextLabel: tr("Done", "Fertig"),
            disableBack: true,
            ignoreOutsideClick: true,
        },
    ]
    // Started on the Extensions tab itself, the way there is skipped.
    return fromExtensions ? steps.filter(step => step.id !== "menu" && step.id !== "extensions") : steps
}

export function useStartMobileTutorial() {
    const { start } = useTour()
    const setSeen = useSetAtom(mobileTutorialSeenAtom)
    return React.useCallback((options?: { fromExtensions?: boolean }) => {
        start(getMobileTutorialSteps(options), "mobile-tutorial", () => setSeen(true))
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
        && !!serverStatus?.settings && !!serverStatus?.user

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
