import { API_ENDPOINTS } from "@/api/generated/endpoints"
import type { Nakama_NakamaStatus, Nakama_WatchPartySession } from "@/api/generated/types"
import {
    useNakamaCreateAndJoinRoom,
    useNakamaCreateWatchParty,
    useNakamaDisconnectFromRoom,
    useNakamaJoinWatchParty,
    useNakamaLeaveWatchParty,
    useNakamaReconnectToHost,
    useNakamaRemoveStaleConnections,
    useNakamaRoomsAvailable,
} from "@/api/hooks/nakama.hooks"
import { PhoneEmpty } from "@/components/shared/phone-cards"
import { ActionRow, LoadingRows, RowGroup } from "@/components/shared/phone-kit"
import { Button } from "@/components/ui/button/button"
import { Dialog, Sheet, SheetGroup } from "@/components/ui/sheet/sheet"
import { Muted } from "@/components/ui/text/text"
import { toast } from "@/components/ui/toast/toast-store"
import { type Translate, useTr } from "@/lib/app-language"
import { successFeedback } from "@/lib/feedback"
import { copyToClipboard } from "@/lib/helpers/browser"
import { MENU_ENTRIES } from "@/lib/nav/nav-items"
import { useRouter } from "@/lib/navigation"
import { WSEvents } from "@/lib/server/ws-events"
import { colors } from "@/lib/theme/tokens"
import { useWebsocketMessageListener, useWebsocketSender } from "@/main/_hooks/handle-websockets"
import { useServerStatus } from "@/main/_hooks/use-server-status"
import { clientIdAtom, websocketConnectedAtom } from "@/main/websocket-provider"
import { useQueryClient } from "@tanstack/react-query"
import { atom, useAtom, useAtomValue } from "jotai"
import Clock from "lucide-react-native/icons/clock"
import Cloud from "lucide-react-native/icons/cloud"
import Copy from "lucide-react-native/icons/copy"
import Eraser from "lucide-react-native/icons/eraser"
import KeyRound from "lucide-react-native/icons/key-round"
import Link from "lucide-react-native/icons/link"
import LogOut from "lucide-react-native/icons/log-out"
import Play from "lucide-react-native/icons/play"
import Plus from "lucide-react-native/icons/plus"
import RadioTower from "lucide-react-native/icons/radio-tower"
import RefreshCw from "lucide-react-native/icons/refresh-cw"
import Settings from "lucide-react-native/icons/settings"
import Unplug from "lucide-react-native/icons/unplug"
import User from "lucide-react-native/icons/user"
import React from "react"
import { participantTags, watchPartyMembership } from "./nakama-status"

/*
 * Nakama (web _features/nakama/nakama-manager.tsx + nakama-phone.tsx/.css): the status from the server's websocket, the
 * reloads when the host comes or goes (library and an open anime page get the host's anime and episodes, including the
 * host's stream entries the fork keeps, docs §3.1) and the sheet: who the host is and how this device is connected,
 * the watch party (start, join, its people, relay, leave) and the way to the settings. The phone never hosts: its server
 * listens on 127.0.0.1. The host address (with or without http://) and passcode are settings (2.12).
 * Not here: the watch party chat and the player's sync to the party (the player's side, see docs §9).
 */

export const nakamaModalOpenAtom = atom(false)
export const nakamaStatusAtom = atom<Nakama_NakamaStatus | null | undefined>(undefined)

export function useNakamaStatus() {
    return useAtomValue(nakamaStatusAtom)
}

export function useNakamaWatchParty() {
    const status = useAtomValue(nakamaStatusAtom)
    return { watchPartySession: status?.currentWatchPartySession, ...watchPartyMembership(status) }
}

