import { API_ENDPOINTS } from "@/api/generated/endpoints"
import {
    Nakama_NakamaStatus,
    Nakama_WatchPartySession,
    Nakama_WatchPartySessionSettings,
    VideoCore_OnlinestreamParams,
    VideoCore_ServerEvent,
} from "@/api/generated/types"
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
import { useWebsocketMessageListener, useWebsocketSender } from "@/app/(main)/_hooks/handle-websockets"
import { PhoneSheet } from "@/app/(main)/_features/phone-screen/phone-screen"
import { NakamaPhoneContent } from "./nakama-phone"
import { useServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { useNakamaOnlineStreamWatchParty } from "@/app/(main)/onlinestream/_lib/handle-onlinestream"
import { clientIdAtom, websocketConnectedAtom } from "@/app/websocket-provider"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { GlowingEffect } from "@/components/shared/glowing-effect"
import { SeaLink } from "@/components/shared/sea-link"
import { Badge } from "@/components/ui/badge"
import { Button, IconButton } from "@/components/ui/button"
import { cn } from "@/components/ui/core/styling"
import { LoadingSpinner } from "@/components/ui/loading-spinner"
import { Modal } from "@/components/ui/modal"
import { TextInput } from "@/components/ui/text-input"
import { Tooltip } from "@/components/ui/tooltip"
import { copyToClipboard } from "@/lib/helpers/browser"
import { WSEvents } from "@/lib/server/ws-events"
import { useThemeSettings } from "@/lib/theme/theme-hooks"
import { useQueryClient } from "@tanstack/react-query"
import { atom, useAtom, useAtomValue } from "jotai"
import { useTr } from "@/lib/app-language"
import { successFeedback } from "@/lib/feedback"
import React from "react"
import { BiCog } from "react-icons/bi"
import { FaBroadcastTower } from "react-icons/fa"
import { HiOutlinePlay } from "react-icons/hi2"
import { LuClipboard, LuPopcorn } from "react-icons/lu"
import { MdAdd, MdCleaningServices, MdOutlineConnectWithoutContact, MdPlayArrow, MdRefresh } from "react-icons/md"
import { TbCloudPlus } from "react-icons/tb"
import { toast } from "sonner"
import { useWideScreen } from "./use-wide-screen"

export const nakamaModalOpenAtom = atom(false)
// exported for tests/mobile_settings_harness.tsx
export const nakamaStatusAtom = atom<Nakama_NakamaStatus | null | undefined>(undefined)

export function useNakamaStatus() {
    return useAtomValue(nakamaStatusAtom)
}

export function useNakamaWatchParty() {
    const nakamaStatus = useAtomValue(nakamaStatusAtom)
    const watchPartySession = React.useMemo(() => nakamaStatus?.currentWatchPartySession, [nakamaStatus])

    const currentUserPeerId = React.useMemo(() => {
        if (nakamaStatus?.isHost) {
            return "host"
        }
        return nakamaStatus?.hostConnectionStatus?.peerId || null
    }, [nakamaStatus])


    const isParticipant = React.useMemo(() => {
        if (!watchPartySession || !watchPartySession.participants) return false
        return nakamaStatus?.isHost || !!(currentUserPeerId && currentUserPeerId in watchPartySession.participants)
    }, [watchPartySession, nakamaStatus, currentUserPeerId])

    const isPeer = React.useMemo(() => {
        if (!isParticipant || currentUserPeerId === "host" || !currentUserPeerId || !watchPartySession) return false
        return !watchPartySession?.participants?.[currentUserPeerId]?.isRelayOrigin
    }, [watchPartySession])

    return {
        watchPartySession,
        isParticipant,
        isPeer: isPeer,
        isHost: currentUserPeerId === "host",
        currentUserPeerId,
    }
}

export function NakamaManager() {
    const tr = useTr()
    const wide = useWideScreen()
    const { sendMessage } = useWebsocketSender()
    const queryClient = useQueryClient()
    const [isModalOpen, setIsModalOpen] = useAtom(nakamaModalOpenAtom)
    const [nakamaStatus, setNakamaStatus] = useAtom(nakamaStatusAtom)
    const clientId = useAtomValue(clientIdAtom)
    const ts = useThemeSettings()
    const serverStatus = useServerStatus()

    const watchPartySession = React.useMemo(() => nakamaStatus?.currentWatchPartySession, [nakamaStatus])

    const roomInfo = nakamaStatus?.currentRoom

    const { mutate: reconnectToHost, isPending: isReconnecting } = useNakamaReconnectToHost()
    const { mutate: removeStaleConnections, isPending: isCleaningUp } = useNakamaRemoveStaleConnections()
    const { mutate: createWatchParty, isPending: isCreatingWatchParty } = useNakamaCreateWatchParty()
    const { mutate: joinWatchParty, isPending: isJoiningWatchParty } = useNakamaJoinWatchParty()
    const { mutate: leaveWatchParty, isPending: isLeavingWatchParty } = useNakamaLeaveWatchParty()
    const { mutate: createAndJoinRoom, isPending: isCreatingRoom } = useNakamaCreateAndJoinRoom()
    const { mutate: disconnectFromRoom, isPending: isDisconnectingFromRoom } = useNakamaDisconnectFromRoom()
    const { data: roomsAvailable } = useNakamaRoomsAvailable()

    // Watch party settings for creating a new session
    const [watchPartySettings, setWatchPartySettings] = React.useState<Nakama_WatchPartySessionSettings>({
        syncThreshold: 3.0,
        maxBufferWaitTime: 10,
    })

    function refetchStatus() {
        sendMessage({
            type: WSEvents.NAKAMA_STATUS_REQUESTED,
            payload: {
                // Tell the server whether this client is using the native player
                useDenshiPlayer: false,
                clientId: clientId || "",
            },
        })
    }

    React.useEffect(() => {
        refetchStatus()
    }, [])

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_STATUS,
        onMessage: (data: Nakama_NakamaStatus | null) => {
            setNakamaStatus(data ?? null)
        },
    })

    function refetchNakamaLibrary() {
        refetchStatus()
        queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_COLLECTION.GetLibraryCollection.key] })
        // An open anime page gets the host's episodes (or loses them) without leaving it
        queryClient.invalidateQueries({ queryKey: [API_ENDPOINTS.ANIME_ENTRIES.GetAnimeEntry.key] })
    }

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_HOST_CONNECTED,
        onMessage: () => {
            refetchNakamaLibrary()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_HOST_DISCONNECTED,
        onMessage: () => {
            refetchNakamaLibrary()
        },
    })

    // NAKAMA_WATCH_PARTY_STATE tells the client to refetch the status
    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_WATCH_PARTY_STATE,
        onMessage: (data: any) => {
            refetchStatus()
        },
    })

    const websocketConnected = useAtomValue(websocketConnectedAtom)

    React.useEffect(() => {
        refetchStatus()
    }, [isModalOpen, websocketConnected])

    const handleReconnect = React.useCallback(() => {
        reconnectToHost({}, {
            onSuccess: () => {
                toast.success(tr("Reconnection started", "Verbindung wird neu aufgebaut"))
                refetchStatus()
            },
            onError: (error) => {
                toast.error(`${tr("Could not reconnect", "Neuverbindung fehlgeschlagen")}: ${error.message}`)
            },
        })
    }, [reconnectToHost, refetchStatus])

    const handleCleanupStaleConnections = React.useCallback(() => {
        removeStaleConnections({}, {
            onSuccess: () => {
                toast.success(tr("Stale connections removed", "Veraltete Verbindungen entfernt"))
                refetchStatus()
            },
            onError: (error) => {
                toast.error(`${tr("Could not clean up", "Aufräumen fehlgeschlagen")}: ${error.message}`)
            },
        })
    }, [removeStaleConnections, refetchStatus])

    const handleCreateWatchParty = React.useCallback(() => {
        createWatchParty({ settings: watchPartySettings }, {
            onSuccess: () => {
                toast.success(tr("Watch party created", "Watch Party erstellt"))
                refetchStatus()
            },
            onError: (error) => {
                toast.error(`${tr("Could not create the watch party", "Watch Party konnte nicht erstellt werden")}: ${error.message}`)
            },
        })
    }, [createWatchParty, watchPartySettings, refetchStatus])

    const handleJoinWatchParty = React.useCallback(() => {
        joinWatchParty({
            clientId: clientId || "",
        }, {
            onSuccess: () => {
                toast.info(tr("Joining the watch party", "Watch Party wird beigetreten"))
                successFeedback()
                refetchStatus()
            },
        })
    }, [joinWatchParty, refetchStatus])

    const handleLeaveWatchParty = React.useCallback(() => {
        leaveWatchParty(undefined, {
            onSuccess: () => {
                toast.info(tr("Leaving the watch party", "Watch Party wird verlassen"))
                refetchStatus()
            },
        })
    }, [leaveWatchParty, refetchStatus])

    const handleCreateRoom = React.useCallback(() => {
        createAndJoinRoom(undefined, {
            onSuccess: () => {
                toast.success(tr("Room created", "Raum erstellt"))
                refetchStatus()
            },
        })
    }, [createAndJoinRoom, refetchStatus])

    const handleDisconnectFromRoom = React.useCallback(() => {
        disconnectFromRoom(undefined, {
            onSuccess: () => {
                toast.info(tr("Disconnected from the room", "Vom Raum getrennt"))
                refetchStatus()
            },
            onError: (error) => {
                toast.error(`${tr("Could not disconnect from the room", "Trennen vom Raum fehlgeschlagen")}: ${error.message}`)
            },
        })
    }, [disconnectFromRoom, refetchStatus])

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_ROOM_CLOSED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_ROOM_RECONNECTED,
        onMessage: (data: { roomId: string }) => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_HOST_STARTED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_HOST_STOPPED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_PEER_CONNECTED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_PEER_DISCONNECTED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_HOST_CONNECTED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_HOST_DISCONNECTED,
        onMessage: () => {
            refetchStatus()
        },
    })

    useWebsocketMessageListener({
        type: WSEvents.NAKAMA_ERROR,
        onMessage: () => {
            refetchStatus()
        },
    })

    /////// Online stream

    const { startOnlineStreamWatchParty } = useNakamaOnlineStreamWatchParty()
    useWebsocketMessageListener({
        type: WSEvents.VIDEOCORE,
        onMessage: ({ type, payload }: { type: VideoCore_ServerEvent, payload: unknown }) => {
            switch (type) {
                case "start-onlinestream-watch-party":
                    const data = payload as VideoCore_OnlinestreamParams
                    startOnlineStreamWatchParty(data)
            }
        },
    })

    const confirmRoom = useConfirmationDialog({
        title: tr("Create a Cloud Room", "Cloud-Raum erstellen"),
        description: tr("By continuing, you agree to broadcast your playback state through Seanime's servers to sync with peers while the room is active. You are limited to 10 rooms per day and 4 peers per room (subject to change).",
            "Wenn du fortfährst, wird dein Wiedergabestand über die Server von Seanime gesendet, solange der Raum aktiv ist, damit die anderen synchron bleiben. Möglich sind 10 Räume pro Tag und 4 Teilnehmer pro Raum (kann sich ändern)."),
        actionText: tr("Create room", "Raum erstellen"),
        onConfirm: () => {
            handleCreateRoom()
        },
        actionIntent: "white-subtle",
    })

    const content = <>
            <div className="absolute top-4 right-14">
                <SeaLink href="/settings?tab=nakama" onClick={() => setIsModalOpen(false)}>
                    <IconButton intent="gray-basic" size="sm" icon={<BiCog />} aria-label={tr("Nakama settings", "Nakama-Einstellungen")} />
                </SeaLink>
            </div>

            {nakamaStatus === undefined && <LoadingSpinner />}

            {!nakamaStatus?.isHost && (
                <div className="flex items-center justify-between">
                    <div></div>
                    <Button
                        onClick={handleReconnect}
                        disabled={isReconnecting}
                        size="sm"
                        intent="gray-basic"
                        leftIcon={<MdRefresh />}
                    >
                        {isReconnecting ? tr("Reconnecting…", "Verbindet neu …") : tr("Reconnect", "Neu verbinden")}
                    </Button>
                </div>
            )}

            {nakamaStatus !== undefined && (nakamaStatus?.isHost || nakamaStatus?.isConnectedToHost) && (
                <>

                    {nakamaStatus?.isHost && (
                        <>
                            <div className="flex items-center justify-between">
                                <Badge intent="success-solid" className="px-0 text-indigo-300 bg-transparent">{tr("Currently hosting", "Du hostest gerade")}</Badge>
                                <Button
                                    onClick={handleCleanupStaleConnections}
                                    disabled={isCleaningUp}
                                    size="sm"
                                    intent="gray-basic"
                                                leftIcon={<MdCleaningServices />}
                                >
                                    {isCleaningUp ? tr("Cleaning up…", "Räumt auf …") : tr("Remove stale connections", "Veraltete Verbindungen entfernen")}
                                </Button>
                            </div>

                            {/* Cloud Rooms */}
                            {nakamaStatus?.connectionMode === "rooms" && roomInfo
                                ? (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <h4>{tr("Cloud room", "Cloud-Raum")}</h4>
                                            <Button
                                                onClick={handleDisconnectFromRoom}
                                                disabled={isDisconnectingFromRoom}
                                                size="sm"
                                                intent="alert-link"
                                                                    >
                                                {isDisconnectingFromRoom ? tr("Disconnecting…", "Trennt …") : tr("Disconnect", "Trennen")}
                                            </Button>
                                        </div>
                                        <p className="text-sm text-[--muted]">
                                            {tr("Cloud rooms do not support local file and debrid playback.", "Cloud-Räume unterstützen keine lokalen Dateien und kein Debrid.")}
                                        </p>
                                        <div className="p-4 border rounded-lg bg-gray-950 space-y-3">
                                            <div className="space-y-1">
                                                <span className="text-sm text-[--muted]">{tr("Nakama host URL and passcode", "Nakama-Host-URL und Passwort")}</span>
                                                <div className="flex items-center gap-2">
                                                    <TextInput
                                                        readOnly
                                                        leftAddon={tr("Host URL", "Host-URL")}
                                                        value={`room://${roomInfo.roomId}`}
                                                        onClick={(e) => e.currentTarget.select()}
                                                        addonClass="font-bold tracking-wide text-sm pr-2"
                                                        rightAddon={<>
                                                            <IconButton
                                                                size="sm"
                                                                intent="gray-basic"
                                                                aria-label={tr("Copy", "Kopieren")}
                                                                onClick={() => {
                                                                    copyToClipboard(`room://${roomInfo.roomId}`)
                                                                        .then(() => toast.success(tr("Copied to clipboard", "In die Zwischenablage kopiert")))
                                                                }}
                                                                icon={<LuClipboard />}
                                                            />
                                                        </>}
                                                    />
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <TextInput
                                                        readOnly
                                                        leftAddon={tr("Passcode", "Passwort")}
                                                        value={serverStatus?.settings?.nakama?.hostPassword || tr("No password set", "Kein Passwort gesetzt")}
                                                        onClick={(e) => e.currentTarget.select()}
                                                        addonClass="font-bold tracking-wide text-sm pr-2"
                                                        rightAddon={<>
                                                            <IconButton
                                                                size="sm"
                                                                intent="gray-basic"
                                                                aria-label={tr("Copy", "Kopieren")}
                                                                onClick={() => {
                                                                    copyToClipboard(serverStatus?.settings?.nakama?.hostPassword || "")
                                                                        .then(() => toast.success(tr("Copied to clipboard", "In die Zwischenablage kopiert")))
                                                                }}
                                                                icon={<LuClipboard />}
                                                            />
                                                        </>}
                                                    />
                                                </div>
                                            </div>
                                            {roomInfo.expiresAt && <div className="flex items-center gap-1">
                                                <span className="text-sm text-[--muted]">{tr("Expires:", "Läuft ab:")} </span>
                                                <span className="text-sm font-semibold">{new Date(roomInfo.expiresAt).toLocaleString()}</span>
                                            </div>}
                                        </div>
                                    </div>
                                )
                                : nakamaStatus?.connectionMode === "direct" && roomsAvailable && (!nakamaStatus?.currentWatchPartySession || (nakamaStatus.currentWatchPartySession && nakamaStatus.currentWatchPartySession?.isRoom)) && (
                                <div className="space-y-2">
                                    <div className="p-4 border rounded-lg bg-gray-950">
                                        <div className="flex items-center justify-between">
                                            <div className="space-y-1">
                                                <p className="font-bold">
                                                    {tr("Cloud room", "Cloud-Raum")}
                                                </p>
                                                <p className="text-sm text-[--muted] pr-4">
                                                    {tr("Cloud rooms use Seanime's API to host watch parties without exposing your server to the internet.",
                                                        "Cloud-Räume nutzen die API von Seanime, damit du Watch Partys hosten kannst, ohne deinen Server ins Internet zu stellen.")}
                                                </p>
                                            </div>
                                            <Tooltip
                                                trigger={<Button
                                                    onClick={confirmRoom.open}
                                                    disabled={isCreatingRoom}
                                                    size="sm"
                                                    intent="white-subtle"
                                                                                leftIcon={<TbCloudPlus className="text-2xl" />}
                                                >
                                                    {isCreatingRoom ? tr("Creating…", "Erstellt …") : tr("Create a cloud room", "Cloud-Raum erstellen")}
                                                </Button>}
                                            >
                                                {tr("You join the room automatically.", "Du trittst dem Raum automatisch bei.")}
                                            </Tooltip>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {nakamaStatus.connectionMode === "direct" && <>
                                <h4>{tr("Direct connections", "Direkte Verbindungen")} ({nakamaStatus?.connectedPeers?.length ?? 0})</h4>
                                <div className="p-4 border rounded-lg bg-gray-950">
                                    {!nakamaStatus?.connectedPeers?.length &&
                                        <p className="text-center text-sm text-[--muted]">{tr("No connected peers", "Keine verbundenen Teilnehmer")}</p>}
                                    {nakamaStatus?.connectedPeers?.map((peer, index) => (
                                        <div key={index} className="flex items-center justify-between py-1">
                                            <span className="font-medium">{peer}</span>
                                        </div>
                                    ))}
                                </div>
                            </>}
                        </>
                    )}

                    {(nakamaStatus?.isConnectedToHost && !nakamaStatus?.isHost) && (
                        <>

                            <h4>{tr("Host connection", "Verbindung zum Host")}</h4>
                            <div className="p-4 border rounded-lg bg-gray-950">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-[--muted]">Host</span>
                                        <span className="font-medium text-sm tracking-wide">
                                            {nakamaStatus?.hostConnectionStatus?.username || tr("Unknown", "Unbekannt")}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-[--muted]">{tr("Connection mode", "Verbindungsart")}</span>
                                        <Badge intent={nakamaStatus?.hostConnectionStatus?.connectionMode === "rooms" ? "primary" : "gray"}>
                                            {nakamaStatus?.hostConnectionStatus?.connectionMode === "rooms" ? tr("Cloud room", "Cloud-Raum") : tr("Direct", "Direkt")}
                                        </Badge>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {/* Watch Party Content */}
                    {(() => {
                        const isHost = nakamaStatus?.isHost || false
                        const isConnectedToHost = nakamaStatus?.isConnectedToHost || false
                        const currentPeerID = nakamaStatus?.hostConnectionStatus?.peerId

                        // Check if user is in the participant list by comparing peer ID
                        const isUserInSession = watchPartySession && (
                            isHost ||
                            (currentPeerID && watchPartySession.participants && currentPeerID in watchPartySession.participants)
                        )

                        // Show session view if there's a session AND user is in it
                        if (watchPartySession && isUserInSession) {
                            return (
                                <WatchPartySessionView
                                    session={watchPartySession}
                                    isHost={isHost}
                                    onLeave={handleLeaveWatchParty}
                                    isLeaving={isLeavingWatchParty}
                                    isRoom={nakamaStatus.connectionMode === "rooms"}
                                />
                            )
                        }

                        // Otherwise show creation/join options
                        return (
                            <WatchPartyCreation
                                isHost={isHost}
                                isConnectedToHost={isConnectedToHost}
                                hasActiveSession={!!watchPartySession}
                                settings={watchPartySettings}
                                onSettingsChange={setWatchPartySettings}
                                onCreateWatchParty={handleCreateWatchParty}
                                onJoinWatchParty={handleJoinWatchParty}
                                isCreating={isCreatingWatchParty}
                                isJoining={isJoiningWatchParty}
                            />
                        )
                    })()}
                </>
            )}

            {!nakamaStatus?.isHost && !nakamaStatus?.isConnectedToHost && nakamaStatus !== undefined && (
                <div className="text-center py-8">
                    <p className="text-[--muted]">{tr("Nakama is not active", "Nakama ist nicht aktiv")}</p>
                    <p className="text-sm text-[--muted] mt-2">
                        {tr("Set up Nakama in the settings to connect to a host or to start hosting.", "Richte Nakama in den Einstellungen ein, um dich mit einem Host zu verbinden oder selbst zu hosten.")}
                    </p>
                </div>
            )}
    </>

    return <>
        {wide ? (
            <Modal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                title={<div className="flex items-center gap-2 w-full justify-center">
                    <MdOutlineConnectWithoutContact className="size-8" />
                    Nakama
                </div>}
                contentClass={cn(
                    "max-w-3xl bg-gray-950 bg-opacity-90 firefox:bg-opacity-100 firefox:backdrop-blur-none sm:rounded-3xl",
                    ts.enableBlurringEffects && "bg-gray-950 bg-opacity-90 backdrop-blur-sm firefox:bg-opacity-100 firefox:backdrop-blur-none",
                )}
                overlayClass={cn(ts.enableBlurringEffects ? "bg-gray-950/70 backdrop-blur-sm" : "bg-black/80")}
            >
            <GlowingEffect
                variant="classic"
                spread={40}
                glow={true}
                disabled={false}
                proximity={64}
                inactiveZone={0.01}
                className="opacity-50"
            />

                {content}
            </Modal>
        ) : (
            <PhoneSheet title="Nakama" open={isModalOpen} onOpenChange={setIsModalOpen} data-nakama-sheet>
                <NakamaPhoneContent status={nakamaStatus} roomsAvailable={!!roomsAvailable} hostPassword={serverStatus?.settings?.nakama?.hostPassword || ""}
                    close={() => setIsModalOpen(false)} actions={{
                    reconnect: handleReconnect, reconnecting: isReconnecting,
                    cleanUp: handleCleanupStaleConnections, cleaningUp: isCleaningUp,
                    createRoom: confirmRoom.open, creatingRoom: isCreatingRoom,
                    disconnectRoom: handleDisconnectFromRoom, disconnectingRoom: isDisconnectingFromRoom,
                    createParty: handleCreateWatchParty, creatingParty: isCreatingWatchParty,
                    joinParty: handleJoinWatchParty, joiningParty: isJoiningWatchParty,
                    leaveParty: handleLeaveWatchParty, leavingParty: isLeavingWatchParty,
                }} />
            </PhoneSheet>
        )}

        <ConfirmationDialog {...confirmRoom} />
    </>
}

interface WatchPartyCreationProps {
    isHost: boolean
    isConnectedToHost: boolean
    hasActiveSession: boolean
    settings: Nakama_WatchPartySessionSettings
    onSettingsChange: (settings: Nakama_WatchPartySessionSettings) => void
    onCreateWatchParty: () => void
    onJoinWatchParty: () => void
    isCreating: boolean
    isJoining: boolean
}

function WatchPartyCreation({
    isHost,
    isConnectedToHost,
    hasActiveSession,
    settings,
    onSettingsChange,
    onCreateWatchParty,
    onJoinWatchParty,
    isCreating,
    isJoining,
}: WatchPartyCreationProps) {
    const tr = useTr()
    return (
        <div className="space-y-4">
            <h4 className="flex items-center gap-2"><LuPopcorn className="size-6" /> Watch Party</h4>
            {isHost && (
                <div className="p-4 border rounded-lg bg-gray-950">
                    <div className="space-y-4">

                        <Button
                            onClick={onCreateWatchParty}
                            disabled={isCreating}
                            className="w-full"
                            intent="primary"
                            leftIcon={<MdAdd />}
                        >
                            {isCreating ? tr("Creating…", "Erstellt …") : tr("Create watch party", "Watch Party erstellen")}
                        </Button>
                    </div>
                </div>
            )}

            {isConnectedToHost && !isHost && hasActiveSession && (
                <div className="p-4 border rounded-lg bg-gray-950">
                    <div className="space-y-4">
                        <p className="text-sm text-[--muted]">
                            {tr("There is an active watch party. Join to watch together in sync.", "Es läuft eine Watch Party. Tritt bei, um gemeinsam synchron zu schauen.")}
                        </p>
                        <Button
                            onClick={onJoinWatchParty}
                            disabled={isJoining}
                            className="w-full"
                            intent="primary"
                            leftIcon={<MdPlayArrow />}
                        >
                            {isJoining ? tr("Joining…", "Tritt bei …") : tr("Join watch party", "Watch Party beitreten")}
                        </Button>
                    </div>
                </div>
            )}

            {!isHost && !isConnectedToHost && (
                <div className="text-center py-8">
                    <p className="text-[--muted]">{tr("Connect to a host to join a watch party", "Verbinde dich mit einem Host, um einer Watch Party beizutreten")}</p>
                </div>
            )}

            {!isHost && isConnectedToHost && !hasActiveSession && (
                <div className="text-center py-8">
                    <p className="text-[--muted]">{tr("No active watch party", "Keine aktive Watch Party")}</p>
                </div>
            )}
        </div>
    )
}

interface WatchPartySessionViewProps {
    session: Nakama_WatchPartySession
    isHost: boolean
    onLeave: () => void
    isLeaving: boolean
    isRoom: boolean
}

function WatchPartySessionView({ session, isHost, onLeave, isLeaving, isRoom }: WatchPartySessionViewProps) {
    const tr = useTr()
    const { sendMessage } = useWebsocketSender()
    const nakamaStatus = useNakamaStatus()
    const participants = Object.values(session.participants || {})
    const participantCount = participants.length
    const serverStatus = useServerStatus()

    const [enablingRelayMode, setEnablingRelayMode] = React.useState(false)

    // Identify current user - either "host" if hosting, or the peer ID if connected as peer
    const currentUserId = isHost ? "host" : nakamaStatus?.hostConnectionStatus?.peerId

    function handleEnableRelayMode(peerId: string) {
        sendMessage({
            type: WSEvents.NAKAMA_WATCH_PARTY_ENABLE_RELAY_MODE,
            payload: { peerId },
        })
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2"><LuPopcorn className="size-6" /> Watch Party</h4>
                <div className="flex items-center gap-2">
                    {/*Enable relay mode*/}
                    {isHost && !session.isRelayMode && !isRoom && (
                        <Tooltip
                            trigger={<IconButton
                                size="sm"
                                intent={!enablingRelayMode ? "primary-subtle" : "primary"}
                                icon={<FaBroadcastTower />}
                                onClick={() => setEnablingRelayMode(p => !p)}
                                className={cn(enablingRelayMode && "animate-pulse")}
                                aria-label={tr("Enable relay mode", "Relay-Modus aktivieren")}
                            />}
                        >
                            {tr("Enable relay mode", "Relay-Modus aktivieren")}
                        </Tooltip>
                    )}
                    <Button
                        onClick={onLeave}
                        disabled={isLeaving}
                        size="sm"
                        intent="alert-basic"
                    >
                        {isLeaving ? tr("Leaving…", "Verlässt …") : isHost ? tr("Stop", "Beenden") : tr("Leave", "Verlassen")}
                    </Button>
                </div>
            </div>


            <h5>{tr("Participants", "Teilnehmer")} ({participantCount})</h5>
            <div className="p-4 border rounded-lg bg-gray-950">
                <div className="space-y-0">
                    {participants.map((participant) => {
                        const isCurrentUser = participant.id === currentUserId
                        return (
                            <div key={participant.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-1">
                                <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm tracking-wide">
                                        {participant.username}
                                        {isCurrentUser && <span className="text-[--muted] font-normal"> ({tr("me", "ich")})</span>}
                                    </span>
                                    {session.isRelayMode && participant.isHost && (
                                        <Badge intent="unstyled" className="text-xs" leftIcon={<FaBroadcastTower />}>Relay</Badge>
                                    )}
                                    {participant.isHost && (
                                        <Badge className="text-xs">Host</Badge>
                                    )}
                                    {participant.isRelayOrigin && (
                                        <Badge intent="warning" className="text-xs">{tr("Origin", "Ursprung")}</Badge>
                                    )}
                                    {enablingRelayMode && !participant.isHost && !participant.isRelayOrigin && !session.isRelayMode && (
                                        <Button
                                            size="sm" intent="white" leftIcon={<HiOutlinePlay />}
                                            onClick={() => handleEnableRelayMode(participant.id)}
                                        >{tr("Promote to origin", "Zum Ursprung machen")}</Button>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-[--muted]">
                                    {!participant.isHost && participant.bufferHealth !== undefined && (
                                        <Tooltip
                                            trigger={<div className="flex items-center gap-1">
                                                <span className="text-xs">{tr("Buffer", "Puffer")}</span>
                                                <div className="w-8 h-1 bg-gray-300 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-green-500 transition-all duration-300"
                                                        style={{ width: `${Math.max(0, Math.min(100, participant.bufferHealth * 100))}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs">{Math.round(participant.bufferHealth * 100)}%</span>
                                            </div>}
                                        >
                                            {tr("Synchronization buffer health", "Zustand des Synchronisations-Puffers")}
                                        </Tooltip>
                                    )}
                                    {participant.latency > 0 && (
                                        <span>{participant.latency}ms</span>
                                    )}
                                    {participant.isBuffering ? (
                                        <Badge intent="alert-solid" className="text-xs">
                                            {tr("Buffering", "Puffert")}
                                        </Badge>
                                    ) : null}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>

        </div>
    )
}
