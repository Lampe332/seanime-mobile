import { useClearFileCacheMediastreamVideoFiles, useGetFileCacheTotalSize, useRemoveFileCacheBucket } from "@/api/hooks/filecache.hooks"
import { ConfirmationDialog, useConfirmationDialog } from "@/components/shared/confirmation-dialog"
import { Button } from "@/components/ui/button"
import React from "react"
import { SettingsCard } from "../_components/settings-card"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

type FilecacheSettingsProps = {
    children?: React.ReactNode
}

export function FilecacheSettings(props: FilecacheSettingsProps) {

    const {
        children,
        ...rest
    } = props


    const { data: totalSize, mutate: getTotalSize, isPending: isFetchingSize } = useGetFileCacheTotalSize()

    const { mutate: clearBucket, isPending: _isClearing } = useRemoveFileCacheBucket(() => {
        getTotalSize()
    })

    const { mutate: clearMediastreamCache, isPending: _isClearing2 } = useClearFileCacheMediastreamVideoFiles(() => {
        getTotalSize()
    })

    const isClearing = _isClearing || _isClearing2

    const [bucket, setBucket] = React.useState<"manga" | "onlinestream">("manga")
    const clearDialog = useConfirmationDialog({
        title: bucket === "manga" ? "Clear manga cache" : "Clear online streaming cache",
        description: bucket === "manga"
            ? "Cached chapter lists and pages will be fetched again from the sources."
            : "Cached episode lists and stream links will be fetched again from the sources.",
        actionText: "Clear",
        actionIntent: "warning",
        onConfirm: () => clearBucket({ bucket }),
    })

    return (
        <div className="space-y-4">
            <div className="flex gap-2 items-center">
                <Button intent="white-subtle" size="sm" onClick={() => getTotalSize()} disabled={isFetchingSize}>
                    Show total size
                </Button>
                {!!totalSize && (
                    <p>
                        {totalSize}
                    </p>
                )}
            </div>

            <SettingsCard>
                <div className="flex gap-2 flex-wrap items-center">
                    <Button intent="warning-subtle" onClick={() => { setBucket("manga"); clearDialog.open() }} disabled={isClearing}>
                        Clear manga cache
                    </Button>
                    {/* Transcoding cache; Android has no transcoding */}
                    {!IS_ANDROID_APP && <Button intent="warning-subtle" onClick={() => clearMediastreamCache()} disabled={isClearing}>
                        Clear media streaming cache
                    </Button>}
                    <Button intent="warning-subtle" onClick={() => { setBucket("onlinestream"); clearDialog.open() }} disabled={isClearing}>
                        Clear online streaming cache
                    </Button>
                </div>
            </SettingsCard>

            <ConfirmationDialog {...clearDialog} />


            {/*<SettingsCard title="TVDB" description="Episode image metadata fetched from TVDB.">*/}
            {/*    <Button intent="alert-subtle" onClick={() => clearBucket({ bucket: "tvdb" })} disabled={isClearing}>*/}
            {/*        Clear metadata*/}
            {/*    </Button>*/}
            {/*</SettingsCard>*/}

        </div>
    )
}