/** Once in the main layout: keeps the status and owns the sheet. */
export function NakamaManager() {
    const t = useTr()
    const { sendMessage } = useWebsocketSender()
    const queryClient = useQueryClient()
    const [open, setOpen] = useAtom(nakamaModalOpenAtom)
    const [status, setStatus] = useAtom(nakamaStatusAtom)
    const clientId = useAtomValue(clientIdAtom)
    const websocketConnected = useAtomValue(websocketConnectedAtom)
    const serverStatus = useServerStatus()

    const { mutate: reconnectToHost, isPending: reconnecting } = useNakamaReconnectToHost()
    const { mutate: removeStaleConnections, isPending: cleaningUp } = useNakamaRemoveStaleConnections()
    const { mutate: createWatchParty, isPending: creatingParty } = useNakamaCreateWatchParty()
    const { mutate: joinWatchParty, isPending: joiningParty } = useNakamaJoinWatchParty()
    const { mutate: leaveWatchParty, isPending: leavingParty } = useNakamaLeaveWatchParty()
    const { mutate: createAndJoinRoom, isPending: creatingRoom } = useNakamaCreateAndJoinRoom()
    const { mutate: disconnectFromRoom, isPending: disconnectingRoom } = useNakamaDisconnectFromRoom()
    const { data: roomsAvailable } = useNakamaRoomsAvailable()
    const [confirmRoom, setConfirmRoom] = React.useState(false)

    const refetchStatus = React.useCallback(() => {
        // useDenshiPlayer: whether this client plays in the desktop app's own player (never on a phone)
        sendMessage({ type: WSEvents.NAKAMA_STATUS_REQUESTED, payload: { useDenshiPlayer: false, clientId: clientId || "" } })
    }, [sendMessage, clientId])

    React.useEffect(() => {
        refetchStatus()
    }, [open, websocketConnected, refetchStatus])

    useWebsocketMessageListener<Nakama_NakamaStatus | null>({ type: WSEvents.NAKAMA_STATUS, onMessage: data => setStatus(data ?? null) })

    // The host's library joins or leaves: the collection and an open anime page reload without leaving it (cbddc39)
    const refetchLibrary = () => {
        refetchStatus()
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
        void queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
    }
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_HOST_CONNECTED, onMessage: refetchLibrary })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_HOST_DISCONNECTED, onMessage: refetchLibrary })
    // Watch party, rooms, host and peers changed, or an error: ask for the status again
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_WATCH_PARTY_STATE, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_ROOM_CLOSED, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_ROOM_RECONNECTED, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_HOST_STARTED, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_HOST_STOPPED, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_PEER_CONNECTED, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_PEER_DISCONNECTED, onMessage: refetchStatus })
    useWebsocketMessageListener({ type: WSEvents.NAKAMA_ERROR, onMessage: refetchStatus })

    const after = (success: string) => ({
        onSuccess: () => {
            toast.success(success)
            refetchStatus()
        },
    })
    const failure = (what: string) => (error: Error) => toast.error(`${what}: ${error.message}`)

    const actions: NakamaActions = {
        reconnect: () => reconnectToHost({}, { ...after(t("Reconnection started", "Verbindung wird neu aufgebaut")), onError: failure(t("Could not reconnect", "Neuverbindung fehlgeschlagen")) }),
        reconnecting,
        cleanUp: () => removeStaleConnections({}, { ...after(t("Stale connections removed", "Veraltete Verbindungen entfernt")), onError: failure(t("Could not clean up", "Aufräumen fehlgeschlagen")) }),
        cleaningUp,
        createRoom: () => setConfirmRoom(true),
        creatingRoom,
        disconnectRoom: () => disconnectFromRoom(undefined, {
            onSuccess: () => {
                toast.info(t("Disconnected from the room", "Vom Raum getrennt"))
                refetchStatus()
            },
            onError: failure(t("Could not disconnect from the room", "Trennen vom Raum fehlgeschlagen")),
        }),
        disconnectingRoom,
        createParty: () => createWatchParty({ settings: { syncThreshold: 3.0, maxBufferWaitTime: 10 } }, {
            ...after(t("Watch party created", "Watch Party erstellt")), onError: failure(t("Could not create the watch party", "Watch Party konnte nicht erstellt werden")),
        }),
        creatingParty,
        joinParty: () => joinWatchParty({ clientId: clientId || "" }, {
            onSuccess: () => {
                toast.info(t("Joining the watch party", "Watch Party wird beigetreten"))
                successFeedback()
                refetchStatus()
            },
        }),
        joiningParty,
        leaveParty: () => leaveWatchParty(undefined, {
            onSuccess: () => {
                toast.info(t("Leaving the watch party", "Watch Party wird verlassen"))
                refetchStatus()
            },
        }),
        leavingParty,
    }

    return <>
        <Sheet open={open} onOpenChange={setOpen} title="Nakama">
            <NakamaPhoneContent t={t} status={status} roomsAvailable={!!roomsAvailable} hostPassword={serverStatus?.settings?.nakama?.hostPassword || ""}
                actions={actions} close={() => setOpen(false)} />
        </Sheet>
        <Dialog open={confirmRoom} onOpenChange={setConfirmRoom} title={t("Create a Cloud Room", "Cloud-Raum erstellen")}
            description={t("By continuing, you agree to broadcast your playback state through Seanime's servers to sync with peers while the room is active. You are limited to 10 rooms per day and 4 peers per room (subject to change).",
                "Wenn du fortfährst, wird dein Wiedergabestand über die Server von Seanime gesendet, solange der Raum aktiv ist, damit die anderen synchron bleiben. Möglich sind 10 Räume pro Tag und 4 Teilnehmer pro Raum (kann sich ändern).")}
            footer={<>
                <Button intent="secondary" onPress={() => setConfirmRoom(false)}>{t("Cancel", "Abbrechen")}</Button>
                <Button onPress={() => {
                    setConfirmRoom(false)
                    createAndJoinRoom(undefined, after(t("Room created", "Raum erstellt")))
                }}>{t("Create room", "Raum erstellen")}</Button>
            </>} />
    </>
}

