import { useListOnlinestreamProviderExtensions } from "@/api/hooks/extensions.hooks"
import { cn } from "@/components/ui/core/styling"
import { Text } from "@/components/ui/text/text"
import { tr } from "@/lib/app-language"
import { fillParts } from "@/lib/i18n/format"
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
 * The marketplace step names the button it points at: "Add marketplace" in the notice shown while the official
 * marketplace has no content sources, otherwise "Change" next to the marketplace in use.
 */
function RepositoryStepText() {
    const [noSources] = React.useState(() => tourTargetData(TOUR_TARGETS.changeRepo) === "add")
    return noSources
        ? <P>{fillParts(tr("Seanime's own marketplace only has plugins. Tap {0} to add a community marketplace with streaming and manga sources.",
            "Der Marktplatz von Seanime hat nur Plugins. Tippe auf {0}, um einen Community-Marktplatz mit Streaming- und Manga-Quellen hinzuzufügen."),
            <B>{tr("Add marketplace", "Marktplatz hinzufügen")}</B>)}</P>
        : <P>{fillParts(tr("Tap {0} to use another marketplace with streaming and manga sources.",
            "Tippe auf {0}, um einen anderen Marktplatz mit Streaming- und Manga-Quellen zu nutzen."), <B>{tr("Change", "Ändern")}</B>)}</P>
}

/** One sentence of a step, its {0}, {1}, … filled by bold button names. */
function Line({ text, names, small }: { text: string, names: React.ReactNode[], small?: boolean }) {
    return <P small={small}>{fillParts(text, ...names.map((name, i) => <B key={i}>{name}</B>))}</P>
}

export function getMobileTutorialSteps({ fromExtensions = false, tablet = false } = {}): TourStep[] {
    const steps: TourStep[] = [
        {
            id: "welcome",
            title: tr("Welcome to Seanime Mobile", "Willkommen bei Seanime Mobile"),
            content: <View className="gap-2">
                <P>{tr("Seanime Mobile doesn't come with any streaming or manga sources. You add them yourself as extensions.",
                    "Seanime Mobile bringt keine Streaming- oder Manga-Quellen mit. Du fügst sie selbst als Erweiterungen hinzu.")}</P>
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
                ? <Line text={tr("Tap {0} on the left.", "Tippe links auf {0}.")} names={[tr("Menu", "Menü")]} />
                : <Line text={tr("Tap {0} at the bottom.", "Tippe unten auf {0}.")} names={[tr("Menu", "Menü")]} />,
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
            content: <Line text={tr("Tap {0}.", "Tippe auf {0}.")} names={[tr("Extensions", "Erweiterungen")]} />,
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
            content: <Line text={tr("Open the {0} tab.", "Öffne den Tab {0}.")} names={[tr("Marketplace", "Marktplatz")]} />,
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
            title: tr("Add a marketplace", "Marktplatz hinzufügen"),
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
            title: tr("Paste the marketplace link", "Marktplatz-Link einfügen"),
            content: <View className="gap-2">
                <Line text={tr("Copy the link to a marketplace, tap {0}, then {1}.", "Kopiere den Link zu einem Marktplatz, tippe auf {0} und dann auf {1}.")}
                    names={[tr("Paste link", "Link einfügen"), tr("Add", "Hinzufügen")]} />
                <P small>{tr("You can find Seanime marketplaces online in the Seanime community.",
                    "Marktplätze für Seanime findest du online in der Seanime-Community.")}</P>
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
            content: <Line text={tr("Tap {0} to see the anime sources of this repository.", "Tippe auf {0}, um die Anime-Quellen dieses Repositorys zu sehen.")} names={["Streaming"]} />,
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
                <Line text={tr("Tap the {0} next to a source to install it.", "Tippe neben einer Quelle auf den {0}, um sie zu installieren.")}
                    names={[tr("download button", "Download-Knopf")]} />
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
            content: <Line text={tr("Tap {0} to see the manga sources of this repository.", "Tippe auf {0}, um die Manga-Quellen dieses Repositorys zu sehen.")} names={["Manga"]} />,
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
            content: <Line text={tr("Tap the {0} next to a manga source to read and download chapters.", "Tippe neben einer Manga-Quelle auf den {0}, um Kapitel zu lesen und zu laden.")}
                names={[tr("download button", "Download-Knopf")]} />,
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
                    <Line key="0" text={tr("Open any anime and tap {0} to watch.", "Öffne einen Anime und tippe auf {0}, um ihn zu schauen.")} names={["Online streaming"]} />,
                    <Line key="1" text={tr("{0} next to Subtitles / Dub saves the whole season or just the current episode to your phone.",
                        "{0} neben Subtitles / Dub speichert die ganze Staffel oder nur die aktuelle Folge auf dem Gerät.")} names={["Download"]} />,
                    <Line key="2" text={tr("Saved episodes and chapters are under {0} at the bottom, also offline.", "Gespeicherte Folgen und Kapitel findest du unten unter {0}, auch offline.")}
                        names={["Downloads"]} />,
                    <Line key="3" text={tr("Your sources are under {0}. Replay this tour any time from the ⋮ menu there.",
                        "Deine Quellen stehen unter {0}. Diese Tour startest du dort jederzeit wieder über das ⋮-Menü.")} names={[tr("Extensions", "Erweiterungen")]} />,
                ].map((line, i) => <View key={i} className="flex-row gap-2 pl-1"><P>•</P><View className="min-w-0 flex-1">{line}</View></View>)}
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
