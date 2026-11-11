import type { Nakama_NakamaStatus, Nakama_WatchPartySessionParticipant as Nakama_WatchPartyParticipant } from "@/api/generated/types"
import type { Translate } from "@/lib/app-language"

/*
 * What the Nakama sheet and the watch party read from the status (web nakama-manager.tsx useNakamaWatchParty and
 * nakama-phone.tsx), without the screen.
 */

export type WatchPartyMembership = {
    /** "host" while hosting, else this device's peer id */
    me: string | null
    isHost: boolean
    /** in the running session (the host always is) */
    isParticipant: boolean
    /** a participant that follows the origin (not the host, not the relay origin) */
    isPeer: boolean
}

export function watchPartyMembership(status: Nakama_NakamaStatus | null | undefined): WatchPartyMembership {
    const session = status?.currentWatchPartySession
    const me = status?.isHost ? "host" : status?.hostConnectionStatus?.peerId || null
    const isParticipant = !!session?.participants && (!!status?.isHost || (!!me && me in session.participants))
    const isPeer = isParticipant && me !== "host" && !!me && !session?.participants?.[me]?.isRelayOrigin
    return { me, isHost: me === "host", isParticipant, isPeer }
}

/** The quiet line under a participant: Host, Relay, Origin, buffer (nakama-phone.tsx) */
export function participantTags(participant: Nakama_WatchPartyParticipant, relayMode: boolean, t: Translate) {
    return [
        participant.isHost && "Host",
        relayMode && participant.isHost && "Relay",
        participant.isRelayOrigin && t("Origin", "Ursprung"),
        !participant.isHost && participant.bufferHealth !== undefined && `${t("Buffer", "Puffer")} ${Math.round(participant.bufferHealth * 100)} %`,
    ].filter(Boolean).join(" · ")
}

/** The Menu's Nakama entry badge: devices connected to this host (main-sidebar.tsx) */
export function nakamaBadge(status: Nakama_NakamaStatus | null | undefined) {
    return status?.isHost ? status.connectedPeers?.length ?? 0 : 0
}
