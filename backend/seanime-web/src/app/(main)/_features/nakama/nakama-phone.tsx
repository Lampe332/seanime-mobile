import { Nakama_NakamaStatus, Nakama_WatchPartySession } from "@/api/generated/types"
import { useWebsocketSender } from "@/app/(main)/_hooks/handle-websockets"
import { PhoneEmpty, PhoneLoading, PhoneRow, PhoneSheetGroup } from "@/app/(main)/_features/phone-screen/phone-screen"
import { copyToClipboard } from "@/lib/helpers/browser"
import { useTr } from "@/lib/app-language"
import { useRouter } from "@/lib/navigation"
import { WSEvents } from "@/lib/server/ws-events"
import React from "react"
import { LuClock, LuCloud, LuCopy, LuEraser, LuKeyRound, LuLink, LuLogOut, LuPlay, LuPlus, LuRadioTower, LuRefreshCw, LuSettings, LuUnplug, LuUser } from "react-icons/lu"
import { toast } from "sonner"
import "./nakama-phone.css"

/** What the Nakama sheet can do; NakamaManager owns the requests and passes them in. */
export type NakamaPhoneActions = {
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

/**
 * The Nakama sheet's content on Android phones and tablets: who the host is and how this device is connected, the watch
 * party (start, join, its people, leave) and the way to the settings, as groups of rows like the app's other sheets.
 */
export function NakamaPhoneContent({ status, roomsAvailable, hostPassword, actions: a, close }: {
    status: Nakama_NakamaStatus | null | undefined
    roomsAvailable: boolean
    hostPassword: string
    actions: NakamaPhoneActions
    close: () => void
}) {
    const t = useTr()
    const router = useRouter()
    const settings = <div className="ps-rows">
        <PhoneRow icon={<LuSettings />} label={t("Nakama settings", "Nakama-Einstellungen")} chevron data-nakama-settings
            note={t("Host, password, connection mode", "Host, Passwort, Verbindungsart")} onClick={() => {
            close()
            router.push("/settings?tab=nakama")
        }} />
    </div>
    const reconnect = <PhoneRow icon={<LuRefreshCw className={a.reconnecting ? "ps-spin" : undefined} />} disabled={a.reconnecting} onClick={a.reconnect}
        label={a.reconnecting ? t("Reconnecting…", "Verbindet neu …") : t("Reconnect", "Neu verbinden")} data-nakama-reconnect
        note={t("Builds the connection to the host again", "Baut die Verbindung zum Host neu auf")} />

    if (status === undefined) return <PhoneLoading label={t("Loading…", "Lädt …")} layout={["row", "row", "row"]} />

    if (!status?.isHost && !status?.isConnectedToHost) return <>
        <PhoneEmpty title={t("Nakama is not active", "Nakama ist nicht aktiv")} data-nakama-inactive
            text={t("Set up Nakama in the settings to connect to a host or to start hosting.", "Richte Nakama in den Einstellungen ein, um dich mit einem Host zu verbinden oder selbst zu hosten.")} />
        <div className="ps-rows">{reconnect}</div>
        {settings}
    </>

    const session = status.currentWatchPartySession
    const isHost = !!status.isHost
    const peerId = status.hostConnectionStatus?.peerId
    const inSession = !!session && (isHost || (!!peerId && !!session.participants && peerId in session.participants))
    const isRoom = status.connectionMode === "rooms"
    const room = status.currentRoom
    const copy = (text: string) => copyToClipboard(text).then(() => toast.success(t("Copied to clipboard", "In die Zwischenablage kopiert")))

    return <>
        {isHost ? <PhoneSheetGroup title={t("You're hosting", "Du bist Host")} data-nakama-group="host">
            <div className="ps-rows">
                <PhoneRow icon={<LuRadioTower />} label={t("Connection mode", "Verbindungsart")} value={isRoom ? t("Cloud room", "Cloud-Raum") : t("Direct", "Direkt")} data-nakama-mode />
                {!isRoom && roomsAvailable && (!session || session.isRoom) && <PhoneRow icon={<LuCloud />} chevron disabled={a.creatingRoom} onClick={a.createRoom}
                    label={a.creatingRoom ? t("Creating…", "Erstellt …") : t("Create a cloud room", "Cloud-Raum erstellen")} data-nakama-create-room
                    note={t("Watch parties through Seanime's servers, without exposing your server", "Watch Partys über die Server von Seanime, ohne deinen Server freizugeben")} />}
                <PhoneRow icon={<LuEraser />} disabled={a.cleaningUp} onClick={a.cleanUp} data-nakama-cleanup
                    label={a.cleaningUp ? t("Cleaning up…", "Räumt auf …") : t("Remove stale connections", "Veraltete Verbindungen entfernen")}
                    note={t("Drops devices that left without saying so", "Entfernt Geräte, die sich nicht abgemeldet haben")} />
            </div>
        </PhoneSheetGroup> : <PhoneSheetGroup title={t("Host connection", "Verbindung zum Host")} data-nakama-group="host">
            <div className="ps-rows">
                <PhoneRow icon={<LuUser />} label="Host" value={status.hostConnectionStatus?.username || t("Unknown", "Unbekannt")} data-nakama-host />
                <PhoneRow icon={<LuRadioTower />} label={t("Connection mode", "Verbindungsart")} data-nakama-mode
                    value={status.hostConnectionStatus?.connectionMode === "rooms" ? t("Cloud room", "Cloud-Raum") : t("Direct", "Direkt")} />
                {reconnect}
            </div>
        </PhoneSheetGroup>}

        {isHost && isRoom && room && <PhoneSheetGroup title={t("Cloud room", "Cloud-Raum")} data-nakama-group="room"
            note={t("Cloud rooms do not support local file and debrid playback.", "Cloud-Räume unterstützen keine lokalen Dateien und kein Debrid.")}>
            <div className="ps-rows">
                <PhoneRow icon={<LuLink />} label={t("Host URL", "Host-URL")} note={`room://${room.roomId}`} value={<LuCopy aria-label={t("Copy", "Kopieren")} />}
                    onClick={() => copy(`room://${room.roomId}`)} data-nakama-copy="url" />
                <PhoneRow icon={<LuKeyRound />} label={t("Passcode", "Passwort")} note={hostPassword || t("No password set", "Kein Passwort gesetzt")}
                    value={hostPassword ? <LuCopy aria-label={t("Copy", "Kopieren")} /> : undefined} disabled={!hostPassword}
                    onClick={() => copy(hostPassword)} data-nakama-copy="password" />
                {!!room.expiresAt && <PhoneRow icon={<LuClock />} label={t("Expires", "Läuft ab")} value={new Date(room.expiresAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })} />}
                <PhoneRow icon={<LuUnplug />} tone="danger" disabled={a.disconnectingRoom} onClick={a.disconnectRoom} data-nakama-disconnect-room
                    label={a.disconnectingRoom ? t("Disconnecting…", "Trennt …") : t("Close the room", "Raum schließen")} />
            </div>
        </PhoneSheetGroup>}

        {isHost && !isRoom && <PhoneSheetGroup title={<>{t("Connected devices", "Verbundene Geräte")}<span className="nk-count">{status.connectedPeers?.length ?? 0}</span></>}
            data-nakama-group="peers">
            {status.connectedPeers?.length
                ? <div className="ps-rows">{status.connectedPeers.map((peer, index) => <div key={index} className="ps-action nk-static">
                    <LuUser className="ps-action-icon" aria-hidden /><span className="ps-action-text"><span>{peer}</span></span>
                </div>)}</div>
                : <PhoneEmpty title={t("No one connected yet", "Noch niemand verbunden")}
                    text={t("Other devices connect to this host in their Nakama settings.", "Andere Geräte verbinden sich in ihren Nakama-Einstellungen mit diesem Host.")} />}
        </PhoneSheetGroup>}

        <PhoneSheetGroup title="Watch Party" data-nakama-group="watch-party">
            {session && inSession
                ? <WatchPartyRows session={session} isHost={isHost} isRoom={isRoom} me={isHost ? "host" : peerId} leave={a.leaveParty} leaving={a.leavingParty} />
                : isHost
                    ? <PhoneEmpty title={t("No watch party running", "Keine Watch Party aktiv")} data-nakama-party-empty
                        text={t("Start one and everyone connected watches in sync with you.", "Starte eine, dann schauen alle Verbundenen synchron mit dir.")}>
                        <button type="button" className="ps-primary" disabled={a.creatingParty} onClick={a.createParty} data-nakama-create-party>
                            <LuPlus aria-hidden />{a.creatingParty ? t("Creating…", "Erstellt …") : t("Create watch party", "Watch Party erstellen")}
                        </button>
                    </PhoneEmpty>
                    : session
                        ? <PhoneEmpty title={t("A watch party is running", "Eine Watch Party läuft")} data-nakama-party-join
                            text={t("Join to watch together in sync.", "Tritt bei, um gemeinsam synchron zu schauen.")}>
                            <button type="button" className="ps-primary" disabled={a.joiningParty} onClick={a.joinParty} data-nakama-join-party>
                                <LuPlay aria-hidden />{a.joiningParty ? t("Joining…", "Tritt bei …") : t("Join watch party", "Watch Party beitreten")}
                            </button>
                        </PhoneEmpty>
                        : <PhoneEmpty title={t("No watch party running", "Keine Watch Party aktiv")} data-nakama-party-empty
                            text={t("When the host starts one, you can join it here.", "Sobald der Host eine startet, kannst du hier beitreten.")} />}
        </PhoneSheetGroup>

        {settings}
    </>
}

