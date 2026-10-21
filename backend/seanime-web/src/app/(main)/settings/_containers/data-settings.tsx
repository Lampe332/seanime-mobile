import { getServerBaseUrl } from "@/api/client/server-url"
import { useImportLocalFiles } from "@/api/hooks/localfiles.hooks"
import { fileTimestamp, useSaveServerFile } from "@/app/(main)/_hooks/use-save-server-file"
import { useServerHMACAuth } from "@/app/(main)/_hooks/use-server-status"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { TextInput } from "@/components/ui/text-input"
import { openTab } from "@/lib/helpers/browser"
import React from "react"
import { CgImport } from "react-icons/cg"
import { TbDatabaseExport } from "react-icons/tb"
import { toast } from "sonner"

const IS_ANDROID_APP = import.meta.env.SEA_PUBLIC_PLATFORM === "mobile"

type DataSettingsProps = {
    children?: React.ReactNode
}

export function DataSettings(props: DataSettingsProps) {

    const {
        children,
        ...rest
    } = props

    const { mutate: importLocalFiles, isPending: isImportingLocalFiles } = useImportLocalFiles()
    const [localFileDataPath, setLocalFileDataPath] = React.useState("")

    function handleImportLocalFiles() {
        if (!localFileDataPath) return

        importLocalFiles({ dataFilePath: localFileDataPath }, {
            onSuccess: () => {
                setLocalFileDataPath("")
            },
        })
    }

    const { getHMACTokenQueryParam } = useServerHMACAuth()
    const saveServerFile = useSaveServerFile()

    const handleExportLocalFiles = React.useCallback(async () => {
        // A new tab does nothing in the Android app; the file goes through the "Save as" dialog instead
        if (IS_ANDROID_APP) {
            try {
                await saveServerFile("/api/v1/library/local-files/dump", `seanime-localfiles-${fileTimestamp()}.json`)
            }
            catch {
                toast.error("Failed to export local file data")
            }
            return
        }
        try {
            const endpoint = "/api/v1/library/local-files/dump"
            const tokenQuery = await getHMACTokenQueryParam(endpoint)
            openTab(`${getServerBaseUrl()}${endpoint}${tokenQuery}`)
        }
        catch (error) {
            toast.error("Failed to generate export token")
        }
    }, [getHMACTokenQueryParam, saveServerFile])

    return (
        <div className="space-y-4">

            <div>
                <h5>Local files</h5>

                <p className="text-[--muted]">
                    Scanned local file data.
                </p>
            </div>

            <div className="flex flex-wrap gap-2">
                <Button
                    intent="primary-subtle"
                    leftIcon={<TbDatabaseExport className="text-xl" />}
                    size="md"
                    disabled={isImportingLocalFiles}
                    onClick={handleExportLocalFiles}
                >
                    Export local file data
                </Button>

                {/* Import reads a path on the server; Android has no way to pick that file, so it only exports */}
                {!IS_ANDROID_APP && <Modal
                    title="Import local files"
                    trigger={
                        <Button
                            intent="white-subtle"
                            leftIcon={<CgImport className="text-xl" />}
                            size="md"
                            disabled={isImportingLocalFiles}
                        >
                            Import local files
                        </Button>
                    }
                >

                    <p>
                        This will overwrite your existing library data, make sure you have a backup.
                    </p>

                    <TextInput
                        label="Data file path"
                        help="The path to the JSON file containing the local file data."
                        value={localFileDataPath}
                        onValueChange={setLocalFileDataPath}
                    />

                    <Button
                        intent="white"
                        rounded
                        onClick={handleImportLocalFiles}
                        disabled={isImportingLocalFiles}
                    >Import</Button>

                </Modal>}
            </div>
        </div>
    )
}
