import { INTERNAL_FeatureKey } from "@/api/generated/types"
import { serverAuthTokenAtom, serverStatusAtom } from "@/app/(main)/_atoms/server-status.atoms"
import { createServerPasswordHMACAuth } from "@/lib/server/hmac-auth"
import { tr } from "@/lib/app-language"
import { TORRENT_PROVIDER } from "@/lib/server/settings"
import { useAtomValue } from "jotai"
import { useAtom } from "jotai"
import { useSetAtom } from "jotai/react"
import React from "react"
import { toast } from "sonner"

export function useServerStatus() {
    return useAtomValue(serverStatusAtom)
}

export function useSetServerStatus() {
    return useSetAtom(serverStatusAtom)
}

export function useCurrentUser() {
    const serverStatus = useServerStatus()
    return React.useMemo(() => serverStatus?.user, [serverStatus?.user])
}

export function useIsSimulatedUser() {
    const serverStatus = useServerStatus()
    return React.useMemo(() => !!serverStatus?.user?.isSimulated, [serverStatus?.user?.isSimulated])
}

export function useHasTorrentProvider() {
    const serverStatus = useServerStatus()
    return {
        hasTorrentProvider: React.useMemo(() => !!serverStatus?.settings?.library?.torrentProvider && serverStatus?.settings?.library?.torrentProvider !== TORRENT_PROVIDER.NONE,
            [serverStatus?.settings?.library?.torrentProvider]),
    }
}

export function useHasDebridService() {
    const serverStatus = useServerStatus()
    return {
        hasDebridService: React.useMemo(() => !!serverStatus?.debridSettings?.enabled && !!serverStatus?.debridSettings?.provider,
            [serverStatus?.debridSettings]),
    }
}

export function useHasTorrentStreaming() {
    const serverStatus = useServerStatus()
    return {
        hasTorrentStreaming: React.useMemo(() => !!serverStatus?.torrentstreamSettings?.enabled,
            [serverStatus?.torrentstreamSettings]),
    }
}

export function useHasOnlineStreaming() {
    const serverStatus = useServerStatus()
    return {
        hasOnlineStreaming: React.useMemo(() =>
                (!!serverStatus?.settings?.library?.enableOnlinestream),
            [serverStatus?.settings?.library]),
    }
}

export function useSelectedDebridService() {
    const serverStatus = useServerStatus()
    return {
        selectedDebridService: React.useMemo(() => serverStatus?.debridSettings?.provider,
            [serverStatus?.debridSettings]),
    }
}

export function useHasTorrentOrDebridInclusion() {
    const serverStatus = useServerStatus()
    const { hasDebridService } = useHasDebridService()
    const { hasTorrentStreaming } = useHasTorrentStreaming()
    const { hasOnlineStreaming } = useHasOnlineStreaming()
    return {
        hasStreamingEnabled: hasOnlineStreaming || hasTorrentStreaming || hasDebridService,
        hasTorrentOrDebridInclusion: React.useMemo(() =>
                (!!serverStatus?.debridSettings?.enabled && !!serverStatus?.debridSettings?.provider && !!serverStatus?.debridSettings?.includeDebridStreamInLibrary) ||
                (!!serverStatus?.torrentstreamSettings?.enabled && serverStatus?.torrentstreamSettings?.includeInLibrary),
            [serverStatus?.debridSettings, serverStatus?.torrentstreamSettings]),
    }
}

export function useServerHMACAuth() {
    const serverStatus = useServerStatus()
    const [password] = useAtom(serverAuthTokenAtom)

    return {
        password,
        getHMACTokenQueryParam: async (endpoint: string, symbol?: string): Promise<string> => {
            if (!serverStatus?.serverHasPassword || !password) return ""

            try {
                const hmacAuth = createServerPasswordHMACAuth(password)
                return await hmacAuth.generateQueryParam(endpoint, symbol)
            }
            catch {
                console.error("Failed to generate HMAC token")
                return ""
            }
        },
        generateHMACToken: async (endpoint: string) => {
            if (!serverStatus?.serverHasPassword || !password) return ""

            try {
                const hmacAuth = createServerPasswordHMACAuth(password)
                return await hmacAuth.generateToken(endpoint)
            }
            catch {
                console.error("Failed to generate HMAC token")
                return ""
            }
        },
    }
}

export function useServerDisabledFeatures() {
    const status = useServerStatus()

    return {
        isFeatureDisabled: (feature: INTERNAL_FeatureKey) => {
            if (!status?.disabledFeatures?.length) return false
            return status?.disabledFeatures?.includes(feature)
        },
        showFeatureWarning: () => {
            return toast.warning(tr("This feature is disabled", "Diese Funktion ist deaktiviert"))
        },
    }
}
