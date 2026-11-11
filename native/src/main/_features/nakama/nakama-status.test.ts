import type { Nakama_NakamaStatus, Nakama_WatchPartySessionParticipant } from "@/api/generated/types"
import { describe, expect, it } from "vitest"
import { nakamaBadge, participantTags, watchPartyMembership } from "./nakama-status"

const person = (id: string, extra: Partial<Nakama_WatchPartySessionParticipant> = {}) => ({
    id, username: id, isHost: false, canControl: false, isReady: true, latency: 0, useDenshiPlayer: false, isBuffering: false, bufferHealth: 1,
    isRelayOrigin: false, ...extra,
}) as Nakama_WatchPartySessionParticipant

const status = (extra: Partial<Nakama_NakamaStatus>) => ({ isHost: false, isConnectedToHost: true, connectionMode: "direct", ...extra }) as Nakama_NakamaStatus

describe("watchPartyMembership", () => {
    const session = { id: "s", isRelayMode: false, isRoom: false, participants: { host: person("host", { isHost: true }), p1: person("p1"), p2: person("p2", { isRelayOrigin: true }) } }
    it("sees a peer in the session", () => {
        const m = watchPartyMembership(status({ hostConnectionStatus: { peerId: "p1" } as never, currentWatchPartySession: session }))
        expect(m).toEqual({ me: "p1", isHost: false, isParticipant: true, isPeer: true })
    })
    it("the relay origin is a participant, not a peer", () => {
        const m = watchPartyMembership(status({ hostConnectionStatus: { peerId: "p2" } as never, currentWatchPartySession: session }))
        expect(m.isParticipant).toBe(true)
        expect(m.isPeer).toBe(false)
    })
    it("a device outside the session can join it", () => {
        const m = watchPartyMembership(status({ hostConnectionStatus: { peerId: "p9" } as never, currentWatchPartySession: session }))
        expect(m.isParticipant).toBe(false)
    })
    it("the host is always in its session", () => {
        expect(watchPartyMembership(status({ isHost: true, currentWatchPartySession: session })).isHost).toBe(true)
        expect(watchPartyMembership(undefined)).toEqual({ me: null, isHost: false, isParticipant: false, isPeer: false })
    })
})

describe("participantTags and badge", () => {
    const t = (en: string) => en
    it("lists host, relay, origin and buffer", () => {
        expect(participantTags(person("h", { isHost: true }), true, t)).toBe("Host · Relay")
        expect(participantTags(person("o", { isRelayOrigin: true, bufferHealth: 0.456 }), false, t)).toBe("Origin · Buffer 46 %")
    })
    it("counts connected devices only while hosting", () => {
        expect(nakamaBadge(status({ isHost: true, connectedPeers: ["a", "b"] }))).toBe(2)
        expect(nakamaBadge(status({ connectedPeers: ["a"] }))).toBe(0)
    })
})
