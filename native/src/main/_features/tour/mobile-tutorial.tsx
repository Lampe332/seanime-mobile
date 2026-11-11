import { useListOnlinestreamProviderExtensions } from "@/api/hooks/extensions.hooks"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { tr } from "@/lib/app-language"
import { atomWithStorage } from "@/lib/storage"
import { useIsTabletScreen } from "@/lib/use-tablet-ui"
import { isLoginModalOpenAtom } from "@/main/_atoms/server-status.atoms"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import React from "react"
import { View } from "react-native"
import { tour, type TourStep, useTourState } from "./tour"
import { TOUR_TARGETS, tourTargetData, waitForTourTargetGone } from "./tour-targets"

/*
 * The first-run walkthrough of the Android app (web mobile-tutorial.tsx): how to add an extension repository and install
 * a streaming source, since the app ships without any. Texts follow the app language; button names are written as the
 * screen shows them. Its targets are registered by the bar, the Menu, the Extensions tab and its marketplace.
 */
export const mobileTutorialSeenAtom = atomWithStorage<boolean>("sea-mobile-tutorial-seen", false)

function P({ children, small }: { children: React.ReactNode, small?: boolean }) {
    return <Text className={cn(small ? "text-xs leading-[18px]" : "text-sm leading-[22px]", "text-sm-text-muted")}>{children}</Text>
}

function B({ children }: { children: React.ReactNode }) {
    return <Text className="font-bold">{children}</Text>
}

const wait = (ms: number) => () => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * The repository step names the button it points at: "Add repository" in the notice shown while the official repository
 * has no content sources, otherwise "Change" next to the repository in use.
 */
function RepositoryStepText() {
    const [noSources] = React.useState(() => tourTargetData(TOUR_TARGETS.changeRepo) === "add")
    return noSources
        ? <P>{tr("Seanime's own repository only has plugins. Tap ", "Das Repository von Seanime hat nur Plugins. Tippe auf ")}<B>{tr("Add repository", "Repository hinzufügen")}</B>
            {tr(" to add a community repository with streaming and manga sources.", ", um ein Community-Repository mit Streaming- und Manga-Quellen hinzuzufügen.")}</P>
        : <P>{tr("Tap ", "Tippe auf ")}<B>{tr("Change", "Ändern")}</B>{tr(" to use another repository with streaming and manga sources.",
            ", um ein anderes Repository mit Streaming- und Manga-Quellen zu nutzen.")}</P>
}