type NakamaActions = {
    reconnect: () => void
    reconnecting: boolean
    cleanUp: () => void
    cleaningUp: boolean
    createRoom: () => void
    creatingRoom: boolean
    disconnectRoom: () => void
    disconnectingRoom: boolean
    createParty: () => void
    creatingParty: boolean
    joinParty: () => void
    joiningParty: boolean
    leaveParty: () => void
    leavingParty: boolean
}

const SETTINGS_READY = MENU_ENTRIES.some(e => e.id === "settings" && e.ready)

function CopyMark() {
    return <Copy size={18} color={colors.smTextMuted} />
}

/** The sheet's content (nakama-phone.tsx): host or host connection, the cloud room, connected devices, the watch party, settings. */
function NakamaPhoneContent({ t, status, roomsAvailable, hostPassword, actions: a, close }: {
    t: Translate
    status: Nakama_NakamaStatus | null | undefined
    roomsAvailable: boolean
    hostPassword: string
    actions: NakamaActions
    close: () => void
}) {
    const router = useRouter()
    // The settings link waits for the settings screen (2.12, MENU_ENTRIES.ready)
    const settings = SETTINGS_READY && (
        <RowGroup>
            <ActionRow icon={Settings} label={t("Nakama settings", "Nakama-Einstellungen")} note={t("Host, password, connection mode", "Host, Passwort, Verbindungsart")} chevron
                onPress={() => {
                    close()
                    router.push("/settings?tab=nakama")
                }} />
        </RowGroup>
    )
    const reconnect = <ActionRow icon={RefreshCw} disabled={a.reconnecting} onPress={a.reconnect}
        label={a.reconnecting ? t("Reconnecting…", "Verbindet neu …") : t("Reconnect", "Neu verbinden")}
        note={t("Builds the connection to the host again", "Baut die Verbindung zum Host neu auf")} />

    if (status === undefined) return <LoadingRows label={t("Loading…", "Lädt …")} count={3} />

    if (!status?.isHost && !status?.isConnectedToHost) return <>
        <PhoneEmpty title={t("Nakama is not active", "Nakama ist nicht aktiv")}
            text={t("Set up Nakama in the settings to connect to a host or to start hosting.", "Richte Nakama in den Einstellungen ein, um dich mit einem Host zu verbinden oder selbst zu hosten.")} />
        <RowGroup>{reconnect}</RowGroup>
        {settings}
    </>

    const session = status.currentWatchPartySession
    const isHost = !!status.isHost
    const { me, isParticipant } = watchPartyMembership(status)
    const isRoom = status.connectionMode === "rooms"
    const room = status.currentRoom
    const copy = (text: string) => void copyToClipboard(text).then(() => toast.success(t("Copied to clipboard", "In die Zwischenablage kopiert")))

    return <>
        {isHost ? (
            <SheetGroup title={t("You're hosting", "Du bist Host")}>
                <RowGroup>
                    <ActionRow icon={RadioTower} label={t("Connection mode", "Verbindungsart")} value={isRoom ? t("Cloud room", "Cloud-Raum") : t("Direct", "Direkt")} />
                    {!isRoom && roomsAvailable && (!session || session.isRoom) && <ActionRow icon={Cloud} chevron disabled={a.creatingRoom} onPress={a.createRoom}
                        label={a.creatingRoom ? t("Creating…", "Erstellt …") : t("Create a cloud room", "Cloud-Raum erstellen")}
                        note={t("Watch parties through Seanime's servers, without exposing your server", "Watch Partys über die Server von Seanime, ohne deinen Server freizugeben")} />}
                    <ActionRow icon={Eraser} disabled={a.cleaningUp} onPress={a.cleanUp}
                        label={a.cleaningUp ? t("Cleaning up…", "Räumt auf …") : t("Remove stale connections", "Veraltete Verbindungen entfernen")}
                        note={t("Drops devices that left without saying so", "Entfernt Geräte, die sich nicht abgemeldet haben")} />
                </RowGroup>
            </SheetGroup>
        ) : (
            <SheetGroup title={t("Host connection", "Verbindung zum Host")}>
                <RowGroup>
                    <ActionRow icon={User} label="Host" value={status.hostConnectionStatus?.username || t("Unknown", "Unbekannt")} />
                    <ActionRow icon={RadioTower} label={t("Connection mode", "Verbindungsart")}
                        value={status.hostConnectionStatus?.connectionMode === "rooms" ? t("Cloud room", "Cloud-Raum") : t("Direct", "Direkt")} />
                    {reconnect}
                </RowGroup>
            </SheetGroup>
        )}

        {isHost && isRoom && !!room && (
            <SheetGroup title={t("Cloud room", "Cloud-Raum")} note={t("Cloud rooms do not support local file and debrid playback.", "Cloud-Räume unterstützen keine lokalen Dateien und kein Debrid.")}>
                <RowGroup>
                    <ActionRow icon={Link} label={t("Host URL", "Host-URL")} note={`room://${room.roomId}`} trailing={<CopyMark />} onPress={() => copy(`room://${room.roomId}`)} />
                    <ActionRow icon={KeyRound} label={t("Passcode", "Passwort")} note={hostPassword || t("No password set", "Kein Passwort gesetzt")}
                        trailing={hostPassword ? <CopyMark /> : undefined} disabled={!hostPassword} onPress={() => copy(hostPassword)} />
                    {!!room.expiresAt && <ActionRow icon={Clock} label={t("Expires", "Läuft ab")}
                        value={new Date(room.expiresAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} />}
                    <ActionRow icon={Unplug} tone="danger" disabled={a.disconnectingRoom} onPress={a.disconnectRoom}
                        label={a.disconnectingRoom ? t("Disconnecting…", "Trennt …") : t("Close the room", "Raum schließen")} />
                </RowGroup>
            </SheetGroup>
        )}

        {isHost && !isRoom && (
            <SheetGroup title={`${t("Connected devices", "Verbundene Geräte")}  ${status.connectedPeers?.length ?? 0}`}>
                {status.connectedPeers?.length
                    ? <RowGroup>{status.connectedPeers.map((peer, index) => <ActionRow key={index} icon={User} label={peer} />)}</RowGroup>
                    : <PhoneEmpty title={t("No one connected yet", "Noch niemand verbunden")}
                        text={t("Other devices connect to this host in their Nakama settings.", "Andere Geräte verbinden sich in ihren Nakama-Einstellungen mit diesem Host.")} />}
            </SheetGroup>
        )}

        <SheetGroup title="Watch Party">
            {session && isParticipant
                ? <WatchPartyRows t={t} session={session} isHost={isHost} isRoom={isRoom} me={me} leave={a.leaveParty} leaving={a.leavingParty} />
                : isHost
                    ? <PhoneEmpty title={t("No watch party running", "Keine Watch Party aktiv")}
                        text={t("Start one and everyone connected watches in sync with you.", "Starte eine, dann schauen alle Verbundenen synchron mit dir.")}>
                        <Button loading={a.creatingParty} leftIcon={<Plus size={18} color="#ffffff" />} onPress={a.createParty}>{t("Create watch party", "Watch Party erstellen")}</Button>
                    </PhoneEmpty>
                    : session
                        ? <PhoneEmpty title={t("A watch party is running", "Eine Watch Party läuft")} text={t("Join to watch together in sync.", "Tritt bei, um gemeinsam synchron zu schauen.")}>
                            <Button loading={a.joiningParty} leftIcon={<Play size={18} color="#ffffff" />} onPress={a.joinParty}>{t("Join watch party", "Watch Party beitreten")}</Button>
                        </PhoneEmpty>
                        : <PhoneEmpty title={t("No watch party running", "Keine Watch Party aktiv")}
                            text={t("When the host starts one, you can join it here.", "Sobald der Host eine startet, kannst du hier beitreten.")} />}
        </SheetGroup>

        {settings}
    </>
}

/** The people in the running watch party, the host's relay choice and leaving or ending it. */
function WatchPartyRows({ t, session, isHost, isRoom, me, leave, leaving }: {
    t: Translate
    session: Nakama_WatchPartySession
    isHost: boolean
    isRoom: boolean
    me: string | null
    leave: () => void
    leaving: boolean
}) {
    const { sendMessage } = useWebsocketSender()
    const [picking, setPicking] = React.useState(false)
    const participants = Object.values(session.participants || {})
    const canRelay = isHost && !session.isRelayMode && !isRoom

    return <>
        <Muted className="-mt-1.5">{participants.length === 1 ? t("1 person", "1 Person") : t(`${participants.length} people`, `${participants.length} Personen`)}</Muted>
        <RowGroup>
            {participants.map(participant => {
                const tags = participantTags(participant, session.isRelayMode, t)
                const label = participant.id === me ? `${participant.username} (${t("me", "ich")})` : participant.username
                const value = participant.isBuffering ? t("Buffering", "Puffert") : participant.latency > 0 ? `${participant.latency} ms` : undefined
                const pickable = picking && !participant.isHost && !participant.isRelayOrigin
                if (pickable) return <ActionRow key={participant.id} icon={User} label={label} note={tags || undefined} tone="attention" chevron
                    value={t("Make origin", "Zum Ursprung machen")} onPress={() => {
                        sendMessage({ type: WSEvents.NAKAMA_WATCH_PARTY_ENABLE_RELAY_MODE, payload: { peerId: participant.id } })
                        setPicking(false)
                    }} />
                return <ActionRow key={participant.id} icon={User} label={label} note={tags || undefined} value={value} />
            })}
        </RowGroup>
        <RowGroup>
            {canRelay && <ActionRow icon={RadioTower} onPress={() => setPicking(p => !p)} tone={picking ? "attention" : undefined}
                label={picking ? t("Pick the origin above", "Ursprung oben antippen") : t("Relay mode", "Relay-Modus")}
                note={picking ? t("Tap again to cancel", "Nochmal tippen zum Abbrechen")
                    : t("One participant's playback becomes the source for everyone", "Die Wiedergabe eines Teilnehmers wird zur Quelle für alle")} />}
            <ActionRow icon={LogOut} tone="danger" disabled={leaving} onPress={leave}
                label={leaving ? t("Leaving…", "Verlässt …") : isHost ? t("End watch party", "Watch Party beenden") : t("Leave watch party", "Watch Party verlassen")} />
        </RowGroup>
    </>
}