/** The people in the running watch party, the host's relay choice and leaving or ending it. */
function WatchPartyRows({ session, isHost, isRoom, me, leave, leaving }: {
    session: Nakama_WatchPartySession
    isHost: boolean
    isRoom: boolean
    me: string | null | undefined
    leave: () => void
    leaving: boolean
}) {
    const t = useTr()
    const { sendMessage } = useWebsocketSender()
    const [picking, setPicking] = React.useState(false)
    const participants = Object.values(session.participants || {})
    const canRelay = isHost && !session.isRelayMode && !isRoom

    return <>
        <p className="ps-sheet-note nk-people">{participants.length === 1 ? t("1 person", "1 Person") : t(`${participants.length} people`, `${participants.length} Personen`)}</p>
        <div className="ps-rows" data-nakama-participants>
            {participants.map(participant => {
                const tags = [
                    participant.isHost && "Host",
                    session.isRelayMode && participant.isHost && "Relay",
                    participant.isRelayOrigin && t("Origin", "Ursprung"),
                    !participant.isHost && participant.bufferHealth !== undefined && `${t("Buffer", "Puffer")} ${Math.round(participant.bufferHealth * 100)} %`,
                ].filter(Boolean).join(" · ")
                const label = <>{participant.username}{participant.id === me && <span className="nk-me"> ({t("me", "ich")})</span>}</>
                const value = participant.isBuffering ? <span className="nk-buffering">{t("Buffering", "Puffert")}</span>
                    : participant.latency > 0 ? `${participant.latency} ms` : undefined
                const pickable = picking && !participant.isHost && !participant.isRelayOrigin
                if (pickable) return <PhoneRow key={participant.id} icon={<LuUser />} label={label} note={tags || undefined} tone="attention" chevron
                    value={t("Make origin", "Zum Ursprung machen")} data-nakama-participant={participant.id} onClick={() => {
                    sendMessage({ type: WSEvents.NAKAMA_WATCH_PARTY_ENABLE_RELAY_MODE, payload: { peerId: participant.id } })
                    setPicking(false)
                }} />
                return <div key={participant.id} className="ps-action nk-static" data-nakama-participant={participant.id}>
                    <LuUser className="ps-action-icon" aria-hidden />
                    <span className="ps-action-text"><span>{label}</span>{!!tags && <small>{tags}</small>}</span>
                    {value != null && <span className="ps-action-value">{value}</span>}
                </div>
            })}
        </div>
        <div className="ps-rows">
            {canRelay && <PhoneRow icon={<LuRadioTower />} onClick={() => setPicking(p => !p)} tone={picking ? "attention" : undefined} data-nakama-relay
                label={picking ? t("Pick the origin above", "Ursprung oben antippen") : t("Relay mode", "Relay-Modus")}
                note={picking ? t("Tap again to cancel", "Nochmal tippen zum Abbrechen")
                    : t("One participant's playback becomes the source for everyone", "Die Wiedergabe eines Teilnehmers wird zur Quelle für alle")} />}
            <PhoneRow icon={<LuLogOut />} tone="danger" disabled={leaving} onClick={leave} data-nakama-leave-party
                label={leaving ? t("Leaving…", "Verlässt …") : isHost ? t("End watch party", "Watch Party beenden") : t("Leave watch party", "Watch Party verlassen")} />
        </div>
    </>
}