export function getMobileTutorialSteps({ fromExtensions = false, tablet = false } = {}): TourStep[] {
    const steps: TourStep[] = [
        {
            id: "welcome",
            title: tr("Welcome to Seanime Mobile", "Willkommen bei Seanime Mobile"),
            content: <View className="gap-2">
                <P>{tr("Seanime doesn't come with any streaming or manga sources. You add them yourself as extensions.",
                    "Seanime bringt keine Streaming- oder Manga-Quellen mit. Du fügst sie selbst als Erweiterungen hinzu.")}</P>
                <P>{tr("This short tour shows you how. It takes about a minute.", "Diese kurze Tour zeigt dir wie. Sie dauert etwa eine Minute.")}</P>
            </View>,
            nextLabel: tr("Show me", "Zeig es mir"),
            hero: "intro",
            ignoreOutsideClick: true,
        },
        {
            id: "menu",
            target: TOUR_TARGETS.menu,
            title: tr("Open the menu", "Menü öffnen"),
            // the tablet shows the menu in the rail on the left: the card sits beside it (T2)
            content: tablet
                ? <P>{tr("Tap ", "Tippe links auf ")}<B>{tr("Menu", "Menü")}</B>{tr(" on the left.", ".")}</P>
                : <P>{tr("Tap ", "Tippe unten auf ")}<B>{tr("Menu", "Menü")}</B>{tr(" at the bottom.", ".")}</P>,
            placement: tablet ? "right" : "top",
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "extensions",
            target: TOUR_TARGETS.menuExtensions,
            title: tr("Extensions", "Erweiterungen"),
            content: <P>{tr("Tap ", "Tippe auf ")}<B>{tr("Extensions", "Erweiterungen")}</B>.</P>,
            placement: "left",
            // let the menu's slide-in settle before measuring
            prepare: wait(450),
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            spotlightPadding: 4,
            waitForTargetMs: 5000,
        },
        {
            id: "marketplace-tab",
            target: TOUR_TARGETS.marketplaceTab,
            title: tr("Marketplace", "Marktplatz"),
            content: <P>{tr("Open the ", "Öffne den Tab ")}<B>{tr("Marketplace", "Marktplatz")}</B>{tr(" tab.", ".")}</P>,
            placement: "bottom",
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 10000,
        },
        {
            id: "change-repo",
            target: TOUR_TARGETS.changeRepo,
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
            target: TOUR_TARGETS.repoSheet,
            title: tr("Paste the repository link", "Repository-Link einfügen"),
            content: <View className="gap-2">
                <P>{tr("Copy the link to a repository (it ends with ", "Kopiere den Link zu einem Repository (er endet auf ")}<B>.json</B>
                    {tr("), tap the ", "), tippe im Feld auf den ")}<B>{tr("paste button", "Einfügen-Knopf")}</B>
                    {tr(" in the field, then ", " und dann auf ")}<B>{tr("Save", "Speichern")}</B>.</P>
                <P small>{tr("You can find Seanime extension repositories online in the Seanime community.",
                    "Repositorys für Seanime findest du online in der Seanime-Community.")}</P>
            </View>,
            placement: "top",
            // the repository sheet slides up from the bottom; measured mid-way, the card would cover its title
            prepare: wait(450),
            spotlightPadding: 4,
            allowTargetInteraction: true,
            advanceOnSelectorClick: TOUR_TARGETS.repoSave,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "streaming-tab",
            target: TOUR_TARGETS.typeChip("onlinestream-provider"),
            title: tr("Streaming sources", "Streaming-Quellen"),
            content: <P>{tr("Tap ", "Tippe auf ")}<B>Streaming</B>{tr(" to see the anime sources of this repository.", ", um die Anime-Quellen dieses Repositorys zu sehen.")}</P>,
            placement: "bottom",
            // wait for the repository sheet to close and the list to reload
            prepare: () => waitForTourTargetGone(TOUR_TARGETS.repoSheet),
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 10000,
        },
        {
            id: "install",
            target: TOUR_TARGETS.install("onlinestream-provider"),
            title: tr("Install a source", "Quelle installieren"),
            content: <View className="gap-2">
                <P>{tr("Tap the ", "Tippe neben einer Quelle auf den ")}<B>{tr("download button", "Download-Knopf")}</B>
                    {tr(" next to a source to install it.", ", um sie zu installieren.")}</P>
                <P small>{tr("Sources in your language come first; the line under each name shows its language. You can install several and switch between them later.",
                    "Quellen in deiner Sprache stehen oben, die Zeile unter dem Namen zeigt die Sprache. Du kannst mehrere installieren und später wechseln.")}</P>
            </View>,
            placement: "bottom",
            // let the filtered list settle first
            prepare: wait(600),
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 15000,
        },
        {
            id: "manga",
            target: TOUR_TARGETS.typeChip("manga-provider"),
            title: tr("Manga works the same way", "Manga funktioniert genauso"),
            content: <P>{tr("Tap ", "Tippe auf ")}<B>Manga</B>{tr(" to see the manga sources of this repository.", ", um die Manga-Quellen dieses Repositorys zu sehen.")}</P>,
            placement: "bottom",
            prepare: wait(800),
            disableBack: true,
            allowTargetInteraction: true,
            advanceOnTargetClick: true,
            hideNextButton: true,
            ignoreOutsideClick: true,
            waitForTargetMs: 5000,
        },
        {
            id: "manga-install",
            target: TOUR_TARGETS.install("manga-provider"),
            title: tr("Install a manga source", "Manga-Quelle installieren"),
            content: <P>{tr("Tap the ", "Tippe neben einer Manga-Quelle auf den ")}<B>{tr("download button", "Download-Knopf")}</B>
                {tr(" next to a manga source to read and download chapters.", ", um Kapitel zu lesen und zu laden.")}</P>,
            placement: "bottom",
            prepare: wait(600),
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
            content: <View className="gap-1.5">
                {[
                    <>{tr("Open any anime and tap ", "Öffne einen Anime und tippe auf ")}<B>Online streaming</B>{tr(" to watch.", ", um ihn zu schauen.")}</>,
                    <><B>Download</B>{tr(" next to Subtitles / Dub saves the whole season or just the current episode to your phone.",
                        " neben Subtitles / Dub speichert die ganze Staffel oder nur die aktuelle Folge auf dem Gerät.")}</>,
                    <>{tr("Saved episodes and chapters are under ", "Gespeicherte Folgen und Kapitel findest du unten unter ")}<B>Downloads</B>
                        {tr(" at the bottom, also offline.", ", auch offline.")}</>,
                    <>{tr("Your sources are under ", "Deine Quellen stehen unter ")}<B>{tr("Extensions", "Erweiterungen")}</B>
                        {tr(". Replay this tour any time from the ⋮ menu there.", ". Diese Tour startest du dort jederzeit wieder über das ⋮-Menü.")}</>,
                ].map((line, i) => <View key={i} className="flex-row gap-2 pl-1"><P>•</P><View className="min-w-0 flex-1"><P>{line}</P></View></View>)}
            </View>,
            nextLabel: tr("Done", "Fertig"),
            hero: "celebrate",
            disableBack: true,
            ignoreOutsideClick: true,
        },
    ]
    // Started on the Extensions tab itself, the way there is skipped.
    return fromExtensions ? steps.filter(step => step.id !== "menu" && step.id !== "extensions") : steps
}

