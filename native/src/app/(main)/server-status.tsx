import { useListExtensionData } from "@/api/hooks/extensions.hooks"
import { PhoneScreen } from "@/components/shared/phone-screen"
import { EmptyState } from "@/components/ui/card/card"
import { ListGroup, ListRow } from "@/components/ui/list-row/list-row"
import { SectionTitle, Text } from "@/components/ui/text/text"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { nativeServerAtom } from "@/main/client-providers"
import { websocketConnectedAtom } from "@/main/websocket-provider"
import { useTr } from "@/lib/app-language"
import { type ErrorBoundaryProps } from "expo-router"
import { useAtomValue } from "jotai"
import React from "react"
import { View } from "react-native"

/*
 * Server status (E0's test screen, kept as a page of the Menu): the app's own Go server process, /api/v1/status and the
 * loaded extensions, now through the real API layer and WebSocket. Text only on purpose, so no cover can end up in a
 * screenshot; extensions only as counts per type (no provider names, docs/NATIVE-UMBAU.md 8).
 */
function countByType(list: { type: string }[]) {
    const counts = new Map<string, number>()
    for (const e of list) counts.set(e.type, (counts.get(e.type) ?? 0) + 1)
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export default function ServerStatusScreen() {
    const t = useTr()
    const server = useAtomValue(nativeServerAtom)
    const connected = useAtomValue(websocketConnectedAtom)
    const status = useServerStatus()
    const ready = !!status?.serverReady
    const extensions = useListExtensionData()
    const yes = t("yes", "ja")
    const no = t("no", "nein")

    return (
        <PhoneScreen title={t("Server status", "Server-Status")} subtitle={`127.0.0.1:${server.port}`}>
            <View className="gap-3">
                <SectionTitle>{t("Server process", "Server-Prozess")}</SectionTitle>
                <ListGroup>
                    <ListRow title={t("State", "Zustand")} side={server.state} />
                    <ListRow title={t("Message", "Meldung")} meta={server.message} />
                    <ListRow title="WebSocket" side={connected ? t("connected", "verbunden") : t("not connected", "nicht verbunden")} />
                </ListGroup>
            </View>

            <View className="gap-3">
                <SectionTitle>/api/v1/status</SectionTitle>
                {status ? (
                    <ListGroup>
                        <ListRow title={t("Version", "Version")} side={`${status.version} (${status.versionName})`} />
                        <ListRow title={t("OS / platform", "System / Plattform")} side={`${status.os} / ${status.clientPlatform || "–"}`} />
                        <ListRow title={t("Data folder", "Datenordner")} meta={status.dataDir || "–"} />
                        <ListRow title={t("AniList connected", "AniList verbunden")} side={status.user && !status.user.isSimulated ? yes : no} />
                        <ListRow title={t("Server ready", "Server bereit")} side={ready ? yes : no} />
                        <ListRow title={t("Content locked", "Inhalte gesperrt")} side={status.contentLocked ? yes : no} />
                        <ListRow title={t("Offline", "Offline")} side={status.isOffline ? yes : no} />
                    </ListGroup>
                ) : (
                    <EmptyState title={t("Waiting for the server…", "Warte auf den Server …")} />
                )}
            </View>

            <View className="gap-3">
                <SectionTitle>/api/v1/extensions/list</SectionTitle>
                {extensions.isSuccess ? (
                    <ListGroup>
                        <ListRow title={t("Loaded extensions", "Geladene Erweiterungen")} side={String(extensions.data?.length ?? 0)} />
                        {countByType(extensions.data ?? []).map(([type, n]) => <ListRow key={type} title={type} side={String(n)} />)}
                    </ListGroup>
                ) : (
                    <EmptyState title={extensions.isError ? t("Could not load the extensions", "Erweiterungen nicht ladbar") : t("Loading…", "Lädt …")} />
                )}
            </View>
        </PhoneScreen>
    )
}

// Expo Router renders this instead of crashing when the screen throws while rendering.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    return (
        <View className="flex-1 justify-center gap-3 bg-background p-6">
            <Text className="text-lg font-bold">Server status crashed</Text>
            <Text className="text-sm text-sm-danger">{error.message}</Text>
            <Text className="text-sm text-sm-accent" onPress={retry}>Retry</Text>
        </View>
    )
}
