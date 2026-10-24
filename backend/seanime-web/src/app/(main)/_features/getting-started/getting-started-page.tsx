import { Status } from "@/api/generated/types"
import { useGettingStarted } from "@/api/hooks/settings.hooks"
import { useSetServerStatus } from "@/app/(main)/_hooks/use-server-status"
import { MobileGettingStarted } from "@/app/(main)/_features/getting-started/getting-started-mobile"
import { Form } from "@/components/ui/form"
import { useRouter } from "@/lib/navigation"
import {
    getDefaultIinaSocket,
    getDefaultMpvSocket,
    getDefaultSettings,
    gettingStartedSchema,
    useDefaultSettingsPaths,
} from "@/lib/server/settings"
import React from "react"

export function GettingStartedPage({ status }: { status: Status }) {
    const router = useRouter()
    const { getDefaultVlcPath, getDefaultQBittorrentPath, getDefaultTransmissionPath } = useDefaultSettingsPaths()
    const setServerStatus = useSetServerStatus()

    const { mutate, data, isPending, isSuccess } = useGettingStarted()

    /**
     * If the settings are returned, redirect to the home page
     */
    React.useEffect(() => {
        if (!isPending && !!data?.settings) {
            setServerStatus(data)
            router.push("/")
        }
    }, [data, isPending])

    const vlcDefaultPath = React.useMemo(() => getDefaultVlcPath(status.os), [status.os])
    const qbittorrentDefaultPath = React.useMemo(() => getDefaultQBittorrentPath(status.os), [status.os])
    const transmissionDefaultPath = React.useMemo(() => getDefaultTransmissionPath(status.os), [status.os])
    const mpvSocketPath = React.useMemo(() => getDefaultMpvSocket(status.os), [status.os])
    const iinaSocketPath = React.useMemo(() => getDefaultIinaSocket(status.os), [status.os])

    const defaultValues = {
        mediaPlayerHost: "127.0.0.1",
        vlcPort: 8080,
        mpcPort: 13579,
        defaultPlayer: "mpv",
        vlcPath: vlcDefaultPath,
        qbittorrentPath: qbittorrentDefaultPath,
        qbittorrentHost: "127.0.0.1",
        qbittorrentPort: 8081,
        transmissionPath: transmissionDefaultPath,
        transmissionHost: "127.0.0.1",
        transmissionPort: 9091,
        mpcPath: "C:/Program Files/MPC-HC/mpc-hc64.exe",
        torrentProvider: "",
        mpvSocket: mpvSocketPath,
        iinaSocket: iinaSocketPath,
        enableRichPresence: false,
        autoScan: false,
        enableManga: true,
        // on Android, online streaming is the main way to watch
        enableOnlinestream: true,
        enableAdultContent: false,
        enableTorrentStreaming: false,
        enableTranscode: false,
        debridProvider: "none",
        debridApiKey: "",
        nakamaUsername: "",
        enableWatchContinuity: true,
    }

    if (!data) return (
        <Form
            schema={gettingStartedSchema}
            onSubmit={data => mutate(getDefaultSettings({
                ...data,
                libraryPath: "",
                torrentProvider: "",
                defaultTorrentClient: "none",
                enableTorrentStreaming: false,
                debridProvider: "none",
                debridApiKey: "",
            }))}
            defaultValues={defaultValues}
        >
            <MobileGettingStarted pending={isPending} />
        </Form>
    )
}