export function useStartMobileTutorial() {
    const setSeen = useSetAtom(mobileTutorialSeenAtom)
    const tablet = useIsTabletScreen()
    return React.useCallback((options?: { fromExtensions?: boolean }) => {
        tour.start(getMobileTutorialSteps({ ...options, tablet }), "mobile-tutorial", () => setSeen(true))
    }, [setSeen, tablet])
}

/**
 * Starts the tutorial once, after the first login on the Android app. Users who already have a streaming extension
 * (e.g. after an update) are marked as done silently.
 */
export function MobileTutorialListener() {
    const serverStatus = useServerStatus()
    const [seen, setSeen] = useAtom(mobileTutorialSeenAtom)
    const { active } = useTourState()
    const startTutorial = useStartMobileTutorial()
    const { data: streamingExtensions, isSuccess } = useListOnlinestreamProviderExtensions()
    const started = React.useRef(false)
    // the AniList login sheet opens right after the setup wizard, wait until it's dealt with
    const loginModalOpen = useAtomValue(isLoginModalOpenAtom)

    const hasStreamingSource = isSuccess && !!streamingExtensions?.length
    const ready = !seen && isSuccess && !hasStreamingSource && !loginModalOpen && !!serverStatus?.settings && !!serverStatus?.user

    React.useEffect(() => {
        if (!seen && hasStreamingSource) setSeen(true)
    }, [seen, hasStreamingSource, setSeen])

    React.useEffect(() => {
        if (!ready || active || started.current) return
        // after a moment on screen, as the web waited for a free screen at its next 1.5 s check
        const timer = setTimeout(() => {
            started.current = true
            startTutorial()
        }, 1500)
        return () => clearTimeout(timer)
    }, [ready, active, startTutorial])

    return null
}
